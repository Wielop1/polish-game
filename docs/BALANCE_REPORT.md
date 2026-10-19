# BALANCE_REPORT — v0.7: rynek, konkurencja i ekonomia modeli zatrudnienia

> Raport z symulatora balansu (`npm run balance`, ADR-061). Opisuje **metodę, badane strategie, wyniki, wykryte problemy, zmienione parametry i ich uzasadnienie, założenia niezweryfikowane oraz ograniczenia modelu**.
> Wszystkie parametry rynku są **kalibracyjne** (nie z danych GUS) — wyniki mówią o zachowaniu modelu, nie o rzeczywistym rynku remontowym w Olsztynie. Surowe dane: `docs/balance/` (JSON z podsumowaniem i każdym przebiegiem).

## 1. Metoda

**Symulator** (`tools/balance/`): ten sam silnik co gra (`commands.*`, `advanceDaysInPlace`); bot gra przez komendy gracza, bez drugiej implementacji silnika. Przebieg = jedna gra od 1.01.2026: bot rezygnuje z etatu, rejestruje JDG (ryczałt/skala — jak w testach: skala, VAT zwolniony, ulga na start), wpłaca kapitał (⅓ na rachunek firmowy, reszta rezerwa właściciela), kupuje sprzęt, ustawia marketing i pozycjonowanie i prowadzi firmę **3 lata**. Jedna rozgrywka = jeden seed (`bal-1 … bal-N`); losowości z (seed, zdarzenie) — przebieg jest powtarzalny (test). Parametry: `--years --runs --policies --capital --workers --quick --trace <seed> --dump-state`.

**Bot** (jednakowy dla wszystkich strategii; różni je tylko struktura firmy, marketing i pozycjonowanie):
- odpowiada na każde zapytanie tego samego dnia: wycenia dostępnym wykonawcą (zespół pracownika → właściciel → podwykonawca zależnie od strategii) albo odrzuca;
- cena = 88–98% budżetu klienta (budżet jest widoczny na karcie zapytania; wyżej, gdy firma jest obłożona, niżej, gdy stoi), z uwzględnieniem VAT (budżet jest brutto — po utracie zwolnienia z VAT cena netto jest odpowiednio niższa), nie mniej niż koszt planowany + 12%; zlecenia, które tego nie spełniają, odrzuca;
- nie obiecuje tego samego terminu dwóm klientom (oferty bez umowy nie rezerwują zasobów w silniku), nie wysyła ofert z terminem >10 dni po życzeniu klienta (z elastycznością), właściciel bierze najwyżej dwie własne prace naraz;
- podpisuje umowy, kupuje materiały, naprawia reklamacje, konserwuje sprzęt, dopłaca z rezerwy właściciela, gdy firmie brakuje gotówki;
- pracowników zatrudnia na stanowiska odpowiadające specjalizacjom firmy (umiejętności są przypisane do stanowiska: malarz ≠ gipsiarz), wybierając najwyżej wykwalifikowanego z kilku kandydatów.

**Strategie** (spec §9): `solo` (sam właściciel), `owner+1` (+1 pracownik), `team3` (3 pracowników od 20. dnia), `team5` (5 pracowników), `subs-only` (tylko podwykonawcy, właściciel nadzoruje), `mixed` (2 pracowników + podwykonawcy). Dodatkowo `grow` — **firma rosnąca**: zatrudnia kolejnych (do 5) dopiero, gdy obecni są obłożeni (≥ 75% dni w najbliższych 14) i firma ma bufor gotówki, marketing zwiększa po 4 miesiącach. Marketing: `basic` (reklamy lokalne + wizytówka, 550 zł/mies.) dla `solo` i `owner+1`; `active` (polecenia, współpraca z przedsiębiorcami, wyszukiwarka, reklamy lokalne, wizytówka, 2 550 zł/mies.) dla pozostałych — rozmiar budżetu rośnie z rozmiarem firmy; profil `active` pomija portale (porównywarki dają dużo zapytań, ale z największą konkurencją — por. §5).

**Metryki** (spec §9): liczba zapytań i kontraktów, konwersja (kontrakty/zapytania i kontrakty/wysłane oferty), udział zapytań odrzuconych przez bota, zapytania utracone z braku mocy i oferty przegrane z konkurencją, przychód netto, marża kontraktów (wynik ekonomiczny po materiałach, transporcie, podwykonawcach i płacach **przypisanych do kontraktów**), przychód na godzinę pracy (norma wykonanej pracy), wykorzystanie mocy własnej (godziny pracy / (właściciel + pracownicy × 2 000 godz. rocznie)), koszty stałe (bezczynność płac, ZUS właściciela, księgowość, marketing, rekrutacja, pojazd), płynność (minimalna gotówka firmy, p10), niewypłacalność (zaległe zobowiązania ≥ 30 dni albo majątek netto < 0), wzrost majątku netto właściciela rocznie (po kosztach życia, podatkach i składkach — porównywalny z utraconym etatem).

**Kapitał:** domyślnie 90 000 zł (realistyczny start gracza: ⅓ w firmie) — mierzy też płynność i niewypłacalność; drugi wariant 400 000 zł wyodrębnia samą **opłacalność** modelu od niedokapitalizowania.

## 2. Uwaga o wersjach bota i zakresie danych (ważne)

Bot był poprawiany w trakcie kalibracji (każda poprawka usuwała wadę bota, nie modelu — por. §4). **Tabele poniżej pochodzą z różnych wersji bota**, więc porównanie v0.6 ↔ v0.7 jest **orientacyjne**:

| zbiór | silnik | wersja bota | próba |
|---|---|---|---|
| v0.7, 90 000 zł (`docs/balance/v07-3y-90k.json`) | v0.7 | B: po poprawkach VAT, stanowisk pracowników, pojazdu i terminów; **przed** zmianą dolnej granicy ceny (płace pracowników i praca własna jako koszt krańcowy) i przed zniesieniem limitu własnych prac | 3 lata × 4 seedy |
| v0.7, 400 000 zł (`v07-3y-400k.json`) | v0.7 | B | 3 lata × 4 seedy |
| v0.6 (`v06-baseline-3y-90k.json`, `…-400k.json`) | v0.6 (commit `e4e04e4`) | C (końcowa) | 3 lata × 5 seedów |
| v0.7, 1 rok (`v07-1y-90k-final-bot.json`) | v0.7 | C (końcowa) | 1 rok × 1 seed (test dymny) |

**Nie wykonałem** zaplanowanej serii końcowej v0.7 (5 lat × 5–6 seedów, bot C) — przerwana na polecenie właściciela, by nie przedłużać prac; to jest największa luka tego raportu. Wnioski jakościowe (§6) opieram na zgodnych wynikach trzech serii (cal-2/3/4, zapisanych w historii prac) i próbie 1-rocznej bota C; liczby bezwzględne traktuj jako rząd wielkości. Do uruchomienia: `npm run balance -- --years 5 --runs 6` (§9).

## 3. Co zmieniono względem v0.6 (skrót modelu)

Szczegóły: `ECONOMY_ENGINE.md` §8e i ADR-055–061. Zapytania nie powstają już z jednej dziennej szansy niezależnej od firmy. Rynek miasta daje popyt (sezon, koniunktura, ceny), część klientów szuka wykonawcy, wybiera 2–3 firmy ważone **widocznością** (marketing, polecenia, reputacja, specjalizacja, pozycjonowanie, zajętość kolejki), a następnie **porównuje oferty** (cena względem budżetu, jakość, opinie, termin, dopasowanie marki) z 15 konkurentami, którzy sami reagują na rynek. Zatrudnienie nie tworzy klientów — zwiększa tylko to, ile z nich można obsłużyć.

## 4. Kalibracja: wykryte problemy i zmiany parametrów

Parametry w `marketConfig.ts` ustawiałem w kilku iteracjach i **tylko wtedy, gdy symulator wskazywał konkretny problem** (a nie dla poprawy wyglądu raportu). Każdy punkt: objaw → przyczyna → zmiana.

| # | Objaw w symulacji | Przyczyna | Zmiana (stara → nowa) i uzasadnienie |
|---|---|---|---|
| 1 | Konkurenci: obłożenie 6–60%, większość z ujemnym wynikiem (łącznie ~44 wykonawców przy popycie na ~25) | Zbyt duża podaż: początkowi konkurenci rośli przez zatrudnienia już w pierwszych miesiącach; popyt za mały | popyt `projectsPer100kPerMonth` 240 → 300; koszt wykonawcy 7 800 → 7 000 zł; zatrudnienie konkurenta wymaga 3 (nie 2) miesięcy ≥ 95% obłożenia |
| 2 | Odwrotny skutek: wiosną obłożenie ~98%, gotówka konkurentów rośnie 4× w rok (wynik ≈ 15 tys. zł/mies. na firmę), potem nadmiar mocy | Zbyt niskie koszty konkurentów i zbyt „miękkie” ograniczenie przyjmowania zleceń (kolejka do 40 dni roboczych); dobowa moc liczona 8 godz. zamiast efektywnych 7 | koszt wykonawcy 7 000 → **8 000 zł** (koszt pracodawcy + narzuty), koszty stałe firm 1,2/1,8/3,0 → 1,5/2,2/3,8 tys. zł; `maxBacklogDays` 40 → **15**, widoczność maleje od 5 dni kolejki (było 20), czas oczekiwania widoczny dla klienta od 3 dni (było 10); moc dobowa 8 → **7 godz.**; popyt 300 → **280** (szczytowe obłożenie ≈ 98% przy kosztach zbyt niskich świadczyło o zbyt dużym popycie względem podaży) |
| 3 | Zwycięzca bierze wszystko: duże firmy premium z wysoką reputacją miały 20+ zleceń miesięcznie, małe niskie ceny — 0–2 | Widoczność rosła zbyt słabo z wielkością i zbyt mocno z reputacją | widoczność wielkości: mała 10 → 11 tys., średnia 15 → 18 tys.; początkowy skład 12 → **15 firm** (6 solo / 6 małych / 3 średnie), cel i maks. liczby firm 12/18 → 15/20 |
| 4 | Nadmiar firm powodował wejścia i wyjścia „na przemian” | Cel liczby firm zależał tylko od koniunktury | cel zależy też od średniego obłożenia (publiczny sygnał opłacalności): ≥ 95% → +4, ≥ 85% → +2, ≤ 50% → −2 |
| 5 | Popyt nie reagował na ceny usług (wymóg spec. §3) | brak | elastyczność popytu 0,5: +10% poziomu cen firm → −5% szukających wykonawcy (`DEMAND.priceElasticity`) |

Efekt końcowy: średnie obłożenie konkurentów w całym przebiegu ≈ **71–72%**, wejścia/wyjścia ok. 5/6 firm w 3 latach, wynik firm konkurencyjnych dodatni, ale umiarkowany. **Nie zmieniałem** kosztów zatrudnienia pracowników gracza, płac ani składek (przepisy 2026) ani cen referencyjnych usług z `renovationCatalog.ts`.

Błędy, które ujawnił symulator, ale **nie są kalibracją** (poprawione w kodzie): (a) komunikat przestoju kontraktu mógł przekroczyć limit pola w zapisie (zapis przestawał się wczytywać) — limit 120 → 400 znaków (ADR-060); (b) bot początkowo wysyłał nieopłacalne oferty po utracie zwolnienia z VAT, obiecywał ten sam termin kilku klientom i zatrudniał pracowników bez potrzebnej umiejętności — to wady bota, nie modelu (opis w §1); (c) wyniki na skrajnych seedach pokazały, że przy braku gotówki firma nie kupuje materiałów, kontrakty stoją, a po 45 dniach opóźnienia klienci je rozwiązują — to zamierzony mechanizm płynności, który tłumaczy 100% niewypłacalności dużych firm przy małym kapitale.

## 5. Wyniki

### 5.1 Model v0.6 (stary popyt), bot C

*3 lat × 5 seedów  kapitał 90 000 zł*

| wskaźnik | solo | owner+1 | team3 | team5 | subs-only | grow | mixed |
|---|---:|---:|---:|---:|---:|---:|---:|
| zapytania / rok | 57 | 57 | 61 | 60 | 68 | 74 | 65 |
| kontrakty / rok | 32 | 39 | 12 | 10 | 26 | 32 | 22 |
| konwersja zapytanie → kontrakt | 56% | 60% | 20% | 17% | 38% | 46% | 33% |
| wygrane z wysłanych ofert | 83% | 74% | 25% | 21% | 62% | 67% | 36% |
| odrzucone przez bota | 33% | 19% | 20% | 20% | 39% | 31% | 10% |
| przegrane z konkurencją / rok | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| udział w zleceniach rynku | — | — | — | — | — | — | — |
| przychód netto / rok (zł) | 103 168 | 114 594 | 46 522 | 34 368 | 65 529 | 128 878 | 68 561 |
| marża kontraktów | 74% | 60% | 35% | 34% | 32% | 52% | 37% |
| przychód / godz. pracy (zł) | 91 | 90 | 127 | 124 | 119 | 120 | 117 |
| wykorzystanie mocy własnej | 56% | 28% | 4% | 2% | 0% | 29% | 10% |
| płace przypisane do kontraktów | — | 17% | 4% | 2% | — | 15% | 8% |
| koszty stałe / mies. (zł) | 2 069 | 7 535 | 22 910 | 35 571 | 2 634 | 7 694 | 15 997 |
| zysk operacyjny / rok (zł) | 51 801 | -21 681 | -260 700 | -415 400 | -10 128 | -22 571 | -167 657 |
| min. gotówka firmy, p10 (zł) | 9 324 | 0 | 0 | 0 | 1 | 3 | 0 |
| niewypłacalność | 0% | 100% | 100% | 100% | 100% | 100% | 100% |
| wzrost majątku / rok, mediana (zł) | 9 656 | -58 713 | -299 357 | -454 747 | -64 342 | -62 550 | -207 219 |
|    p10 … p90 (zł) | 5 612 … 10 030 | -124 747 … -31 498 | -318 754 … -281 654 | -522 114 … -422 947 | -68 703 … -55 965 | -107 019 … -28 181 | -222 198 … -189 321 |

*3 lat × 5 seedów  kapitał 400 000 zł*

| wskaźnik | solo | owner+1 | team3 | team5 | subs-only | grow | mixed |
|---|---:|---:|---:|---:|---:|---:|---:|
| zapytania / rok | 57 | 58 | 80 | 72 | 73 | 80 | 83 |
| kontrakty / rok | 32 | 41 | 36 | 22 | 35 | 45 | 59 |
| konwersja zapytanie → kontrakt | 56% | 73% | 47% | 32% | 49% | 58% | 69% |
| wygrane z wysłanych ofert | 83% | 89% | 60% | 41% | 82% | 83% | 81% |
| odrzucone przez bota | 33% | 18% | 22% | 21% | 41% | 30% | 15% |
| przegrane z konkurencją / rok | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| udział w zleceniach rynku | — | — | — | — | — | — | — |
| przychód netto / rok (zł) | 103 168 | 123 864 | 134 022 | 84 022 | 95 547 | 163 326 | 190 358 |
| marża kontraktów | 74% | 60% | 33% | 31% | 33% | 46% | 34% |
| przychód / godz. pracy (zł) | 91 | 90 | 117 | 119 | 116 | 120 | 107 |
| wykorzystanie mocy własnej | 56% | 36% | 15% | 6% | 0% | 33% | 29% |
| płace przypisane do kontraktów | — | 21% | 14% | 5% | — | 20% | 24% |
| koszty stałe / mies. (zł) | 2 069 | 7 302 | 21 718 | 35 251 | 2 632 | 10 315 | 14 440 |
| zysk operacyjny / rok (zł) | 51 801 | -8 121 | -215 349 | -399 771 | -469 | -38 195 | -112 186 |
| min. gotówka firmy, p10 (zł) | 112 654 | 27 393 | 0 | 0 | 40 938 | 3 749 | 0 |
| niewypłacalność | 0% | 0% | 100% | 100% | 0% | 0% | 60% |
| wzrost majątku / rok, mediana (zł) | 9 656 | -44 917 | -255 461 | -440 185 | -59 895 | -78 702 | -155 383 |
|    p10 … p90 (zł) | 5 612 … 10 030 | -70 578 … -31 498 | -271 325 … -226 958 | -502 620 … -406 356 | -64 955 … -57 465 | -123 656 … -65 648 | -185 155 … -125 490 |

W v0.6 liczba zapytań (≈ 55–75 rocznie) nie zależała od firmy, więc **wykorzystanie mocy własnej pracowników wynosiło 2–29%**, a każda struktura poza samozatrudnieniem kończyła niewypłacalnością przy małym kapitale; przy dużym kapitale firmy z 3–5 pracownikami traciły 200–370 tys. zł rocznie.

### 5.2 Model v0.7, kapitał 90 000 zł (bot B, 3 lata)

*3 lat × 4 seedów  kapitał 90 000 zł*

| wskaźnik | solo | owner+1 | team3 | team5 | subs-only | grow | mixed |
|---|---:|---:|---:|---:|---:|---:|---:|
| zapytania / rok | 408 | 418 | 482 | 483 | 459 | 649 | 498 |
| kontrakty / rok | 28 | 71 | 34 | 35 | 49 | 52 | 64 |
| konwersja zapytanie → kontrakt | 7% | 19% | 7% | 7% | 10% | 7% | 13% |
| wygrane z wysłanych ofert | 72% | 69% | 19% | 19% | 25% | 50% | 31% |
| odrzucone przez bota | 90% | 73% | 67% | 61% | 62% | 85% | 58% |
| przegrane z konkurencją / rok | 8 | 14 | 57 | 62 | 57 | 20 | 54 |
| udział w zleceniach rynku | 1% | 3% | 4% | 5% | 4% | 3% | 6% |
| przychód netto / rok (zł) | 97 593 | 214 812 | 118 600 | 120 359 | 124 555 | 159 834 | 189 988 |
| marża kontraktów | 70% | 50% | 36% | 34% | 30% | 47% | 33% |
| przychód / godz. pracy (zł) | 97 | 101 | 121 | 116 | 124 | 115 | 101 |
| wykorzystanie mocy własnej | 48% | 54% | 12% | 9% | 0% | 36% | 30% |
| płace przypisane do kontraktów | — | 50% | 11% | 8% | — | 33% | 21% |
| koszty stałe / mies. (zł) | 2 154 | 6 249 | 23 574 | 35 957 | 4 026 | 9 364 | 16 920 |
| zysk operacyjny / rok (zł) | 43 004 | 35 328 | -227 673 | -345 183 | -10 949 | -41 656 | -117 607 |
| min. gotówka firmy, p10 (zł) | 9 852 | 6 050 | 0 | 0 | 0 | 0 | 0 |
| niewypłacalność | 0% | 0% | 100% | 100% | 100% | 100% | 100% |
| wzrost majątku / rok, mediana (zł) | 1 647 | -803 | -266 372 | -380 563 | -76 476 | -78 992 | -166 226 |
|    p10 … p90 (zł) | -6 105 … 2 019 | -16 012 … 6 918 | -307 074 … -243 707 | -515 705 … -377 798 | -80 388 … -70 151 | -110 719 … -21 265 | -214 867 … -142 170 |

### 5.3 Model v0.7, kapitał 400 000 zł (bot B, 3 lata) — sama opłacalność, bez niedokapitalizowania

*3 lat × 4 seedów  kapitał 400 000 zł*

| wskaźnik | solo | owner+1 | team3 | team5 | subs-only | grow | mixed |
|---|---:|---:|---:|---:|---:|---:|---:|
| zapytania / rok | 408 | 418 | 664 | 711 | 515 | 676 | 595 |
| kontrakty / rok | 28 | 71 | 131 | 175 | 72 | 114 | 150 |
| konwersja zapytanie → kontrakt | 7% | 19% | 19% | 22% | 14% | 16% | 24% |
| wygrane z wysłanych ofert | 72% | 69% | 62% | 58% | 52% | 64% | 64% |
| odrzucone przez bota | 90% | 73% | 69% | 61% | 74% | 74% | 63% |
| przegrane z konkurencją / rok | 8 | 14 | 33 | 39 | 35 | 26 | 42 |
| udział w zleceniach rynku | 1% | 3% | 7% | 9% | 4% | 6% | 7% |
| przychód netto / rok (zł) | 97 593 | 214 812 | 446 702 | 537 589 | 183 863 | 394 113 | 416 499 |
| marża kontraktów | 70% | 50% | 35% | 34% | 31% | 35% | 33% |
| przychód / godz. pracy (zł) | 97 | 101 | 109 | 102 | 116 | 120 | 97 |
| wykorzystanie mocy własnej | 48% | 54% | 53% | 42% | 0% | 49% | 73% |
| płace przypisane do kontraktów | — | 50% | 48% | 35% | — | 42% | 50% |
| koszty stałe / mies. (zł) | 2 154 | 6 249 | 16 768 | 25 776 | 4 038 | 17 309 | 13 016 |
| zysk operacyjny / rok (zł) | 43 004 | 35 328 | -34 319 | -125 253 | 8 769 | -52 441 | -12 730 |
| min. gotówka firmy, p10 (zł) | 113 182 | 98 222 | 6 127 | 0 | 6 783 | 55 | 6 624 |
| niewypłacalność | 0% | 0% | 0% | 75% | 0% | 0% | 0% |
| wzrost majątku / rok, mediana (zł) | 1 647 | -803 | -64 336 | -146 760 | -70 751 | -86 059 | -78 202 |
|    p10 … p90 (zł) | -6 105 … 2 019 | -16 012 … 6 918 | -97 876 … -51 993 | -379 978 … -105 196 | -82 603 … -62 500 | -126 938 … -63 401 | -95 076 … -58 891 |

### 5.4 Model v0.7, bot C, 1 rok, 1 seed (test dymny, tylko orientacyjnie)

*1 lat × 1 seedów  kapitał 90 000 zł*

| wskaźnik | solo | owner+1 | team3 | team5 | subs-only | grow | mixed |
|---|---:|---:|---:|---:|---:|---:|---:|
| zapytania / rok | 310 | 273 | 497 | 506 | 443 | 457 | 496 |
| kontrakty / rok | 52 | 91 | 161 | 198 | 73 | 67 | 175 |
| konwersja zapytanie → kontrakt | 17% | 33% | 32% | 39% | 16% | 15% | 35% |
| wygrane z wysłanych ofert | 57% | 69% | 62% | 60% | 56% | 56% | 58% |
| odrzucone przez bota | 70% | 52% | 48% | 34% | 71% | 74% | 39% |
| przegrane z konkurencją / rok | 16 | 19 | 40 | 51 | 31 | 17 | 60 |
| udział w zleceniach rynku | 3% | 4% | 8% | 10% | 4% | 3% | 9% |
| przychód netto / rok (zł) | 140 973 | 227 986 | 334 724 | 392 518 | 178 161 | 191 505 | 356 407 |
| marża kontraktów | 72% | 57% | 28% | 26% | 28% | 58% | 25% |
| przychód / godz. pracy (zł) | 91 | 91 | 108 | 101 | 116 | 113 | 95 |
| wykorzystanie mocy własnej | 78% | 66% | 45% | 41% | 0% | 66% | 69% |
| płace przypisane do kontraktów | — | 56% | 53% | 43% | — | 57% | 62% |
| koszty stałe / mies. (zł) | 1 985 | 4 528 | 12 038 | 20 385 | 3 756 | 4 498 | 8 468 |
| zysk operacyjny / rok (zł) | 77 703 | 75 171 | -51 987 | -143 715 | 5 517 | 57 594 | -12 972 |
| min. gotówka firmy, p10 (zł) | 11 704 | 10 054 | 17 | 0 | 2 789 | 6 496 | 2 |
| niewypłacalność | 0% | 0% | 100% | 100% | 0% | 0% | 100% |
| wzrost majątku / rok, mediana (zł) | 36 957 | 35 993 | -110 600 | -188 155 | -68 303 | 14 981 | -101 601 |
|    p10 … p90 (zł) | 36 957 … 36 957 | 35 993 … 35 993 | -110 600 … -110 600 | -188 155 … -188 155 | -68 303 … -68 303 | 14 981 … 14 981 | -101 601 … -101 601 |

## 6. Wnioski

1. **Popyt przestał być stały i niezależny od firmy.** W v0.7 solo dostaje ok. 400 zapytań rocznie (marketing podstawowy), ale obsłuży ok. 30–50 kontraktów: wąskim gardłem jest **moc**, nie popyt. Dla firm większych wąskim gardłem jest **udział w wygrywanych zleceniach**: żeby obłożyć 3–5 pracowników trzeba wygrywać 7–14% zleceń rynku, a nowa firma wygrywa 3–9%. Zatrudnienie samo nie tworzy klientów — potwierdza to test i symulacja.
2. **Realne przyczyny nierentowności etatów** (porządek wg wagi): (a) *niskie obłożenie* — przy dużym kapitale obłożenie pracowników ≈ 40–55% (próg opłacalności ≈ 70–75%, bo wartość dodana ≈ 80 zł/godz. przy koszcie pracodawcy ≈ 47 zł/godz. pełnego etatu); (b) *umiejętności przypisane do stanowiska* — malarz nie wypełni bezczynności gładziami, a popyt na każdą usługę jest ułamkiem całości; (c) *VAT* — firmy z przychodem >240 tys. zł tracą zwolnienie, a budżet klienta jest brutto, więc ten sam klient daje ok. 19% mniej netto; (d) *koszty stałe* (ZUS właściciela, księgowość, marketing 2,5 tys. zł, pojazd) ≈ 5 tys. zł miesięcznie niezależnie od obrotu; (e) *niedokapitalizowanie* — przy 90 tys. zł firma z ≥ 3 pracownikami od startu wyczerpuje gotówkę po 8–10 miesiącach (niewypłacalność 100%), a przy 400 tys. zł przeżywa (0–75% niewypłacalności).
3. **v0.7 poprawia ekonomię zatrudnienia względem v0.6**, ale jej nie „naprawia”: przy dużym kapitale wynik operacyjny „właściciel + 1” zmienił się z ok. −23 tys. na +35 tys. zł rocznie, „3 pracowników” z −199 tys. na −34 tys., „mieszana” z −88 tys. na −13 tys. (bot różnych wersji — por. §2). Samozatrudnienie i „właściciel + 1” są opłacalne, firma rosnąca bywa (bot C, 1 rok: +58 tys.), duże zespoły od startu — nie.
4. **Żadna strategia nie dominuje wszędzie**: wyniki różnią się znacząco, a marketing ma malejące korzyści (więcej zapytań z portali to więcej porównań i niższa konwersja; polecenia i współpraca z przedsiębiorcami dają mniej, ale lepszych zapytań). Konkurenci mają obłożenie ≈ 71–72%, wchodzą i wychodzą (≈ 5/6 firm na 3 lata).
5. **Nie zmieniałem** kosztów zatrudnienia, płac ani składek, aby zatrudnienie „się opłacało”. Jeżeli ma być opłacalne w grze, kierunki są w FEATURE_EVOLUTION (generaliści i pomocnicy, klienci powracający, umowy ramowe/B2B) — nie w obniżaniu kosztów.


## 7. Założenia niezweryfikowane

- **Wielkość popytu** (≈ 280 projektów/mies. na 100 tys. mieszkańców w zakresie czterech usług), udział szukających wykonawcy (40%), sezonowość per usługa, wpływ koniunktury na popyt (±11 pkt na punkt indeksu), ceny materiałów i oczekiwania płacowe — kalibracyjne, bez źródeł statystycznych.
- **Struktura segmentów** (38/47/15%) i ich wagi (wrażliwość na cenę, jakość, reputację, termin), tablica logistyczna wyboru oferty, szum oceny.
- **Konkurenci**: liczba (15), rozkład wielkości, poziomy cen (88/100/118% ceny referencyjnej) i jakości, koszt wykonawcy (8 000 zł/mies.), reguły decyzji.
- **Marketing**: maksymalna widoczność, nasycenie, opóźnienie, tłok i wrażliwość na koniunkturę każdego kanału; zależność „polecenia z liczby prac”.
- **Reputacja i jakość widoczne dla rynku**: jakość = średnia z 8 ostatnich prac (62 bez historii), standard materiałów ±7.
- **Ceny referencyjne, normy czasu i zużycia** — parametry symulacyjne z v0.5 (`renovationCatalog.ts`), nie dane rynkowe.

## 8. Ograniczenia modelu i bota

- Jedna gra = jedna ścieżka seedów; 6 seedów na wariant to próba **diagnostyczna** (mediany i p10–p90 pokazują rozrzut, ale nie przedziały ufności). Wyniki są wrażliwe na decyzje bota (por. §1): ten sam model przy innej polityce cenowej lub doborze marketingu daje inne liczby.
- Bot nie zmienia pozycjonowania, nie optymalizuje budżetu kanałów, nie zwalnia pracowników i nie korzysta z kilku wykonawców na jedno zlecenie; strategia „rosnąca” jest jedną z wielu możliwych ścieżek rozwoju.
- Pracownik ma **jedną** specjalność (stanowisko = umiejętność); w modelu nie ma generalistów ani pomocników wypełniających bezczynność — to ograniczenie v0.6, które w tym raporcie mocno obniża obłożenie zespołów.
- Brak klientów powracających, umów ramowych, przetargów i zleceń B2B (FEATURE_EVOLUTION §14 pkt 45).
- Niewypłacalność = zaległe zobowiązania ≥ 30 dni lub majątek netto < 0; model nie ma upadłości, restrukturyzacji ani kredytu (poza zakresem v0.7).
- Konkurenci to 15 zbiorczych firm, nie pełny rynek; nie reagują na ruchy gracza inaczej niż przez wspólny rynek.
- Czas: 5-letni przebieg największych strategii trwa kilka minut procesora (kopiowanie stanu przy komendach); pełna seria 7 strategii × 6 seedów × 5 lat na 4 wątkach ≈ godzina.

## 9. Jak powtórzyć

```bash
npm run balance -- --quick                                   # 2 lata, 4 seedy, wszystkie strategie
npm run balance -- --years 5 --runs 6 --workers 4            # seria jak w tym raporcie (kapitał 90 000 zł)
npm run balance -- --years 5 --runs 6 --workers 4 --capital 400000
npm run balance -- --policies team3 --marketing portals --runs 4 --years 3     # inny profil marketingu
npm run balance -- --trace bal-3 --policy team3 --years 2 --dump-state         # jeden seed: log decyzji + stan końcowy
```

Raporty trafiają do `balance-out/` (poza repozytorium); wyniki użyte w tym dokumencie są zapisane w `docs/balance/`. Wyniki poprzedniego modelu (v0.6) uzyskano tym samym botem na kodzie z commitu `e4e04e4` (przeniesionym do osobnego katalogu roboczego z adapterem `setAdvertising`).

