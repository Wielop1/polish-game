import { zl } from './money.ts';
import type { Grosze } from './money.ts';
import type { HousingStandard, Lifestyle, Skill } from './state.ts';

/**
 * Parametry i katalogi treści.
 *
 * WSZYSTKIE wartości ekonomiczne poniżej są PRZYKŁADOWE (placeholder) i NIE zostały
 * zweryfikowane z danymi rzeczywistymi (płace, czynsze, ceny, oprocentowanie, podatki).
 * Oferty pracy i mieszkań są FIKCYJNE. Po utworzeniu gry / podpisaniu umowy warunki są
 * KOPIOWANE do stanu (umowy, reguły), więc zmiana tego pliku nie zmienia istniejących zapisów.
 */

export const GAME_START = {
  date: '2026-01-01',
  age: 22,
  cityId: 'olsztyn',
  cash: zl(5_000),
} as const;

export const CITIES: Record<string, { id: string; name: string; voivodeship: string }> = {
  olsztyn: { id: 'olsztyn', name: 'Olsztyn', voivodeship: 'warmińsko-mazurskie' },
};

export const PLACEHOLDER_NOTICE =
  'Wartości przykładowe — niezweryfikowane z danymi rzeczywistymi. Docelowo będą konfigurowalne i wersjonowane datami.';

/* ---------- Wynagrodzenia ---------- */

/**
 * Współczynnik 73% był szacunkiem netto/brutto do v0.3. Od v0.4 netto liczy kalkulator płac (`payroll.ts`);
 * stała zostaje wyłącznie do odtworzenia brutto z zapisów v1–v3 bez brutto (netto ≈ 73% brutto).
 */
export const NET_ESTIMATE_BPS = 7_300;
export const PAYROLL_NOTICE =
  'Netto liczy kalkulator płac 2026 (składki pracownika, składka zdrowotna, zaliczka PIT z PIT-2, ulga dla młodych) — wynik zależy od narastających kwot w roku.';

/* ---------- Start gry ---------- */

export const ECONOMY_V01 = {
  /** Brutto etatu startowego; netto wylicza kalkulator płac. */
  grossSalary: zl(6_300),
  salaryPayDay: 10,
  jobTitle: 'Pracownik biurowy (etat)',
  startHoursPerMonth: 168,
  /** Mieszkanie startowe: czynsz + opłaty eksploatacyjne; umowa bez kaucji (parametr przykładowy). */
  monthlyRent: zl(1_700),
  startUtilities: zl(300),
  rentIssueDay: 1,
  rentDueDay: 10,
  utilitiesIssueDay: 5,
  utilitiesDueDay: 15,
  phoneInternet: { amount: zl(70), issueDay: 12, dueDay: 12 },
} as const;

/* ---------- Styl życia ---------- */

export const LIFESTYLE_LABELS: Record<Lifestyle, string> = {
  oszczedny: 'Oszczędny',
  standardowy: 'Standardowy',
  komfortowy: 'Komfortowy',
};

/** Miesięczne wydatki zależne od stylu życia (przykładowe). Standardowy = wartości z v0.1. */
export const LIFESTYLE = {
  groceries: { oszczedny: zl(800), standardowy: zl(1_000), komfortowy: zl(1_400), issueDay: 3, dueDay: 3 },
  transport: { oszczedny: zl(150), standardowy: zl(180), komfortowy: zl(350), issueDay: 5, dueDay: 5 },
  leisure: { oszczedny: zl(150), standardowy: zl(300), komfortowy: zl(700), issueDay: 20, dueDay: 20, spreadBps: 1_500 },
} as const;

/** Bazowy poziom „jakości życia” wynikający z samego stylu życia (0–100), nie z majątku. */
export const LIFESTYLE_QOL: Record<Lifestyle, number> = { oszczedny: 35, standardowy: 60, komfortowy: 85 };

/* ---------- Budżet czasu ---------- */

export const TIME = {
  hoursPerDay: 24,
  /** Podstawowe obowiązki: gotowanie, higiena, zakupy, sprawy domowe. */
  dutiesHours: 3,
  /** Dojazd w dni robocze, gdy gracz jest zatrudniony. */
  commuteHours: 1,
  /** Dzielnik godzin miesięcznych na godziny w dniu roboczym (≈ 21 dni roboczych/mies.; bez świąt). */
  workdaysPerMonth: 21,
  sleepMin: 4,
  sleepMax: 10,
  defaultSleep: 8,
  businessMax: 8,
  startFatigue: 10,
} as const;

/* ---------- Oszczędności ---------- */

export const SAVINGS = {
  accountName: 'Konto oszczędnościowe',
  /** Oprocentowanie nominalne w skali roku (3,50%) — przykładowe. */
  rateBps: 350,
  /** Podatek od odsetek — przykładowy parametr konfiguracyjny, NIE potwierdzony fakt prawny. */
  taxBps: 1_900,
  bankName: 'Bank (fikcyjny)',
} as const;

/* ---------- Umiejętności ---------- */

export const SKILL_LABELS: Record<Skill, string> = {
  biuro: 'Praca biurowa',
  obsluga_klienta: 'Obsługa klienta',
  sprzedaz: 'Sprzedaż',
  techniczne: 'Umiejętności techniczne',
  angielski: 'Język angielski',
};

export const START_SKILLS: Record<Skill, number> = {
  biuro: 2,
  obsluga_klienta: 2,
  sprzedaz: 1,
  techniczne: 1,
  angielski: 2,
};

/* ---------- Katalog ofert pracy (fikcyjne) ---------- */

export interface JobOffer {
  id: string;
  title: string;
  employerId: string;
  employerName: string;
  description: string;
  grossMonthly: Grosze;
  hoursPerMonth: number;
  /** v0.2 wspiera wyłącznie umowę o pracę; pozostałe formy są w modelu jako przyszłe rozszerzenia. */
  employmentForm: 'umowa_o_prace';
  requiredSkills: Partial<Record<Skill, number>>;
  location: string;
  noticeMonths: number;
}

export const JOB_CATALOG: readonly JobOffer[] = [
  {
    id: 'job:asystent-biura',
    title: 'Asystent/ka biura',
    employerId: 'party:emp-biuro',
    employerName: 'Warmińskie Usługi Biurowe sp. z o.o.',
    description: 'Obsługa korespondencji, dokumentów i kalendarza zarządu.',
    grossMonthly: zl(5_600),
    hoursPerMonth: 168,
    employmentForm: 'umowa_o_prace',
    requiredSkills: { biuro: 2 },
    location: 'Olsztyn, Śródmieście',
    noticeMonths: 1,
  },
  {
    id: 'job:obsluga-klienta',
    title: 'Specjalista ds. obsługi klienta',
    employerId: 'party:emp-kontakt',
    employerName: 'Centrum Kontaktu Mazury sp. z o.o.',
    description: 'Telefoniczna i mailowa obsługa klientów, rozwiązywanie zgłoszeń.',
    grossMonthly: zl(6_000),
    hoursPerMonth: 168,
    employmentForm: 'umowa_o_prace',
    requiredSkills: { obsluga_klienta: 3, biuro: 1 },
    location: 'Olsztyn, Jaroty',
    noticeMonths: 1,
  },
  {
    id: 'job:recepcjonista',
    title: 'Recepcjonista/ka hotelowy/a',
    employerId: 'party:emp-hotel',
    employerName: 'Hotel Nad Jeziorem (fikcyjny)',
    description: 'Praca zmianowa w recepcji, obsługa gości także po angielsku.',
    grossMonthly: zl(5_200),
    hoursPerMonth: 160,
    employmentForm: 'umowa_o_prace',
    requiredSkills: { obsluga_klienta: 2, angielski: 3 },
    location: 'Olsztyn, Śródmieście',
    noticeMonths: 1,
  },
  {
    id: 'job:handlowiec',
    title: 'Przedstawiciel handlowy',
    employerId: 'party:emp-hurt',
    employerName: 'Handel Hurtowy Jezioro sp. z o.o.',
    description: 'Obsługa klientów B2B w regionie, wizyty i oferty.',
    grossMonthly: zl(6_800),
    hoursPerMonth: 168,
    employmentForm: 'umowa_o_prace',
    requiredSkills: { sprzedaz: 3, obsluga_klienta: 2 },
    location: 'Olsztyn i region (dojazdy)',
    noticeMonths: 1,
  },
  {
    id: 'job:technik-serwisu',
    title: 'Technik serwisu',
    employerId: 'party:emp-serwis',
    employerName: 'Serwis Techniczny Pojezierze sp. z o.o.',
    description: 'Montaż i serwis urządzeń u klientów.',
    grossMonthly: zl(7_200),
    hoursPerMonth: 168,
    employmentForm: 'umowa_o_prace',
    requiredSkills: { techniczne: 3 },
    location: 'Olsztyn, Dajtki',
    noticeMonths: 1,
  },
  {
    id: 'job:magazynier-pt',
    title: 'Magazynier (1/2 etatu)',
    employerId: 'party:emp-logistyka',
    employerName: 'Logistyka Warmia sp. z o.o.',
    description: 'Praca na pół etatu — zostawia dużo czasu na inne zajęcia.',
    grossMonthly: zl(3_300),
    hoursPerMonth: 84,
    employmentForm: 'umowa_o_prace',
    requiredSkills: { techniczne: 1 },
    location: 'Olsztyn, strefa przemysłowa',
    noticeMonths: 1,
  },
  {
    id: 'job:mlodszy-it',
    title: 'Młodszy specjalista IT',
    employerId: 'party:emp-it',
    employerName: 'Studio Programistyczne Łyna sp. z o.o.',
    description: 'Wsparcie zespołu developerskiego, testy, dokumentacja. Praca hybrydowa.',
    grossMonthly: zl(8_500),
    hoursPerMonth: 168,
    employmentForm: 'umowa_o_prace',
    requiredSkills: { techniczne: 3, angielski: 3, biuro: 2 },
    location: 'Olsztyn (hybrydowo)',
    noticeMonths: 1,
  },
  {
    id: 'job:kierownik-zmiany',
    title: 'Kierownik zmiany w sklepie',
    employerId: 'party:emp-sklepy',
    employerName: 'Sieć Sklepów Nad Łyną sp. z o.o.',
    description: 'Zarządzanie zmianą, grafikiem i sprzedażą; dłuższy czas pracy.',
    grossMonthly: zl(7_800),
    hoursPerMonth: 180,
    employmentForm: 'umowa_o_prace',
    requiredSkills: { sprzedaz: 3, obsluga_klienta: 3, biuro: 2 },
    location: 'Olsztyn, Kormoran',
    noticeMonths: 3,
  },
];

/* ---------- Katalog ofert najmu (fikcyjne, Olsztyn) ---------- */

export interface HousingListing {
  id: string;
  title: string;
  district: string;
  areaM2: number;
  standard: HousingStandard;
  rent: Grosze;
  utilities: Grosze;
  deposit: Grosze;
  movingCost: Grosze;
  noticeMonths: number;
  description: string;
}

export const STANDARD_LABELS: Record<HousingStandard, string> = {
  podstawowy: 'Podstawowy',
  dobry: 'Dobry',
  wysoki: 'Wysoki',
};

/** Standard mieszkania → wkład do wskaźnika jakości życia (0–100). */
export const STANDARD_QOL: Record<HousingStandard, number> = { podstawowy: 40, dobry: 65, wysoki: 90 };

export const HOUSING_CATALOG: readonly HousingListing[] = [
  {
    id: 'flat:pokoj-zatorze',
    title: 'Pokój w mieszkaniu współdzielonym',
    district: 'Zatorze',
    areaM2: 14,
    standard: 'podstawowy',
    rent: zl(900),
    utilities: zl(200),
    deposit: zl(900),
    movingCost: zl(300),
    noticeMonths: 1,
    description: 'Wspólna kuchnia i łazienka z dwiema osobami. Najtańsza opcja.',
  },
  {
    id: 'flat:kawalerka-nagorki',
    title: 'Kawalerka',
    district: 'Nagórki',
    areaM2: 28,
    standard: 'podstawowy',
    rent: zl(1_500),
    utilities: zl(280),
    deposit: zl(1_500),
    movingCost: zl(400),
    noticeMonths: 1,
    description: 'Samodzielna kawalerka w starszym bloku, bez windy.',
  },
  {
    id: 'flat:2pok-jaroty',
    title: 'Mieszkanie 2-pokojowe',
    district: 'Jaroty',
    areaM2: 42,
    standard: 'dobry',
    rent: zl(2_100),
    utilities: zl(350),
    deposit: zl(2_100),
    movingCost: zl(600),
    noticeMonths: 1,
    description: 'Dobrze utrzymane osiedle, blisko sklepów i komunikacji.',
  },
  {
    id: 'flat:3pok-kormoran',
    title: 'Mieszkanie 3-pokojowe',
    district: 'Kormoran',
    areaM2: 61,
    standard: 'dobry',
    rent: zl(3_200),
    utilities: zl(520),
    deposit: zl(3_200),
    movingCost: zl(900),
    noticeMonths: 1,
    description: 'Przestronne, z balkonem; wysoki koszt utrzymania.',
  },
  {
    id: 'flat:2pok-srodmiescie',
    title: 'Apartament 2-pokojowy po remoncie',
    district: 'Śródmieście',
    areaM2: 48,
    standard: 'wysoki',
    rent: zl(2_900),
    utilities: zl(450),
    deposit: zl(2_900),
    movingCost: zl(800),
    noticeMonths: 1,
    description: 'Wysoki standard w centrum, miejsce postojowe w cenie.',
  },
];

/** Opis mieszkania startowego (umowa z zapisu v1 nie ma tych danych — pola są wtedy null). */
export const START_HOME = {
  title: 'Najem mieszkania w Olsztynie',
  district: 'Pieczewo',
  areaM2: 32,
  standard: 'dobry' as HousingStandard,
};
