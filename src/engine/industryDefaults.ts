import type { Accounting, RenovationState } from './state.ts';

export function emptyReno(): RenovationState {
  return {
    specializations: [], skillXp: {}, advertising: { level: 'none', since: null, paidMonth: null }, enquiries: [], quotes: [], jobs: [],
    equipment: [], stock: {}, stockMoves: [], reviews: [], complaints: [],
  };
}

export function emptyAccounting(): Accounting {
  return { office: null, history: [], lastFeeMonth: null, suggestions: [] };
}
