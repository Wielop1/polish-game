import { registerIndustry } from './industry.ts';
import { initRenovation, processRenovation, renovationGaps } from './renovation.ts';

/** Rejestr modułów branżowych (importowany przez silnik symulacji; kolejne branże dopisujemy tutaj). */
registerIndustry({
  id: 'renovation',
  label: 'Usługi remontowo-wykończeniowe',
  profileIds: ['remonty'],
  onRegister: (s, _b, input) => initRenovation(s, input.specialization),
  processDay: processRenovation,
  gaps: renovationGaps,
});
