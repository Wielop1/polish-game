import { CORP } from './corpConfig.ts';
import { citAdvancesAccrued, citRateFor, companyBalance, companyTaxFigures, lossAvailable, roundToZl } from './companyFinance.ts';
import { createObligation, ensureParty, logEvent, nextCounter } from './core.ts';
import { addDays, dateInMonth, monthKey, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { carriedForward } from './legal.ts';
import { formatPLN, mulBps } from './money.ts';
import type { CitReturn, Company, GameState } from './state.ts';

export const US = 'party:us';

/**
 * CIT spółki z o.o. (v0.8): zaliczki miesięczne metodą narastającą i roczne rozliczenie. Podstawa = przychody − koszty z dokumentów spółki
 * (kwoty podatkowe wspólnego silnika). Oddzielone są: zysk księgowy (zmiana aktywów netto), podstawa opodatkowania, gotówka i kapitały własne —
 * wpływ z objęcia udziałów (wkład na kapitał) nie jest przychodem ze sprzedaży usług i nie trafia do podstawy.
 * Stawka 9% jest stosowana tylko po sprawdzeniu limitu przychodów i statusu podatnika (`citRateFor`).
 */

/** Zaliczka za miesiąc kończący się `date` (ostatni dzień miesiąca): różnica między podatkiem narastająco a zaliczkami już naliczonymi. */
export function accrueCitAdvance(s: GameState, c: Company, date: IsoDate): void {
  if (!c.operation) return;
  const { year } = parseIso(date);
  const month = monthKey(date);
  const figs = companyTaxFigures(s, c, year, date);
  if (figs.revenue === 0 && figs.costs === 0) return;
  const rate = citRateFor(s, c, year, figs.revenue);
  const taxCum = figs.income > 0 ? roundToZl(mulBps(figs.income, rate.rateBps)) : 0;
  const already = citAdvancesAccrued(s, c, year);
  const advance = taxCum - already;
  if (advance <= 0) return;
  ensureParty(s, { id: US, name: 'Urząd Skarbowy', role: 'service' });
  const nextMonth = parseIso(addDays(date, 1));
  createObligation(s, {
    occurrenceId: `cit:adv:${c.id}:${month}`, ruleId: `cit:adv:${c.id}:${year}`, direction: 'payable', counterpartyId: US, accountId: c.accountId, scope: 'company',
    amount: advance, issueDate: date, dueDate: dateInMonth(nextMonth.year, nextMonth.month, 20), category: 'cit_zaliczka',
    description: `Zaliczka CIT ${c.name} sp. z o.o. za ${month} (${rate.rateBps / 100}%, dochód narastająco ${formatPLN(figs.income, { round: true })})`,
  });
}

/** Zamknięcie roku podatkowego (31 grudnia): zeznanie CIT-8 (automatycznie), strata, saldo do zapłaty do 31 marca albo nadpłata. */
export function closeCitYear(s: GameState, c: Company, date: IsoDate): CitReturn | null {
  if (!c.operation && c.status !== 'registered') return null;
  const { year } = parseIso(date);
  const id = `cit:${c.id}:${year}`;
  if (s.processed[id]) return null;
  s.processed[id] = true;
  const figs = companyTaxFigures(s, c, year);
  const rate = citRateFor(s, c, year, figs.revenue);
  const income = figs.income;
  // strata z lat ubiegłych: do 5 lat, nie więcej niż 50% straty rocznie
  const avail = lossAvailable(s, c, year);
  const lossDeducted = income > 0 ? Math.min(income, avail.total) : 0;
  let left = lossDeducted;
  for (const part of avail.parts) {
    if (left <= 0) break;
    const use = Math.min(left, part.amount);
    s.corp.citLosses.find((l) => l.id === part.lossId)!.usages.push({ year, amount: use });
    left -= use;
  }
  const base = roundToZl(Math.max(0, income - lossDeducted));
  const tax = roundToZl(mulBps(base, rate.rateBps));
  const advances = citAdvancesAccrued(s, c, year);
  const balance = tax - advances;
  if (income < 0) s.corp.citLosses.push({ id: `loss:${c.id}:${year}`, companyId: c.id, year, amount: -income, usages: [] });
  ensureParty(s, { id: US, name: 'Urząd Skarbowy', role: 'service' });
  const due = `${year + 1}-03-31`;
  let obligationId: string | null = null;
  if (balance !== 0) {
    const ob = createObligation(s, {
      occurrenceId: `${id}:obl`, ruleId: 'rule:cit-annual', direction: balance > 0 ? 'payable' : 'receivable', counterpartyId: US, accountId: c.accountId, scope: 'company',
      amount: Math.abs(balance), issueDate: date, dueDate: balance > 0 ? due : addDays(date, 45), category: balance > 0 ? 'cit_roczny' : 'cit_roczny',
      description: balance > 0 ? `CIT-8 ${year}: dopłata podatku (${c.name} sp. z o.o.)` : `CIT-8 ${year}: nadpłata do zwrotu (${c.name} sp. z o.o.)`,
    });
    obligationId = ob?.id ?? null;
  }
  const ret: CitReturn = {
    id: `citret:${c.id}:${year}`, companyId: c.id, year, revenue: figs.revenue, costs: figs.costs, income, lossDeducted, base, rateBps: rate.rateBps, rateReason: rate.reason.slice(0, 240),
    tax, advances, balance, dueDate: due, obligationId, smallTaxpayer: rate.smallTaxpayer, startYear: rate.startYear, carriedForward: carriedForward(year),
  };
  s.corp.citReturns.push(ret);
  nextCounter(s, 'cit:return');
  logEvent(s, {
    id: `corp.tax:${ret.id}`, date, type: 'corp.tax', tone: balance > 0 ? 'warning' : 'neutral',
    title: `CIT-8 za ${year}: ${c.name} sp. z o.o. — ${income < 0 ? `strata ${formatPLN(-income, { round: true })}` : `podatek ${formatPLN(tax, { round: true })}`}`,
    detail: `${rate.reason} · zaliczki ${formatPLN(advances, { round: true })} · ${balance > 0 ? `do zapłaty ${formatPLN(balance, { round: true })} do 31 marca` : balance < 0 ? `nadpłata ${formatPLN(-balance, { round: true })}` : 'bez dopłaty'}`.slice(0, 290),
    amount: null, category: null,
  });
  void companyBalance; void CORP;
  return ret;
}
