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
  scope: 'PIT' | 'ETAT' | 'ZUS' | 'ZDROWOTNA' | 'VAT' | 'REJESTRACJA';
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
const BG_SUSP = 'https://www.biznes.gov.pl/pl/portal/00141';
const BG_SOURCES = 'https://www.biznes.gov.pl/pl/portal/00235';
const BG_PIT_EMP = 'https://www.biznes.gov.pl/pl/portal/00234';
const BG_FORM = 'https://www.biznes.gov.pl/pl/portal/00172';
const PIT_YOUTH = 'https://www.podatki.gov.pl/ulgi-i-odliczenia/ulga-dla-mlodych-pit';
const PIT_LOSS = 'https://www.podatki.gov.pl/ulgi-i-odliczenia/odliczenie-straty-pit';
const PIT_REFUND = 'https://www.podatki.gov.pl/pit/zwrot-nadplaty/';
const PIT_COSTS = 'https://www.podatki.gov.pl/twoj-e-pit/pytania-i-odpowiedzi/koszty-uzyskania-przychodow';
const PIT2 = 'https://www.podatki.gov.pl/poradniki-i-informatory/pit-2-pit-2a-pit-3-zasady-skladania-oswiadczen-o-stosowaniu-pomniejszenia-zaliczki-o-kwote-zmniejszajaca-podatek-112-124-lub-136';
const ZUS_EMP = 'https://www.zus.pl/en/-/nowe-wysoko%C5%9Bci-sk%C5%82adek-na-ubezpieczenia-spo%C5%82eczne-w-2026-r.';
const ZUS_30 = 'https://www.zus.pl/en/firmy/rozliczenia-z-zus/30-krotnosc';
const ZUS_HEALTH_BASE = 'https://www.zus.pl/en/pracujacy/ubezpieczenie-zdrowotne-w-polsce/podstawa-wymiaru-skladek-na-ubezpieczenie-zdrowotne';
const ORD63 = 'https://www.podatki.gov.pl/media/g5ebnm2e/broszura-do-pit-38-za-2025-r.pdf';

const r = (id: string, scope: LegalRule['scope'], title: string, status: LegalStatus, source: string, note: string, validFrom = '2026-01-01', validTo: string | null = '2026-12-31'): LegalRule => ({
  id, scope, title, validFrom, validTo, source, verifiedOn: V, status, note,
});

export const LEGAL_RULES: readonly LegalRule[] = [
  r('PIT-SCALE-2026', 'PIT', 'Skala podatkowa: 12% do 120 000 zł (minus 3 600 zł), 32% nadwyżki (10 800 zł + 32% ponad 120 000 zł)', 'VERIFIED', PIT, 'Strona podaje skalę „od 2022 r.”; limit 2026 — z opisu strony zaktualizowanej 15.12.2025.'),
  r('PIT-LINEAR-2026', 'PIT', 'Podatek liniowy 19% dochodów z pozarolniczej działalności', 'VERIFIED', PIT, 'Stawka 19%.'),
  r('PIT-RYCZALT-RATES-2026', 'PIT', 'Stawki ryczałtu: 12% (niektóre usługi informatyczne), 8,5% (m.in. edukacja i pozostałe usługi), 15% (m.in. usługi reklamowe)', 'SIMPLIFIED', PIT, 'Stawkę ustala się wg klasyfikacji PKWiU konkretnej usługi — symulator przypisuje jedną stawkę do całego profilu. Niektóre usługi IT mają inną stawkę.'),
  r('PIT-RYCZALT-DEDUCT-2026', 'PIT', 'Ryczałt: składki społeczne odliczane od przychodu; 50% zapłaconych składek zdrowotnych od przychodu; podstawa = przychód bez kosztów', 'VERIFIED', PIT_RYC, 'Odliczane są tylko składki zapłacone w roku podatkowym; nadwyżka składek społecznych ponad przychód przepada.'),
  r('PIT-SKALA-NO-HEALTH-DEDUCT', 'PIT', 'Skala podatkowa: brak odliczenia składki zdrowotnej', 'VERIFIED', PIT_HEALTH, 'Składki społeczne zapłacone odliczane są od dochodu (biznes.gov.pl/00230).'),
  r('PIT-ADVANCE-DEADLINE', 'PIT', 'Zaliczki miesięczne do 20. dnia następnego miesiąca (za grudzień do 20 stycznia)', 'VERIFIED', PIT_LIN, 'Opcja kwartalna i zaliczki uproszczone — niezaimplementowane (DEFERRED).', '2026-01-01', null),
  r('PIT-ADVANCE-MIN-1000', 'PIT', 'Zaliczki nie wpłaca się, jeśli jej kwota nie przekracza 1 000 zł', 'VERIFIED', PIT_START, 'Niewpłacona kwota zwiększa kolejną zaliczkę (metoda narastająca).', '2026-01-01', null),
  r('PIT-EMPLOYER-RESTRICTION', 'PIT', 'Usługi dla obecnego/byłego pracodawcy o charakterze pracy etatowej pozbawiają prawa do liniowego, ryczałtu i ulg ZUS', 'VERIFIED', PIT_LIN, 'Symulator blokuje zlecenia od pracodawców gracza zamiast modelować utratę prawa.', '2026-01-01', null),
  r('PIT-SKALA-WITH-EMPLOYMENT', 'PIT', 'Skala przy równoległym etacie: roczne rozliczenie łączne; zaliczki JDG bez kwoty zmniejszającej, gdy zastosował ją pracodawca (PIT-2)', 'SIMPLIFIED', BG_SOURCES, 'Od v0.4 łączne rozliczenie roczne jest zaimplementowane (PIT-ANNUAL-SOURCES); w zaliczkach JDG kwota 3 600 zł jest pomijana, gdy w roku było zatrudnienie z PIT-2, a różnica wraca w rozliczeniu rocznym.'),
  r('PIT-REVENUE-DATE', 'PIT', 'Moment powstania przychodu/kosztu = data wystawienia dokumentu (równa dacie wykonania usługi)', 'SIMPLIFIED', PIT_RYC, 'Metoda kasowa i rozbieżne daty sprzedaży — niezaimplementowane.', '2026-01-01', null),
  r('ZUS-BASE-STANDARD-2026', 'ZUS', 'Podstawa składek społecznych: 60% prognozowanego przeciętnego wynagrodzenia = 5 652 zł', 'VERIFIED', BG_PREF, 'Prognozowane przeciętne wynagrodzenie 2026: 9 420 zł (zus.pl, wg wyników wyszukiwania; kwota 5 652 zł potwierdzona na biznes.gov.pl).'),
  r('ZUS-RATES-2026', 'ZUS', 'Stopy: emerytalna 19,52%, rentowa 8%, chorobowa 2,45% (dobrowolna), wypadkowa 1,67% (do 9 ubezpieczonych), FP+FS 2,45%', 'VERIFIED', BG_ZUS, 'Każdy składnik zaokrąglany do grosza. Stawka wypadkowa zależy od branży — przyjęto 1,67%.'),
  r('ZUS-PREF-BASE-2026', 'ZUS', 'Preferencyjna podstawa: 30% minimalnego wynagrodzenia (4 806 zł) = 1 441,80 zł; łącznie 456,18 zł (z chorobową)', 'VERIFIED', BG_PREF, 'FP i FS nie są płacone, gdy działalność jest jedynym tytułem do ubezpieczeń.'),
  r('ZUS-PREF-ELIGIBILITY', 'ZUS', 'Warunki: brak działalności w ostatnich 60 miesiącach; nie dla byłego pracodawcy; trwa 24 pełne miesiące', 'VERIFIED', BG_PREF, 'Zawieszenie nie przerywa biegu okresu. Symulator zakłada brak wcześniejszej działalności tylko, gdy w grze nie było JDG w ciągu 60 miesięcy.', '2026-01-01', null),
  r('ZUS-ULGA-START', 'ZUS', 'Ulga na start: do 6 miesięcy bez składek społecznych, składka zdrowotna płatna', 'VERIFIED', BG_ULGA, 'Miesiąc rozpoczęcia liczy się, jeśli działalność zaczyna się 1. dnia miesiąca (symulator: start zawsze 1. dnia). Po uldze — 24 miesiące składek preferencyjnych.', '2026-01-01', null),
  r('ZUS-PAYMENT-DEADLINE', 'ZUS', 'Składki płatne do 20. dnia następnego miesiąca (płatnicy nieposiadający osobowości prawnej)', 'VERIFIED', BG_ZUS, 'Dotyczy przedsiębiorcy będącego osobą fizyczną.', '2026-01-01', null),
  r('ZUS-ZBIEG-ETAT', 'ZUS', 'Zbieg z etatem: wynagrodzenie z etatu ≥ minimalne (4 806 zł w 2026 r.) = brak składek społecznych z JDG; niższe = składki z JDG', 'VERIFIED', BG_ZBIEG, 'Składka zdrowotna płatna z obu tytułów. Wyjątek zdrowotny dla ryczałtu przy niskim przychodzie — DEFERRED. Dobrowolne ubezpieczenia przy zbiegu — DEFERRED.'),
  r('HEALTH-MIN-2026', 'ZDROWOTNA', 'Minimalna składka zdrowotna: 432,54 zł miesięcznie (9% × 4 806 zł) dla skali i liniowego', 'VERIFIED', BG_HEALTH, 'ZUS (wg wyszukiwania) podaje okres 1.02.2026–31.01.2027 dla kwot ryczałtowych; biznes.gov.pl — od 1.01.2026 dla minimum.'),
  r('HEALTH-RATES', 'ZDROWOTNA', 'Skala: 9% dochodu; liniowy: 4,9% dochodu; podstawa — dochód miesiąca poprzedniego', 'VERIFIED', BG_HEALTH, 'Symulator liczy dochód jako przychód − koszty − składki społeczne za miesiąc poprzedni (bez narastającej korekty strat i rozliczenia rocznego).', '2026-01-01', null),
  r('HEALTH-RYCZALT-2026', 'ZDROWOTNA', 'Ryczałt: 498,35 zł (przychód narastająco do 60 tys. zł), 830,58 zł (60–300 tys.), 1 495,04 zł (powyżej 300 tys.)', 'VERIFIED', BG_HEALTH, 'Przekroczenie progu w miesiącu: składka za ten miesiąc wg następnego progu. Kwoty ważne od 1.02.2026 wg ZUS; kwoty za styczeń 2026 niezweryfikowane — JDG startuje od 1.02.2026.', '2026-02-01', '2027-01-31'),
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

  // ---------- v0.4: etat (wynagrodzenie brutto → netto) ----------
  r('PAY-SOCIAL-2026', 'ETAT', 'Składki pracownika: emerytalna 9,76%, rentowa 1,5%, chorobowa 2,45%; limit roczny podstawy emerytalnej i rentowej 282 600 zł (30-krotność)', 'VERIFIED', ZUS_EMP, 'Limit 30-krotności dotyczy tylko składek emerytalnej i rentowej (potwierdza zus.pl/30-krotnosc, ' + ZUS_30 + '). Każdy składnik zaokrąglany do grosza.'),
  r('PAY-HEALTH-BASE', 'ETAT', 'Składka zdrowotna pracownika 9% podstawy pomniejszonej o składki emerytalną, rentową i chorobową pracownika (bez limitu 30-krotności)', 'VERIFIED', ZUS_HEALTH_BASE, 'Przykład z zus.pl: płaca minimalna 4 806 zł → podstawa 4 147,09 zł → składka 373,24 zł (test).'),
  r('PAY-COSTS-2026', 'ETAT', 'Koszty uzyskania przychodu pracownika: 250 zł miesięcznie (3 000 zł rocznie) przy jednym stosunku pracy', 'VERIFIED', PIT_COSTS, 'Podwyższone 300 zł (pracownik dojeżdżający) i 4 500 zł przy kilku stosunkach pracy — DEFERRED; symulator zawsze stosuje 250 zł.'),
  r('PAY-PIT-ADVANCE', 'ETAT', 'Zaliczka PIT pracodawcy: podstawa = przychód − koszty − składki społeczne pracownika; 12% do 120 000 zł narastająco, 32% powyżej; minus 300 zł (1/12 kwoty zmniejszającej) po złożeniu PIT-2; przychód powstaje w miesiącu wypłaty', 'VERIFIED', BG_PIT_EMP, 'Strona biznes.gov.pl pochodzi z 2021 r., a skala i kwota zmniejszająca 2026 potwierdzone osobno (PIT-SCALE-2026, ' + PIT2 + '). Symulator zakłada złożone PIT-2 u jedynego pracodawcy; kwotę 300 zł stosuje się, dopóki narastający dochód nie przekroczy 120 000 zł.'),
  r('PAY-ROUNDING', 'ETAT', 'Zaliczka PIT pracodawcy zaokrąglana do pełnych złotych', 'SIMPLIFIED', ORD63, 'Zaokrąglanie do zł podstawy i podatku wynika z art. 63 § 1 Ordynacji podatkowej (dokumenty MF); sposób zaokrąglania samej zaliczki miesięcznej nie został odczytany w tekście ustawy — stosujemy tę samą zasadę.'),
  r('PAY-YOUTH-RELIEF-2026', 'ETAT', 'Ulga dla młodych (PIT-0): przychody ze stosunku pracy do dnia 26. urodzin włącznie zwolnione do 85 528 zł rocznie; składki społeczne od zwolnionej części nie podlegają odliczeniu', 'VERIFIED', PIT_YOUTH, 'Ulga NIE obejmuje przychodów z działalności gospodarczej; limit wspólny z ulgami 4+ i na powrót (niezaimplementowane). Nadwyżka ponad limit podlega skali. Koszty uzyskania przy częściowym zwolnieniu i wpływ zwolnionego przychodu na próg 120 000 zł — strona tego nie opisuje (uproszczenie: zwolniony przychód nie wchodzi do progu).'),
  r('PAY-LEGACY-PAYSLIPS', 'ETAT', 'Wynagrodzenia naliczone przed wdrożeniem kalkulatora (zapisy v1–v3) zostają w dotychczasowej kwocie; do rozliczenia rocznego ich podatek jest wyliczany kalkulatorem', 'SIMPLIFIED', PIT_COSTS, 'Historia księgowa nie jest zmieniana; w miesiącach przed `payrollFrom` wypłacone netto bywa niższe niż wynik kalkulatora (stary szacunek 73% brutto).', '2026-01-01', null),

  // ---------- v0.4: PIT roczny, straty, zaokrąglenia, zmiana formy ----------
  r('PIT-ANNUAL-DEADLINE', 'PIT', 'Zeznania roczne 15 lutego – 30 kwietnia; podatek do zapłaty do 30 kwietnia; nadpłata zwracana w 45 dni od złożenia zeznania (elektronicznie)', 'VERIFIED', PIT_REFUND, 'Symulator składa zeznanie automatycznie (jak zaakceptowany Twój e-PIT) 30 kwietnia: niedopłata płatna 30.04, zwrot — należność z terminem 14 czerwca (45 dni od 1 maja). Numer rachunku do zwrotu założony jako zgłoszony.', '2026-01-01', null),
  r('PIT-ANNUAL-SOURCES', 'PIT', 'Rozliczenie roczne: dochody ze stosunku pracy i działalności opodatkowanej skalą łączą się w jednym zeznaniu (PIT-36), a działalność na podatku liniowym (PIT-36L) i ryczałcie (PIT-28) rozlicza się osobno', 'VERIFIED', BG_SOURCES, 'Kwota zmniejszająca 3 600 zł jest stosowana raz w zeznaniu ze skalą. Zaliczki pracodawcy i przedsiębiorcy są zaliczane na poczet podatku rocznego.', '2026-01-01', null),
  r('PIT-ROUNDING', 'PIT', 'Podstawa opodatkowania i podatek (zeznanie i zaliczki działalności) zaokrąglane do pełnych złotych (50 gr i więcej w górę); składki ZUS i zdrowotne — do grosza', 'SIMPLIFIED', ORD63, 'Zasada z art. 63 § 1 Ordynacji podatkowej według dokumentów MF (brak odczytu tekstu ujednoliconego; pierwotne brzmienie ustawy z 1997 r. zaokrąglało podatek do dziesiątek groszy). Wyjątek § 1a dotyczy ryczałtu od dochodów kapitałowych, nie ryczałtu ewidencjonowanego. Składki ZUS do grosza — potwierdzone tabelami ZUS.', '2026-01-01', null),
  r('PIT-LOSS-5Y', 'PIT', 'Strata z działalności: odliczana od dochodu (skala, liniowy) lub przychodu (ryczałt) z tego samego źródła w 5 kolejnych latach, nie więcej niż 50% straty rocznie', 'VERIFIED', PIT_LOSS, 'Strata powstaje, gdy koszty przekraczają przychody ze źródła (ryczałt kosztów nie ma, więc straty nie generuje). Odliczenie nie może przekroczyć dochodu (przychodu) roku. W symulatorze: odliczenie przed składkami społecznymi; jednorazowe odliczenie do 5 mln zł — DEFERRED (nieistotne dla małych kwot).', '2026-01-01', null),
  r('PIT-LOSS-ONETIME', 'PIT', 'Jednorazowe odliczenie straty do 5 000 000 zł w jednym z 5 lat', 'DEFERRED', PIT_LOSS, 'Gracz zawsze stosuje zasadę 50% rocznie.', '2026-01-01', null),
  r('PIT-RELIEFS', 'PIT', 'Ulgi i odliczenia inne niż zaimplementowane (IP Box, B+R, prorodzinna, internetowa, ulga 4+, ulga na powrót), rozliczenie wspólne, ryczałt przy wielu stawkach', 'DEFERRED', PIT_LOSS, 'Poza zakresem.', '2026-01-01', null),
  r('PIT-FORM-CHANGE', 'PIT', 'Wybór/zmiana formy opodatkowania: skala jest domyślna; liniowy i ryczałt zgłasza się do 20. dnia miesiąca po pierwszym przychodzie w roku; forma obowiązuje cały rok podatkowy; ryczałt tylko przy przychodach z poprzedniego roku do 2 000 000 euro (8 517 200 zł)', 'VERIFIED', BG_FORM, 'Symulator: zmianę deklaruje się najpóźniej do 31 grudnia poprzedniego roku (skutek od 1 stycznia) — węższe okno niż w prawie; zmiana wsteczna za zgodą naczelnika — DEFERRED. Zmiana nie niszczy historii rozliczeń.', '2026-01-01', null),

  // ---------- v0.4: zdrowotna roczna, ZUS, zawieszenie ----------
  r('HEALTH-ANNUAL-2026', 'ZDROWOTNA', 'Roczne rozliczenie składki zdrowotnej: skala/liniowy — % rocznego dochodu, nie mniej niż 12 × 432,54 zł (podstawa roczna min. 57 672 zł); ryczałt — liczba miesięcy × kwota z progu rocznego przychodu; dopłata do 20 maja; nadpłata tylko na wniosek do końca maja, zwrot do 3 miesięcy po terminie PIT', 'VERIFIED', BG_HEALTH, 'ROZSTRZYGNIĘTE (v0.3): minimalna podstawa roczna to 57 672 zł (12 × 4 806 zł; zgodnie z biznes.gov.pl/00286 i obliczeniem 0,09 × 12 × 4 806 = 5 190,48 zł); wartość 62 285,76 zł na stronie 001052 jest błędem (5 190,48 × 12). Rok niepełny: minimum = miesiące działalności × 4 806 zł oraz progi ryczałtu bez proporcji — SIMPLIFIED (strony nie opisują). Podstawa dochodowa: przychód − koszty − zapłacone składki społeczne (bez strat z lat ubiegłych).', '2026-01-01', '2026-12-31'),
  r('HEALTH-ANNUAL-REFUND', 'ZDROWOTNA', 'Nadpłata składki zdrowotnej wymaga wniosku (do końca maja); bez wniosku nie jest księgowana jako gotówka', 'VERIFIED', BG_HEALTH, 'Po terminie bez wniosku nadpłatę zaliczać na przyszłe składki — DEFERRED (nie zweryfikowano); symulator oznacza roszczenie jako „po terminie”.', '2026-01-01', null),
  r('HEALTH-RYCZALT-BASIS', 'ZDROWOTNA', 'Kwoty składki ryczałtowców (498,35 / 830,58 / 1 495,04 zł) to 9% z 60% / 100% / 180% przeciętnego wynagrodzenia w sektorze przedsiębiorstw za IV kwartał 2025 (9 228,64 zł)', 'VERIFIED', BG_HEALTH, 'ROZSTRZYGNIĘTE (v0.3): rozbieżność „podstawa 5 537,18 zł vs prognoza 9 420 zł” wynika z innego wynagrodzenia referencyjnego — kwoty zgadzają się z 9% × (60/100/180)% × 9 228,64 zł (498,35; 830,58; 1 495,04). Używamy kwot.', '2026-02-01', '2027-01-31'),
  r('PIT-LINEAR-HEALTH-LIMIT-2026', 'PIT', 'Podatek liniowy: odliczenie składki zdrowotnej do 14 100 zł rocznie (2026)', 'VERIFIED', PIT_HEALTH, 'ROZSTRZYGNIĘTE (v0.3): tabela na podatki.gov.pl (akt. 24.06.2026) podaje 2026 = 14 100 zł, 2025 = 12 900 zł; strona biznes.gov.pl/00230 błędnie opisuje 14 100 zł jako kwotę „2025”.'),
  r('ZUS-MALY-PLUS', 'ZUS', 'Mały ZUS Plus: przychód z działalności w poprzednim roku ≤ 120 000 zł (proporcjonalnie do dni działalności), ≥ 60 dni działalności w poprzednim roku, nie w pierwszym roku działalności, do 36 z ostatnich 60 miesięcy; podstawa = dochód z poprzedniego roku / liczba dni × 30, w granicach 1 441,80–5 652 zł (ryczałt: dochód = 50% przychodu); składka zdrowotna bez zmian', 'VERIFIED', BG_MALY, 'SIMPLIFIED: gracz deklaruje korzystanie (nie automatycznie); ulga jest alternatywą dla ulgi na start i składek preferencyjnych (dostępna po ich zakończeniu); FP i FS naliczane od podstawy ≥ minimalnego wynagrodzenia — reguła niepotwierdzona na stronach urzędowych (zus.pl potwierdza brak FP/FS przy podstawie 30% minimalnego); przegląd uprawnień co roku 1 stycznia; wyłączenia grup zawodowych — DEFERRED.', '2026-01-01', null),
  r('ZUS-VACATION', 'ZUS', 'Wakacje składkowe', 'DEFERRED', BG_CLOSE, 'Nie weryfikowano.', '2026-01-01', null),
  r('SUSP-RULES', 'REJESTRACJA', 'Zawieszenie działalności (CEIDG): min. 30 dni (wyjątek: luty), od dowolnej daty; w okresie zawieszenia nie wolno prowadzić działalności ani osiągać bieżących przychodów, wolno przyjmować należności i regulować zobowiązania sprzed zawieszenia', 'VERIFIED', BG_SUSP, 'Zawieszenie możliwe tylko bez pracowników. SIMPLIFIED: pełne miesiące (od 1. do ostatniego dnia), bez zleceń w toku (konserwatywnie), brak dobrowolnych ubezpieczeń i NFZ.', '2026-01-01', null),
  r('SUSP-CONTRIBUTIONS', 'REJESTRACJA', 'W pełnych miesiącach zawieszenia nie płaci się składek społecznych ani zdrowotnej z działalności; nie wpłaca się zaliczek PIT; zawieszenie nie przerywa biegu ulgi na start (6 mies.) ani składek preferencyjnych (24 mies.)', 'VERIFIED', BG_SUSP, 'Zawieszenie w trakcie miesiąca (składki proporcjonalnie, zdrowotna za cały miesiąc) — DEFERRED (symulator zawiesza tylko od 1. dnia miesiąca). Rozliczenie roczne PIT nadal obowiązuje.', '2026-01-01', null),
  r('REG-CLOSURE', 'REJESTRACJA', 'Zakończenie działalności: ostatnia zaliczka do 20. dnia następnego miesiąca; zeznanie roczne do 30 kwietnia', 'SIMPLIFIED', BG_CLOSE, 'Zakończenie tylko na koniec miesiąca, bez trwających zleceń; wyrejestrowanie ZUS/VAT-Z nie jest modelowane.', '2026-01-01', null),
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
  payroll: {
    emerytalnaBps: 976,
    rentowaBps: 150,
    chorobowaBps: 245,
    healthBps: 900,
    pensionCap: zl(282_600),
    costsMonthly: zl(250),
    reductionMonthly: zl(300),
    youthLimit: zl(85_528),
    youthAge: 26,
  },
  health: { minAnnualBase: zl(4_806) * 12, annualDueMonthDay: [5, 20] as const, refundClaimMonthDay: [5, 31] as const },
  malyPlus: { revenueLimit: zl(120_000), minDays: 60, maxMonthsOf60: 36 },
  /** Górny limit przychodów z poprzedniego roku dla ryczałtu: 2 000 000 euro = 8 517 200 zł (kurs NBP 4,2586). */
  ryczaltRevenueLimit: zl(8_517_200),
  refund: { daysAfterFiling: 45 },
  zusDueDay: 20,
} as const;

/** Reguły są zweryfikowane tylko dla 2026 r.; w kolejnych latach stosujemy te same wartości (oznaczone w UI). */
export function carriedForward(year: number): boolean {
  return year !== RULES_2026.year;
}
