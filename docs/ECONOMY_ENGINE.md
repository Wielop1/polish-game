# ECONOMY_ENGINE — zasady silnika ekonomii

Kod: `src/engine/`. Silnik jest **czysty** (brak I/O, UI, zegara systemowego, `Math.random`) i **deterministyczny**: ten sam stan + ten sam seed ⇒ ten sam wynik.

## 1. Pieniądze

- Kwota = **całkowita liczba groszy** (`Grosze = number`, safe integer). `assertGrosze` odrzuca ułamki, `NaN` i liczby spoza zakresu.
- Dodawanie/odejmowanie — na liczbach całkowitych (bez błędów typu `0.1 + 0.2`).
- Procenty: `mulBps(kwota, bps)` (1% = 100 bps) z zaokrągleniem `roundDiv` (połówki od zera). Wynik zawsze w pełnych groszach.
- `Intl.NumberFormat` (`formatPLN`) służy **wyłącznie do wyświetlania**.

## 2. Księgowanie i przepływy finansowe

### 2.1 Dwa etapy: naliczenie → rozliczenie

| Etap | Co się dzieje | Zmienia gotówkę? | Zmienia majątek netto? |
|---|---|---|---|
| **Naliczenie** (`issueObligation`) | Powstaje `Obligation`: wierzyciel, dłużnik, kwota, data naliczenia, **termin**. | nie | tak (należność +, zobowiązanie −) |
| **Rozliczenie** (`settleOne`) | Zapłata/wpłata w terminie: `postTransaction` + status `settled`. | tak | nie (zmienia strukturę: gotówka ↔ należność/zobowiązanie) |

To realizuje zasady: *przychód ≠ wpływ gotówki*, *koszt ≠ wypływ gotówki w tym samym dniu*. Przykłady z v0.1:
- Pensja za styczeń: naliczona **31.01** (należność), wpływa **10.02**.
- Czynsz: naliczony **1.01**, zapłacony **10.01**.
- Zakupy spożywcze: naliczone i płatne **3.01** (naliczenie i rozliczenie tego samego dnia).

### 2.2 Rejestr transakcji (`ledger`)

- Jedyna droga zmiany salda: `postTransaction`. Wpis ma id `tx:<eventId>`, datę, rachunek, kwotę ze znakiem (≠ 0), kategorię, kontrahenta, `obligationId`, `eventId`.
- Saldo rachunku **zawsze** = suma wpisów rejestru dla tego rachunku (niezmiennik).
- Wpisy są niemodyfikowalne i chronologiczne.
- **Brak debetu (v0.1–v0.2)**: saldo żadnego rachunku nigdy nie schodzi poniżej 0. `postTransaction` rzuca wyjątek, jeśli próbowano to zrobić — logika płatności sprawdza saldo *przed* zapłatą.

### 2.3 Reguły rozliczeń (`settleDueObligations`)

W każdym dniu, dla zobowiązań o `dueDate ≤ dziś` i statusie `open`:
1. **Należności** (gracz jest wierzycielem) są wpłacane w terminie — kontrahenci w v0.1 zawsze płacą.
2. **Zobowiązania** są regulowane automatycznie (zlecenie stałe), **od najstarszego terminu** (potem po `id`). Każde jest próbowane **niezależnie** i opłacane **w całości albo wcale** (brak płatności częściowych).
3. Gdy brak środków: ustawiane jest `overdueSince` (raz, pierwszego dnia) i emitowane jedno zdarzenie `obligation.overdue`. Zobowiązanie czeka i jest ponawiane codziennie; po wpłynięciu gotówki zostaje opłacone, a zdarzenie rozliczenia ma adnotację „po terminie”.
4. Kolejność „należności przed zobowiązaniami” w obrębie dnia sprawia, że wpływ pensji 10. dnia może w tym samym dniu pokryć czynsz.

Znane uproszczenie: mniejsze, późniejsze zobowiązanie może zostać opłacone, mimo że starsze, większe czeka (każde próbowane niezależnie). Do rewizji przy odsetkach/windykacji.

## 3. Model czasu

- Data = napis ISO `YYYY-MM-DD` (`src/engine/date.ts`), bez stref czasowych i bez `Date`. Arytmetyka na numerze dnia (algorytmy civil-from-days). Poprawnie obsługuje lata przestępne (w tym regułę 100/400) i granice miesięcy/lat.
- Dzień, który ma status „bieżący”, jest **już przetworzony**: `clock.today` zawsze wskazuje dzień, którego zdarzenia zostały zastosowane. `createNewGame` przetwarza dzień startu (np. naliczenie czynszu 1 stycznia nie jest pomijane).
- `advanceDays(state, n)` → dla każdego z `n` dni: `next = today + 1`, `processDay(next)`, `today = next`. **Żaden dzień nie jest pomijany**; skok o 365 dni daje stan identyczny z 365 pojedynczymi krokami (test).
- `advanceToNextMonth` → do **pierwszego dnia następnego miesiąca** (z dowolnego dnia bieżącego miesiąca).
- Dzień miesiąca > długość miesiąca jest ucinany (`31` w lutym ⇒ 28/29); `'last'` = ostatni dzień miesiąca.
- Limit pojedynczego skoku: `MAX_ADVANCE_DAYS = 3 700` (ochrona UI).

### Kolejność przetwarzania dnia (`processDay`)

1. `runPendingActions` — jednorazowe akcje zaplanowane na ten dzień (v0.2; kolejność data → id).
2. `applyScheduledOccurrences` — naliczenia z reguł (także kapitalizacja odsetek), w kolejności `rule.id`.
3. `rollLifeEvents` — losowanie wydarzeń życiowych (v0.2).
4. `processBusiness` — JDG (v0.3): oferty (1. i 16.), postęp i zakończenie zleceń, przegląd VAT w nowym roku, zamknięcie miesiąca (ostatniego dnia).
5. `settleDueObligations` — rozliczenia (pkt 2.3), każde z rachunku wskazanego w zobowiązaniu.
6. `updateFatigue` — zmiana zmęczenia z budżetu godzin (v0.2, idempotentna po `life.fatigueDate`).
7. `recordHistory` — migawka `{data, rachunek bieżący, oszczędności, majątek netto}` (jedna na dzień).

## 4. Mechanizm zdarzeń

- **Reguły** (`Rule`) generują **wystąpienia** w określonych dniach. Wystąpienie ma deterministyczny identyfikator `"<ruleId>@<YYYY-MM-DD>"` (np. `rule:rent@2026-01-01`).
- `processed` (mapa id → `true`) zapamiętuje zastosowane wystąpienia i transakcje. **Ponowne zastosowanie tego samego wystąpienia jest ignorowane** (idempotencja); ponowne zaksięgowanie tej samej transakcji **rzuca wyjątek** (błąd programisty ma być głośny).
- Każde istotne zdarzenie trafia do **dziennika** (`events`) z unikalnym id, datą, typem, tonem (`neutral|positive|negative|warning`), tytułem, szczegółem, kwotą i kategorią.
- Typy: `game.started`, `life.birthday`, `obligation.issued|settled|overdue`; od v0.2 także `job.*` (aplikacja, decyzja, zatrudnienie, start, koniec, rezygnacja), `housing.*` (umowa, przeprowadzka, koniec najmu), `deposit.paid|refunded`, `lifestyle.changed`, `time.plan_changed|overload`, `savings.transfer`, `life.event|decision`.
- Identyfikatory: zobowiązanie `obl:<occurrenceId>`, rozliczenie `settle:<oblId>`, zaległość `overdue:<oblId>`, transakcja `tx:<eventId>`.

### Kwoty reguł (`AmountSpec`)
`fixed` · `variable` (baza ± `spreadBps`, losowane deterministycznie) · `contract` (kwota z umowy — jedno źródło prawdy; pole `monthlyAmount` lub `utilitiesMonthly`) · `lifestyle` (kwota z poziomu stylu życia obowiązującego w dniu naliczenia, opcjonalnie ± `spreadBps`).

## 5. Zasady symulacji

- `advanceDays` **klonuje stan raz** (`structuredClone`), mutuje klon w pętli dni i zwraca nowy stan; stan wejściowy pozostaje nietknięty (UI/Zustand dostaje niezmienne migawki; pętla nie kopiuje stanu co dzień).
- Silnik nie czyta zegara ani konfiguracji globalnej w trakcie symulacji: parametry startowe są **kopiowane do stanu** (umowy, reguły) przy tworzeniu gry. Zmiana `config.ts` nie zmienia istniejących zapisów.
- Wszystko, co zależy od gracza (decyzje), będzie w przyszłości **komendami** zmieniającymi stan w sposób deterministyczny i logowanymi do dziennika.

## 6. Losowość

- `createRng(seed, streamId)` → strumień (xmur3 → mulberry32). **Strumień jest wyprowadzany z pary (seed gry, identyfikator zdarzenia)**, np. `createRng(seed, "rule:leisure@2026-03-20")`.
- Konsekwencje: wynik zdarzenia nie zależy od kolejności ani liczby innych losowań; **zapis nie przechowuje stanu generatora**; wczytanie zapisu daje identyczną dalszą symulację (test).
- Zastosowania v0.1: data urodzenia (22 lata w dniu startu), wariancja „Rozrywka i drobne wydatki” (±15%).
- Zakaz `Math.random()`/`Date.now()` w `src/engine/`. Ziarno domyślne generuje wyłącznie warstwa UI (`randomSeed`).

## 7. Niezmienniki finansowe (`checkInvariants`)

Sprawdzane w testach po każdym miesiącu symulacji oraz przy wczytywaniu zapisu (uszkodzony/zmanipulowany zapis jest odrzucany):

1. Saldo **każdego** rachunku = suma jego wpisów rejestru; saldo ≥ 0.
2. Wpisy: kwoty całkowite i ≠ 0, unikalne id, chronologia, każdy oznaczony jako przetworzony, istniejący rachunek. **Przelewy własne**: dokładnie dwa wpisy o sumie zero.
3. Zobowiązania: unikalne id, termin ≥ naliczenia, istniejący rachunek; **rozliczone ⇔ dokładnie 1 transakcja o właściwej kwocie, znaku i rachunku**; otwarte nie mają transakcji; zaległość nie przed terminem.
4. **Kaucje**: wpłata i (dla zwróconych) zwrot mają pokrycie w rejestrze; status `held` bez zwrotu.
5. **Tożsamość księgowa**: majątek netto (rachunki + kaucje + należności − zobowiązania) = kapitał początkowy + Σ naliczone przychody − Σ naliczone koszty. Przelewy własne i kaucje jej nie zmieniają.
6. Zegar i historia: ostatni punkt historii = dziś, zgodny z saldami i majątkiem; daty ściśle rosnące.
7. Unikalne id zdarzeń, wydarzeń życiowych i akcji zaplanowanych; akcja wykonana nie może zostać w kolejce.
8. Odwołania reguł do umów, kontrahentów i rachunków istnieją; **koniec reguły = koniec jej umowy**.
9. Umowy o pracę nie nakładają się (jedna praca naraz); umowy najmu mogą (świadomie).
10. Budżet czasu na dziś nie przekracza 24 godzin; zmęczenie w zakresie 0–100.

## 8. Dane i wersjonowanie prawa

- **Nie wymyślamy obowiązujących stawek.** Wszystkie parametry v0.1 (pensja, czynsz, koszty życia) mają `dataStatus: 'placeholder'` i są oznaczone w UI jako „przykładowe”. Brak modelu podatków i składek (kwoty netto).
- Zasada docelowa: przepisy/stawki jako **tabele z datami obowiązywania** (`{od, do?, wartość, źródło}`), wybierane według daty gry (np. `valueAt(tabela, data)`), tak by gra poprawnie odtwarzała zmiany prawa w czasie. Zweryfikowana wartość wymaga źródła (akt prawny/link/data). Implementacja — etap podatkowy (patrz `IMPLEMENTATION_PLAN.md`).

## 8a. Mechaniki v0.2 (skrót zasad)

**Komendy gracza** (`commands.*`): praca (`applyForJob`, `respondToJobOffer`, `resignFromJob`), mieszkanie (`signLease`), `setLifestyle`, `setTimePlan`, `transferFunds`, `resolveLifeEvent`. Patrz ADR-015.

**Praca.** Oferta (katalog fikcyjny) ma brutto, wymiar godzin, wymagane umiejętności, miejsce i okres wypowiedzenia. Aplikacja → decyzja pracodawcy po 5–12 dniach (los: seed + id aplikacji; szansa z dopasowania umiejętności, −2 poziomy = brak szans, zmęczenie obniża). Propozycja ważna 7 dni. Przyjęcie: wypowiedzenie obecnej umowy (koniec = ostatni dzień miesiąca po okresie wypowiedzenia), nowa umowa od 1. dnia miesiąca po jej końcu (min. 7 dni od dziś), weryfikacja budżetu czasu. Pensja zawsze przez `rule:salary:<umowa>` (naliczenie ostatniego dnia miesiąca, wypłata 10. następnego); jedno naliczenie na miesiąc.

**Mieszkanie.** `signLease`: wypowiedzenie obecnej umowy, nowa umowa od wybranego 1. dnia, kaucja płatna od razu (aktywo), koszt przeprowadzki naliczany w dniu wprowadzenia, zwrot kaucji ze starego lokalu 14 dni po jego końcu. Ujęcie w ADR-017/018.

**Budżet czasu.** Dzień roboczy = pon–pt. Praca: `round(godziny_miesięczne / 21)` godz. w dni robocze; obowiązki 3 godz. + 1 godz. dojazdu w dni robocze przy zatrudnieniu; sen i rezerwa na działalność z planu; zobowiązania czasowe (kursy, zlecenia) z `commitments`; **czas wolny = 24 − reszta**. Zmęczenie, dzienna delta (liczby całkowite):
`2·max(0, aktywne−10) + 5·max(0, 8−sen) − 2·max(0, sen−8) + 2·max(0, 2−wolne) − max(0, wolne−3)`, gdzie *aktywne* = praca + obowiązki + działalność + zobowiązania. Wydajność = 10 000 − 70·max(0, zmęczenie−30) pkt bazowych.

**Styl życia.** Trzy poziomy zmieniają kwoty reguł `lifestyle` (żywność, transport, rozrywka) od najbliższego naliczenia. Wskaźnik jakości życia: ADR-021.

**Oszczędności.** Odsetki i podatek: ADR-022. Przelew nie zmienia majątku netto i nie jest przychodem ani kosztem.

**Wydarzenia życiowe.** ADR-023. Prawdopodobieństwa miesięczne (bazowe, w pkt bazowych): awaria 700 (jest najem, brak w ostatnich 60 dniach), niespodziewany wydatek 900, premia 500×wydajność (staż w firmie ≥ 60 dni, wydajność ≥ 70%), awans 300 (staż w firmie i na stanowisku ≥ 180 dni, wydajność ≥ 80%, bez awansu w 12 mies.), utrata pracy = suma czynników z `labor.ts` (wydajność 40/150, trudna sytuacja pracodawcy 50, recesja 50; 0 bez czynników; staż w firmie ≥ 90 dni — ADR-025), zlecenie 700 (mieści się 2 godz. dziennie przez 14 dni), kurs 400 (≥ 1 400 zł na rachunkach, mieści się 2 godz. dziennie przez 30 dni). Wszystkie wartości przykładowe.

## 8c. Mechaniki v0.5 — branża remontowa i księgowość (skrót; ADR-040–046)

Moduły: `renovation.ts` (+ `renovationCatalog.ts` z parametrami symulacyjnymi), `accounting.ts`, `industry.ts`/`industries.ts`. Dzienna kolejność w `processDay`: … → `processBusiness` (oferty v0.3 → postęp zleceń v0.3 → **`industryOf(b).processDay`**: reklama, kontrakty (praca, odbiór, rozliczenie), decyzje klientów, reklamacje, nowe zapytania) → `processAccounting` (abonament, powiadomienia, wniosek o zwrot, porównanie form) → `processAnnual` → rozliczenia. Każdy dzień modułu jest idempotentny (`processed['reno:day:…']`).
Przepływy: zakup materiałów/sprzętu = dokument kosztowy (zobowiązanie → gotówka) + aktywo (`netWorth.inventory/equipment`); zużycie = przeniesienie wartości zapasu do kosztu kontraktu (bez nowego wydatku); sprzedaż = zaliczka (`part: advance`) + rozliczenie końcowe (`final`). Majątek netto = … + zapasy + sprzęt; tożsamość księgowa w `invariants.ts` uwzględnia aktywa, a niezmienniki pilnują zgodności zapasu z ruchami magazynowymi.

## 8d. Mechaniki v0.6 — pracownicy, ekipy, podwykonawcy, pojazdy (skrót; ADR-047–054)

Dzienna kolejność w `processDay`: … → `processBusiness` (w tym `processRenovation`: reklama, **podwykonawcy**, kontrakty w kolejności startu ze wspólnym zbiorem użytych zasobów, decyzje klientów, reklamacje, zapytania) → `processAccounting` → **`processWorkforce`** (ogłoszenia i kandydaci, wygasanie umów, morale i zmęczenie, listy płac na koniec miesiąca) → **`processFleet`** (koszty pojazdów na koniec miesiąca) → `processAnnual` → rozliczenia.
Przepływy: lista płac = dokument kosztowy (brutto + składki pracodawcy) + 3 zobowiązania (netto 10., ZUS i PIT 20.); koszt pracy trafia do kontraktów według godzin (`job.actual.labor`), reszta to koszt stały; podwykonawca = przedpłata (aktywo) → odbiór → dokument kosztowy bez VAT na pełną cenę, zapłata reszty; pojazd = wydatek gotówkowy bez kosztu podatkowego + aktywo; zaliczka od klienta = zobowiązanie do wykonania usługi, przychód podatkowy po wykonaniu. Majątek netto: + pojazdy + przedpłaty − zaliczki do czasu wykonania usługi; tożsamość księgowa w `invariants.ts` ma te składniki.

## 8e. Mechaniki v0.7 — rynek lokalny, konkurencja, marketing, strategia (skrót; ADR-055–060)

Moduły: `market.ts` (wspólna warstwa: popyt, alokacja klientów, konkurenci, marketing, pozycjonowanie, komendy), `macro.ts` (koniunktura), `marketConfig.ts` (CAŁA konfiguracja — parametry **kalibracyjne**; interfejs `MarketIndustry`), `renovationMarket.ts` (parametry branży remontowej: usługi, udziały w popycie, sezonowość, losowanie zlecenia z segmentu), `marketAnalytics.ts` (selektory dla UI i symulatora). Dzienna kolejność: `processRenovation` → … → `processMarketDay` (na końcu dnia).

**Popyt** (wzór w `expectedDailyDemand`): projekty/miesiąc = mieszkańcy/100 tys. × 280 × (udział usługi) × sezonowość ogólna × sezonowość usługi × koniunktura × szum, rozłożone na dni tygodnia; liczba projektów dnia = część całkowita + losowanie (seed, dzień, usługa). **Szukający wykonawcy** = ułamek popytu (40% × skłonność do wydatków × (1 − 0,5 × (poziom cen firm − 1))); reszta robi samodzielnie lub odkłada. Każdy szukający wybiera segment (struktura zależna od koniunktury), losuje zlecenie (`rollProject`) i **zestaw 2–3 firm** ważony widocznością; gracz trafia do zestawu z prawdopodobieństwem proporcjonalnym do swojej widoczności. Każdy projekt kończy w jednym z pięciu stanów: zapytanie do gracza, utracone z braku mocy (≥ 6 otwartych zapytań), zlecenie konkurenta, niezrealizowane (konkurenci przeciążeni) albo nie-szukający. Wszystko to jest zliczane miesięcznie (`market.months`).

**Widoczność** (waga ×10 000; średni konkurent ≈ 10 000): firma = (baza organiczna + Σ kanałów × waga segmentu) × pozycjonowanie × (0,55 + 0,9 × reputacja/100) × bramka kolejki; usługa poza specjalizacją ×0,12. Konkurent: (rozmiar + marketing) × pozycjonowanie × reputacja × bramka kolejki (od 5 dni zaległości maleje do 15%).

**Wybór oferty** (`utilityParts`): ocena = cena względem budżetu klienta (waga segmentu) + jakość − oczekiwana jakość segmentu + reputacja + opóźnienie startu + dopasowanie pozycjonowania + szum. Klient porównujący oferty (rivals > 0) wybiera między graczem a najsilniejszym konkurentem z zestawu: prawdopodobieństwo z tablicy logistycznej różnicy ocen (`winProbabilityBps`; bez funkcji transcendentalnych). Wygrana otwiera zwykłą decyzję klienta (`decideQuote`: cena, termin, zaliczka…); przegrana kończy ofertę, a zlecenie trafia do konkurenta (raz). Zapytania z poleceń/współpracy mają duży udział „pytam tylko Ciebie” (bez porównań), portale — dodatkowych rywali.

**Konkurenci** (`Competitor`): rozmiar i liczba wykonawców, usługi, pozycjonowanie, poziom cen, jakość, reputacja, budżet i widoczność marketingu, zaległość pracy (godziny i wartość dodana), uproszczona gotówka. Dziennie wykonują pracę (7 godz./osobę w dni robocze), miesięcznie: przychód z wykonanych godzin − koszty (płace × presja płacowa + koszty stałe + marketing); decyzje (`closeMonth`, seed per konkurent i miesiąc): ceny ±, marketing, zatrudnienie/zwolnienie, zmiana pozycjonowania w kłopotach, wyjście z rynku (gotówka poniżej progu albo 7 miesięcy straty), wejście nowych firm (cel liczby firm zależy od koniunktury i średniego obłożenia). **Konkurenci nie czytają stanu gracza** — widzą tylko koniunkturę i własne wyniki; dla gracza pokazujemy oszacowania z szumem (`competitorViews`), bez gotówki, obciążenia i dokładnych cen.

**Marketing:** 6 kanałów; widoczność kanału = maks. × budżet/(budżet + nasycenie) (malejące korzyści) × koniunktura × „tłok” (reklama konkurentów); zbliża się do celu o 1/(1+opóźnienie) miesięcznie. Budżet obowiązuje od 1. dnia następnego miesiąca i jest pobierany jako dokument kosztowy „Marketing: …”. **Strategia:** 3 pozycjonowania; zmiana narasta liniowo przez 90 dni, odstęp ≥ 60 dni, historia decyzji w stanie, koszt utrzymania „Pozycjonowanie: …”. Reputacja nie jest zerowana.

**Koniunktura** (`macroAt`): kotwice roczne z istniejącego `economicClimate` (dobra +0,90 / przeciętna 0 / recesja −1,40), interpolacja miesięczna + wygładzony szum → 4 fazy; wpływ na popyt, skłonność do wydatków, ceny materiałów (`materialPrice`), oczekiwania płacowe kandydatów (płaca minimalna obowiązuje zawsze) i kondycję konkurentów. Ten sam klimat roczny nadal steruje ryzykiem zwolnień z etatu.

**Zapis:** `GameState.market`; `SAVE_VERSION = 7`; `migrateV6ToV7` nie generuje wstecznie konkurentów ani historii (`initializedOn = null` → model startuje w pierwszym przetworzonym dniu firmy remontowej), dawna reklama staje się budżetami kanałów. **Niezmienniki:** konkurenci (status ⇔ data wyjścia, zaległość ≥ 0), budżety i widoczność tylko dla znanych kanałów, chronologia miesięcy, odwołania zapytań do istniejących konkurentów.

**Symulator balansu:** `npm run balance` (`tools/balance/`): bot gra przez `commands.*` na tym samym silniku; strategie, seedy, wątki robocze, raport JSON i podsumowanie; wyniki i wnioski: `BALANCE_REPORT.md`.

## 8a. Mechaniki v0.4 — płace, rozliczenia roczne, planowanie (skrót; ADR-033–039)

Moduły: `payroll.ts` (kalkulator brutto → netto, odcinki płacowe), `annual.ts` (31.12: zeznania PIT-37/36/36L/28, straty, roczna zdrowotna, wnioski o zwrot), `business.ts` (zawieszenie, zmiana formy od 1.01, Mały ZUS Plus), `planning.ts` (prognoza na klonie stanu), `report.ts` (podsumowanie roku). Zaokrąglenia: składki do grosza, podstawa i podatek do zł. Dzienne przetwarzanie: `processDay` → płace → JDG (`closeMonth`) → `processAnnual` (31.12). Wszystkie operacje idempotentne (klucze `processed`).

## 8b. Mechaniki v0.3 — JDG (skrót; szczegóły i źródła: `LEGAL_SOURCES.md`, ADR-026–030)

- **Ewidencja.** Zobowiązania mają `scope` (personal/business); JDG ma rachunek `type: 'business'` należący do osoby. Przelewy prywatne↔firma to `transferFunds`.
- **Dokumenty i VAT.** `issueDocument` tworzy dokument i zobowiązania: sprzedaż — należność netto (przychód), a przy czynnym VAT także należność z VAT od klienta i zobowiązanie VAT należny (25. następnego miesiąca); koszt — zobowiązanie netto/brutto (zwolniony: brutto), przy czynnym VAT także VAT naliczony jako należność od US. Opóźnienie płatności klienta: `paymentDelayDays(seed, dokument)`.
- **Miesiąc JDG** (ostatniego dnia): składki społeczne wg reżimu (`zusRegimeFor`: ulga 6 mies. → preferencyjne 24 → standard; zbieg z etatem ≥ 4 806 zł brutto → brak), składka zdrowotna (skala/liniowy: % dochodu poprzedniego miesiąca z minimum 432,54 zł; ryczałt: progi 60/300 tys. zł przychodu narastająco) i zaliczka PIT metodą narastającą (próg 1 000 zł, tylko zapłacone składki; liniowy: odliczenie zdrowotnej do 14 100 zł; ryczałt: przychód − społeczne − 50% zdrowotnej). Termin 20. następnego miesiąca. Grudzień/zakończenie: saldo roczne do 30 kwietnia.
- **Zlecenia.** Przyjęcie rezerwuje godziny (`commitment`) walidowane na każdy dzień; postęp = godziny × wydajność; po terminie kara umowna; dokument sprzedaży w dniu wykonania.
- **Niezmienniki dodatkowe:** jedna aktywna JDG, rachunek firmowy należy do osoby, ewidencja zgodna z rachunkiem, dokumenty (netto + VAT = brutto, powiązane zobowiązania, unikalne numery), zlecenia, unikalność rozliczeń miesięcznych.

## 9. Strategia testowania silnika

Pliki: `src/engine/*.test.ts`, `src/persistence/persistence.test.ts` (Vitest, środowisko Node).

| Obszar | Co sprawdzają testy |
|---|---|
| Czas | dzień po dniu przez granice miesięcy/lat i rok przestępny; „do następnego miesiąca” zawsze na 1.; skok = dni = miesiące (równość stanów); czysta funkcja; walidacja argumentów |
| Kalendarz | odwracalność numeru dnia 1900–2200, `addMonths` z ucinaniem, lata przestępne |
| Pieniądze | brak błędów float, odrzucanie ułamków groszy, zaokrąglanie, formatowanie |
| Wynagrodzenia | naliczenie 31.01 ≠ wpływ 10.02; należność w majątku, nie w gotówce; luty (28 dni) |
| Koszty | każdy koszt księgowany w dniu terminu, właściwa kwota i powiązanie z zobowiązaniem |
| Saldo | saldo = suma rejestru i ≥ 0 po każdym dniu przez 2 lata |
| Podwójne księgowanie | ponowne zastosowanie dnia nie zmienia stanu; ponowne `postTransaction` rzuca wyjątek; unikalność id po 10 latach |
| Majątek netto | start, tożsamość księgowa codziennie przez 400 dni, neutralność płatności, historia |
| Zaległości | brak środków ⇒ jedno zdarzenie, czekanie, opłacenie po wpływie, adnotacja „po terminie” |
| Seed | ten sam seed ⇒ równość stanów po 24 mies.; różne seedy ⇒ różne wyniki; niezależność od ścieżki dojścia |
| Zapis | round-trip, kontynuacja po wczytaniu = bez zapisu, uszkodzony JSON, nowsza wersja, zła struktura, zmanipulowane saldo/rejestr, IndexedDB (fake-indexeddb) |
| Długie symulacje | 12 i 120 miesięcy; niezmienniki sprawdzane **co miesiąc**; sensowność (brak zaległości, wynik > 0) |
| Kariera (v0.2) | szansa z umiejętności i zmęczenia; aplikacja → decyzja deterministyczna; zmiana pracy bez dubli wypłat; rezygnacja; brak dwóch umów naraz; praca musi mieścić się w budżecie czasu |
| Mieszkanie (v0.2) | dozwolone daty, podgląd, kaucja jako aktywo (majątek netto bez zmian), jeden czynsz w miesiącu, jawne nakładanie, zwrot kaucji, walidacje, brak mutacji wejścia |
| Czas i styl życia (v0.2) | 24 h (dzień roboczy/weekend), walidacja planu, zmęczenie i wydajność, idempotencja; styl życia zmienia kwoty przez zobowiązania; jakość życia ≠ majątek |
| Oszczędności (v0.2) | przelew neutralny dla majątku i przepływów, walidacje, odsetki (jedno zaokrąglenie), osobny podatek, idempotencja kapitalizacji, historia |
| Wydarzenia (v0.2) | determinizm i niezależność od ścieżki, każda opcja decyzji, brak podwójnego skutku, domyślne wygaśnięcie, premia/awans/utrata pracy/zlecenie/kurs, decyzja niewykonalna bez zmiany stanu, 12 miesięcy aktywnego zarządzania |
| JDG i prawo (v0.3) | zweryfikowane przykłady ZUS (1 926,76 / 456,18 zł), zdrowotnej (progi ryczałtu, minimum), PIT (skala, liniowy z limitem 14 100 zł, ryczałt), limit VAT (220 000 zł przy starcie 1.02), zbieg z etatem, ulga na start i oś czasu składek, zaliczki narastająco i próg 1 000 zł, rozliczenie roczne, zlecenia i konflikt godzin, opóźnienia płatności, dokumenty, terminy 20./25., rejestr reguł, 24 miesiące z JDG |
| Migracja (v0.2–v0.3) | prawdziwy zapis v1 → v2: historia nietknięta, nowe pola bez zgadywania, dalsza gra bez dubli, nowe mechaniki na zmigrowanym zapisie, uszkodzony zapis odrzucony |
| Harmonogram | projekcja przyszłych zdarzeń zgodna z tym, co faktycznie się wydarzy |

Wymóg: każda nowa mechanika dodaje niezmienniki i testy zachowania; nie wystarczy, że „kompiluje się”.
