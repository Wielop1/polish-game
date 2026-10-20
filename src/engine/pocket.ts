import { activeBusiness, formOn, profileOf } from './business.ts';
import { addDays, dateInMonth, monthKey, parseIso } from './date.ts';
import { mulBps, roundDiv, zl } from './money.ts';
import type { Grosze } from './money.ts';
import { currentOperator } from './operator.ts';
import { fixedCosts } from './profitability.ts';
import type { GameState } from './state.ts';

/**
 * „Ile zostaje po wszystkim” dla jednego zlecenia (v0.8.1, tylko szacunek do wyceny — nic nie księguje):
 * nadwyżka − udział w kosztach stałych firmy (ZUS i zdrowotna właściciela, księgowość, reklama, stałe koszty pojazdów, rekrutacja)
 * − orientacyjny podatek dochodowy. Koszty stałe bierzemy z dwóch ostatnich pełnych miesięcy (większy z nich; płace zatrudnionych
 * są już w kosztach zlecenia, bezczynność pracowników nie jest doliczana do pojedynczego zlecenia).
 */
export interface PocketEstimate {
  workDays: number;
  fixedMonthly: Grosze;
  /** Czy znamy koszty stałe z historii (nowa firma w pierwszym miesiącu ich nie ma — wtedy szacunek jest zawyżony). */
  fixedKnown: boolean;
  fixedShare: Grosze;
  taxEstimate: Grosze;
  taxLabel: string;
  pocket: Grosze;
  /** Kwota na dzień roboczy zlecenia i przeliczenie na miesiąc przy pełnym kalendarzu (21 dni roboczych). */
  perDay: Grosze;
  perMonthFull: Grosze;
}

const WORKDAYS_PER_MONTH = 21;
/** Nowa firma nie ma jeszcze miesiąca kosztów stałych: przyjmujemy typowe 2 500 zł (składki właściciela po ulgach, księgowość, drobne). */
const FALLBACK_FIXED_MONTHLY = zl(2_500);

export function estimatePocket(s: GameState, surplus: Grosze, revenueNet: Grosze, workDays: number): PocketEstimate | null {
  const op = currentOperator(s);
  if (!op) return null;
  const today = s.clock.today;
  const first = dateInMonth(parseIso(today).year, parseIso(today).month, 1);
  const prev = monthKey(addDays(first, -1));
  const prev2 = monthKey(addDays(`${prev}-01`, -1));
  const fixedOf = (m: string): Grosze => { const f = fixedCosts(s, m); return f.total - f.payrollIdle; };
  const known = Math.max(fixedOf(prev), fixedOf(prev2));
  const fixedMonthly = known > 0 ? known : FALLBACK_FIXED_MONTHLY;
  const days = Math.max(1, Math.round(workDays));
  const fixedShare = roundDiv(fixedMonthly * days, WORKDAYS_PER_MONTH);
  const base = Math.max(0, surplus - fixedShare);
  let tax: Grosze;
  let taxLabel: string;
  if (s.corp.context !== null) { tax = mulBps(base, 900); taxLabel = 'CIT 9%'; } else {
    const jdg = activeBusiness(s);
    const form = jdg ? formOn(jdg, today) : 'skala';
    if (form === 'ryczalt') { const rate = profileOf(op).ryczaltRateBps; tax = mulBps(Math.max(0, revenueNet), rate); taxLabel = `ryczałt ${rate / 100}% od przychodu`; } else if (form === 'liniowy') { tax = mulBps(base, 1_900); taxLabel = 'podatek liniowy 19%'; } else { tax = mulBps(base, 1_200); taxLabel = 'skala 12%'; }
  }
  const pocket = surplus - fixedShare - tax;
  const perDay = roundDiv(pocket, days);
  return { workDays: days, fixedMonthly, fixedKnown: known > 0, fixedShare, taxEstimate: tax, taxLabel, pocket, perDay, perMonthFull: perDay * WORKDAYS_PER_MONTH };
}
