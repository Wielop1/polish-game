import { addMonthsToKey, ageOn, monthKey } from './date.ts';
import type { IsoDate } from './date.ts';
import type { Grosze } from './money.ts';
import type { Account, GameState, Obligation } from './state.ts';

export function playerAccount(s: GameState): Account {
  const acc = s.accounts[s.playerAccountId];
  if (!acc) throw new Error(`Brak rachunku gracza: ${s.playerAccountId}`);
  return acc;
}

export function cash(s: GameState): Grosze {
  return playerAccount(s).balance;
}

export interface NetWorthBreakdown {
  cash: Grosze;
  /** Otwarte należności gracza (np. naliczona, niewypłacona pensja). */
  receivables: Grosze;
  /** Otwarte zobowiązania gracza (np. naliczony, nieopłacony czynsz). */
  payables: Grosze;
  netWorth: Grosze;
}

export function openObligations(s: GameState, direction?: Obligation['direction']): Obligation[] {
  return s.obligations.filter((o) => o.status === 'open' && (!direction || o.direction === direction));
}

/** Majątek netto = gotówka + otwarte należności − otwarte zobowiązania (v0.1: brak innych aktywów). */
export function netWorthBreakdown(s: GameState): NetWorthBreakdown {
  let receivables = 0;
  let payables = 0;
  for (const o of s.obligations) {
    if (o.status !== 'open') continue;
    if (o.direction === 'receivable') receivables += o.amount;
    else payables += o.amount;
  }
  const c = cash(s);
  return { cash: c, receivables, payables, netWorth: c + receivables - payables };
}

export function netWorth(s: GameState): Grosze {
  return netWorthBreakdown(s).netWorth;
}

export function overdueObligations(s: GameState): Obligation[] {
  return s.obligations.filter((o) => o.status === 'open' && o.overdueSince !== null);
}

export function playerAge(s: GameState, on: IsoDate = s.clock.today): number {
  return ageOn(s.person.birthDate, on);
}

export interface MonthSummary {
  month: string; // YYYY-MM
  /** Przychody memoriałowo (naliczone w miesiącu). */
  income: Grosze;
  /** Koszty memoriałowo (naliczone w miesiącu). */
  expenses: Grosze;
  result: Grosze;
  /** Przepływy pieniężne (zaksięgowane na rachunku), bez kapitału początkowego. */
  cashIn: Grosze;
  cashOut: Grosze;
  closingCash: Grosze | null;
  closingNetWorth: Grosze | null;
  expensesByCategory: Record<string, Grosze>;
  /** Czy miesiąc jest już zakończony (jego ostatni dzień został przetworzony). */
  complete: boolean;
}

/** Miesięczne podsumowania od miesiąca startu do bieżącego. */
export function monthlySummaries(s: GameState): MonthSummary[] {
  const firstKey = monthKey(s.clock.startDate);
  const lastKey = monthKey(s.clock.today);
  const map = new Map<string, MonthSummary>();
  for (let key = firstKey; key <= lastKey; key = addMonthsToKey(key, 1)) {
    map.set(key, {
      month: key,
      income: 0,
      expenses: 0,
      result: 0,
      cashIn: 0,
      cashOut: 0,
      closingCash: null,
      closingNetWorth: null,
      expensesByCategory: {},
      complete: false,
    });
  }
  for (const o of s.obligations) {
    const m = map.get(monthKey(o.issueDate));
    if (!m) continue;
    if (o.direction === 'receivable') m.income += o.amount;
    else {
      m.expenses += o.amount;
      m.expensesByCategory[o.category] = (m.expensesByCategory[o.category] ?? 0) + o.amount;
    }
  }
  for (const tx of s.ledger) {
    if (tx.category === 'kapital_poczatkowy') continue;
    const m = map.get(monthKey(tx.date));
    if (!m) continue;
    if (tx.amount > 0) m.cashIn += tx.amount;
    else m.cashOut += -tx.amount;
  }
  for (const p of s.history) {
    const m = map.get(monthKey(p.date));
    if (!m) continue;
    m.closingCash = p.cash;
    m.closingNetWorth = p.netWorth;
  }
  const lastDay = s.clock.today;
  for (const m of map.values()) {
    m.result = m.income - m.expenses;
    m.complete = m.month < monthKey(lastDay);
  }
  return [...map.values()];
}
