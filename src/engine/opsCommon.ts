import { isSuspendedOn, issueDocument } from './business.ts';
import { currentOperator } from './operator.ts';
import { CommandError, ensureParty } from './core.ts';
import type { IsoDate } from './date.ts';
import { RULES_2026 as R } from './legal.ts';
import { formatPLN, mulBps } from './money.ts';
import type { Grosze } from './money.ts';
import type { Operator, GameState } from './state.ts';

/** Wspólne pomocnicze funkcje komend firmowych (kontrola działalności i gotówki, zakupy przez dokumenty). */

export const SUPPLIER_PARTY = 'party:supplier-reno';

export const vatRateNow = (b: Operator): number => (b.vat.status === 'active' ? R.vat.rateBps : 0);
export const grossOfNet = (net: Grosze, vatBps: number): Grosze => net + mulBps(net, vatBps);

export function requireBusiness(s: GameState): Operator {
  const b = currentOperator(s);
  if (!b) throw new CommandError(s.corp.context ? 'Spółka nie prowadzi działalności.' : 'Nie prowadzisz działalności.');
  if (s.clock.today < b.startDate) throw new CommandError('Działalność jeszcze się nie rozpoczęła.');
  if (b.closeOn !== null) throw new CommandError('Działalność jest w trakcie zamykania.');
  return b;
}

export function requireActiveBusiness(s: GameState): Operator {
  const b = requireBusiness(s);
  if (isSuspendedOn(b, s.clock.today) || b.suspensions.some((x) => x.from > s.clock.today)) throw new CommandError('Działalność jest zawieszona — ta operacja jest niedostępna.');
  return b;
}

/** Gotówka firmy po odliczeniu zobowiązań już wymagalnych (nie wolno wydać pieniędzy, które są już „zajęte”). */
export function availableCash(s: GameState, b: Operator): Grosze {
  let due = 0;
  for (const o of s.obligations) if (o.accountId === b.accountId && o.status === 'open' && o.direction === 'payable' && o.dueDate <= s.clock.today) due += o.amount;
  return s.accounts[b.accountId]!.balance - due;
}

export function requireCash(s: GameState, b: Operator, net: Grosze, withVat = true): void {
  const need = withVat && b.vat.status === 'active' ? grossOfNet(net, R.vat.rateBps) : net;
  const have = availableCash(s, b);
  if (have < need) throw new CommandError(`Za mało środków na rachunku firmowym (dostępne ${formatPLN(Math.max(0, have))}, potrzeba ${formatPLN(need)}). Zrób wkład własny na rachunek firmowy.`);
}

export function supplier(s: GameState): void {
  ensureParty(s, { id: SUPPLIER_PARTY, name: 'Hurtownie i dostawcy materiałów (fikcyjni)', role: 'service' });
}

export function purchaseCost(s: GameState, b: Operator, net: Grosze, description: string, orderId: string | null = null, date: IsoDate = s.clock.today): { docId: string; taxAmount: Grosze } {
  supplier(s);
  const doc = issueDocument(s, b, { kind: 'cost', issueDate: date, counterpartyId: SUPPLIER_PARTY, orderId, description, net, termDays: 0 });
  return { docId: doc.id, taxAmount: doc.taxAmount };
}
