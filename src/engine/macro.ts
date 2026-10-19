import { economicClimate } from './labor.ts';
import type { Climate } from './labor.ts';
import { createRng } from './rng.ts';

/**
 * Koniunktura gospodarcza w ujęciu miesięcznym (v0.7). NIE jest to nowy, niezależny system: punktem zakotwiczenia jest
 * istniejący roczny klimat `economicClimate(seed, rok)` używany przy ryzyku zwolnień (labor.ts). Każdy rok ma „kotwicę”
 * w połowie roku (lipiec): dobra +90, przeciętna 0, recesja −140 (setne części indeksu). Indeks miesięczny to interpolacja
 * między kotwicami sąsiednich lat plus deterministyczny, wygładzony szum — więc recesja nie pojawia się nagle 1 stycznia,
 * a rok „w recesji” wg `economicClimate` zawsze ma w środku roku fazę spowolnienia lub recesji.
 *
 * Funkcja jest czysta: wynik zależy wyłącznie od (seed, miesiąc), nie od stanu gry ani działań gracza.
 * WSZYSTKIE współczynniki wpływu są parametrami kalibracyjnymi (marketConfig.ts → MACRO).
 */

export type MacroPhase = 'wzrost' | 'stabilizacja' | 'spowolnienie' | 'recesja';
export const MACRO_PHASE_LABEL: Record<MacroPhase, string> = { wzrost: 'wzrost', stabilizacja: 'stabilizacja', spowolnienie: 'spowolnienie', recesja: 'recesja' };

/** Parametry kalibracyjne koniunktury (niezaczerpnięte z danych GUS). */
export const MACRO = {
  /** Kotwice roczne (setne części indeksu) dla klimatu z `economicClimate`. */
  anchor: { dobra: 90, przeciętna: 0, recesja: -140 } as Record<Climate, number>,
  /** Amplituda miesięcznego szumu (±, setne części indeksu) przed wygładzeniem. */
  noise: 30,
  /** Progi faz (setne części indeksu). */
  thresholds: { growth: 45, stable: -30, slowdown: -100 },
  /** Wpływ 1 punktu indeksu (0,01) na wskaźniki, w pkt bazowych (10 000 = neutralnie). */
  perPoint: { demand: 11, spending: 9, materials: 3, wage: 4, stress: 10 },
} as const;

export interface Macro {
  month: string;
  phase: MacroPhase;
  /** Indeks koniunktury ×100 (dodatni = ponad trend). */
  index: number;
  /** Popyt rynkowy na remonty (10 000 = neutralnie). */
  demandBps: number;
  /** Skłonność klientów do wydatków — udział szukających wykonawcy i budżety (10 000 = neutralnie). */
  spendingBps: number;
  /** Ceny materiałów (10 000 = neutralnie). */
  materialsBps: number;
  /** Presja płacowa — oczekiwania kandydatów (10 000 = neutralnie; płaca minimalna nadal obowiązuje). */
  wageBps: number;
  /** Presja na kondycję firm (dodatnia = trudniej; wpływa na konkurentów). */
  stressBps: number;
}

const parse = (month: string): { y: number; m: number } => ({ y: Number(month.slice(0, 4)), m: Number(month.slice(5, 7)) });
const climateAnchor = (seed: string, year: number): number => MACRO.anchor[economicClimate(seed, year)];
const rawNoise = (seed: string, y: number, m: number): number => createRng(seed, `macro:noise:${y}-${m}`).int(-MACRO.noise, MACRO.noise);

/** Miesiąc o `delta` miesięcy wcześniej (YYYY-MM). */
function shift(y: number, m: number, delta: number): { y: number; m: number } {
  const t = y * 12 + (m - 1) + delta;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}

const cache = new Map<string, Macro>();

export function macroAt(seed: string, month: string): Macro {
  const key = `${seed}|${month}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { y, m } = parse(month);
  // pozycja względem kotwicy z lipca: sierpień–grudzień → między kotwicą tego a następnego roku; styczeń–czerwiec → poprzedniego a tego
  const a = m >= 7 ? climateAnchor(seed, y) : climateAnchor(seed, y - 1);
  const b = m >= 7 ? climateAnchor(seed, y + 1) : climateAnchor(seed, y);
  const k = m >= 7 ? m - 7 : m + 5; // 0..11 miesięcy od kotwicy
  const trend = a + ((b - a) * k) / 12;
  const n = [0, 1, 2].map((d) => { const p = shift(y, m, -d); return rawNoise(seed, p.y, p.m); });
  const index = Math.round(trend + (n[0]! + n[1]! + n[2]!) / 3) + 0; // +0: bez ujemnego zera (-0 psuje porównania po zapisie JSON)
  const t = MACRO.thresholds;
  const phase: MacroPhase = index >= t.growth ? 'wzrost' : index >= t.stable ? 'stabilizacja' : index >= t.slowdown ? 'spowolnienie' : 'recesja';
  const pp = MACRO.perPoint;
  const out: Macro = {
    month, phase, index,
    demandBps: 10_000 + index * pp.demand,
    spendingBps: 10_000 + index * pp.spending,
    materialsBps: 10_000 + index * pp.materials,
    wageBps: 10_000 + index * pp.wage,
    stressBps: 0 - index * pp.stress,
  };
  if (cache.size > 5_000) cache.clear();
  cache.set(key, out);
  return out;
}
