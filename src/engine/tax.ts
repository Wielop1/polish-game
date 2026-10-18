import { addMonthsToKey, monthKey, monthKeyToYm, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { mulBps, roundDiv } from './money.ts';
import type { Grosze } from './money.ts';
import { RULES_2026 as R } from './legal.ts';
import type { TaxForm, ZusStart } from './state.ts';

/**
 * Czyste kalkulatory podatkowo-składkowe JDG (grosze). Reguły: legal.ts (LEGAL_SOURCES.md).
 * SYMULACJA — nie jest poradą podatkową; uproszczenia opisane w rejestrze reguł.
 */

/* ---------- ZUS: składki społeczne ---------- */

export interface SocialBreakdown {
  emerytalna: Grosze;
  rentowa: Grosze;
  chorobowa: Grosze;
  wypadkowa: Grosze;
  fpFs: Grosze;
  total: Grosze;
}

/** Każdy składnik liczony osobno i zaokrąglany do grosza (jak w deklaracji ZUS). */
export function socialContributions(base: Grosze, opts: { sickness: boolean; fpFs: boolean }): SocialBreakdown {
  const emerytalna = mulBps(base, R.zus.emerytalna);
  const rentowa = mulBps(base, R.zus.rentowa);
  const chorobowa = opts.sickness ? mulBps(base, R.zus.chorobowa) : 0;
  const wypadkowa = mulBps(base, R.zus.wypadkowa);
  const fpFs = opts.fpFs ? mulBps(base, R.zus.fpFs) : 0;
  return { emerytalna, rentowa, chorobowa, wypadkowa, fpFs, total: emerytalna + rentowa + chorobowa + wypadkowa + fpFs };
}

export type ZusRegime = 'ulga' | 'preferencyjny' | 'standard';

/** Liczba miesięcy od `fromKey` do `toKey` (0 dla tego samego miesiąca). */
export function monthsBetween(fromKey: string, toKey: string): number {
  const a = monthKeyToYm(fromKey);
  const b = monthKeyToYm(toKey);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

export const ULGA_MONTHS = 6;
export const PREFERENTIAL_MONTHS = 24;

/** Reżim składek w danym miesiącu działalności (0 = miesiąc startu). Ulga → 24 mies. preferencyjnych → standard. */
export function zusRegimeFor(start: ZusStart, monthIndex: number): ZusRegime {
  if (start === 'ulga') {
    if (monthIndex < ULGA_MONTHS) return 'ulga';
    return monthIndex < ULGA_MONTHS + PREFERENTIAL_MONTHS ? 'preferencyjny' : 'standard';
  }
  if (start === 'preferencyjny') return monthIndex < PREFERENTIAL_MONTHS ? 'preferencyjny' : 'standard';
  return 'standard';
}

/** Składki społeczne za miesiąc w danym reżimie (ulga: 0; preferencyjny: bez FP/FS; standard: z FP/FS). */
export function socialForRegime(regime: ZusRegime, sickness: boolean): SocialBreakdown {
  if (regime === 'ulga') return { emerytalna: 0, rentowa: 0, chorobowa: 0, wypadkowa: 0, fpFs: 0, total: 0 };
  if (regime === 'preferencyjny') return socialContributions(R.zusBasePreferential, { sickness, fpFs: false });
  return socialContributions(R.zusBaseStandard, { sickness, fpFs: true });
}

/* ---------- Składka zdrowotna ---------- */

/** Skala/liniowy: % dochodu miesiąca poprzedniego, nie mniej niż minimum. */
export function healthFromIncome(form: 'skala' | 'liniowy', previousMonthIncome: Grosze): Grosze {
  const bps = form === 'skala' ? R.healthScaleBps : R.healthLinearBps;
  return Math.max(R.healthMin, mulBps(Math.max(0, previousMonthIncome), bps));
}

/** Ryczałt: kwota wg przedziału przychodu narastająco od początku roku (włącznie z bieżącym miesiącem). */
export function healthRyczalt(cumulativeRevenue: Grosze): Grosze {
  for (const b of R.healthRyczalt) if (cumulativeRevenue <= b.upToRevenue) return b.amount;
  return R.healthRyczalt[R.healthRyczalt.length - 1]!.amount;
}

/* ---------- PIT ---------- */

export interface PitInput {
  form: TaxForm;
  revenue: Grosze;
  costs: Grosze;
  /** Zapłacone w roku składki społeczne (narastająco). */
  socialPaid: Grosze;
  /** Zapłacone w roku składki zdrowotne (narastająco). */
  healthPaid: Grosze;
  /** Czy stosować kwotę zmniejszającą podatek (skala). */
  applyReduction: boolean;
  ryczaltRateBps: number;
}

export interface PitResult {
  /** Podstawa opodatkowania po odliczeniach (dochód albo przychód pomniejszony). */
  base: Grosze;
  tax: Grosze;
}

/** Podatek narastająco od początku roku podatkowego (jeden wzór dla zaliczek i rozliczenia rocznego). */
export function pitCumulative(i: PitInput): PitResult {
  if (i.form === 'ryczalt') {
    const base = Math.max(0, i.revenue - i.socialPaid - mulBps(i.healthPaid, R.pit.ryczaltHealthDeductionBps));
    return { base, tax: mulBps(base, i.ryczaltRateBps) };
  }
  if (i.form === 'liniowy') {
    const healthDeduction = Math.min(i.healthPaid, R.pit.linearHealthDeductionLimit);
    const base = Math.max(0, i.revenue - i.costs - i.socialPaid - healthDeduction);
    return { base, tax: mulBps(base, R.pit.linearBps) };
  }
  const base = Math.max(0, i.revenue - i.costs - i.socialPaid);
  const reduction = i.applyReduction ? R.pit.scaleReduction : 0;
  const t = R.pit.scaleThreshold;
  const tax =
    base <= t
      ? Math.max(0, mulBps(base, R.pit.scaleLowBps) - reduction)
      : mulBps(t, R.pit.scaleLowBps) - reduction + mulBps(base - t, R.pit.scaleHighBps);
  return { base, tax: Math.max(0, tax) };
}

/* ---------- VAT ---------- */

/** Limit zwolnienia w danym roku: 240 000 zł, a w roku rozpoczęcia — proporcjonalnie do pełnych miesięcy działalności. */
export function vatExemptionLimit(startDate: IsoDate, year: number): Grosze {
  const start = parseIso(startDate);
  if (start.year < year) return R.vat.exemptionLimit;
  if (start.year > year) return 0;
  const months = 12 - (start.month - 1) - (start.day > 1 ? 1 : 0);
  return roundDiv(R.vat.exemptionLimit * months, 12);
}

export function vatOf(net: Grosze, rateBps: number): Grosze {
  return mulBps(net, rateBps);
}

export function nextMonthKey(date: IsoDate): string {
  return addMonthsToKey(monthKey(date), 1);
}
