import { zl } from './money.ts';
import type { Grosze } from './money.ts';

/**
 * Centralna konfiguracja modelu rynku (v0.7). WSZYSTKIE wartości w tym pliku to parametry KALIBRACYJNE — nie pochodzą
 * z danych GUS ani z badań rynku; dobrano je tak, by model dawał wiarygodne rzędy wielkości i zachowania (patrz
 * `docs/BALANCE_REPORT.md`). W UI są oznaczone jako „kalibracyjne”. Stan gry kopiuje z konfiguracji tylko to, co musi być
 * stabilne w zapisie (konkurenci, budżety); sama konfiguracja nie jest częścią zapisu.
 *
 * Warstwa rynku jest wspólna dla branż: branża przekazuje własne parametry (`MarketIndustry`: usługi, segmenty, normy,
 * sezonowość), a wspólny silnik (market.ts) odpowiada za popyt, konkurencję, marketing, alokację klientów i strategię.
 */
export const MARKET_PARAMS_STATUS = 'kalibracyjne' as const;

export type SegmentId = 'budget' | 'standard' | 'premium';
export const SEGMENT_IDS: readonly SegmentId[] = ['budget', 'standard', 'premium'];
export type Positioning = 'low' | 'balanced' | 'premium';
export const POSITIONINGS: readonly Positioning[] = ['low', 'balanced', 'premium'];
export type CompetitorSize = 'solo' | 'small' | 'medium';
export type ChannelId = 'search' | 'local_ads' | 'portals' | 'referrals' | 'card' | 'partnerships';
export const CHANNEL_IDS: readonly ChannelId[] = ['search', 'local_ads', 'portals', 'referrals', 'card', 'partnerships'];

/* ---------- Miasto ---------- */

export interface CityDef { id: string; label: string; population: number; /** Mnożnik popytu względem średniej (10 000 = neutralnie). */ demandScaleBps: number }
export const MARKET_CITIES: Record<string, CityDef> = {
  olsztyn: { id: 'olsztyn', label: 'Olsztyn', population: 170_000, demandScaleBps: 10_000 },
};

/* ---------- Segmenty klientów ---------- */

export interface SegmentDef {
  id: SegmentId;
  label: string;
  description: string;
  /** Udział w popycie przy neutralnej koniunkturze (pkt bazowe; suma = 10 000). */
  shareBps: number;
  /** Waga ceny w ocenie oferty (większa = klient bardziej wrażliwy na cenę). */
  priceSensitivity: number;
  /** Jakość (0–100), której klient oczekuje, oraz waga odchylenia od niej. */
  expectedQuality: number;
  qualityWeight: number;
  /** Waga reputacji firmy (opinie). */
  reputationWeight: number;
  /** Waga terminowości — opóźnienie względem oczekiwanego startu (na 14 dni). */
  timeWeight: number;
  /** Budżet klienta względem ceny referencyjnej (pkt bazowe). */
  budgetFactorBps: number;
  /** Rozkład wymagań jakościowych w zapytaniach: [podstawowe, dobre, wysokie] w % (suma 100). */
  qualityReqPct: [number, number, number];
  /** Szansa, że klient negocjuje cenę (%). */
  haggleChancePct: number;
  /** Elastyczność terminu startu [min, max] dni. */
  flexDays: [number, number];
  /** Liczba firm, z którymi klient porównuje oferty. */
  considerationSize: number;
  /** Mnożnik ryzyka reklamacji (pkt bazowe; 10 000 = bez zmiany). */
  complaintFactorBps: number;
}

export const SEGMENTS: Record<SegmentId, SegmentDef> = {
  budget: {
    id: 'budget', label: 'Budżetowy', description: 'Szuka najniższej ceny; akceptuje podstawową jakość, chętnie negocjuje, mało wrażliwy na opinie.',
    shareBps: 3_800, priceSensitivity: 1.7, expectedQuality: 55, qualityWeight: 0.7, reputationWeight: 0.4, timeWeight: 0.4, budgetFactorBps: 9_000,
    qualityReqPct: [70, 30, 0], haggleChancePct: 55, flexDays: [2, 8], considerationSize: 3, complaintFactorBps: 9_000,
  },
  standard: {
    id: 'standard', label: 'Standardowy', description: 'Szuka rozsądnego stosunku ceny do jakości; sprawdza opinie, oczekuje dobrego wykonania w ustalonym terminie.',
    shareBps: 4_700, priceSensitivity: 1.0, expectedQuality: 68, qualityWeight: 1.2, reputationWeight: 1.0, timeWeight: 0.8, budgetFactorBps: 10_000,
    qualityReqPct: [10, 80, 10], haggleChancePct: 30, flexDays: [0, 6], considerationSize: 2, complaintFactorBps: 10_000,
  },
  premium: {
    id: 'premium', label: 'Premium', description: 'Płaci więcej za jakość, markę i punktualność; porównuje kilka firm, wymaga wysokich opinii, rzadko negocjuje, mocno karze wady.',
    shareBps: 1_500, priceSensitivity: 0.45, expectedQuality: 80, qualityWeight: 2.2, reputationWeight: 1.8, timeWeight: 1.0, budgetFactorBps: 11_500,
    qualityReqPct: [0, 20, 80], haggleChancePct: 12, flexDays: [0, 3], considerationSize: 3, complaintFactorBps: 13_500,
  },
};

/** Przesunięcie struktury klientów w zależności od koniunktury: recesja zwiększa udział budżetowych kosztem standardowych i premium. */
export const SEGMENT_SHIFT = { perPoint: -4, min: -400, max: 700, fromStandardPct: 70 } as const;

/* ---------- Popyt ---------- */

export const DEMAND = {
  /** Projekty remontowe w zakresie symulowanych usług, miesięcznie na 100 tys. mieszkańców, przy sezonowości neutralnej. */
  projectsPer100kPerMonth: 280,
  /** Odsetek projektów, dla których klient aktywnie szuka wykonawcy (reszta: własnoręcznie, rodzina, odkłada). */
  seekingRateBps: 4_000,
  /** Elastyczność popytu względem poziomu cen rynkowych: +10% cen u firm → o tyle pkt proc. mniej klientów szukających wykonawców (0,5 = −5%). */
  priceElasticity: 0.5,
  /** Mnożnik dni tygodnia (pn–nd), pkt bazowe; suma ≈ 70 000. */
  weekdayBps: [10_500, 10_500, 10_500, 10_500, 10_500, 11_000, 6_000],
  /** Szum miesięczny popytu (±, pkt bazowe). */
  monthlyNoiseBps: 600,
  /** Maksymalna liczba otwartych zapytań gracza, powyżej której kolejne zapytania giną (klient idzie do innej firmy). */
  maxOpenEnquiries: 6,
} as const;

/* ---------- Marketing ---------- */

export interface ChannelDef {
  id: ChannelId;
  label: string;
  description: string;
  /** Maksymalna widoczność kanału (waga ×10 000; średnia firma konkurencyjna ≈ 10 000). */
  maxReach: number;
  /** Miesięczny budżet, przy którym kanał daje połowę maksymalnej widoczności (malejące korzyści). */
  saturation: Grosze;
  /** Opóźnienie efektu w miesiącach: widoczność zbliża się do celu o 1/(1+opóźnienie) różnicy miesięcznie. */
  delayMonths: number;
  /** Wagi segmentów — który klient trafia przez kanał (pkt bazowe; 10 000 = neutralnie). */
  segmentBias: Record<SegmentId, number>;
  /** Wrażliwość skuteczności na koniunkturę (wpływ 0,01 indeksu na skuteczność, pkt bazowe). */
  macroSensitivityBps: number;
  /** Ile razy skuteczność maleje przy reklamie konkurencji (wzrost „tłoku”, pkt bazowe na jednostkę średniej widoczności konkurentów). */
  crowdingBps: number;
  /** Jakość zapytań: udział zapytań, w których klient pyta tylko jedną firmę (bez porównań), w %. */
  exclusivePct: number;
  /** Dodatkowe firmy, z którymi klient z tego kanału porównuje oferty (portale = porównywarki). */
  extraRivals: number;
  /** Mnożnik wartości projektów z kanału (pkt bazowe). */
  valueBps: number;
}

export const CHANNELS: Record<ChannelId, ChannelDef> = {
  search: {
    id: 'search', label: 'Wyszukiwarka internetowa', description: 'Pozycjonowanie i reklamy w wyszukiwarce — szybki efekt, klienci porównują oferty.',
    maxReach: 11_000, saturation: zl(1_600), delayMonths: 1, segmentBias: { budget: 10_000, standard: 12_000, premium: 9_000 }, macroSensitivityBps: 60, crowdingBps: 1_200,
    exclusivePct: 8, extraRivals: 0, valueBps: 10_000,
  },
  local_ads: {
    id: 'local_ads', label: 'Reklamy lokalne', description: 'Ulotki, tablice, lokalne radio i media społecznościowe — tańsze, krótszy zasięg, klienci cenowi.',
    maxReach: 5_500, saturation: zl(700), delayMonths: 1, segmentBias: { budget: 13_000, standard: 10_000, premium: 5_000 }, macroSensitivityBps: 30, crowdingBps: 700,
    exclusivePct: 12, extraRivals: 0, valueBps: 9_500,
  },
  portals: {
    id: 'portals', label: 'Portale z ogłoszeniami', description: 'Katalogi i porównywarki wykonawców — dużo zapytań, ale klient porównuje wiele firm i patrzy na cenę.',
    maxReach: 9_000, saturation: zl(1_100), delayMonths: 1, segmentBias: { budget: 14_000, standard: 11_000, premium: 6_000 }, macroSensitivityBps: 40, crowdingBps: 1_500,
    exclusivePct: 2, extraRivals: 1, valueBps: 9_500,
  },
  referrals: {
    id: 'referrals', label: 'Polecenia klientów', description: 'Program poleceń (bonusy, upominki). Poza budżetem działają też spontaniczne polecenia zadowolonych klientów.',
    maxReach: 5_000, saturation: zl(600), delayMonths: 3, segmentBias: { budget: 8_000, standard: 12_000, premium: 14_000 }, macroSensitivityBps: 0, crowdingBps: 0,
    exclusivePct: 55, extraRivals: 0, valueBps: 10_500,
  },
  card: {
    id: 'card', label: 'Wizytówka firmy', description: 'Wizytówki, oznakowanie pojazdu, profil firmy w mapach — niewielki, stały zasięg.',
    maxReach: 3_000, saturation: zl(250), delayMonths: 1, segmentBias: { budget: 9_000, standard: 12_000, premium: 11_000 }, macroSensitivityBps: 10, crowdingBps: 300,
    exclusivePct: 30, extraRivals: 0, valueBps: 10_000,
  },
  partnerships: {
    id: 'partnerships', label: 'Współpraca z przedsiębiorcami', description: 'Architekci, sklepy budowlane, deweloperzy, zarządcy — wolno rośnie, ale daje większe i lepsze zlecenia.',
    maxReach: 8_000, saturation: zl(900), delayMonths: 5, segmentBias: { budget: 3_000, standard: 9_000, premium: 22_000 }, macroSensitivityBps: 20, crowdingBps: 400,
    exclusivePct: 40, extraRivals: 0, valueBps: 11_500,
  },
};

/** Bazowa, darmowa widoczność nowej firmy i spontaniczne polecenia zadowolonych klientów (waga ×10 000). */
export const VISIBILITY = {
  organicBase: 1_800,
  /** Polecenia spontaniczne: maks. waga × (1 − 1/(1 + zakończone prace z 12 mies. / skala)) × reputacja. */
  referralOrganicMax: 9_000,
  referralOrganicScale: 25,
  /** Wpływ reputacji na widoczność: 0,55 + 0,9 × wynik/100 (pkt bazowe). */
  reputationBaseBps: 5_500,
  reputationSlopeBps: 90,
  /** Mnożnik widoczności dla usługi poza specjalizacją. */
  nonSpecializedBps: 1_200,
  /** Gdy zaległość kontraktów (dni pracy) przekracza próg, firma bywa „zajęta” — mniejsza widoczność. */
  backlogThresholdDays: 30,
  backlogPenaltyBps: 6_000,
} as const;

/* ---------- Strategia (pozycjonowanie) ---------- */

export interface PositioningDef {
  id: Positioning;
  label: string;
  description: string;
  /** Wagi widoczności wśród segmentów (pkt bazowe). */
  segmentBias: Record<SegmentId, number>;
  /** Dopasowanie marki do segmentu jako dodatek do oceny oferty (punkty ×100). */
  fit: Record<SegmentId, number>;
  /** Miesięczny koszt utrzymania pozycjonowania (portfolio, próbki, gwarancje, system jakości). */
  monthlyCost: Grosze;
  /** Typowy poziom cen i jakości firm o tym pozycjonowaniu (konkurenci). */
  typicalPriceBps: number;
  typicalQuality: number;
}

export const POSITIONING: Record<Positioning, PositioningDef> = {
  low: {
    id: 'low', label: 'Niska cena', description: 'Konkurujesz ceną: więcej klientów budżetowych, mniejsze marże, mniej uwagi klientów premium.',
    segmentBias: { budget: 15_000, standard: 10_000, premium: 3_500 }, fit: { budget: 30, standard: 0, premium: -35 }, monthlyCost: 0, typicalPriceBps: 8_800, typicalQuality: 58,
  },
  balanced: {
    id: 'balanced', label: 'Zrównoważona oferta', description: 'Rozsądna cena i jakość: rynek główny, bez wyraźnej przewagi i bez ryzyka niedopasowania.',
    segmentBias: { budget: 10_000, standard: 10_000, premium: 10_000 }, fit: { budget: 0, standard: 0, premium: 0 }, monthlyCost: 0, typicalPriceBps: 10_000, typicalQuality: 68,
  },
  premium: {
    id: 'premium', label: 'Wysoka jakość / premium', description: 'Wyższe ceny i wymagania: klienci premium cenią jakość i punktualność, ale mocniej karzą wady; koszt marki i systemu jakości.',
    segmentBias: { budget: 5_000, standard: 9_500, premium: 19_000 }, fit: { budget: -35, standard: 0, premium: 40 }, monthlyCost: zl(600), typicalPriceBps: 11_800, typicalQuality: 80,
  },
};

export const STRATEGY = {
  /** Pełny efekt zmiany pozycjonowania pojawia się stopniowo (liniowo) przez tyle dni. */
  transitionDays: 90,
  /** Minimalny odstęp między zmianami pozycjonowania. */
  cooldownDays: 60,
  /** Maks. liczba wpisów historii decyzji w stanie. */
  maxHistory: 40,
} as const;

/* ---------- Ocena oferty przez klienta ---------- */

export const UTILITY = {
  /** Punkty oceny za każde +10% ceny względem budżetu klienta × wrażliwość segmentu (cena = 0,9 budżetu → 0). */
  pricePerTenPct: 0.6,
  priceCenter: 0.9,
  /** Punkty za każde +20 pkt jakości / reputacji względem oczekiwań. */
  qualityPer20: 1,
  reputationPer20: 1,
  reputationCenter: 65,
  /** Punkty za każde 14 dni opóźnienia startu (× waga segmentu). */
  timePer14Days: 1,
  /** Skala losowego szumu oceny (suma trzech losowań). */
  noise: 0.55,
  /** Tabela logistyczna prawdopodobieństwa wyboru (pkt bazowe) dla różnicy ocen −4…+4. */
  logistic: [180, 470, 1_190, 2_690, 5_000, 7_310, 8_810, 9_530, 9_820] as readonly number[],
} as const;

/* ---------- Konkurenci ---------- */

export const COMPETITORS = {
  initialCount: 15,
  targetCount: 15,
  maxCount: 20,
  sizes: {
    solo: { workers: 1, visibility: 7_000, overhead: zl(1_500) },
    small: { workers: 3, visibility: 11_000, overhead: zl(2_200) },
    medium: { workers: 6, visibility: 18_000, overhead: zl(3_800) },
  } as Record<CompetitorSize, { workers: number; visibility: number; overhead: Grosze }>,
  initialMix: { solo: 6, small: 6, medium: 3 } as Record<CompetitorSize, number>,
  /** Koszt pełnego etatu (pracownik albo właściciel-wykonawca) miesięcznie. */
  costPerWorker: zl(8_000),
  /** Godziny efektywnej pracy na wykonawcę miesięcznie. */
  hoursPerWorkerMonth: 150,
  /** Godziny efektywnej pracy na wykonawcę w dzień roboczy (≈ 150 godz. miesięcznie). */
  hoursPerWorkerDay: 7,
  /** Gdy zaległość firmy (dni pracy) przekracza próg, nie przyjmuje kolejnych zleceń; od 5 dni rośnie czas oczekiwania, który klient widzi w ofercie. */
  maxBacklogDays: 15,
  /** Udział wartości dodanej (cena bez materiałów) w cenie zlecenia — ustala branża (usługi). */
  entry: { baseChancePct: 14, growthBonusPct: 6, minMonthsBetween: 2 },
  exit: { monthsInLoss: 7, minCash: -zl(8_000) },
  decisions: { priceStepBps: 250, priceMinBps: 7_800, priceMaxBps: 14_000, hireUtilBps: 9_500, fireUtilBps: 4_000, marketingStepBps: 1_500, maxWorkers: 9 },
  /** Średnia cena rynkowa: konkurenci porównują swoją cenę do niej, gdy rynek jest drogi/tani. */
  marketingSaturation: zl(1_200),
  marketingMaxReach: 9_000,
} as const;

/* ---------- Branża: interfejs przekazywany do wspólnego silnika ---------- */

export interface ProjectSpec {
  serviceId: string;
  units: number;
  complexity: 'standard' | 'trudne';
  qualityReq: 1 | 2 | 3;
  /** Godziny pracy normatywnej (do obciążenia konkurentów). */
  hours: number;
  /** Cena referencyjna netto (qualityReq uwzględnione) — baza budżetu i cen firm. */
  referenceGross: Grosze;
  budgetGross: Grosze;
  walkAwayGross: Grosze;
  desiredStartOffset: number;
  maxDays: number;
  flexDays: number;
  haggler: boolean;
  location: string;
  clientName: string;
}

export interface MarketIndustry {
  id: string;
  label: string;
  services: readonly { id: string; label: string; shareBps: number; /** Udział materiałów w cenie (reszta = wartość dodana usługi). */ materialShareBps: number }[];
  /** Sezonowość popytu (miesiąc 1–12), pkt bazowe, oraz korekta per usługa. */
  seasonalityBps: readonly number[];
  serviceSeasonalityBps: Record<string, readonly number[]>;
  /** Godziny pracy normatywnej i cena referencyjna zlecenia (do obciążenia konkurenta, który je zdobył). */
  estimate(serviceId: string, units: number, complexity: 'standard' | 'trudne', qualityReq: number): { hours: number; referenceGross: Grosze };
  /** Losuje szczegóły projektu klienta z danego segmentu (deterministycznie z przekazanego strumienia). */
  rollProject(rng: { int(lo: number, hi: number): number }, segment: SegmentDef, serviceId: string): ProjectSpec;
}
