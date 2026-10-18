import { CommandError, accountById, createObligation, logEvent, nextCounter, periodLabel, postTransaction } from './core.ts';
import { dateInMonth, daysInMonth, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { assertGrosze, formatPLN, mulBps, roundDiv } from './money.ts';
import type { Grosze } from './money.ts';
import type { GameState, SavingsInterestRule } from './state.ts';

/** Przelew między własnymi rachunkami: dwa wpisy o przeciwnych znakach, majątek netto bez zmian. */
export function transferFunds(s: GameState, fromId: string, toId: string, amount: Grosze): string {
  const from = s.accounts[fromId];
  const to = s.accounts[toId];
  if (!from || !to) throw new CommandError('Nieznany rachunek.');
  if (from.id === to.id) throw new CommandError('Wybierz dwa różne rachunki.');
  if (from.ownerId !== s.person.id || to.ownerId !== s.person.id) throw new CommandError('Przelew możliwy tylko między własnymi rachunkami.');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new CommandError('Kwota musi być dodatnia (z dokładnością do grosza).');
  if (from.balance < amount) throw new CommandError(`Brak środków na rachunku „${from.name}” (dostępne ${formatPLN(from.balance)}).`);
  const today = s.clock.today;
  const n = nextCounter(s, 'transfer');
  const transferId = `transfer:${n}`;
  const desc = `Przelew własny: ${from.name} → ${to.name}`;
  postTransaction(s, { eventId: `${transferId}:out`, accountId: from.id, date: today, amount: -amount, category: 'przelew_wlasny', description: desc, counterpartyId: null, obligationId: null, transferId });
  postTransaction(s, { eventId: `${transferId}:in`, accountId: to.id, date: today, amount, category: 'przelew_wlasny', description: desc, counterpartyId: null, obligationId: null, transferId });
  logEvent(s, {
    id: `savings.transfer:${transferId}`, date: today, type: 'savings.transfer', tone: 'neutral',
    title: desc, detail: `${formatPLN(amount)} · majątek netto bez zmian`, amount: null, category: 'przelew_wlasny',
  });
  return `Przelano ${formatPLN(amount)}.`;
}

/**
 * Kapitalizacja odsetek. Każdego dnia dolicza saldo na początek dnia do akumulatora (grosze·dni);
 * ostatniego dnia miesiąca liczy odsetki JEDNYM zaokrągleniem (saldo·dni·stopa / (10 000·365)) i księguje
 * je jako odrębne operacje: należność z tytułu odsetek oraz — osobno — podatek od odsetek.
 * Stopy to konfigurowalne parametry (status danych w koncie), nie fakty prawne.
 */
export function applySavingsInterest(s: GameState, rule: SavingsInterestRule, date: IsoDate): void {
  if (date < rule.startDate) return;
  const acc = accountById(s, rule.accountId);
  const cfg = acc.interest;
  if (!cfg) return;
  if (cfg.lastAccrualDate !== null && date <= cfg.lastAccrualDate) return; // idempotencja
  cfg.accumulator += acc.balance;
  assertGrosze(cfg.accumulator, 'akumulator odsetek');
  cfg.lastAccrualDate = date;

  const { year, month, day } = parseIso(date);
  if (day !== daysInMonth(year, month)) return;
  const interest = roundDiv(cfg.accumulator * cfg.rateBps, 10_000 * 365);
  cfg.accumulator = 0;
  if (interest <= 0) return;
  const monthEnd = dateInMonth(year, month, 'last');
  const base = { ruleId: rule.id, counterpartyId: rule.counterpartyId, accountId: acc.id, issueDate: monthEnd, dueDate: monthEnd };
  createObligation(s, {
    ...base, occurrenceId: `${rule.id}@${date}:interest`, direction: 'receivable', amount: interest,
    category: 'odsetki', description: periodLabel('Odsetki od oszczędności', monthEnd),
  });
  const tax = mulBps(interest, cfg.taxBps);
  if (tax > 0) {
    createObligation(s, {
      ...base, occurrenceId: `${rule.id}@${date}:tax`, direction: 'payable', amount: tax,
      category: 'podatek_odsetki', description: periodLabel('Podatek od odsetek', monthEnd),
    });
  }
}
