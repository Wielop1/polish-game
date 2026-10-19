import { zl } from './money.ts';
import type { Grosze } from './money.ts';
import type { B2BClient } from './state.ts';

/**
 * Katalog większych projektów i klientów B2B (v0.8.1).
 * WSZYSTKIE parametry (ceny względem rynku, metraże, terminy płatności, rzetelność płatników, wymagania referencyjne, kary, częstość zapytań)
 * to PARAMETRY KALIBRACYJNE — nie dane rynkowe ani GUS. Klienci i firmy są fikcyjni. Opis i uzasadnienie: docs/BALANCE_REPORT.md §10.
 */
export type B2BKind = B2BClient['kind'];
export type ProjectTemplateId = 'flat_finish' | 'local_remont' | 'finish_package' | 'serial_flats' | 'subcontract';
export type PackageStage = 'przygotowanie' | 'roboty' | 'wykonczenie' | 'prace_koncowe';

export const STAGE_LABEL: Record<PackageStage, string> = { przygotowanie: 'Przygotowanie', roboty: 'Roboty wykończeniowe mokre', wykonczenie: 'Wykończenie', prace_koncowe: 'Prace końcowe i odbiór' };
export const STAGE_ORDER: readonly PackageStage[] = ['przygotowanie', 'roboty', 'wykonczenie', 'prace_koncowe'];

export interface B2BKindDef {
  id: B2BKind;
  label: string;
  description: string;
  /** Cena, jaką klient jest gotów płacić względem referencyjnej ceny prywatnej (rabat ilościowy / siła nabywcza); pkt bazowe. */
  priceFactorBps: number;
  termDays: readonly [number, number];
  reliability: readonly [number, number];
  /** Kara umowna za rozpoczęty tydzień zwłoki (pkt bazowe ceny pakietu). */
  penaltyBpsPerWeek: number;
  /** Maksymalna zaliczka, jaką klient akceptuje (pkt bazowe). */
  advanceMaxBps: number;
  qualityReq: readonly [number, number];
  templates: readonly ProjectTemplateId[];
}

export const B2B_KINDS: Record<B2BKind, B2BKindDef> = {
  property_manager: { id: 'property_manager', label: 'Zarządca nieruchomości', description: 'Remonty lokali i części wspólnych; płaci regularnie, ceni terminowość.', priceFactorBps: 9_300, termDays: [21, 30], reliability: [65, 90], penaltyBpsPerWeek: 250, advanceMaxBps: 1_000, qualityReq: [2, 2], templates: ['finish_package', 'local_remont'] },
  private_investor: { id: 'private_investor', label: 'Inwestor prywatny', description: 'Kupuje mieszkania pod wynajem lub sprzedaż; płaci szybko, ale liczy każdą złotówkę.', priceFactorBps: 10_000, termDays: [7, 21], reliability: [55, 90], penaltyBpsPerWeek: 200, advanceMaxBps: 2_000, qualityReq: [2, 3], templates: ['flat_finish', 'finish_package'] },
  builder: { id: 'builder', label: 'Firma budowlana', description: 'Zleca wykończenia części inwestycji; długie terminy płatności, kary za opóźnienia.', priceFactorBps: 9_000, termDays: [30, 45], reliability: [50, 80], penaltyBpsPerWeek: 300, advanceMaxBps: 1_000, qualityReq: [1, 2], templates: ['local_remont', 'finish_package', 'subcontract'] },
  general_contractor: { id: 'general_contractor', label: 'Generalny wykonawca', description: 'Podzleca roboty wykończeniowe; wymaga referencji, płaci po odbiorze z opóźnieniem.', priceFactorBps: 8_800, termDays: [30, 60], reliability: [45, 75], penaltyBpsPerWeek: 400, advanceMaxBps: 0, qualityReq: [1, 2], templates: ['subcontract', 'serial_flats', 'local_remont'] },
  developer: { id: 'developer', label: 'Deweloper', description: 'Seryjne wykończenia lokali; największe kontrakty, najniższe ceny, najdłuższe terminy płatności.', priceFactorBps: 8_500, termDays: [45, 60], reliability: [60, 90], penaltyBpsPerWeek: 500, advanceMaxBps: 500, qualityReq: [2, 2], templates: ['serial_flats', 'flat_finish'] },
};

export const B2B_CLIENT_POOL: readonly { name: string; kind: B2BKind; size: B2BClient['size'] }[] = [
  { name: 'Wspólnota Mieszkaniowa Kormoran — zarząd (fikcyjny)', kind: 'property_manager', size: 'small' },
  { name: 'Administracja Nieruchomości Łyna (fikcyjna)', kind: 'property_manager', size: 'medium' },
  { name: 'Marek Rogowski — inwestor prywatny (fikcyjny)', kind: 'private_investor', size: 'small' },
  { name: 'Fundusz Mieszkań na Wynajem Dajtki (fikcyjny)', kind: 'private_investor', size: 'medium' },
  { name: 'Instal-Bud Olsztyn (fikcyjna)', kind: 'builder', size: 'small' },
  { name: 'Budowlana Mazury sp. z o.o. (fikcyjna)', kind: 'builder', size: 'medium' },
  { name: 'Generalne Wykonawstwo Warmia (fikcyjne)', kind: 'general_contractor', size: 'medium' },
  { name: 'Konsorcjum Budowlane Pojezierze (fikcyjne)', kind: 'general_contractor', size: 'large' },
  { name: 'Deweloper Nowe Jaroty (fikcyjny)', kind: 'developer', size: 'medium' },
  { name: 'Osiedla Olsztyn Park (fikcyjne)', kind: 'developer', size: 'large' },
];

export interface PackageSpec { key: string; label: string; stage: PackageStage; serviceId: string; units: number; deps: string[] }

const r5 = (x: number) => Math.max(5, Math.round(x / 5) * 5);
const hrs = (x: number) => Math.max(6, Math.round(x / 2) * 2);

export interface TemplateDef {
  id: ProjectTemplateId;
  label: string;
  description: string;
  /** Powierzchnia podstawowa (m² lokalu albo m² ścian dla pakietu/podzlecenia) i liczba lokali. */
  areaRange: readonly [number, number];
  flatsRange: readonly [number, number];
  spec: (area: number, flats: number) => PackageSpec[];
}

export const PROJECT_TEMPLATES: Record<ProjectTemplateId, TemplateDef> = {
  flat_finish: {
    id: 'flat_finish', label: 'Wykończenie mieszkania pod klucz', description: 'Przygotowanie, gładzie, malowanie, podłogi i prace końcowe w jednym lokalu.',
    areaRange: [38, 95], flatsRange: [1, 1],
    spec: (A) => [
      { key: 'a', label: 'Przygotowanie lokalu', stage: 'przygotowanie', serviceId: 'drobne', units: hrs(0.18 * A), deps: [] },
      { key: 'b', label: 'Gładzie ścian i sufitów', stage: 'roboty', serviceId: 'gladzie', units: r5(2.4 * A), deps: ['a'] },
      { key: 'c', label: 'Malowanie', stage: 'wykonczenie', serviceId: 'malowanie', units: r5(3.0 * A), deps: ['b'] },
      { key: 'd', label: 'Podłogi — panele', stage: 'wykonczenie', serviceId: 'panele', units: r5(0.8 * A), deps: ['c'] },
      { key: 'e', label: 'Prace końcowe i odbiór', stage: 'prace_koncowe', serviceId: 'drobne', units: hrs(0.2 * A), deps: ['d'] },
    ],
  },
  local_remont: {
    id: 'local_remont', label: 'Remont większego lokalu', description: 'Lokal usługowy lub duże mieszkanie: pełny cykl robót wykończeniowych.',
    areaRange: [90, 260], flatsRange: [1, 1],
    spec: (A) => [
      { key: 'a', label: 'Przygotowanie lokalu', stage: 'przygotowanie', serviceId: 'drobne', units: hrs(0.12 * A), deps: [] },
      { key: 'b', label: 'Gładzie ścian i sufitów', stage: 'roboty', serviceId: 'gladzie', units: r5(2.0 * A), deps: ['a'] },
      { key: 'c', label: 'Malowanie', stage: 'wykonczenie', serviceId: 'malowanie', units: r5(2.6 * A), deps: ['b'] },
      { key: 'd', label: 'Podłogi — panele', stage: 'wykonczenie', serviceId: 'panele', units: r5(0.75 * A), deps: ['c'] },
      { key: 'e', label: 'Prace końcowe i odbiór', stage: 'prace_koncowe', serviceId: 'drobne', units: hrs(0.12 * A), deps: ['d'] },
    ],
  },
  finish_package: {
    id: 'finish_package', label: 'Pakiet prac wykończeniowych', description: 'Gładzie i malowanie na wskazanej powierzchni ścian (np. kilka lokali, części wspólne).',
    areaRange: [150, 420], flatsRange: [1, 1],
    spec: (W) => [
      { key: 'a', label: 'Gładzie ścian', stage: 'roboty', serviceId: 'gladzie', units: r5(W), deps: [] },
      { key: 'b', label: 'Malowanie', stage: 'wykonczenie', serviceId: 'malowanie', units: r5(W), deps: ['a'] },
      { key: 'c', label: 'Poprawki i odbiór', stage: 'prace_koncowe', serviceId: 'drobne', units: hrs(0.04 * W), deps: ['b'] },
    ],
  },
  serial_flats: {
    id: 'serial_flats', label: 'Seryjne wykończenie lokali', description: 'Seria jednakowych mieszkań (deweloper / generalny wykonawca); roboty liczone zbiorczo dla całej serii.',
    areaRange: [35, 55], flatsRange: [4, 12],
    spec: (A, K) => [
      { key: 'a', label: 'Przygotowanie lokali', stage: 'przygotowanie', serviceId: 'drobne', units: hrs(0.12 * A * K), deps: [] },
      { key: 'b', label: 'Gładzie (seria)', stage: 'roboty', serviceId: 'gladzie', units: r5(2.4 * A * K), deps: ['a'] },
      { key: 'c', label: 'Malowanie (seria)', stage: 'wykonczenie', serviceId: 'malowanie', units: r5(3.0 * A * K), deps: ['b'] },
      { key: 'd', label: 'Podłogi — panele (seria)', stage: 'wykonczenie', serviceId: 'panele', units: r5(0.8 * A * K), deps: ['c'] },
      { key: 'e', label: 'Prace końcowe i odbiory', stage: 'prace_koncowe', serviceId: 'drobne', units: hrs(0.15 * A * K), deps: ['d'] },
    ],
  },
  subcontract: {
    id: 'subcontract', label: 'Prace podwykonawcze dla większej firmy', description: 'Generalny wykonawca podzleca gładzie i malowanie na dużej powierzchni; niższa cena, dłuższy termin płatności, kary za zwłokę.',
    areaRange: [300, 1_100], flatsRange: [1, 1],
    spec: (W) => [
      { key: 'a', label: 'Gładzie (podzlecenie)', stage: 'roboty', serviceId: 'gladzie', units: r5(0.55 * W), deps: [] },
      { key: 'b', label: 'Malowanie (podzlecenie)', stage: 'wykonczenie', serviceId: 'malowanie', units: r5(W), deps: ['a'] },
    ],
  },
};

/** Granice wartości (netto) poziomów projektów: poziom 1 < 25 tys., poziom 2 < 90 tys., poziom 3 — powyżej. */
export const TIER_BOUNDS: readonly [Grosze, Grosze] = [zl(25_000), zl(90_000)];
export const tierOfValue = (net: Grosze): 1 | 2 | 3 => (net < TIER_BOUNDS[0] ? 1 : net < TIER_BOUNDS[1] ? 2 : 3);
export const TIER_LABEL: Record<number, string> = { 0: 'brak dostępu do projektów', 1: 'małe projekty (do 25 tys. zł)', 2: 'średnie projekty (do 90 tys. zł)', 3: 'duże projekty (od 90 tys. zł)' };

/**
 * Wymagania klienta wobec wykonawcy wg poziomu projektu: referencje (ukończone kontrakty, ich wartość i ocena, ukończone projekty niższego poziomu) i zdolność
 * realizacyjna (liczba wykonawców). Forma prawna NIE jest warunkiem — JDG i spółka mają te same progi.
 */
export const TIER_REQUIREMENTS: Record<1 | 2 | 3, { minCompleted: number; minValueNet: Grosze; minRating10: number; minProjectTier: number; minWorkers: number }> = {
  1: { minCompleted: 3, minValueNet: zl(5_000), minRating10: 35, minProjectTier: 0, minWorkers: 1 },
  2: { minCompleted: 8, minValueNet: zl(30_000), minRating10: 38, minProjectTier: 1, minWorkers: 1 },
  3: { minCompleted: 15, minValueNet: zl(150_000), minRating10: 38, minProjectTier: 2, minWorkers: 3 },
};

export const B2B_RULES = {
  /** Zapytania B2B nie są nieograniczone: jedno losowanie tygodniowo (poniedziałek), limity otwartych i aktywnych projektów. */
  weeklyBaseBps: 1_100,
  weeklyMaxBps: 3_000,
  maxOpen: 2,
  maxActive: 3,
  /** Szansa, że zapytanie dotyczy projektu o poziom wyższego niż aktualnie dostępny (widać wymagania, ale nie można go wycenić). */
  stretchChanceBps: 1_500,
  respondDays: [10, 18] as const,
  decideDays: [3, 6] as const,
  signDays: 7,
  /** Zwłoka płatnika: do (100 − rzetelność) × 0,4 dni ponad umowny termin. */
  delayPerReliabilityPt: 0.4,
  /** Zapas czasu w planie względem minimalnego czasu pracy: ekipa z właścicielem / bez właściciela. */
  slackOwner: 1.4,
  slackCrew: 1.6,
} as const;
