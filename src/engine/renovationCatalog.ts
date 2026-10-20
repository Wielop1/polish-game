import { mulBps, roundDiv, zl } from './money.ts';
import type { Grosze } from './money.ts';

/**
 * Katalog branży remontowo-wykończeniowej (v0.5).
 * WSZYSTKIE ceny, stawki, normy czasu i zużycia materiałów to PARAMETRY SYMULACYJNE (placeholder) — nie oficjalny
 * cennik remontów w Polsce i nie dane rynkowe. Po zawarciu umowy warunki są kopiowane do stanu (kontrakt, wycena),
 * więc zmiana tego pliku nie zmienia istniejących zapisów.
 */

export type MaterialStandard = 'eko' | 'std' | 'premium';
export type Complexity = 'standard' | 'trudne';

export const STANDARDS: Record<MaterialStandard, { label: string; priceBps: number; quality: number; /** Poziom wymagań klienta, który ten standard zaspokaja (1–3). */ level: number }> = {
  eko: { label: 'Ekonomiczny', priceBps: 8_000, quality: -7, level: 1 },
  std: { label: 'Standard', priceBps: 10_000, quality: 0, level: 2 },
  premium: { label: 'Premium', priceBps: 13_500, quality: 7, level: 3 },
};

export const QUALITY_REQ_LABEL: Record<number, string> = { 1: 'podstawowe', 2: 'dobre', 3: 'wysokie' };
/** Minimalny wynik jakości (0–100), którego klient oczekuje przy danym poziomie wymagań. */
export const QUALITY_THRESHOLD: Record<number, number> = { 1: 55, 2: 68, 3: 80 };

export const COMPLEXITY_LABEL: Record<Complexity, string> = { standard: 'standardowe', trudne: 'trudne (nierówne podłoże, utrudniony dostęp)' };
/** Mnożnik normy czasu (pkt bazowe) i dodatkowy poziom wymaganych umiejętności. */
export const COMPLEXITY_HOURS_BPS: Record<Complexity, number> = { standard: 10_000, trudne: 12_500 };

export interface MaterialDef {
  id: string;
  label: string;
  unit: string;
  /** Cena netto jednostki w standardzie „Standard”. */
  priceNet: Grosze;
}

export const MATERIALS: readonly MaterialDef[] = [
  { id: 'farba', label: 'Farba do ścian i sufitów', unit: 'l', priceNet: zl(24) },
  { id: 'tasma-folia', label: 'Taśma i folia ochronna (zestaw)', unit: 'kpl.', priceNet: zl(18) },
  { id: 'gladz', label: 'Gładź szpachlowa', unit: 'kg', priceNet: zl(1.6) },
  { id: 'grunt', label: 'Grunt', unit: 'l', priceNet: zl(9) },
  { id: 'papier', label: 'Papier ścierny i siatki (opak.)', unit: 'opak.', priceNet: zl(22) },
  { id: 'panele', label: 'Panele podłogowe', unit: 'm²', priceNet: zl(55) },
  { id: 'podklad', label: 'Podkład pod panele', unit: 'm²', priceNet: zl(7) },
  { id: 'listwy', label: 'Listwy przypodłogowe', unit: 'mb', priceNet: zl(9) },
  { id: 'drobne', label: 'Drobne materiały montażowe (zestaw)', unit: 'kpl.', priceNet: zl(40) },
];
export const MATERIAL_BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

export interface EquipmentDef {
  id: string;
  label: string;
  category: 'ręczne' | 'elektronarzędzia' | 'specjalistyczny' | 'transport';
  priceNet: Grosze;
  /** Trwałość: liczba godzin pracy do zużycia (stan techniczny 100% → 0%). */
  durabilityHours: number;
  /** Koszt konserwacji (przywraca 30 pkt proc. stanu). */
  maintenanceNet: Grosze;
  /** Wpływ na wydajność wybranych usług (pkt bazowe) — dla pozostałych 0. */
  speedBps: Record<string, number>;
  /** Dodatek do jakości (punkty) — dla usług z mapy, `*` = wszystkie. */
  quality: Record<string, number>;
  /** Redukcja kosztu dojazdu/transportu (pkt bazowe). */
  transportSaveBps?: number;
}

export const EQUIPMENT: readonly EquipmentDef[] = [
  { id: 'hand-tools', label: 'Zestaw narzędzi ręcznych', category: 'ręczne', priceNet: zl(900), durabilityHours: 2_500, maintenanceNet: zl(90), speedBps: {}, quality: {} },
  { id: 'paint-basic', label: 'Zestaw malarski (wałki, pędzle, drabina)', category: 'ręczne', priceNet: zl(650), durabilityHours: 2_000, maintenanceNet: zl(65), speedBps: {}, quality: {} },
  { id: 'trowel-set', label: 'Zestaw szpachli, pac i mieszadło', category: 'ręczne', priceNet: zl(700), durabilityHours: 2_000, maintenanceNet: zl(70), speedBps: {}, quality: {} },
  { id: 'panel-kit', label: 'Zestaw do paneli (dobijaki, ściągi, klocki)', category: 'ręczne', priceNet: zl(450), durabilityHours: 2_000, maintenanceNet: zl(45), speedBps: {}, quality: {} },
  { id: 'drill', label: 'Wkrętarka akumulatorowa', category: 'elektronarzędzia', priceNet: zl(500), durabilityHours: 1_800, maintenanceNet: zl(50), speedBps: { '*': 800 }, quality: {} },
  { id: 'laser', label: 'Poziomica laserowa', category: 'elektronarzędzia', priceNet: zl(350), durabilityHours: 3_000, maintenanceNet: zl(35), speedBps: {}, quality: { '*': 3 } },
  { id: 'sander', label: 'Szlifierka do gipsu z odciągiem', category: 'specjalistyczny', priceNet: zl(2_400), durabilityHours: 1_500, maintenanceNet: zl(240), speedBps: { gladzie: 2_500 }, quality: { gladzie: 6 } },
  { id: 'sprayer', label: 'Agregat malarski natryskowy', category: 'specjalistyczny', priceNet: zl(3_800), durabilityHours: 1_200, maintenanceNet: zl(380), speedBps: { malowanie: 3_500 }, quality: { malowanie: 4 } },
  { id: 'miter-saw', label: 'Ukośnica do cięcia listew i paneli', category: 'specjalistyczny', priceNet: zl(1_400), durabilityHours: 1_800, maintenanceNet: zl(140), speedBps: { panele: 2_500 }, quality: { panele: 4 } },
  { id: 'roof-rack', label: 'Bagażnik dachowy i wózek transportowy', category: 'transport', priceNet: zl(700), durabilityHours: 3_000, maintenanceNet: zl(70), speedBps: {}, quality: {}, transportSaveBps: 3_000 },
  { id: 'trailer', label: 'Przyczepka towarowa', category: 'transport', priceNet: zl(5_500), durabilityHours: 4_000, maintenanceNet: zl(400), speedBps: {}, quality: {}, transportSaveBps: 5_500 },
];
export const EQUIPMENT_BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));

export interface ServiceDef {
  id: string;
  label: string;
  description: string;
  /** Jednostka rozliczeniowa. */
  unit: 'm²' | 'godz.';
  /** Norma czasu: setne godziny na jednostkę (pracy w standardowej wydajności). */
  normCentiPerUnit: number;
  /** 1 = łatwe … 3 = trudne; poziom umiejętności wymagany do przyjęcia zlecenia = trudność + (trudne ? 1 : 0). */
  difficulty: 1 | 2 | 3;
  /** Zużycie materiałów na 100 jednostek (w jednostkach materiału; zawiera typowy odpad). */
  materialsPer100: { materialId: string; qty: number }[];
  requiredEquipment: string[];
  /** Orientacyjna cena rynkowa netto za jednostkę (materiały + robocizna + marża) — PARAMETR SYMULACYJNY. */
  referencePerUnit: Grosze;
  qtyRange: [number, number];
  risks: string[];
  /** Typowa dzienna stawka dojazdu/transportu (netto). */
  transportPerDay: Grosze;
}

export const SERVICES: readonly ServiceDef[] = [
  {
    id: 'malowanie', label: 'Malowanie ścian i sufitów', description: 'Zabezpieczenie, gruntowanie i dwukrotne malowanie pomieszczeń.',
    unit: 'm²', normCentiPerUnit: 30, difficulty: 1,
    materialsPer100: [{ materialId: 'farba', qty: 32 }, { materialId: 'tasma-folia', qty: 7 }],
    requiredEquipment: ['paint-basic'], referencePerUnit: zl(38), qtyRange: [30, 140], transportPerDay: zl(35),
    risks: ['nierówne podłoże wymagające dodatkowego gruntowania', 'zmiana koloru przez klienta', 'wilgoć na ścianach'],
  },
  {
    id: 'gladzie', label: 'Gładzie i szpachlowanie', description: 'Dwuwarstwowe gładzie gipsowe ze szlifowaniem, przygotowanie ścian pod malowanie.',
    unit: 'm²', normCentiPerUnit: 55, difficulty: 2,
    materialsPer100: [{ materialId: 'gladz', qty: 250 }, { materialId: 'grunt', qty: 15 }, { materialId: 'papier', qty: 5 }],
    requiredEquipment: ['trowel-set'], referencePerUnit: zl(54), qtyRange: [25, 120], transportPerDay: zl(35),
    risks: ['ukryte ubytki i pęknięcia tynku', 'kurz i konieczność dodatkowego sprzątania', 'zbyt wilgotne podłoże'],
  },
  {
    id: 'panele', label: 'Montaż paneli podłogowych', description: 'Rozłożenie podkładu, montaż paneli i listew przypodłogowych.',
    unit: 'm²', normCentiPerUnit: 40, difficulty: 2,
    materialsPer100: [{ materialId: 'panele', qty: 108 }, { materialId: 'podklad', qty: 105 }, { materialId: 'listwy', qty: 60 }],
    requiredEquipment: ['panel-kit'], referencePerUnit: zl(118), qtyRange: [15, 80], transportPerDay: zl(45),
    risks: ['nierówna wylewka', 'błędy cięcia i większy odpad', 'opóźniona dostawa paneli'],
  },
  {
    id: 'drobne', label: 'Drobne prace wykończeniowe', description: 'Montaż listew, uszczelnienia, drobne poprawki i naprawy — rozliczane godzinowo.',
    unit: 'godz.', normCentiPerUnit: 100, difficulty: 1,
    materialsPer100: [{ materialId: 'drobne', qty: 12 }],
    requiredEquipment: ['hand-tools'], referencePerUnit: zl(95), qtyRange: [6, 40], transportPerDay: zl(30),
    risks: ['zakres rozszerzany w trakcie prac', 'brak dostępu do lokalu w umówionym terminie'],
  },
];
export const SERVICE_BY_ID = new Map(SERVICES.map((s) => [s.id, s]));

/** Szkolenie dla dodatkowej specjalizacji (wydatek firmy). */
export const SPECIALIZATION_COURSE: Grosze = zl(1_800);

/** Progi umiejętności (godziny efektywnej pracy) dla poziomów 3, 4, 5; poziom 2 = start specjalizacji. */
export const SKILL_THRESHOLD_CENTI = [20_000, 50_000, 110_000] as const;
export const SKILL_START_CENTI = 4_000;
export const SKILL_SPEED_BPS = [0, 8_500, 10_000, 11_200, 12_200, 13_000] as const;
export const SKILL_QUALITY = [0, 52, 64, 72, 80, 87] as const;

export const DISTRICTS = ['Śródmieście', 'Zatorze', 'Jaroty', 'Nagórki', 'Pieczewo', 'Kortowo', 'Dajtki', 'Podleśna', 'Likusy', 'Mazurskie'] as const;
export const CLIENT_NAMES = ['Anna W.', 'Marek K.', 'Ewa N.', 'Piotr Z.', 'Joanna S.', 'Tomasz B.', 'Karolina M.', 'Paweł D.', 'Magdalena L.', 'Robert G.', 'Agnieszka T.', 'Krzysztof R.'] as const;

/** Sezonowość popytu (miesiąc 1–12), pkt bazowe. PARAMETR SYMULACYJNY (używany przez rynek: `renovationMarket.ts`; reklama i szansa dzienna zastąpione w v0.7 modelem rynku). */
export const SEASONALITY_BPS = [0, 7_000, 8_000, 9_500, 11_000, 11_500, 10_500, 10_000, 10_000, 11_500, 12_000, 9_500, 7_000] as const;

export const OWN_LABOR_RATE_DEFAULT: Grosze = zl(60);
export const OTHER_COSTS_BPS = 400;
export const DELAY_PENALTY_BPS_PER_WEEK = 200;
export const DELAY_PENALTY_CAP_BPS = 1_500;
export const COMPLAINT_WINDOW_DAYS = 14;
export const CANCEL_AFTER_DEADLINE_DAYS = 45;

/** Plany obsługi księgowej (oferty biur rachunkowych — FIKCYJNE, parametry symulacyjne). */
export interface AccountingPlan {
  id: string;
  office: string;
  label: string;
  monthlyNet: Grosze;
  description: string;
  features: { reminders: boolean; gaps: boolean; autoClaim: boolean; formComparison: boolean };
}
export const ACCOUNTING_PLANS: readonly AccountingPlan[] = [
  {
    id: 'start', office: 'Biuro Rachunkowe „Łyna” (fikcyjne)', label: 'Pakiet Start', monthlyNet: zl(280),
    description: 'Prowadzenie ewidencji i przypomnienia o terminach ZUS, PIT i VAT.',
    features: { reminders: true, gaps: false, autoClaim: false, formComparison: false },
  },
  {
    id: 'standard', office: 'Biuro Rachunkowe „Łyna” (fikcyjne)', label: 'Pakiet Standard', monthlyNet: zl(520),
    description: 'Start + powiadomienia o brakach (brak środków na zobowiązania, zaległe należności, brak materiałów) + wnioski o zwrot nadpłaty składki zdrowotnej w terminie.',
    features: { reminders: true, gaps: true, autoClaim: true, formComparison: false },
  },
  {
    id: 'plus', office: 'Centrum Księgowe „Kormoran” (fikcyjne)', label: 'Pakiet Plus', monthlyNet: zl(890),
    description: 'Standard + coroczne porównanie form opodatkowania przed końcem roku (obliczenia silnika gry — informacja, nie doradztwo podatkowe).',
    features: { reminders: true, gaps: true, autoClaim: true, formComparison: true },
  },
];
export const ACCOUNTING_PLAN_BY_ID = new Map(ACCOUNTING_PLANS.map((p) => [p.id, p]));

/* ---------- v0.6: umiejętności pracowników, role, pojazdy, podwykonawcy (parametry symulacyjne) ---------- */

/** Poziom umiejętności z doświadczenia (setne godziny): 1 = początkujący, 2 od 40 godz., 3–5 wg progów. */
export function levelFromXp(xp: number): number {
  let level = xp >= SKILL_START_CENTI ? 2 : 1;
  for (const th of SKILL_THRESHOLD_CENTI) if (xp >= th) level += 1;
  return Math.min(5, level);
}
/** Doświadczenie odpowiadające początkowi poziomu (dla generowanych kandydatów). */
export const LEVEL_START_XP = [0, 0, SKILL_START_CENTI, SKILL_THRESHOLD_CENTI[0], SKILL_THRESHOLD_CENTI[1], SKILL_THRESHOLD_CENTI[2]] as const;

/** Rynkowe wynagrodzenie brutto miesięcznie przy pełnym etacie wg poziomu (PARAMETR SYMULACYJNY, nie dane rynkowe). */
export const MARKET_GROSS_BY_LEVEL = [0, zl(4_806), zl(5_400), zl(6_300), zl(7_400), zl(8_600)] as const;

export interface RoleDef { id: string; label: string; skillId: string }
export const ROLES: readonly RoleDef[] = [
  { id: 'malarz', label: 'Malarz', skillId: 'malowanie' },
  { id: 'gipsiarz', label: 'Gipsiarz (gładzie)', skillId: 'gladzie' },
  { id: 'monter-podlog', label: 'Monter podłóg', skillId: 'panele' },
  { id: 'wykonczeniowiec', label: 'Pracownik wykończeniowy', skillId: 'drobne' },
  { id: 'pomocnik', label: 'Pracownik ogólny / pomocnik', skillId: 'ogolne' },
];
export const ROLE_BY_ID = new Map(ROLES.map((r) => [r.id, r]));

export const LISTING_TIERS = {
  basic: { label: 'Ogłoszenie podstawowe', costNet: zl(300), rateBps: 1_200 },
  premium: { label: 'Ogłoszenie wyróżnione', costNet: zl(800), rateBps: 2_600 },
} as const;
export const MAX_CANDIDATES_PER_LISTING = 6;
export const LISTING_DAYS = 21;
export const MAX_EMPLOYEES = 8;

export const FIRST_NAMES = ['Adam', 'Bartosz', 'Cezary', 'Damian', 'Edyta', 'Filip', 'Grzegorz', 'Hubert', 'Iwona', 'Jakub', 'Kamil', 'Łukasz', 'Marta', 'Norbert', 'Oskar', 'Patryk', 'Rafał', 'Sylwia', 'Tadeusz', 'Wojciech'] as const;
export const LAST_NAMES = ['Adamski', 'Baran', 'Czarnecki', 'Dąbrowski', 'Gajewski', 'Jasiński', 'Kaczmarek', 'Lewandowski', 'Maj', 'Nowicki', 'Olszewski', 'Pawlak', 'Rutkowski', 'Sikora', 'Tomaszewski', 'Urban', 'Walczak', 'Zawadzki'] as const;

export interface VehicleDef {
  id: string;
  label: string;
  description: string;
  priceNet: Grosze;
  /** Pojemność transportowa w punktach ładunku (porównywana z zapotrzebowaniem kontraktu). */
  capacity: number;
  /** Zmienny koszt eksploatacji za dzień pracy przy kontrakcie (paliwo, zużycie). */
  runPerDay: Grosze;
  /** Koszty stałe miesięcznie (ubezpieczenie, przegląd, postój). */
  fixedMonthly: Grosze;
  /** Trwałość: dni użycia do pełnego zużycia. */
  durabilityDays: number;
}
export const VEHICLES: readonly VehicleDef[] = [
  { id: 'kombi', label: 'Pojazd osobowo-dostawczy (kombi)', description: 'Tani w utrzymaniu, mała pojemność.', priceNet: zl(24_000), capacity: 2, runPerDay: zl(40), fixedMonthly: zl(260), durabilityDays: 1_500 },
  { id: 'van-small', label: 'Mały samochód dostawczy', description: 'Dobry kompromis dla ekipy 2–3 osób.', priceNet: zl(38_000), capacity: 3, runPerDay: zl(55), fixedMonthly: zl(320), durabilityDays: 1_800 },
  { id: 'bus', label: 'Większy bus', description: 'Duża pojemność: materiały i ekipa 4–5 osób.', priceNet: zl(72_000), capacity: 6, runPerDay: zl(80), fixedMonthly: zl(480), durabilityDays: 2_200 },
];
export const VEHICLE_BY_ID = new Map(VEHICLES.map((v) => [v.id, v]));
export const VEHICLE_AGING_BPS_PER_MONTH = 40;

/** Zapotrzebowanie transportowe kontraktu (punkty ładunku) — porównywane z pojemnością pojazdu. */
export const loadPoints = (serviceId: string, units: number): number => 1 + Math.floor(units / (serviceId === 'panele' ? 30 : serviceId === 'drobne' ? 40 : 60));

export const SUBCONTRACTOR_SEEDS: { name: string; services: string[]; priceBps: number; quality: number; reliabilityBps: number }[] = [
  { name: 'Malowanie-Serwis Łyna (fikcyjna)', services: ['malowanie', 'gladzie'], priceBps: 4_200, quality: 74, reliabilityBps: 8_800 },
  { name: 'PodłogiPro Warmia (fikcyjna)', services: ['panele', 'drobne'], priceBps: 3_800, quality: 82, reliabilityBps: 9_200 },
  { name: 'Ekipa Remontowa Kormoran (fikcyjna)', services: ['malowanie', 'gladzie', 'panele', 'drobne'], priceBps: 3_400, quality: 62, reliabilityBps: 7_400 },
  { name: 'Wykończenia Dajtki (fikcyjna)', services: ['gladzie', 'malowanie'], priceBps: 4_800, quality: 88, reliabilityBps: 9_400 },
  { name: 'Montaż-Szybko Jaroty (fikcyjna)', services: ['panele', 'drobne', 'malowanie'], priceBps: 3_100, quality: 55, reliabilityBps: 6_800 },
  // v0.8.1: pula podwykonawców jest szersza — jedna ekipa realizuje naraz jeden kontrakt, więc pięciu wykonawców ograniczało skalę modelu „generalny wykonawca” do ok. 40 kontraktów rocznie
  { name: 'Malarz-Plus Zatorze (fikcyjna)', services: ['malowanie', 'drobne'], priceBps: 3_600, quality: 70, reliabilityBps: 8_400 },
  { name: 'Gładź-Mistrz Pieczewo (fikcyjna)', services: ['gladzie', 'malowanie'], priceBps: 4_400, quality: 79, reliabilityBps: 8_900 },
  { name: 'Panele-Ekspres Nagórki (fikcyjna)', services: ['panele', 'drobne'], priceBps: 3_300, quality: 68, reliabilityBps: 8_100 },
  { name: 'Ekipa Wykończeniowa Likusy (fikcyjna)', services: ['malowanie', 'gladzie', 'panele'], priceBps: 3_900, quality: 76, reliabilityBps: 8_600 },
  { name: 'Złota Rączka Kortowo (fikcyjna)', services: ['drobne', 'panele', 'malowanie'], priceBps: 3_500, quality: 66, reliabilityBps: 7_900 },
];

/** Norma pracy w setnych godziny (bez uwzględnienia wydajności wykonawcy) dla zakresu usługi. */
export const normCentiOf = (serviceId: string, units: number, complexity: 'standard' | 'trudne'): number =>
  Math.round((SERVICE_BY_ID.get(serviceId)!.normCentiPerUnit * units * COMPLEXITY_HOURS_BPS[complexity]) / 10_000);

/** Orientacyjna cena rynkowa netto zlecenia — baza budżetu klienta, wskaźnika cen i cen konkurentów (v0.7: przeniesiona z renovation.ts). */
export function referencePrice(serviceId: string, units: number, complexity: Complexity, qualityReq: number): Grosze {
  const def = SERVICE_BY_ID.get(serviceId)!;
  const q = qualityReq === 3 ? 11_200 : qualityReq === 1 ? 9_500 : 10_000;
  const raw = mulBps(mulBps(def.referencePerUnit * units, COMPLEXITY_HOURS_BPS[complexity]), q);
  return Math.max(zl(10), roundDiv(raw, zl(10)) * zl(10));
}
