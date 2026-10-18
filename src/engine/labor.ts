import { createRng } from './rng.ts';
import { performanceBps } from './time.ts';
import { companyTenureDays, currentEmployment } from './contracts.ts';
import { parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import type { GameState } from './state.ts';

/**
 * Otoczenie rynku pracy. Klimat gospodarczy i kondycja pracodawcy są losowane deterministycznie
 * z (seed, rok) oraz (seed, pracodawca, rok) — niezależnie od tego, co robi gracz — więc
 * zwolnienia mają zewnętrzne, uzasadnione przyczyny, a nie wynikają z samego upływu czasu.
 */
export type Climate = 'dobra' | 'przeciętna' | 'recesja';
export type EmployerCondition = 'dobra' | 'stabilna' | 'trudna';

export const CLIMATE_LABEL: Record<Climate, string> = { dobra: 'dobra koniunktura', przeciętna: 'przeciętna koniunktura', recesja: 'recesja' };
export const EMPLOYER_LABEL: Record<EmployerCondition, string> = { dobra: 'dobra', stabilna: 'stabilna', trudna: 'trudna' };

export function economicClimate(seed: string, year: number): Climate {
  const r = createRng(seed, `economy:${year}`).int(0, 99);
  return r < 20 ? 'dobra' : r < 85 ? 'przeciętna' : 'recesja'; // 15% lat to recesja
}

export function employerCondition(seed: string, partyId: string, year: number): EmployerCondition {
  const r = createRng(seed, `employer:${partyId}:${year}`).int(0, 99);
  return r < 20 ? 'dobra' : r < 85 ? 'stabilna' : 'trudna'; // 15% lat pracodawca w trudnej sytuacji
}

export interface LayoffFactor {
  id: 'performance' | 'employer' | 'economy';
  label: string;
  /** Wkład w miesięczne ryzyko zwolnienia (pkt bazowe). */
  bps: number;
}

export interface LayoffRisk {
  totalBps: number;
  factors: LayoffFactor[];
  climate: Climate;
  employer: EmployerCondition | null;
}

/** Staż w firmie, od którego pracodawca w ogóle rozważa zwolnienie z przyczyn innych niż okres próbny. */
export const MIN_TENURE_FOR_LAYOFF_DAYS = 90;

/**
 * Miesięczne ryzyko zwolnienia (pkt bazowe) z uzasadnionych czynników:
 * wydajność/absencje (zmęczenie), kondycja pracodawcy, koniunktura. Bez czynników = 0 —
 * samo przewijanie czasu nikogo nie zwalnia. Przy kilku czynnikach ryzyko się sumuje.
 */
export function layoffRisk(s: GameState, date: IsoDate = s.clock.today): LayoffRisk {
  const year = parseIso(date).year;
  const climate = economicClimate(s.seed, year);
  const c = currentEmployment(s, date);
  if (!c || c.endDate !== null) return { totalBps: 0, factors: [], climate, employer: null };
  const employer = employerCondition(s.seed, c.partyId, year);
  const factors: LayoffFactor[] = [];
  const perf = performanceBps(s.life.fatigue);
  if (perf < 6_000) factors.push({ id: 'performance', label: 'słabe wyniki i częste absencje (wyczerpanie)', bps: 150 });
  else if (perf < 8_000) factors.push({ id: 'performance', label: 'obniżona wydajność z powodu zmęczenia', bps: 40 });
  if (employer === 'trudna') factors.push({ id: 'employer', label: 'pracodawca w trudnej sytuacji (redukcje etatów)', bps: 50 });
  if (climate === 'recesja') factors.push({ id: 'economy', label: 'recesja w gospodarce', bps: 50 });
  const eligible = companyTenureDays(s, c, date) >= MIN_TENURE_FOR_LAYOFF_DAYS;
  const totalBps = eligible ? factors.reduce((a, f) => a + f.bps, 0) : 0;
  return { totalBps, factors: eligible ? factors : [], climate, employer };
}

/** Główna przyczyna (największy wkład) — do opisu wydarzenia. */
export function dominantFactor(risk: LayoffRisk): LayoffFactor | null {
  return risk.factors.reduce<LayoffFactor | null>((best, f) => (best === null || f.bps > best.bps ? f : best), null);
}
