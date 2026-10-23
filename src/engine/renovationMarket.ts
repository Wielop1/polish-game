import { mulBps, roundDiv, zl } from './money.ts';
import type { MarketIndustry, ProjectSpec } from './marketConfig.ts';
import { CLIENT_NAMES, DISTRICTS, SEASONALITY_BPS, SERVICES, SERVICE_BY_ID, normCentiOf, referencePrice } from './renovationCatalog.ts';

/**
 * Parametry branży remontowo-wykończeniowej przekazywane do wspólnej warstwy rynku (v0.7): usługi i ich udziały w popycie,
 * sezonowość (ogólna i per usługa), losowanie zlecenia klienta z danego segmentu. Wszystkie liczby kalibracyjne.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const roundTo = (v: number, unit: number) => Math.max(unit, roundDiv(v, unit) * unit);

/** Sezonowość per usługa (miesiąc 1–12; indeks 0 nieużywany), pkt bazowe — modyfikuje sezonowość ogólną. */
const SERVICE_SEASON: Record<string, readonly number[]> = {
  // malowanie: szczyt wiosną i latem (okna otwarte, schnięcie), słabiej zimą
  malowanie: [0, 8_800, 9_000, 10_000, 10_800, 11_000, 10_800, 10_500, 10_200, 10_000, 9_500, 9_000, 8_600],
  // gładzie: prace „na mokro” — jak malowanie, ale z mniejszą zimową luką (remonty przed Bożym Narodzeniem)
  gladzie: [0, 9_200, 9_400, 10_000, 10_600, 10_800, 10_500, 10_300, 10_200, 10_000, 9_800, 9_400, 9_000],
  // panele: jesień i zima (po sezonie malowania), wiosną słabiej
  panele: [0, 10_800, 10_500, 9_800, 9_300, 9_200, 9_500, 9_800, 10_000, 10_400, 10_800, 11_000, 10_400],
  // drobne prace: równomiernie
  drobne: [0, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000],
};

const SHARES: Record<string, { shareBps: number; materialShareBps: number }> = {
  malowanie: { shareBps: 4_000, materialShareBps: 2_600 },
  gladzie: { shareBps: 2_500, materialShareBps: 1_400 },
  panele: { shareBps: 2_000, materialShareBps: 4_100 },
  drobne: { shareBps: 1_500, materialShareBps: 500 },
};

export const RENOVATION_MARKET: MarketIndustry = {
  id: 'renovation',
  label: 'Remonty i wykończenia',
  services: SERVICES.map((d) => ({ id: d.id, label: d.label, shareBps: SHARES[d.id]!.shareBps, materialShareBps: SHARES[d.id]!.materialShareBps })),
  seasonalityBps: SEASONALITY_BPS,
  serviceSeasonalityBps: SERVICE_SEASON,
  estimate(serviceId, units, complexity, qualityReq) {
    return { hours: Math.max(1, Math.round(normCentiOf(serviceId, units, complexity) / 100)), referenceGross: referencePrice(serviceId, units, complexity, qualityReq) };
  },
  rollProject(rng, segment, serviceId): ProjectSpec {
    const def = SERVICE_BY_ID.get(serviceId)!;
    const [lo, hi] = def.qtyRange;
    const step = def.unit === 'm²' ? 5 : 2;
    const units = Math.max(lo, Math.floor(rng.int(lo, hi) / step) * step);
    const complexity = rng.int(0, 99) < 22 ? 'trudne' : 'standard';
    const rq = rng.int(0, 99);
    const [p1, p2] = segment.qualityReqPct;
    const qualityReq: 1 | 2 | 3 = rq < p1 ? 1 : rq < p1 + p2 ? 2 : 3;
    const norm = normCentiOf(serviceId, units, complexity);
    const ref = referencePrice(serviceId, units, complexity, qualityReq);
    const budgetGross = roundTo(mulBps(roundDiv(ref * rng.int(78, 130), 100), segment.budgetFactorBps), zl(10));
    const walkAwayGross = roundTo(roundDiv(budgetGross * rng.int(95, 118), 100), zl(10));
    return {
      serviceId, units, complexity, qualityReq, hours: Math.max(1, Math.round(norm / 100)), referenceGross: ref, budgetGross, walkAwayGross,
      desiredStartOffset: rng.int(4, 24),
      maxDays: clamp(Math.ceil(norm / 100 / 3) + rng.int(2, 10), 3, 60),
      flexDays: rng.int(segment.flexDays[0], segment.flexDays[1]),
      haggler: rng.int(0, 99) < segment.haggleChancePct,
      location: DISTRICTS[rng.int(0, DISTRICTS.length - 1)]!,
      clientName: `${CLIENT_NAMES[rng.int(0, CLIENT_NAMES.length - 1)]} (klient indywidualny, fikcyjny)`,
    };
  },
};
