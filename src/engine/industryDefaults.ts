import { SUBCONTRACTOR_SEEDS } from './renovationCatalog.ts';
import { createRng } from './rng.ts';
import type { Accounting, Ops, RenovationState, Subcontractor } from './state.ts';

export function emptyReno(): RenovationState {
  return {
    specializations: [], skillXp: {}, enquiries: [], quotes: [], jobs: [],
    equipment: [], stock: {}, stockMoves: [], reviews: [], complaints: [], b2bClients: [], projects: [],
  };
}

export function emptyAccounting(): Accounting {
  return { office: null, history: [], lastFeeMonth: null, suggestions: [] };
}

/** Pula podwykonawców (fikcyjne firmy B2B) — parametry z ziarna gry, deterministyczne. */
export function buildSubcontractors(seed: string): Subcontractor[] {
  return SUBCONTRACTOR_SEEDS.map((x, i) => {
    const rng = createRng(seed, `sub:pool:${i}`);
    return {
      id: `sub:${i + 1}`, name: x.name, services: x.services, priceBps: Math.min(9_000, Math.max(1_000, x.priceBps + rng.int(-300, 300))),
      quality: Math.min(100, Math.max(0, x.quality + rng.int(-4, 4))), reliabilityBps: Math.min(10_000, Math.max(0, x.reliabilityBps + rng.int(-300, 300))),
    };
  });
}

export function emptyOps(seed = ''): Ops {
  return {
    people: [], employments: [], payslips: [], listings: [], candidates: [], subcontractors: buildSubcontractors(seed), subcontracts: [], teams: [], assignments: [], vehicles: [],
    laborAllocated: {}, vehicleRunning: {},
  };
}
