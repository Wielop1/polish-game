import { zl } from './money.ts';

/**
 * Stałe prawne i parametry kalibracyjne spółek z o.o. (v0.8).
 * Wartości prawne mają odpowiedniki w rejestrze reguł (`legalCorp.ts`, `docs/LEGAL_SOURCES.md`); parametry „kalibracyjne” to założenia symulacji
 * (nie fakty prawne) i są tak oznaczone w interfejsie.
 */

export const CORP = {
  /** Art. 154 § 1–2 KSH. */
  capitalMin: zl(5_000),
  nominalMin: zl(50),
  /** Opłata sądowa za wpis spółki z o.o. zawartej przez wzorzec S24 (art. 52 ust. 2 u.k.s.c.). Opłaty za ogłoszenie w MSiG nie ma od 29.11.2025 (Dz.U. 2025 poz. 1556). */
  courtFeeRegistration: zl(250),
  /** Zmiana wpisu (zarząd, kapitał): 250 zł (art. 55 ust. 1) albo 200 zł przy zmianie wzorcem uchwały z systemu teleinformatycznego (art. 55 ust. 2). */
  courtFeeChange: zl(250),
  courtFeeChangeTemplate: zl(200),
  /** PCC: umowa spółki i podwyższenie kapitału 0,5% (art. 7 ust. 1 pkt 9), sprzedaż praw majątkowych (udziałów) 1% (pkt 1 lit. b). */
  pccCompanyBps: 50,
  pccSaleBps: 100,
  pccDueDays: 14,
  /** Zwołanie zgromadzenia wspólników: co najmniej dwa tygodnie przed terminem (art. 238 § 1 KSH). */
  assemblyNoticeDays: 14,
  /** Sąd rejestrowy rozpoznaje wniosek S24 w terminie jednego dnia (art. 20a ust. 2 ustawy o KRS); inne wnioski — do 7 dni (ust. 1). */
  krsDecisionDaysS24: 1,
  krsChangeDaysMin: 2,
  krsChangeDaysMax: 7,
  /** Zwyczajne zgromadzenie wspólników: w ciągu 6 miesięcy po roku obrotowym (art. 231 § 1 KSH). */
  ordinaryAssemblyMonths: 6,
  /** Maksymalna liczba członków zarządu w grze. */
  maxBoard: 4,
  maxShareholders: 6,
  /** Stawki CIT 2026 (art. 19 ust. 1 pkt 1–2 ustawy o CIT). */
  citStandardBps: 1_900,
  citSmallBps: 900,
  /** 2 000 000 EUR × 4,2156 (średni kurs NBP z 2.01.2026 — pierwszy dzień roboczy 2026), zaokrąglone do 1000 zł (art. 19 ust. 1 pkt 2 lit. a). */
  citRevenueLimit2026: zl(8_431_000),
  /** 2 000 000 EUR × 4,3770 (średni kurs NBP z 1.10.2026 — pierwszy dzień roboczy października), do ustalenia statusu małego podatnika w 2027 r. (art. 4a pkt 10). */
  citSmallLimitFor2027: zl(8_754_000),
  /** Podatek od dywidend dla osób fizycznych: 19% zryczałtowany (art. 30a ust. 1 pkt 4 PIT), pobiera spółka, odprowadza do 20. dnia następnego miesiąca (art. 42 ust. 1). */
  dividendTaxBps: 1_900,
  dividendTaxDueDay: 20,
  /** Sprzedaż udziałów przez osobę fizyczną: 19% dochodu (art. 30b ust. 1 pkt 2 PIT), zeznanie roczne do 30 kwietnia. */
  shareSaleTaxBps: 1_900,
  /** Zdrowotna jedynego wspólnika sp. z o.o.: 9% × 9 228,64 zł (przeciętne wynagrodzenie w sektorze przedsiębiorstw w IV kw. 2025, MP 2026 poz. 117; art. 81 ust. 2za u.ś.o.z.). */
  soleHealth: zl(830.58),
  /** ZUS za pracowników spółki (płatnik z osobowością prawną): do 15. dnia następnego miesiąca (art. 47 ust. 1 pkt 3 ustawy o systemie ubezpieczeń społecznych). */
  zusDayLegalEntity: 15,
  /** Składki ZUS jedynego wspólnika płatne do 20. dnia (płatnik składek za siebie jako osoba fizyczna). */
  zusDayPerson: 20,

  /* ---------- Parametry kalibracyjne (nie fakty prawne) ---------- */
  /** Wycena: mnożnik zysku netto z 12 miesięcy (bps ×10 000 = 1,0×) przy neutralnych warunkach. */
  valuation: {
    baseEarningsMultipleBps: 40_000,
    minMultipleBps: 20_000,
    maxMultipleBps: 70_000,
    /** Waga wyceny dochodowej względem aktywów netto (pkt bazowe), gdy firma ma ≥ 6 mies. historii. */
    earningsWeightBps: 5_000,
    /** Miesięcy działalności, od których wycena uwzględnia wyniki. */
    minMonthsForEarnings: 3,
    /** Dyskonto zadłużenia: odjęcie przeterminowanych zobowiązań ponad aktywa obrotowe. */
    lowLiquidityPenaltyBps: 1_500,
  },
  /** Czas oczekiwania na odpowiedź partnera w negocjacjach (dni). */
  negotiationDays: 21,
  maxNegotiationRounds: 4,
  /** Wydatek ponad tę część kapitału zakładowego (i ≥ 50 000 zł) w ciągu 2 lat od rejestracji wymaga uchwały wspólników (art. 229 KSH). */
  art229Fraction: 4,
  art229MinAmount: zl(50_000),
  art229Years: 2,
} as const;

export const REPRESENTATION_LABELS = {
  each_alone: 'Każdy członek zarządu samodzielnie',
  joint_two: 'Dwóch członków zarządu łącznie (ustawowo, art. 205 § 1 KSH)',
  all_jointly: 'Wszyscy członkowie zarządu łącznie',
} as const;

export const RESOLUTION_LABELS = {
  appoint_board: 'Powołanie członka zarządu',
  dismiss_board: 'Odwołanie członka zarządu',
  approve_statements: 'Zatwierdzenie sprawozdania finansowego',
  allocate_profit: 'Podział zysku (dywidenda / kapitał zapasowy)',
  capital_increase: 'Podwyższenie kapitału zakładowego',
  change_representation: 'Zmiana sposobu reprezentacji (zmiana umowy spółki)',
  consent_acquisition: 'Zgoda na nabycie środków trwałych (art. 229 KSH)',
} as const;
