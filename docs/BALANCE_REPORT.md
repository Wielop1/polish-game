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



---

# 10. v0.8.1 — audyt rentowności, kalibracja i większe projekty (B2B)

> ⚠ **Rozdział 10 opisuje pierwszą serię pomiarów (bot v1). Jej wnioski o zespołach były w dużej mierze skutkiem błędów bota — korekta, nowa seria i aktualne liczby: rozdział 11.** Surowe dane serii bot v1: `docs/balance/v081-before-bot-v1-2y.json`.

> Pomiary z tego rozdziału pochodzą z narzędzi w repozytorium: `node tools/balance/audit.ts` (audyt usług i projektów) oraz `npm run balance` (flaga `--projects true`). Surowe wyniki: `docs/balance/v081-*.json`. Parametry rynku, klientów B2B i projektów są **kalibracyjne** (nie dane GUS).

## 10.1 Dlaczego ten rozdział: „na JDG nie da się zarobić”

Zgłoszenie z gry: oferty po 1–3 tys. zł, „zysk” rzędu 200 zł, brak szans na rozwój. Sprawdziłem trzy możliwe przyczyny osobno:

1. **Prezentacja.** Karta wyceny pokazywała „koszt planowany” z Twoją pracą po 60 zł/godz. i „marżę” po tej pracy — to wyglądało jak pensja, której firma nie zarabia. Realnie praca własna nie jest przepływem pieniężnym ani kosztem podatkowym (dowód: `economics.test.ts`). **Naprawione w v0.8.1** (koszty rzeczywiste ≠ praca właściciela ≠ zysk ekonomiczny).
2. **Brak marketingu.** Mój pierwszy pomiar (bierny gracz, bez marketingu) dał ok. **5 zapytań miesięcznie** (31 w pół roku, 28 wygasło) — to prawdziwy powód „nie ma klientów”; z podstawowym marketingiem (550 zł/mies.) bot dostaje 300–500 zapytań rocznie. **Poprawione UI**: karta „Co zrobić teraz?”, szybki start marketingu, pomoc przy ekranie.
3. **Ceny usług.** Audyt poniżej: przy cenie rynkowej wszystkie usługi dają nadwyżkę **70–120 zł za godzinę własnej pracy** (przed składkami i podatkiem), więc same ceny nie są głównym problemem. Jedyna anomalia: gładzie (trudniejsze, wymagają szkolenia za 1 800 zł) dawały mniej niż malowanie. **Skorygowane.**

Mój wcześniejszy szybki pomiar (gładzie 73 m² z marżą −3%) był błędny — gracz nie miał specjalizacji i sprzętu; pomiar poprawiony w audycie (nowa firma: tylko sprzęt wymagany do usługi).

## 10.2 Audyt usług (cena rynkowa, wymagania „dobre”, zlecenie standardowe, materiały „std”, stawka kalkulacyjna 60 zł/godz., sprzęt tylko wymagany)

| usługa | poziom | zlecenie | cena ref. netto (przed → po) | godz. pracy | koszty rzecz. | nadwyżka (po) | nadwyżka / godz. (przed → po) | zysk ekonomiczny (przed → po) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| malowanie | 1 | 85 m² | 2 890 → 2 890 | 25,5 | 942 | 1 948 | 76 → 76 | 418 → 418 |
| malowanie | 5 | 85 m² | 2 890 → 2 890 | 19,6 | 905 | 1 985 | 101 → 101 | 808 → 808 |
| gładzie | 1 | 73 m² | 3 500 → **3 940** | 40,1 | 733 | 3 207 | 69 → **80** | 358 → 798 |
| gładzie | 5 | 73 m² | 3 500 → **3 940** | 30,9 | 660 | 3 280 | 92 → **106** | 987 → 1 427 |
| panele | 1 | 48 m² | 5 660 | 19,2 | 3 960 | 1 700 | 89 | 548 |
| panele | 5 | 48 m² | 5 660 | 14,8 | 3 914 | 1 746 | 118 | 860 |
| drobne prace | 1 | 23 godz. | 2 190 | 23,0 | 231 | 1 959 | 85 | 579 |
| drobne prace | 5 | 23 godz. | 2 190 | 17,7 | 229 | 1 961 | 111 | 900 |

Wnioski: (a) nadwyżka na godzinę rośnie z poziomem umiejętności (+30–40% od poziomu 1 do 5), (b) panele to głównie materiały (70% ceny) — mała nadwyżka na zlecenie, duże zamrożenie gotówki, (c) zlecenie 1–3 tys. zł daje 0,5–2 tys. zł nadwyżki — **przy 100–150 godzinach własnej pracy miesięcznie to 7–10 tys. zł przed składkami (ok. 2 tys. zł) i podatkiem**: da się zarobić, ale przy około 5 zapytaniach miesięcznie (bez marketingu) — nie.

## 10.3 Kalibracja (osobno dla składników)

| składnik | decyzja | uzasadnienie / pomiar |
|---|---|---|
| wielkość rynku, liczba zapytań, konwersja, udział firmy | **bez zmian** | benchmark: solo dostaje 320–470 zapytań rocznie i odrzuca 64–83% (termin, moc) — popyt nie jest wąskim gardłem; zespoły ≥ 3 osób są ograniczone kosztami stałymi i udziałem w wygranych ofertach, nie wielkością rynku |
| cena referencyjna gładzi | **48 → 54 zł/m²** (+12,5%) | zarobek godzinowy gładzi (trudność 2, szkolenie 1 800 zł) 69 zł/godz. był niższy niż malowania (76); po zmianie 80 zł/godz. — zachowana kolejność wg trudności |
| ceny malowania, paneli, drobnych | bez zmian | audyt: 76–89 zł/godz. na poziomie 1 |
| normy czasu, zużycie materiałów | bez zmian | brak sygnału z audytu |
| problemy na budowie | **jeden problem nie dołoży więcej niż 40% normy kontraktu** | stała pula 6–16 godz. podwajała robociznę małych pakietów (8–12 godz.), co wyszło dopiero przy projektach |
| anulowanie kontraktu | **poprawka błędu**: anulowany kontrakt nie wydłuża już rezerwacji godzin do dnia anulowania | benchmark z projektami wykrył ujemny wolny czas (naruszony niezmiennik „budżet czasu > 24 godz.”); błąd istniał od v0.5 |
| ceny i warunki B2B | nowe, kalibracyjne | cena 85–100% ceny prywatnej (siła nabywcza), płatność 7–60 dni, kary 2–5% za tydzień (`projectsCatalog.ts`) |

Nie zwiększano jednocześnie cen i liczby klientów.

## 10.4 Metoda benchmarku (przed / po)

Ten sam bot (wersja z v0.7 po poprawkach, bez zmian logiki dla małych zleceń), te same seedy `bal-1…3`, ten sam horyzont (2 lata; dodatkowo 4 lata dla 3 strategii), kapitał 90 000 zł, strategie: solo, właściciel + 1, 3 pracowników, podwykonawcy, model mieszany, firma rosnąca (bez „5 pracowników” — czas). Trzy zestawy: **przed** (silnik v0.8, commit `e21658d`), **po, tylko prywatni** (silnik v0.8.1, bot ignoruje projekty — izoluje kalibrację) i **po, z projektami** (`--projects true`: ten sam bot + wycena/podpis projektów; dokupuje specjalizacje drobnych prac i paneli — koszt wliczony). Nie mieszam wersji bota.

## 10.5 Wyniki — 2 lata × 3 seedy (mediany)

| wskaźnik | wariant | solo | owner+1 | team3 | subs-only | mixed | grow |
|---|---|---:|---:|---:|---:|---:|---:|
| przychód netto / rok (zł) | przed | 148 870 | 256 465 | 149 397 | 179 722 | 150 612 | 257 608 |
| | po, prywatni | 148 140 | 262 440 | 152 926 | 152 324 | 179 563 | 265 909 |
| | po, z projektami | 120 506 | 259 777 | 170 809 | 152 145 | 169 452 | 106 309 |
| marża (nadwyżka / przychód) | przed → po prywatni → z projektami | 74 → 75 → 62% | 53 → 57 → 47% | 28 → 31 → 29% | 30 → 30 → 34% | 27 → 28 → 30% | 43 → 45 → 51% |
| zysk operacyjny / rok (zł) | przed | 86 147 | 53 132 | −176 708 | 3 859 | −130 719 | 19 116 |
| | po, prywatni | 88 517 | 92 932 | −191 585 | −817 | −119 467 | 19 871 |
| | po, z projektami | 51 769 | 66 399 | −171 049 | 6 292 | −120 441 | 13 964 |
| wzrost majątku / rok (zł) | przed | 39 910 | 16 525 | −228 687 | −70 323 | −204 918 | −19 753 |
| | po, prywatni | 41 299 | 49 684 | −232 811 | −78 072 | −192 561 | −33 212 |
| | po, z projektami | −3 461 | 18 195 | −220 075 | −71 234 | −194 370 | −52 979 |
| niewypłacalność (% przebiegów) | przed / po prywatni / z projektami | 0 / 0 / 0 | 0 / 0 / 33 | 100 / 100 / 100 | 100 / 100 / 100 | 100 / 100 / 100 | 0 / 67 / 67 |
| zysk ekonomiczny właściciela / rok (zł) | po, prywatni | 17 770 | 47 904 | 15 665 | 35 140 | 16 765 | 9 509 |
| | po, z projektami | −25 313 | 4 782 | −3 578 | 40 725 | 10 380 | −17 413 |
| projekty B2B / rok: zapytania · wycenione · podpisane · ukończone | z projektami | 4,3·1,7·1,7·0,8 | 5,8·4,2·4,0·2,2 | 5,5·1,5·1,5·0,5 | 5,0·1,8·1,7·0,0 | 4,2·1,5·1,5·0,2 | 5,7·3,0·2,7·1,5 |
| przychód z projektów / z małych zleceń (zł / rok) | z projektami | 20 732 / 99 839 | 81 860 / 173 090 | 22 116 / 141 022 | 2 128 / 165 679 | 12 521 / 156 719 | 42 275 / 110 750 |

## 10.6 Wyniki — 4 lata × 3 seedy (solo, właściciel + 1, firma rosnąca)

| wskaźnik | wariant | solo | owner+1 | grow |
|---|---|---:|---:|---:|
| przychód netto / rok (zł) | prywatni | 160 642 | 269 470 | 143 353 |
| | z projektami | 126 208 | 279 394 | 53 720 |
| wzrost majątku / rok (zł) | prywatni | 40 490 | 41 922 | −148 639 |
| | z projektami | −12 058 | 30 541 | −76 520 |
| niewypłacalność (% przebiegów) | prywatni / z projektami | 0 / 33 | 0 / 33 | 100 / 100 |
| zysk ekonomiczny właściciela / rok (zł) | prywatni / z projektami | 22 428 / −47 201 | 41 449 / 21 432 | 3 562 / −8 706 |
| projekty / rok: zapytania·wycenione·podpisane·ukończone | z projektami | 7,2·1,3·1,2·1,0 | 5,5·4,4·4,2·3,6 | 6,9·2,3·2,1·1,3 |

## 10.7 Wnioski (bez zaokrąglania w stronę sukcesu)

1. **Kalibracja nie jest „naprawą ekonomii”.** Samozatrudnienie (+40 tys. zł majątku rocznie) i „właściciel + 1” (+17…50 tys.) były opłacalne już w v0.8; zespoły ≥ 3 osób pozostają nierentowne w 100% przebiegów (koszty stałe 13–19 tys. zł miesięcznie przy 20–30% obłożenia). Zmiany kalibracyjne (gładzie, limit problemów) nie zmieniły tego obrazu (różnice w granicach rozrzutu 3 seedów).
2. **Większe projekty B2B nie poprawiają wyniku tego bota.** Dla firm ograniczonych mocą właściciela (solo, owner+1) projekt *wypiera* drobne zlecenia (przychód z małych zleceń solo: −48 tys. zł rocznie, z projektów: +21 tys.), a nadwyżka na godzinę jest niższa (ceny B2B 85–100% prywatnych, zwłoka płatników 2–6 dni, długie okna pracy właściciela → zmęczenie i wolniejsza praca; zysk ekonomiczny solo spada z +22 do −47 tys. zł). Dla owner+1 przychód jest taki sam (270 → 279 tys.), ale 40% pochodzi z projektów, a wynik majątkowy jest o ok. 11 tys. niższy.
3. **Co blokuje projekty (najczęstsze powody wstrzymania oferty w botach, 2 lata):** dla firm z pracownikami i niskim kapitałem (3 pracowników, model mieszany, część „rosnącej”) — „brakuje gotówki na start pierwszego pakietu” (materiały + płace przed pierwszą płatnością za 30–60 dni); dla solo i owner+1 — referencje (liczba ukończonych kontraktów, średnia ocena, wymagany ukończony projekt poziomu 1 dla poziomu 2) i brak wolnych godzin właściciela; dla „tylko podwykonawców” — brak wykonawców z umiejętnościami do pakietów (panele). Kto jest niewypłacalny przed zbudowaniem referencji, nie dostaje projektów.
4. **Referencje działają jak zaplanowano:** poziom 1 po 3 ukończonych kontraktach z oceną ≥ 3,5★, poziom 2 po ukończonym projekcie poziomu 1 i 8 kontraktach (owner+1 ukończył w 4 latach 11–17 projektów na seed, solo 3–5, firma rosnąca 2–12; 0–3 projekty na seed przerwane — klient odstępuje po 45 dniach bez wykonawców albo po anulowaniu pakietu). Projektów poziomu 3 (3 wykonawców, ukończony projekt poziomu 2) nie analizowałem osobno.
5. **Wartość B2B w tej wersji jest strukturalna, nie finansowa:** daje drabinę rozwoju, referencje, realistyczne warunki płatności i kary oraz podstawę pod kolejne poziomy skali (FE-SCALE-01). Gracz ręcznie decyduje, które projekty bierze (kalkulator pokazuje zysk ekonomiczny, termin i zapotrzebowanie na gotówkę przed wysłaniem oferty) — bot tego nie robi tak ostrożnie.

## 10.8 Ograniczenia

- 3 seedy na wariant (rozrzut p10–p90 w `docs/balance/*.json`), 2 i 4 lata; brak serii 5-letniej (pozostaje luka z v0.7, §2).
- Bot wycenia projekty prostą regułą (nadwyżka ≥ 60% wartości pracy właściciela + 8% przychodu), nie zarządza gotówką pod projekty, nie planuje zmęczenia i nie unika kumulowania prac; dobry gracz może wypaść lepiej (lub gorzej).
- Parametry klientów B2B, wymagań i częstości zapytań są kalibracyjne; sprawdziłem dwa warianty okien czasowych projektu (godziny 5 vs 6 dziennie, zapas 1,7 vs 1,4) — wariant o dłuższych oknach wypadł gorzej, pozostawiono pierwotny (`projectsCatalog.ts`).
- Benchmark wykrył i naprawił błąd rezerwacji godzin przy anulowaniu kontraktu (10.3); wcześniejsze serie (v0.7) mogły go zawierać w niewielkim stopniu.


---

# 11. v0.8.1 — korekta po przeglądzie: zespoły, bot v2, dane rynkowe i poprawki B2B

## 11.1 Co poszło źle w rozdziale 10

Wniosek „zespoły ≥ 3 osób są nierentowne w 100% przebiegów, a B2B nie pomaga” był **w głównej mierze artefaktem bota**, nie ekonomii. Prześledziłem miesiące zespołu z 3 pracownikami (`tools/balance`, ślad dzienny) i znalazłem cztery przyczyny po stronie bota:

1. **Nadzór właściciela:** bot jawnie ustawiał „nadzoruje” (1 godz./dzień **na każdy** kontrakt ekipy), przez co właściciel nie miał godzin, a kontrakty ekip stały („Brak wolnych godzin”). Domyślna wartość gry (od wcześniejszej poprawki) to pełne delegowanie — bot v2 używa domyślnej.
2. **Pojazd:** bot kupował pojazd za 38 tys. zł przy 45 tys. zł na rachunku. Bez zapasu gotówki firma nie kupuje materiałów → kontrakty stają → brak przychodu, a płace i składki płyną dalej (**spirala śmierci**: gotówka 0 przez kolejne miesiące, „wykonane” kontrakty zamrożone). Bot v2 kupuje pojazd dopiero przy 90 tys. zł.
3. **Przeładowanie kontraktami:** bot przyjmował zlecenia, aż w toku było 25–38 kontraktów przy 3–4 wykonawcach (zamrożone materiały, opóźnienia, anulowania). Bot v2: nie więcej niż 4 kontrakty (w toku + oferty) na wykonawcę.
4. **Zbyt wąskie wymagania gotówkowe projektów** (nowa funkcja): patrz 11.3.

Skutek: te same strategie na tym samym silniku v0.8 dają po korekcie bota **zupełnie inne** liczby (np. firma z 3 pracownikami: zysk operacyjny 0 zamiast −170 tys. zł; niewypłacalność 33% zamiast 100%). Pomiar poprzedni zachowuję w `docs/balance/v081-before-bot-v1-2y.json`.

## 11.2 Dane rynkowe do kalibracji cen (2025–2026, serwisy porównawcze — nie źródła urzędowe)

| usługa | robocizna (zł/m², bez materiałów) wg serwisów | gra (cena łączna − materiały) przed → po |
|---|---|---|
| malowanie ścian i sufitów | 25–36, mediana ok. 28 ([cenauslug.pl](https://cenauslug.pl/budowa-i-remont/malowanie-scian-i-sufitow/lodz)) | 24,6 → **28,6** (cena 34 → **38 zł/m²**) |
| gładzie gipsowe | 36–52 ([cenauslug.pl](https://cenauslug.pl/budowa-i-remont/wykonanie-gladzi-gipsowej-reczne/warszawa)), 45–70 ([kb.pl](https://kb.pl/cenniki/uslugi/cennik-gladzi-gipsowej-i-szpachlowania-scian-w-calej-polsce/)), całość z materiałem 60–80 | 41,5 → **47,5** (cena 48 → **54 zł/m²**) |
| montaż paneli | średnia ok. 33 (29–42, [cenauslug.pl](https://cenauslug.pl/budowa-i-remont/montaz-paneli-laminowanych/warszawa)), 55–90 brutto ([kb.pl](https://kb.pl/cenniki/uslugi/cennik-ukladania-paneli-podlogowych-w-calej-polsce/)) + listwy 18–25 zł/mb | 46 (z listwami) — bez zmian |
| drobne prace (złota rączka) | brak potwierdzonych stawek w wynikach | 95 zł/godz. — bez zmian |

Dane pochodzą z podsumowań wyszukiwarki (nie czytałem pełnych stron i cenników) — to **orientacyjne** źródła; parametry gry pozostają kalibracyjne. Zmiana cen: malowanie do mediany rynku, gładzie wcześniej (§10.3).

## 11.3 Poprawki silnika B2B po przeglądzie

- **Wykonawcy pakietów:** zatrudnieni przed właścicielem (właściciel zostaje wolny do własnych zleceń; pracuje przy pakiecie tylko, gdy nikt inny nie ma umiejętności) — wcześniej właściciel trafiał do prawie każdej ekipy i blokował drobne zlecenia (40 anulowanych zleceń prywatnych w jednym przebiegu).
- **Skład dopasowany przy aktywacji:** gdy ktoś z zaplanowanej ekipy zwolni się dopiero za tydzień lub dłużej, pakiet startuje mniejszym składem — wcześniej mieszkanie 55 m² trwało pół roku z miesięcznymi przerwami między pakietami.
- **Gotówka:** płace zatrudnionych nie zwiększają zapotrzebowania na gotówkę przy starcie pakietu (płacone co miesiąc niezależnie); dostępne środki = najniższe prognozowane saldo na 60 dni **minus materiały niekupione jeszcze do trwających kontraktów**; przekroczenie = **blokada** oferty („bez kredytu firma nie sfinansuje projektu”) zamiast samego ostrzeżenia.
- **Zaliczki etapowe:** klienci B2B akceptują zaliczki 10–30% (wcześniej 0–20%), domyślnie maksymalną; ceny B2B 94–100% cen prywatnych (wcześniej 85–93% — przy marży rzędu 20 zł/godz. rabat 10% zjadał ok. 40% marży pracownika).
- **Anulowanie projektu:** pakiet, który nie może ruszyć przez 45 dni od odbioru poprzedniego, kończy projekt (relacja z klientem −10).
- **UI:** pojazdy pokazują, ile gotówki i ilu miesięcy kosztów stałych zostanie po zakupie; słownik: „Płynność” i „Nadzór właściciela”; pomoc przy zatrudnieniu i pojazdach.

## 11.4 Wyniki końcowe — bot v2, 2 lata × 3 seedy (mediany)

Bot v2 = ten sam bot co v1 + (a) domyślny nadzór (pełne delegowanie), (b) pojazd dopiero przy 90 tys. zł, (c) limit 4 kontraktów na wykonawcę, (d) projekty tylko dla firm z mocą ponad właściciela (≥ 2 zatrudnionych albo podwykonawcy) — właściciel przy projekcie przeciąża swoje drobne zlecenia. „Przed” = silnik v0.8 (`e21658d`) z botem v2.

| wskaźnik | wariant | solo | owner+1 | team3 | subs-only | mixed | grow |
|---|---|---:|---:|---:|---:|---:|---:|
| przychód / rok | przed | 138k | 249k | 482k | 70k | 323k | 341k |
| | po, prywatni | 154k | 260k | 499k | 74k | 499k | 346k |
| | po, z projektami | 164k | 266k | 232k | 86k | 501k | 272k |
| zysk operacyjny / rok | przed | 74k | 79k | 0k | −28k | −31k | 14k |
| | po, prywatni | 88k | 88k | 25k | −26k | 53k | 37k |
| | po, z projektami | 82k | 81k | −119k | −25k | 59k | 50k |
| wzrost majątku / rok | przed | 29k | 37k | −27k | −87k | −105k | −19k |
| | po, prywatni | 41k | 46k | 0k | −89k | −22k | −1k |
| | po, z projektami | 35k | 38k | −162k | −91k | −27k | 6k |
| niewypłacalność (% przebiegów) | przed / prywatni / z projektami | 0 / 0 / 0 | 0 / 0 / 0 | 33 / 0 / 67 | 100 / 100 / 100 | 67 / 0 / 33 | 0 / 0 / 0 |
| projekty / rok (podpisane) | z projektami | — | — | 0,7 | 0,8 | 1,3 | 1,3 |

4 lata × 3 seedy (solo, owner+1, firma rosnąca): zysk operacyjny / rok: przed 80k / 65k / −76k → po (prywatni) **90k / 82k / +14k** → po z projektami 85k / 71k / +18k; wzrost majątku / rok: 33k / 24k / −108k → **41k / 39k / −21k** → 36k / 29k / −16k. Firma rosnąca nadal oznaczana jako niewypłacalna w 4-letnich przebiegach (majątek netto < 0 po latach wypłat właściciela na życie przewyższających zysk firmy).

## 11.5 Wnioski po korekcie

1. **Zespoły działają, ale na cienkiej marży.** Po poprawkach (kalibracja cen, nadzór, dyscyplina zleceń, zapas gotówki) firma z 3 pracownikami ma zysk operacyjny +25 tys. zł rocznie przy 69% obłożenia, model mieszany +53 tys., firma rosnąca +37 tys.; **żaden** z tych modeli nie jest już niewypłacalny w serii prywatnej (było 33–67%). Rachunek: pracownik wnosi ok. 20 zł marży na godzinę pracy (przy cenach rynkowych i koszcie pracodawcy ok. 41 zł/godz.), więc opłaca się przy obłożeniu powyżej ok. 60–70% — poniżej firma traci. Sama praca właściciela (solo: 88 tys. zł zysku) jest nadal dochodowsza niż zarządzanie ekipą — to cecha modelu cienkich marż, nie błąd.
2. **B2B pomaga firmom z mocą i szkodzi niezdyscyplinowanym.** Dla firmy rosnącej i modelu mieszanego projekty dają +13 tys. i +6 tys. zł zysku operacyjnego rocznie względem wariantu prywatnego (2 lata). Dla firmy z 3 pracownikami jeden z trzech przebiegów kończy się spiralą gotówkową (−119 tys. zł) — marża jest tak cienka, że jakakolwiek zmiana trajektorii (tu: pierwszy projekt) może ją przechylić; wymaga to dalszej pracy nad zabezpieczeniami gotówkowymi (kredyt/zaliczki — v0.9). Solo i „właściciel + 1” nie biorą projektów (bot) — gra ostrzega w pomocy, że projekty są dla firm z ekipą.
3. **Co bot v2 robi „po ludzku”, a gra nadal tego nie wymusza:** nie przeładowuje się zleceniami, nie wydaje całej gotówki, deleguje bez nadzoru. Gracz nie dostaje jeszcze wprost ostrzeżeń o przeładowaniu (UI: pojazdy pokazują zapas po zakupie).
4. **Pozostałe słabości:** strategia „tylko podwykonawcy” jest nadal niewypłacalna w 100% przebiegów (podwykonawcy zjadają marżę, kontrakty czekają na wolnego podwykonawcę i są anulowane — 52 anulowane zlecenia w jednym przebiegu); firma rosnąca przy 4 latach wypłat właściciela na życie traci majątek mimo dodatniego zysku firmy.

## 11.6 Ograniczenia

3 seedy na wariant, 2 i 4 lata; wyniki zespołów są chaotyczne (jeden seed potrafi przejść ze zysku do spirali); bot v2 jest nadal prostszy niż dobry gracz. Surowe dane: `docs/balance/v081-{before,private,projects}-{2y,4y}.json`.


> ⚠ Tabele w §11.7–11.8 pochodzą sprzed naprawy błędów silnika opisanych w §11.9 (podwykonawcy i praca właściciela po terminie) — aktualne liczby: §11.9.

## 11.7 Druga korekta: bot v3, więcej podwykonawców, „zostaje do kieszeni” (uwaga właściciela: zlecenie 7 dni za 5–7 tys. zł przy dużych kosztach nie ma sensu)

**Co zmierzyłem.** Typowe zlecenie na 7 dni pracy za 5–7 tys. zł to (audyt usług): koszty rzeczywiste 1–2 tys. zł (materiały, transport, drobne), nadwyżka ok. 4–5 tys. zł, czyli 70–90 zł za godzinę pracy. Wyceny nie pokazywały jednak, ile z tego zostaje po kosztach stałych (ZUS, zdrowotna, księgowość, reklama) i podatku, a panel „zysk ekonomiczny” odejmował od nadwyżki kalkulacyjną wartość pracy właściciela (60 zł/godz.) — przy takim zleceniu wychodziło ok. 0–1 tys. zł „zysku” za tydzień pracy, co wyglądało na kosztowną nieopłacalność. To była wada prezentacji, nie kosztów: prawdziwy koszt pracy właściciela to jego czas, nie wydatek.
- Wycena pokazuje teraz blok **„Ile zostaje po wszystkim”**: nadwyżka − udział w stałych kosztach firmy (z dwóch ostatnich pełnych miesięcy; nowa firma: 2 500 zł/mies.) − orientacyjny podatek (skala 12% / liniowy 19% / ryczałt / CIT 9%) = **zostaje do kieszeni**, z przeliczeniem na pełny 8-godzinny dzień pracy i miesiąc przy pełnym kalendarzu (`src/engine/pocket.ts`, testy `pocket.test.ts`). Przykład: zlecenie 3 730 zł / 30 godz. → koszty 1 184 zł → nadwyżka 2 546 zł → po podatku zostaje 2 240 zł (ok. 560 zł za 8-godzinny dzień); zlecenie 6 000 zł / 7 dni → ok. 3 tys. zł (ok. 420 zł za dzień, ok. 9 tys. zł miesięcznie przy pełnym kalendarzu, zanim opłacisz życie ok. 3,5 tys. zł).
- Przy zatrudnianiu pracownika oferta pokazuje, od jakiego obłożenia zaczyna się opłacać (koszt godziny / ok. 70 zł nadwyżki na godzinę ≈ 50–70%), że pensja płynie także bez zleceń oraz na ile miesięcy wystarczy gotówki firmy na pensję tej osoby.

**Przyczyny niskiej rentowności zespołów (pomiar na silniku, bot v2 → v3):**
1. **Utrata dni roboczych pracowników.** Śledzenie dni roboczych pracowników (grow/team3, 2 lata): 57–64% dni przy zleceniu, ok. 30% dni „kontrakt jeszcze nie ruszył” (ekipa zarezerwowana, ale pierwszy dzień zlecenia jest dopiero za kilka dni), reszta: brak materiałów, przerwy. Bot rezerwował ekipę na minDays + 3 dni kalendarzowych; zapas +2 daje wykorzystanie 77% (zamiast 57%) przy 50/323 spóźnionych zleceń i karach ok. 1% przychodu (+3: 17/202 spóźnień, ale tylko 202 wykonane zlecenia; +1: 99/274 spóźnień, kary ok. 4%). Zapas terminu w bocie: +2.
2. **Pula podwykonawców** (5 firm, każda na jednym zleceniu naraz) ograniczała „generalnego wykonawcę” do ok. 40 zleceń rocznie: pula zwiększona do 10 firm (nowe gry i migracje zapisów).
3. **Limit zleceń w toku** w strategii „tylko podwykonawcy” liczył wykonawców jako 2 (odrzucał lub pozostawiał bez odpowiedzi 47% zapytań) — teraz 6.
4. **Marża pracownika jest realistycznie cienka**: godzina pracy przy zleceniu to ok. 70–75 zł nadwyżki, koszt pracodawcy pracownika poziomu 2–3 to 36–48 zł/godz.; po odjęciu bezczynności, marketingu, pojazdu i księgowości firma z 2–3 osobami zarabia kilkadziesiąt tysięcy rocznie (10–12% przychodu) — typowy poziom małych firm remontowych. Nie zmieniałem cen ani płac, bo pomiar nie wskazał błędu kalibracji (ceny zgodne z danymi rynkowymi z §11.2).

**Wyniki (bot v3; 3 seedy, mediany; zysk operacyjny / rok · wzrost majątku / rok · % niewypłacalnych):**

| strategia | 2 lata, tylko małe zlecenia | 2 lata, z projektami B2B |
|---|---|---|
| solo | 107k · 57k · 0% | 101k · 50k · 0% |
| właściciel + 1 | 100k · 54k · 0% | 88k · 45k · 33% |
| 3 pracowników od startu | −153k · −197k · 67% | −168k · −218k · 100% |
| tylko podwykonawcy | −16k · −98k · 100% | −21k · −101k · 100% |
| 2 pracowników + podwykonawcy | 86k · −4k · 0% | −113k · −190k · 100% |
| rosnąca (zatrudnia, gdy obłożona) | 58k · 18k · 0% | 12k · −35k · 33% |

4 lata (3 seedy, bez projektów): solo 110k · 58k · 0%; właściciel + 1 99k · 54k · 0%; rosnąca 30k · 0,2k · 33% (wcześniej: 100% niewypłacalnych).

Rosnąca firma, **8 seedów** (osobna seria, 2 lata): bez projektów zysk operacyjny 43k, wzrost majątku +3,9k, 0% niewypłacalnych (p10 −12k…p90 +21k); z projektami 42k, +1,3k, 25% niewypłacalnych (p10 −40k…p90 +12k). Marża nadwyżki z projektów jest taka sama jak z małych zleceń (42% | 42%).

## 11.8 Wnioski po drugiej korekcie (uczciwie)
1. Solo i „właściciel + 1” zarabiają dobrze (ok. 100k zysku, 50–58k rocznie przyrostu majątku po podatkach i kosztach życia ok. 3,5 tys. zł miesięcznie).
2. Zespół opłaca się dopiero przy obłożeniu powyżej ok. 65–75% i stopniowym zatrudnianiu; zatrudnienie 3 osób „od startu” (przed pojawieniem się popytu: marketing działa z opóźnieniem 1–5 mies.) kończy się niewypłacalnością w większości przebiegów — pensje 15–24 tys. zł miesięcznie wyprzedzają przychód. To nie błąd silnika, ale gra ostrzega o tym dopiero teraz (podpowiedź przy ofercie pracy).
3. Projekty B2B nie poprawiają **średniego** wyniku (marża jak w małych zleceniach), a **zwiększają ryzyko** (zamrożona gotówka: płatność do 54–60 dni, zaliczki etapów 10–30%). Ich wartość to skala, referencje i stały front robót, nie wyższa marża. Mediana zysku jest bez zmian, ale ogon (25–33% niewypłacalnych) jest wyraźnie gorszy; wymaga finansowania (kredyt obrotowy / faktoring — v0.9).
4. „Tylko podwykonawcy” pozostaje stratna na małej skali: marża pośrednika ok. 24% przychodu 140k zł rocznie < koszty stałe (ZUS + księgowość + reklama ≈ 46k), a dochód nie rośnie, bo właściciel nie pracuje i zlecenia ograniczają dostępni wykonawcy. To zgodne z rzeczywistością (pośrednik potrzebuje skali), nie jest błędem do naprawy bez rozszerzenia rynku podwykonawców i kredytu.
5. Ograniczenia: 3 (8) seedów, wyniki zespołów chaotyczne (drobna różnica potrafi przesądzić o spirali), bot prostszy niż dobry gracz; surowe dane: `docs/balance/v081c-*.json`.


## 11.9 Trzecia korekta: błędy silnika znalezione w przebiegach (zamiast strojenia cen) — wyniki końcowe

Przejrzałem końcowy stan przebiegów, które kończyły się niewypłacalnością, i zamiast kolejnego strojenia znalazłem trzy **błędy silnika** (w pomiarze „tylko podwykonawcy” klient anulował 34 z 117 zleceń, a w „mixed” 52 z 308 — zlecenia stały bez wykonawcy mimo wykonanej pracy):
1. **Problem na budowie nie wchodził w zakres podwykonawcy.** Podwykonawca „kończył” zakres z normy i był rozliczany, a dodatkowa praca z problemu (6–16 godz.) i poprawki po odbiorze zostawały bez wykonawcy; kontrakt stał, aż klient odstąpił od umowy (45 dni po terminie), a firma traciła przychód i zwracała zaliczkę. Naprawa: dodatkowa praca zwiększa zakres umów podwykonawców proporcjonalnie do ich zakresu (cena ryczałtowa), zgłoszona już praca wraca do wykonania; jeśli podwykonawca jest już rozliczony, poprawki robi w ramach gwarancji (`extendSubScope`, test w `ops.test.ts`).
2. **Oferta podwykonawcy szukała terminu w krótszym oknie niż akceptacja** (praca + 3 dni zamiast + 6 dni zapasu), więc część ofert nie dawała się zaakceptować („jest już zajęty w tym terminie”). Naprawa: to samo okno przy ofercie i akceptacji. Bot w takiej sytuacji prosi o nową ofertę (jak robiłby to gracz).
3. **Praca właściciela po terminie umowy stawała w miejscu**, gdy doba była zajęta przez inne zobowiązania — kontrakt czekał do odstąpienia klienta, a właściciel dalej przyjmował nowe zlecenia w zwolnione dni. Naprawa: gdy wolnych godzin jest mniej niż zwykle, praca idzie wolniej (tyle godzin, ile zostało), bez wolnej godziny nadal jest przestój; dzień pracy ograniczonej nie rezerwuje doby (testy w `ops.test.ts`).

Dodatkowo (kalibracja zmierzona, nie „pod wynik”): ceny podwykonawców +20% (ok. 55–60 zł za godzinę pracy: koszt pracodawcy pracownika 41 zł/godz. plus narzut ok. 40% na narzędzia, składki i przestoje — wcześniej ok. 50 zł/godz., podwykonawca był tańszy od własnego pracownika) oraz w bocie prosta zasada ostrożnego pracodawcy (zatrudnia kolejną osobę, gdy gotówka firmy pokrywa ok. 3 miesiące pensji wszystkich po zatrudnieniu — to samo, co od teraz podpowiada gra przy ofercie pracy).

**Wyniki końcowe, 2 lata, 3 seedy (mediany; zysk operacyjny / rok · wzrost majątku / rok · % niewypłacalnych):**

| strategia | małe zlecenia | z projektami B2B |
|---|---|---|
| solo | 108k · 56k · 0% | 101k · 51k · 0% |
| właściciel + 1 | 105k · 59k · 0% | 76k · 35k · 0% |
| 3 pracowników (zatrudniani gdy jest zapas gotówki) | 36k · 4k · 33% | 33k · 1k · 0% |
| tylko podwykonawcy | 30k · −11k · 0% | 54k · 11k · 0% |
| 2 pracowników + podwykonawcy | 77k · 37k · 0% | 113k · 62k · 0% |
| rosnąca (zatrudnia, gdy obłożona) | 61k · 17k · 0% | 39k · 3k · 0% |

4 lata (3 seedy, bez projektów): „2 pracowników + podwykonawcy” 78k · 37k · 0%; rosnąca 32k · 1k · 33% (jeden seed: ok. 100 tys. zł rocznie bezczynnych pensji). Wykonanych zleceń 94–97% wszystkich przyjętych (reszta w toku na koniec symulacji), zero naruszeń niezmienników. Surowe dane: `docs/balance/v081e-*.json`.

**Wnioski końcowe:**
- Wszystkie strategie mają dodatni zysk operacyjny; w serii z projektami B2B nikt nie jest niewypłacalny (wcześniej 33–100%) — przyczyną „ryzyka B2B” były błędy silnika (stojące zlecenia), nie same płatności.
- Najlepsze skalowanie: stały zespół 2 osób plus podwykonawcy na szczyty (jak w rzeczywistości); drugi najlepszy: właściciel + 1. Pensje bez zleceń nadal są głównym kosztem strategii „rosnąca”, która zatrudnia za późno lub zbyt wolno.
- Ograniczenia: 3 seedy, 4 lata tylko dla dwóch strategii, chaos zespołów; „tylko podwykonawcy” zarabia mało (30k przy przychodzie 450k) — marża pośrednika ok. 18% jest realna.
