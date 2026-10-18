import { zl } from './money.ts';

/**
 * Rejestr reguł prawnych używanych przez silnik JDG (v0.3). Każda reguła ma identyfikator, zakres,
 * okres obowiązywania, źródło urzędowe, datę weryfikacji i status:
 *  - VERIFIED   — wartość/zasada potwierdzona na stronie urzędowej (patrz `source`),
 *  - SIMPLIFIED — zasada uproszczona w symulacji (opis ograniczeń w `note`),
 *  - DEFERRED   — niezaimplementowana (brak weryfikacji lub poza zakresem); UI nie udaje, że ją stosuje.
 * Pełny opis: docs/LEGAL_SOURCES.md. SYMULACJA — nie jest poradą prawną ani podatkową.
 */
export type LegalStatus = 'VERIFIED' | 'SIMPLIFIED' | 'DEFERRED';

export interface LegalRule {
  id: string;
  scope: 'PIT' | 'ZUS' | 'ZDROWOTNA' | 'VAT' | 'REJESTRACJA';
  title: string;
  validFrom: string;
  validTo: string | null;
  source: string;
  verifiedOn: string;
  status: LegalStatus;
  note: string;
}

const V = '2026-10-18';
const PIT = 'https://podatki.gov.pl/podatki-firmowe/pit/stawki-i-limity';
const PIT_LIN = 'https://podatki.gov.pl/podatki-firmowe/pit/informacje-podstawowe/co-jest-opodatkowane/opodatkowanie-podatkiem-liniowym';
const PIT_RYC = 'https://www.podatki.gov.pl/podatki-firmowe/pit/informacje-podstawowe/co-jest-opodatkowane/opodatkowanie-ryczaltem-od-przychodow-ewidencjonowanych';
const PIT_START = 'https://podatki.gov.pl/dzialalnosc-gospodarcza/forma-opodatkowania';
const PIT_HEALTH = 'https://www.podatki.gov.pl/ulgi-i-odliczenia/odliczenie-skladek-na-ubezpieczenie-zdrowotne-pit';
const VAT_EX = 'https://www.podatki.gov.pl/podatki-firmowe/vat/poradniki-i-informatory/zwolnienie-podmiotowe-od-podatku-vat';
const VAT_BASE = 'https://www.podatki.gov.pl/podatki-firmowe/vat/informacje-podstawowe';
const BG_ZUS = 'https://www.biznes.gov.pl/pl/portal/00274';
const BG_PREF = 'https://www.biznes.gov.pl/pl/portal/00286';
const BG_ZBIEG = 'https://www.biznes.gov.pl/pl/portal/00288';
const BG_ULGA = 'https://www.biznes.gov.pl/pl/portal/00285';
const BG_HEALTH = 'https://www.biznes.gov.pl/pl/portal/001052';
const BG_MALY = 'https://www.biznes.gov.pl/pl/portal/00284';
const BG_CLOSE = 'https://biznes.gov.pl/pl/portal/00258';

const r = (id: string, scope: LegalRule['scope'], title: string, status: LegalStatus, source: string, note: string, validFrom = '2026-01-01', validTo: string | null = '2026-12-31'): LegalRule => ({
  id, scope, title, validFrom, validTo, source, verifiedOn: V, status, note,
});

export const LEGAL_RULES: readonly LegalRule[] = [
  r('PIT-SCALE-2026', 'PIT', 'Skala podatkowa: 12% do 120 000 zł (minus 3 600 zł), 32% nadwyżki (10 800 zł + 32% ponad 120 000 zł)', 'VERIFIED', PIT, 'Strona podaje skalę „od 2022 r.”; limit 2026 — z opisu strony zaktualizowanej 15.12.2025.'),
  r('PIT-LINEAR-2026', 'PIT', 'Podatek liniowy 19% dochodów z pozarolniczej działalności', 'VERIFIED', PIT, 'Stawka 19%.'),
  r('PIT-RYCZALT-RATES-2026', 'PIT', 'Stawki ryczałtu: 12% (niektóre usługi informatyczne), 8,5% (m.in. edukacja i pozostałe usługi), 15% (m.in. usługi reklamowe)', 'SIMPLIFIED', PIT, 'Stawkę ustala się wg klasyfikacji PKWiU konkretnej usługi — symulator przypisuje jedną stawkę do całego profilu. Niektóre usługi IT mają inną stawkę.'),
  r('PIT-RYCZALT-DEDUCT-2026', 'PIT', 'Ryczałt: składki społeczne odliczane od przychodu; 50% zapłaconych składek zdrowotnych od przychodu; podstawa = przychód bez kosztów', 'VERIFIED', PIT_RYC, 'Odliczane są tylko składki zapłacone w roku podatkowym; nadwyżka składek społecznych ponad przychód przepada.'),
  r('PIT-LINEAR-HEALTH-LIMIT-2026', 'PIT', 'Podatek liniowy: odliczenie składki zdrowotnej do 14 100 zł rocznie', 'VERIFIED', PIT_HEALTH, 'Limit 2026 r. (2025: 12 900 zł).'),
  r('PIT-SKALA-NO-HEALTH-DEDUCT', 'PIT', 'Skala podatkowa: brak odliczenia składki zdrowotnej', 'VERIFIED', PIT_HEALTH, 'Składki społeczne zapłacone odliczane są od dochodu (biznes.gov.pl/00230).'),
  r('PIT-ADVANCE-DEADLINE', 'PIT', 'Zaliczki miesięczne do 20. dnia następnego miesiąca (za grudzień do 20 stycznia)', 'VERIFIED', PIT_LIN, 'Opcja kwartalna i zaliczki uproszczone — niezaimplementowane (DEFERRED).', '2026-01-01', null),
  r('PIT-ADVANCE-MIN-1000', 'PIT', 'Zaliczki nie wpłaca się, jeśli jej kwota nie przekracza 1 000 zł', 'VERIFIED', PIT_START, 'Niewpłacona kwota zwiększa kolejną zaliczkę (metoda narastająca).', '2026-01-01', null),
  r('PIT-ANNUAL-DEADLINE', 'PIT', 'Zeznanie roczne (PIT-36/36L/28) 15 lutego – 30 kwietnia; podatek wynikający z zeznania do 30 kwietnia', 'VERIFIED', PIT_RYC, 'Symulator rozlicza saldo roczne jako zobowiązanie z terminem 30 kwietnia; nie generuje zeznania.', '2026-01-01', null),
  r('PIT-FORM-CHOICE', 'PIT', 'Skala jest formą podstawową; liniowy i ryczałt wymagają zgłoszenia do 20. dnia miesiąca po pierwszym przychodzie', 'SIMPLIFIED', PIT_START, 'Symulator: wybór formy przy rejestracji; zmiana formy w trakcie działalności niedostępna.', '2026-01-01', null),
  r('PIT-EMPLOYER-RESTRICTION', 'PIT', 'Usługi dla obecnego/byłego pracodawcy o charakterze pracy etatowej pozbawiają prawa do liniowego, ryczałtu i ulg ZUS', 'VERIFIED', PIT_LIN, 'Symulator blokuje zlecenia od pracodawców gracza zamiast modelować utratę prawa.', '2026-01-01', null),
  r('PIT-SKALA-WITH-EMPLOYMENT', 'PIT', 'Skala przy równoległym etacie: łączne rozliczenie dochodów', 'SIMPLIFIED', PIT, 'Dochody z etatu nie wchodzą do progu 120 000 zł; gdy gracz miał etat w roku, kwota zmniejszająca 3 600 zł NIE jest stosowana do dochodu z JDG (zakłada się, że wykorzystał ją pracodawca). Rozliczenie łączne — DEFERRED.'),
  r('PIT-REVENUE-DATE', 'PIT', 'Moment powstania przychodu/kosztu = data wystawienia dokumentu (równa dacie wykonania usługi)', 'SIMPLIFIED', PIT_RYC, 'Metoda kasowa i rozbieżne daty sprzedaży — niezaimplementowane.', '2026-01-01', null),
  r('PIT-ROUNDING', 'PIT', 'Zaokrąglanie podatku do pełnych złotych', 'DEFERRED', PIT, 'Obliczenia w groszach bez zaokrąglenia do złotych (nie zweryfikowano zasad zaokrąglania).', '2026-01-01', null),
  r('PIT-LOSSES-RELIEFS', 'PIT', 'Straty z lat ubiegłych, ulgi (np. IP Box, B+R, prorodzinna), wspólne rozliczenie', 'DEFERRED', PIT, 'Poza zakresem v0.3.', '2026-01-01', null),
  r('ZUS-BASE-STANDARD-2026', 'ZUS', 'Podstawa składek społecznych: 60% prognozowanego przeciętnego wynagrodzenia = 5 652 zł', 'VERIFIED', BG_PREF, 'Prognozowane przeciętne wynagrodzenie 2026: 9 420 zł (zus.pl, wg wyników wyszukiwania; kwota 5 652 zł potwierdzona na biznes.gov.pl).'),
  r('ZUS-RATES-2026', 'ZUS', 'Stopy: emerytalna 19,52%, rentowa 8%, chorobowa 2,45% (dobrowolna), wypadkowa 1,67% (do 9 ubezpieczonych), FP+FS 2,45%', 'VERIFIED', BG_ZUS, 'Każdy składnik zaokrąglany do grosza. Stawka wypadkowa zależy od branży — przyjęto 1,67%.'),
  r('ZUS-PREF-BASE-2026', 'ZUS', 'Preferencyjna podstawa: 30% minimalnego wynagrodzenia (4 806 zł) = 1 441,80 zł; łącznie 456,18 zł (z chorobową)', 'VERIFIED', BG_PREF, 'FP i FS nie są płacone, gdy działalność jest jedynym tytułem do ubezpieczeń.'),
  r('ZUS-PREF-ELIGIBILITY', 'ZUS', 'Warunki: brak działalności w ostatnich 60 miesiącach; nie dla byłego pracodawcy; trwa 24 pełne miesiące', 'VERIFIED', BG_PREF, 'Zawieszenie nie przerywa biegu okresu. Symulator zakłada brak wcześniejszej działalności tylko, gdy w grze nie było JDG w ciągu 60 miesięcy.', '2026-01-01', null),
  r('ZUS-ULGA-START', 'ZUS', 'Ulga na start: do 6 miesięcy bez składek społecznych, składka zdrowotna płatna', 'VERIFIED', BG_ULGA, 'Miesiąc rozpoczęcia liczy się, jeśli działalność zaczyna się 1. dnia miesiąca (symulator: start zawsze 1. dnia). Po uldze — 24 miesiące składek preferencyjnych.', '2026-01-01', null),
  r('ZUS-PAYMENT-DEADLINE', 'ZUS', 'Składki płatne do 20. dnia następnego miesiąca (płatnicy nieposiadający osobowości prawnej)', 'VERIFIED', BG_ZUS, 'Dotyczy przedsiębiorcy będącego osobą fizyczną.', '2026-01-01', null),
  r('ZUS-ZBIEG-ETAT', 'ZUS', 'Zbieg z etatem: wynagrodzenie z etatu ≥ minimalne (4 806 zł w 2026 r.) = brak składek społecznych z JDG; niższe = składki z JDG', 'VERIFIED', BG_ZBIEG, 'Składka zdrowotna płatna z obu tytułów. Wyjątek zdrowotny dla ryczałtu przy niskim przychodzie — DEFERRED. Dobrowolne ubezpieczenia przy zbiegu — DEFERRED.'),
  r('ZUS-MALY-PLUS', 'ZUS', 'Mały ZUS Plus (przychód ≤ 120 000 zł w poprzednim roku, limit 36 z 60 miesięcy)', 'DEFERRED', BG_MALY, 'Zweryfikowane warunki, ale niezaimplementowane (rejestr rozwoju).', '2026-01-01', null),
  r('ZUS-VACATION-SUSPENSION', 'ZUS', 'Wakacje składkowe, składki w okresie zawieszenia działalności', 'DEFERRED', BG_CLOSE, 'Niezweryfikowane w tym etapie.', '2026-01-01', null),
  r('HEALTH-MIN-2026', 'ZDROWOTNA', 'Minimalna składka zdrowotna: 432,54 zł miesięcznie (9% × 4 806 zł) dla skali i liniowego', 'VERIFIED', BG_HEALTH, 'ZUS (wg wyszukiwania) podaje okres 1.02.2026–31.01.2027 dla kwot ryczałtowych; biznes.gov.pl — od 1.01.2026 dla minimum.'),
  r('HEALTH-RATES', 'ZDROWOTNA', 'Skala: 9% dochodu; liniowy: 4,9% dochodu; podstawa — dochód miesiąca poprzedniego', 'VERIFIED', BG_HEALTH, 'Symulator liczy dochód jako przychód − koszty − składki społeczne za miesiąc poprzedni (bez narastającej korekty strat i rozliczenia rocznego).', '2026-01-01', null),
  r('HEALTH-RYCZALT-2026', 'ZDROWOTNA', 'Ryczałt: 498,35 zł (przychód narastająco do 60 tys. zł), 830,58 zł (60–300 tys.), 1 495,04 zł (powyżej 300 tys.)', 'VERIFIED', BG_HEALTH, 'Przekroczenie progu w miesiącu: składka za ten miesiąc wg następnego progu. Kwoty ważne od 1.02.2026 wg ZUS; kwoty za styczeń 2026 niezweryfikowane — JDG startuje od 1.02.2026.', '2026-02-01', '2027-01-31'),
  r('HEALTH-ANNUAL-SETTLEMENT', 'ZDROWOTNA', 'Roczne rozliczenie składki zdrowotnej (dopłata do 20 maja)', 'DEFERRED', BG_HEALTH, 'Poza zakresem v0.3.', '2026-01-01', null),
  r('VAT-LIMIT-2026', 'VAT', 'Zwolnienie podmiotowe: limit sprzedaży 240 000 zł (od 1.01.2026)', 'VERIFIED', VAT_EX, 'Przejściowo zwolnienie przysługuje także przy sprzedaży 200–240 tys. zł w 2025 r.'),
  r('VAT-LIMIT-PRORATED', 'VAT', 'Limit proporcjonalny do okresu działalności w roku', 'SIMPLIFIED', VAT_EX, 'Strona nie podaje metody — symulator liczy w pełnych miesiącach (start zawsze 1. dnia miesiąca).'),
  r('VAT-EXEMPTION-EXCLUSIONS', 'VAT', 'Wyłączenia ze zwolnienia (art. 113 ust. 13; np. usługi prawnicze)', 'SIMPLIFIED', VAT_EX, 'Pełny katalog niezweryfikowany; profile usługowe dobrano tak, by nie obejmowały znanych wyłączeń. Czynności niewliczane do limitu (art. 113 ust. 2) — DEFERRED.', '2026-01-01', null),
  r('VAT-LIMIT-EXCEEDED', 'VAT', 'Utrata zwolnienia od czynności, którą przekroczono limit', 'VERIFIED', VAT_EX, 'Symulator: kwota umowna traktowana jako netto, VAT 23% doliczany do tej i kolejnych sprzedaży.', '2026-01-01', null),
  r('VAT-RATE-23', 'VAT', 'Stawka VAT 23% dla usług', 'SIMPLIFIED', VAT_BASE, 'Strona wymienia stawki 23%, 8%, 5% bez przypisania usług; symulator stosuje 23% do wszystkich usług profili.', '2026-01-01', null),
  r('VAT-SETTLEMENT-DEADLINE', 'VAT', 'Rozliczenie miesięczne i zapłata do 25. dnia następnego miesiąca (JPK_V7M)', 'VERIFIED', VAT_BASE, 'Rozliczenie kwartalne — DEFERRED. Obowiązek podatkowy = data wystawienia dokumentu (uproszczenie).', '2026-01-01', null),
  r('VAT-INPUT-DEDUCTION', 'VAT', 'Odliczenie VAT naliczonego tylko przez czynnego podatnika; podatnik zwolniony nie odlicza', 'SIMPLIFIED', VAT_BASE, 'Strona nie opisuje odliczenia przez podatnika zwolnionego — przyjęto brak odliczenia. Zwrot nadwyżki VAT naliczonego księgowany jako należność z terminem 25. dnia (w rzeczywistości zwykle przeniesienie/zwrot w terminach ustawowych).', '2026-01-01', null),
  r('VAT-KSEF-ADVANCED', 'VAT', 'KSeF, korekty, procedury szczególne, metoda kasowa', 'DEFERRED', VAT_BASE, 'Rekord sprzedaży w grze NIE jest fakturą zgodną z KSeF.', '2026-01-01', null),
  r('REG-PKD-2025', 'REJESTRACJA', 'Kody PKD 2025 (np. 62.10.B, 62.20.B)', 'SIMPLIFIED', 'https://www.biznes.gov.pl/pl/portal/00119', 'Kody 62.10.B i 62.20.B potwierdzone w wynikach z GUS/gov.pl; 85.59.A i 81.21.Z wynikają z kluczy powiązań GUS (nie sprawdzono pełnych nazw).', '2025-01-01', null),
  r('REG-CEIDG', 'REJESTRACJA', 'Rejestracja w CEIDG (biznes.gov.pl), zgłoszenie do ZUS w 7 dni', 'SIMPLIFIED', BG_ULGA, 'Symulator nie modeluje formularzy ani urzędów; rejestracja jest natychmiastowa, a start działalności przypada 1. dnia miesiąca.', '2026-01-01', null),
  r('REG-SUSPENSION-CLOSURE', 'REJESTRACJA', 'Zawieszenie (min. 30 dni) i zakończenie działalności', 'DEFERRED', BG_CLOSE, 'Zawieszenie niezaimplementowane (nie zweryfikowano skutków ZUS). Zakończenie: tylko na koniec miesiąca, po zakończeniu zleceń; ostatnia zaliczka do 20. dnia następnego miesiąca, zeznanie do 30 kwietnia.', '2026-01-01', null),
];

export const LEGAL_BY_ID = new Map(LEGAL_RULES.map((x) => [x.id, x]));

/** Wartości liczbowe reguł 2026 (grosze, pkt bazowe). */
export const RULES_2026 = {
  year: 2026,
  minWage: zl(4_806),
  zusBaseStandard: zl(5_652),
  zusBasePreferential: zl(1_441.8),
  zus: { emerytalna: 1_952, rentowa: 800, chorobowa: 245, wypadkowa: 167, fpFs: 245 },
  healthMin: zl(432.54),
  healthScaleBps: 900,
  healthLinearBps: 490,
  healthRyczalt: [
    { upToRevenue: zl(60_000), amount: zl(498.35) },
    { upToRevenue: zl(300_000), amount: zl(830.58) },
    { upToRevenue: Number.MAX_SAFE_INTEGER, amount: zl(1_495.04) },
  ],
  pit: {
    scaleThreshold: zl(120_000),
    scaleLowBps: 1_200,
    scaleHighBps: 3_200,
    scaleReduction: zl(3_600),
    linearBps: 1_900,
    linearHealthDeductionLimit: zl(14_100),
    ryczaltHealthDeductionBps: 5_000,
    advanceMinimum: zl(1_000),
    advanceDueDay: 20,
    annualDueMonthDay: [4, 30] as const,
  },
  vat: { exemptionLimit: zl(240_000), rateBps: 2_300, dueDay: 25 },
  zusDueDay: 20,
} as const;

/** Reguły są zweryfikowane tylko dla 2026 r.; w kolejnych latach stosujemy te same wartości (oznaczone w UI). */
export function carriedForward(year: number): boolean {
  return year !== RULES_2026.year;
}
