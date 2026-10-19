import { registerIndustry } from './industry.ts';
import { processProjects } from './projects.ts';
import { initRenovation, processRenovation, renovationGaps } from './renovation.ts';
import type { IsoDate } from './date.ts';
import type { GameState, Operator } from './state.ts';

/** Rejestr modułów branżowych (importowany przez silnik symulacji; kolejne branże dopisujemy tutaj). */
registerIndustry({
  id: 'renovation',
  label: 'Usługi remontowo-wykończeniowe',
  profileIds: ['remonty'],
  onRegister: (s, _b, input) => initRenovation(s, input.specialization),
  processDay: (s: GameState, b: Operator, date: IsoDate) => { processRenovation(s, b, date); processProjects(s, b, date); },
  gaps: renovationGaps,
});
