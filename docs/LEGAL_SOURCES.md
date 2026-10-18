# LEGAL_SOURCES — źródła prawne i status reguł (v0.3)

> **To jest symulacja gospodarcza, nie porada prawna ani podatkowa.** Reguły poniżej odwzorowują zasady polskiego systemu (stan na 2026 r.) w zakresie potrzebnym do prowadzenia jednej JDG usługowej. Każda reguła ma status: **VERIFIED** (potwierdzona na stronie urzędowej), **SIMPLIFIED** (uproszczona w symulacji — ograniczenia w kolumnie „Ograniczenia”), **DEFERRED** (niezaimplementowana, bo niezweryfikowana lub poza zakresem; UI tego nie ukrywa).
>
> Źródłem prawdy w kodzie jest `src/engine/legal.ts` (rejestr `LEGAL_RULES` + wartości `RULES_2026`); **tabela poniżej jest z niego wygenerowana**. Zmiana reguły = zmiana rejestru, wartości, testu i tego dokumentu (w jednym commicie). Reguł z pozycji „DEFERRED” nie wolno „po cichu” implementować bez weryfikacji źródła.

## Zasady stosowania

1. **Nie zgadujemy.** Wartość bez źródła nie wchodzi do silnika jako fakt. Jeśli nie dało się zweryfikować — status DEFERRED albo jawnie SIMPLIFIED z opisem uproszczenia.
2. **Wersjonowanie datami.** Każda reguła ma `validFrom`/`validTo`. Zweryfikowano **wyłącznie 2026 r.**; dla lat późniejszych silnik stosuje te same wartości i oznacza rozliczenia flagą `carriedForward` (UI pokazuje ostrzeżenie). Po weryfikacji kolejnego roku dodaje się nowy zestaw wartości zamiast nadpisywania.
3. **Obliczenia w groszach**, każdy składnik składek zaokrąglany do grosza (jak w deklaracji ZUS); podatek bez zaokrąglenia do złotych (`PIT-ROUNDING` — DEFERRED).
4. **Ślad obliczeń.** Każde miesięczne rozliczenie (`taxPeriods`) zapisuje identyfikatory reguł użytych w obliczeniu (widoczne w UI „Podatki i ZUS”).

## Metoda weryfikacji

Strony urzędowe pobrano 2026-10-18 (narzędzia WebFetch/WebSearch). Użyte serwisy: **podatki.gov.pl** (Ministerstwo Finansów), **biznes.gov.pl** (portal Ministerstwa Rozwoju i Technologii), **zus.pl**. Daty publikacji/aktualizacji stron: „Stawki i limity PIT” (publ. i akt. 15.12.2025), „Opodatkowanie podatkiem liniowym” (akt. 24.06.2026), „Opodatkowanie ryczałtem” (akt. 16.02.2026), „Rozpoczęcie działalności gospodarczej” (akt. 26.05.2026), „Odliczenie składek zdrowotnych” (akt. 24.06.2026), „Zwolnienie podmiotowe od VAT” (akt. 13.10.2026), „VAT — informacje podstawowe” (akt. 15.12.2025). Portal biznes.gov.pl: strony 00274 (składki ZUS), 00285 (ulga na start), 00286 (składki preferencyjne), 00288 (zbieg tytułów), 00284 (Mały ZUS Plus), 001052 (składka zdrowotna), 00258 (zawieszenie i likwidacja).

## Rejestr reguł

### Podatek dochodowy (PIT)

| ID | Zakres i treść reguły | Obowiązuje | Status | Źródło (urzędowe) | Zweryfikowano | Ograniczenia i wyjątki |
|---|---|---|---|---|---|---|
| `PIT-SCALE-2026` | Skala podatkowa: 12% do 120 000 zł (minus 3 600 zł), 32% nadwyżki (10 800 zł + 32% ponad 120 000 zł) | 2026-01-01 → 2026-12-31 | **VERIFIED** | [link](https://podatki.gov.pl/podatki-firmowe/pit/stawki-i-limity) | 2026-10-18 | Strona podaje skalę „od 2022 r.”; limit 2026 — z opisu strony zaktualizowanej 15.12.2025. |
| `PIT-LINEAR-2026` | Podatek liniowy 19% dochodów z pozarolniczej działalności | 2026-01-01 → 2026-12-31 | **VERIFIED** | [link](https://podatki.gov.pl/podatki-firmowe/pit/stawki-i-limity) | 2026-10-18 | Stawka 19%. |
| `PIT-RYCZALT-RATES-2026` | Stawki ryczałtu: 12% (niektóre usługi informatyczne), 8,5% (m.in. edukacja i pozostałe usługi), 15% (m.in. usługi reklamowe) | 2026-01-01 → 2026-12-31 | **SIMPLIFIED** | [link](https://podatki.gov.pl/podatki-firmowe/pit/stawki-i-limity) | 2026-10-18 | Stawkę ustala się wg klasyfikacji PKWiU konkretnej usługi — symulator przypisuje jedną stawkę do całego profilu. Niektóre usługi IT mają inną stawkę. |
| `PIT-RYCZALT-DEDUCT-2026` | Ryczałt: składki społeczne odliczane od przychodu; 50% zapłaconych składek zdrowotnych od przychodu; podstawa = przychód bez kosztów | 2026-01-01 → 2026-12-31 | **VERIFIED** | [link](https://www.podatki.gov.pl/podatki-firmowe/pit/informacje-podstawowe/co-jest-opodatkowane/opodatkowanie-ryczaltem-od-przychodow-ewidencjonowanych) | 2026-10-18 | Odliczane są tylko składki zapłacone w roku podatkowym; nadwyżka składek społecznych ponad przychód przepada. |
| `PIT-LINEAR-HEALTH-LIMIT-2026` | Podatek liniowy: odliczenie składki zdrowotnej do 14 100 zł rocznie | 2026-01-01 → 2026-12-31 | **VERIFIED** | [link](https://www.podatki.gov.pl/ulgi-i-odliczenia/odliczenie-skladek-na-ubezpieczenie-zdrowotne-pit) | 2026-10-18 | Limit 2026 r. (2025: 12 900 zł). |
| `PIT-SKALA-NO-HEALTH-DEDUCT` | Skala podatkowa: brak odliczenia składki zdrowotnej | 2026-01-01 → 2026-12-31 | **VERIFIED** | [link](https://www.podatki.gov.pl/ulgi-i-odliczenia/odliczenie-skladek-na-ubezpieczenie-zdrowotne-pit) | 2026-10-18 | Składki społeczne zapłacone odliczane są od dochodu (biznes.gov.pl/00230). |
| `PIT-ADVANCE-DEADLINE` | Zaliczki miesięczne do 20. dnia następnego miesiąca (za grudzień do 20 stycznia) | 2026-01-01 → bezterminowo* | **VERIFIED** | [link](https://podatki.gov.pl/podatki-firmowe/pit/informacje-podstawowe/co-jest-opodatkowane/opodatkowanie-podatkiem-liniowym) | 2026-10-18 | Opcja kwartalna i zaliczki uproszczone — niezaimplementowane (DEFERRED). |
| `PIT-ADVANCE-MIN-1000` | Zaliczki nie wpłaca się, jeśli jej kwota nie przekracza 1 000 zł | 2026-01-01 → bezterminowo* | **VERIFIED** | [link](https://podatki.gov.pl/dzialalnosc-gospodarcza/forma-opodatkowania) | 2026-10-18 | Niewpłacona kwota zwiększa kolejną zaliczkę (metoda narastająca). |
| `PIT-ANNUAL-DEADLINE` | Zeznanie roczne (PIT-36/36L/28) 15 lutego – 30 kwietnia; podatek wynikający z zeznania do 30 kwietnia | 2026-01-01 → bezterminowo* | **VERIFIED** | [link](https://www.podatki.gov.pl/podatki-firmowe/pit/informacje-podstawowe/co-jest-opodatkowane/opodatkowanie-ryczaltem-od-przychodow-ewidencjonowanych) | 2026-10-18 | Symulator rozlicza saldo roczne jako zobowiązanie z terminem 30 kwietnia; nie generuje zeznania. |
| `PIT-FORM-CHOICE` | Skala jest formą podstawową; liniowy i ryczałt wymagają zgłoszenia do 20. dnia miesiąca po pierwszym przychodzie | 2026-01-01 → bezterminowo* | **SIMPLIFIED** | [link](https://podatki.gov.pl/dzialalnosc-gospodarcza/forma-opodatkowania) | 2026-10-18 | Symulator: wybór formy przy rejestracji; zmiana formy w trakcie działalności niedostępna. |
| `PIT-EMPLOYER-RESTRICTION` | Usługi dla obecnego/byłego pracodawcy o charakterze pracy etatowej pozbawiają prawa do liniowego, ryczałtu i ulg ZUS | 2026-01-01 → bezterminowo* | **VERIFIED** | [link](https://podatki.gov.pl/podatki-firmowe/pit/informacje-podstawowe/co-jest-opodatkowane/opodatkowanie-podatkiem-liniowym) | 2026-10-18 | Symulator blokuje zlecenia od pracodawców gracza zamiast modelować utratę prawa. |
| `PIT-SKALA-WITH-EMPLOYMENT` | Skala przy równoległym etacie: łączne rozliczenie dochodów | 2026-01-01 → 2026-12-31 | **SIMPLIFIED** | [link](https://podatki.gov.pl/podatki-firmowe/pit/stawki-i-limity) | 2026-10-18 | Dochody z etatu nie wchodzą do progu 120 000 zł; gdy gracz miał etat w roku, kwota zmniejszająca 3 600 zł NIE jest stosowana do dochodu z JDG (zakłada się, że wykorzystał ją pracodawca). Rozliczenie łączne — DEFERRED. |
| `PIT-REVENUE-DATE` | Moment powstania przychodu/kosztu = data wystawienia dokumentu (równa dacie wykonania usługi) | 2026-01-01 → bezterminowo* | **SIMPLIFIED** | [link](https://www.podatki.gov.pl/podatki-firmowe/pit/informacje-podstawowe/co-jest-opodatkowane/opodatkowanie-ryczaltem-od-przychodow-ewidencjonowanych) | 2026-10-18 | Metoda kasowa i rozbieżne daty sprzedaży — niezaimplementowane. |
| `PIT-ROUNDING` | Zaokrąglanie podatku do pełnych złotych | 2026-01-01 → bezterminowo* | **DEFERRED** | [link](https://podatki.gov.pl/podatki-firmowe/pit/stawki-i-limity) | 2026-10-18 | Obliczenia w groszach bez zaokrąglenia do złotych (nie zweryfikowano zasad zaokrąglania). |
| `PIT-LOSSES-RELIEFS` | Straty z lat ubiegłych, ulgi (np. IP Box, B+R, prorodzinna), wspólne rozliczenie | 2026-01-01 → bezterminowo* | **DEFERRED** | [link](https://podatki.gov.pl/podatki-firmowe/pit/stawki-i-limity) | 2026-10-18 | Poza zakresem v0.3. |

### Składki społeczne (ZUS)

| ID | Zakres i treść reguły | Obowiązuje | Status | Źródło (urzędowe) | Zweryfikowano | Ograniczenia i wyjątki |
|---|---|---|---|---|---|---|
| `ZUS-BASE-STANDARD-2026` | Podstawa składek społecznych: 60% prognozowanego przeciętnego wynagrodzenia = 5 652 zł | 2026-01-01 → 2026-12-31 | **VERIFIED** | [link](https://www.biznes.gov.pl/pl/portal/00286) | 2026-10-18 | Prognozowane przeciętne wynagrodzenie 2026: 9 420 zł (zus.pl, wg wyników wyszukiwania; kwota 5 652 zł potwierdzona na biznes.gov.pl). |
| `ZUS-RATES-2026` | Stopy: emerytalna 19,52%, rentowa 8%, chorobowa 2,45% (dobrowolna), wypadkowa 1,67% (do 9 ubezpieczonych), FP+FS 2,45% | 2026-01-01 → 2026-12-31 | **VERIFIED** | [link](https://www.biznes.gov.pl/pl/portal/00274) | 2026-10-18 | Każdy składnik zaokrąglany do grosza. Stawka wypadkowa zależy od branży — przyjęto 1,67%. |
| `ZUS-PREF-BASE-2026` | Preferencyjna podstawa: 30% minimalnego wynagrodzenia (4 806 zł) = 1 441,80 zł; łącznie 456,18 zł (z chorobową) | 2026-01-01 → 2026-12-31 | **VERIFIED** | [link](https://www.biznes.gov.pl/pl/portal/00286) | 2026-10-18 | FP i FS nie są płacone, gdy działalność jest jedynym tytułem do ubezpieczeń. |
| `ZUS-PREF-ELIGIBILITY` | Warunki: brak działalności w ostatnich 60 miesiącach; nie dla byłego pracodawcy; trwa 24 pełne miesiące | 2026-01-01 → bezterminowo* | **VERIFIED** | [link](https://www.biznes.gov.pl/pl/portal/00286) | 2026-10-18 | Zawieszenie nie przerywa biegu okresu. Symulator zakłada brak wcześniejszej działalności tylko, gdy w grze nie było JDG w ciągu 60 miesięcy. |
| `ZUS-ULGA-START` | Ulga na start: do 6 miesięcy bez składek społecznych, składka zdrowotna płatna | 2026-01-01 → bezterminowo* | **VERIFIED** | [link](https://www.biznes.gov.pl/pl/portal/00285) | 2026-10-18 | Miesiąc rozpoczęcia liczy się, jeśli działalność zaczyna się 1. dnia miesiąca (symulator: start zawsze 1. dnia). Po uldze — 24 miesiące składek preferencyjnych. |
| `ZUS-PAYMENT-DEADLINE` | Składki płatne do 20. dnia następnego miesiąca (płatnicy nieposiadający osobowości prawnej) | 2026-01-01 → bezterminowo* | **VERIFIED** | [link](https://www.biznes.gov.pl/pl/portal/00274) | 2026-10-18 | Dotyczy przedsiębiorcy będącego osobą fizyczną. |
| `ZUS-ZBIEG-ETAT` | Zbieg z etatem: wynagrodzenie z etatu ≥ minimalne (4 806 zł w 2026 r.) = brak składek społecznych z JDG; niższe = składki z JDG | 2026-01-01 → 2026-12-31 | **VERIFIED** | [link](https://www.biznes.gov.pl/pl/portal/00288) | 2026-10-18 | Składka zdrowotna płatna z obu tytułów. Wyjątek zdrowotny dla ryczałtu przy niskim przychodzie — DEFERRED. Dobrowolne ubezpieczenia przy zbiegu — DEFERRED. |
| `ZUS-MALY-PLUS` | Mały ZUS Plus (przychód ≤ 120 000 zł w poprzednim roku, limit 36 z 60 miesięcy) | 2026-01-01 → bezterminowo* | **DEFERRED** | [link](https://www.biznes.gov.pl/pl/portal/00284) | 2026-10-18 | Zweryfikowane warunki, ale niezaimplementowane (rejestr rozwoju). |
| `ZUS-VACATION-SUSPENSION` | Wakacje składkowe, składki w okresie zawieszenia działalności | 2026-01-01 → bezterminowo* | **DEFERRED** | [link](https://biznes.gov.pl/pl/portal/00258) | 2026-10-18 | Niezweryfikowane w tym etapie. |

### Składka zdrowotna

| ID | Zakres i treść reguły | Obowiązuje | Status | Źródło (urzędowe) | Zweryfikowano | Ograniczenia i wyjątki |
|---|---|---|---|---|---|---|
| `HEALTH-MIN-2026` | Minimalna składka zdrowotna: 432,54 zł miesięcznie (9% × 4 806 zł) dla skali i liniowego | 2026-01-01 → 2026-12-31 | **VERIFIED** | [link](https://www.biznes.gov.pl/pl/portal/001052) | 2026-10-18 | ZUS (wg wyszukiwania) podaje okres 1.02.2026–31.01.2027 dla kwot ryczałtowych; biznes.gov.pl — od 1.01.2026 dla minimum. |
| `HEALTH-RATES` | Skala: 9% dochodu; liniowy: 4,9% dochodu; podstawa — dochód miesiąca poprzedniego | 2026-01-01 → bezterminowo* | **VERIFIED** | [link](https://www.biznes.gov.pl/pl/portal/001052) | 2026-10-18 | Symulator liczy dochód jako przychód − koszty − składki społeczne za miesiąc poprzedni (bez narastającej korekty strat i rozliczenia rocznego). |
| `HEALTH-RYCZALT-2026` | Ryczałt: 498,35 zł (przychód narastająco do 60 tys. zł), 830,58 zł (60–300 tys.), 1 495,04 zł (powyżej 300 tys.) | 2026-02-01 → 2027-01-31 | **VERIFIED** | [link](https://www.biznes.gov.pl/pl/portal/001052) | 2026-10-18 | Przekroczenie progu w miesiącu: składka za ten miesiąc wg następnego progu. Kwoty ważne od 1.02.2026 wg ZUS; kwoty za styczeń 2026 niezweryfikowane — JDG startuje od 1.02.2026. |
| `HEALTH-ANNUAL-SETTLEMENT` | Roczne rozliczenie składki zdrowotnej (dopłata do 20 maja) | 2026-01-01 → bezterminowo* | **DEFERRED** | [link](https://www.biznes.gov.pl/pl/portal/001052) | 2026-10-18 | Poza zakresem v0.3. |

### VAT

| ID | Zakres i treść reguły | Obowiązuje | Status | Źródło (urzędowe) | Zweryfikowano | Ograniczenia i wyjątki |
|---|---|---|---|---|---|---|
| `VAT-LIMIT-2026` | Zwolnienie podmiotowe: limit sprzedaży 240 000 zł (od 1.01.2026) | 2026-01-01 → 2026-12-31 | **VERIFIED** | [link](https://www.podatki.gov.pl/podatki-firmowe/vat/poradniki-i-informatory/zwolnienie-podmiotowe-od-podatku-vat) | 2026-10-18 | Przejściowo zwolnienie przysługuje także przy sprzedaży 200–240 tys. zł w 2025 r. |
| `VAT-LIMIT-PRORATED` | Limit proporcjonalny do okresu działalności w roku | 2026-01-01 → 2026-12-31 | **SIMPLIFIED** | [link](https://www.podatki.gov.pl/podatki-firmowe/vat/poradniki-i-informatory/zwolnienie-podmiotowe-od-podatku-vat) | 2026-10-18 | Strona nie podaje metody — symulator liczy w pełnych miesiącach (start zawsze 1. dnia miesiąca). |
| `VAT-EXEMPTION-EXCLUSIONS` | Wyłączenia ze zwolnienia (art. 113 ust. 13; np. usługi prawnicze) | 2026-01-01 → bezterminowo* | **SIMPLIFIED** | [link](https://www.podatki.gov.pl/podatki-firmowe/vat/poradniki-i-informatory/zwolnienie-podmiotowe-od-podatku-vat) | 2026-10-18 | Pełny katalog niezweryfikowany; profile usługowe dobrano tak, by nie obejmowały znanych wyłączeń. Czynności niewliczane do limitu (art. 113 ust. 2) — DEFERRED. |
| `VAT-LIMIT-EXCEEDED` | Utrata zwolnienia od czynności, którą przekroczono limit | 2026-01-01 → bezterminowo* | **VERIFIED** | [link](https://www.podatki.gov.pl/podatki-firmowe/vat/poradniki-i-informatory/zwolnienie-podmiotowe-od-podatku-vat) | 2026-10-18 | Symulator: kwota umowna traktowana jako netto, VAT 23% doliczany do tej i kolejnych sprzedaży. |
| `VAT-RATE-23` | Stawka VAT 23% dla usług | 2026-01-01 → bezterminowo* | **SIMPLIFIED** | [link](https://www.podatki.gov.pl/podatki-firmowe/vat/informacje-podstawowe) | 2026-10-18 | Strona wymienia stawki 23%, 8%, 5% bez przypisania usług; symulator stosuje 23% do wszystkich usług profili. |
| `VAT-SETTLEMENT-DEADLINE` | Rozliczenie miesięczne i zapłata do 25. dnia następnego miesiąca (JPK_V7M) | 2026-01-01 → bezterminowo* | **VERIFIED** | [link](https://www.podatki.gov.pl/podatki-firmowe/vat/informacje-podstawowe) | 2026-10-18 | Rozliczenie kwartalne — DEFERRED. Obowiązek podatkowy = data wystawienia dokumentu (uproszczenie). |
| `VAT-INPUT-DEDUCTION` | Odliczenie VAT naliczonego tylko przez czynnego podatnika; podatnik zwolniony nie odlicza | 2026-01-01 → bezterminowo* | **SIMPLIFIED** | [link](https://www.podatki.gov.pl/podatki-firmowe/vat/informacje-podstawowe) | 2026-10-18 | Strona nie opisuje odliczenia przez podatnika zwolnionego — przyjęto brak odliczenia. Zwrot nadwyżki VAT naliczonego księgowany jako należność z terminem 25. dnia (w rzeczywistości zwykle przeniesienie/zwrot w terminach ustawowych). |
| `VAT-KSEF-ADVANCED` | KSeF, korekty, procedury szczególne, metoda kasowa | 2026-01-01 → bezterminowo* | **DEFERRED** | [link](https://www.podatki.gov.pl/podatki-firmowe/vat/informacje-podstawowe) | 2026-10-18 | Rekord sprzedaży w grze NIE jest fakturą zgodną z KSeF. |

### Rejestracja i zakończenie działalności

| ID | Zakres i treść reguły | Obowiązuje | Status | Źródło (urzędowe) | Zweryfikowano | Ograniczenia i wyjątki |
|---|---|---|---|---|---|---|
| `REG-PKD-2025` | Kody PKD 2025 (np. 62.10.B, 62.20.B) | 2025-01-01 → bezterminowo* | **SIMPLIFIED** | [link](https://www.biznes.gov.pl/pl/portal/00119) | 2026-10-18 | Kody 62.10.B i 62.20.B potwierdzone w wynikach z GUS/gov.pl; 85.59.A i 81.21.Z wynikają z kluczy powiązań GUS (nie sprawdzono pełnych nazw). |
| `REG-CEIDG` | Rejestracja w CEIDG (biznes.gov.pl), zgłoszenie do ZUS w 7 dni | 2026-01-01 → bezterminowo* | **SIMPLIFIED** | [link](https://www.biznes.gov.pl/pl/portal/00285) | 2026-10-18 | Symulator nie modeluje formularzy ani urzędów; rejestracja jest natychmiastowa, a start działalności przypada 1. dnia miesiąca. |
| `REG-SUSPENSION-CLOSURE` | Zawieszenie (min. 30 dni) i zakończenie działalności | 2026-01-01 → bezterminowo* | **DEFERRED** | [link](https://biznes.gov.pl/pl/portal/00258) | 2026-10-18 | Zawieszenie niezaimplementowane (nie zweryfikowano skutków ZUS). Zakończenie: tylko na koniec miesiąca, po zakończeniu zleceń; ostatnia zaliczka do 20. dnia następnego miesiąca, zeznanie do 30 kwietnia. |

\* „bezterminowo” = dopóki nie zmieni się przepis; wartości liczbowe są zweryfikowane tylko dla 2026 r. (patrz zasada 2).

## Rozbieżności i luki znalezione podczas weryfikacji

- **Minimalna roczna podstawa składki zdrowotnej (skala/liniowy):** biznes.gov.pl podaje w jednym miejscu 57 672 zł (12 × 4 806 zł), w innym 62 285,76 zł — niespójne. Silnik **nie** korzysta z podstawy rocznej (roczne rozliczenie zdrowotnej: DEFERRED); używa wyłącznie minimum miesięcznego 432,54 zł (9% × 4 806 zł), potwierdzonego w wielu źródłach.
- **Składka zdrowotna ryczałtowców — podstawa:** źródło ZUS wskazuje podstawę z przeciętnego wynagrodzenia w sektorze przedsiębiorstw (Q4 2025: 9 228,64 zł), a nie z prognozy 9 420 zł; kwoty 498,35 / 830,58 / 1 495,04 zł są spójne z tą podstawą (9% × 60% / 100% / 180%). Używamy kwot, nie przeliczeń.
- **Okres obowiązywania kwot ryczałtowych:** ZUS (wyniki wyszukiwania) — od 1.02.2026 do 31.01.2027; minimum dla skali/liniowego — od 1.01.2026. Dlatego JDG może wystartować najwcześniej **1.02.2026** (kwoty ryczałtowe za styczeń 2026 niezweryfikowane).
- **Limit odliczenia zdrowotnej (liniowy):** biznes.gov.pl (00230) podaje 14 100 zł jako kwotę „2025”, podczas gdy podatki.gov.pl — tabela: 2026 = 14 100 zł, 2025 = 12 900 zł. Przyjęto podatki.gov.pl (strona MF, z tabelą lat).
- **Proporcja limitu VAT w roku startu:** strona nie podaje, czy liczy się w dniach czy miesiącach — start tylko 1. dnia miesiąca eliminuje niejednoznaczność, ale metoda pozostaje oznaczona SIMPLIFIED.
- **Katalog wyłączeń ze zwolnienia z VAT (art. 113 ust. 13)** i katalog czynności niewliczanych do limitu (ust. 2): strony tylko odsyłają do ustawy — niezweryfikowane w pełni (znany przykład: usługi prawnicze).
- **Odliczenie VAT naliczonego przez podatnika zwolnionego:** strona VAT tego nie opisuje; przyjęto brak odliczenia (SIMPLIFIED).
- **Kody PKD 2025:** 62.10.B i 62.20.B potwierdzone w wynikach (GUS/gov.pl); 85.59.A (nauka języków obcych) i 81.21.Z wynikają z kluczy powiązań GUS, bez sprawdzenia pełnych nazw w klasyfikacji.
- **Stawki ryczałtu:** strony podają stawki według grup usług (PKWiU); symulator przypisuje jedną stawkę do profilu (SIMPLIFIED).
- **Nie weryfikowano:** wakacje składkowe, składki w okresie zawieszenia, zaokrąglanie podatku, termin zwrotu nadpłaty PIT (45 dni — wartość demonstracyjna), wyjątek od składki zdrowotnej przy zbiegu z etatem i niskim przychodzie ryczałtowym, dobrowolne ubezpieczenia przy zbiegu, kwartalne rozliczanie zaliczek i VAT, metoda kasowa.

## Zakres zbiegu etatu z JDG (v0.3)

Zweryfikowane (biznes.gov.pl/00288): przy wynagrodzeniu z etatu co najmniej minimalnym (4 806 zł brutto w 2026 r.) JDG nie rodzi obowiązku składek społecznych, a składka zdrowotna jest płacona z obu tytułów; przy niższym wynagrodzeniu (np. część etatu) składki społeczne z JDG są wymagane. Silnik ocenia to na koniec każdego miesiąca według brutto bieżącej umowy o pracę (dla zapisów v1 bez brutto — odwrotność szacunku netto 73%). Wyjątek zdrowotny (przychody ryczałtowe ≤ 50% minimalnego wynagrodzenia) — DEFERRED. W PIT: dochody z etatu nie są łączone z dochodem z JDG (`PIT-SKALA-WITH-EMPLOYMENT`).
