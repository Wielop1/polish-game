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
- **Brak debetu (v0.1)**: saldo nigdy nie schodzi poniżej 0. `postTransaction` rzuca wyjątek, jeśli próbowano to zrobić — logika płatności sprawdza saldo *przed* zapłatą.

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

1. `applyScheduledOccurrences` — naliczenia z reguł, w kolejności `rule.id`.
2. `settleDueObligations` — rozliczenia (pkt 2.3).
3. `recordHistory` — migawka `{data, gotówka, majątek netto}` (jedna na dzień).

## 4. Mechanizm zdarzeń

- **Reguły** (`Rule`) generują **wystąpienia** w określonych dniach. Wystąpienie ma deterministyczny identyfikator `"<ruleId>@<YYYY-MM-DD>"` (np. `rule:rent@2026-01-01`).
- `processed` (mapa id → `true`) zapamiętuje zastosowane wystąpienia i transakcje. **Ponowne zastosowanie tego samego wystąpienia jest ignorowane** (idempotencja); ponowne zaksięgowanie tej samej transakcji **rzuca wyjątek** (błąd programisty ma być głośny).
- Każde istotne zdarzenie trafia do **dziennika** (`events`) z unikalnym id, datą, typem, tonem (`neutral|positive|negative|warning`), tytułem, szczegółem, kwotą i kategorią.
- Typy v0.1: `game.started`, `life.birthday`, `obligation.issued`, `obligation.settled`, `obligation.overdue`.
- Identyfikatory: zobowiązanie `obl:<occurrenceId>`, rozliczenie `settle:<oblId>`, zaległość `overdue:<oblId>`, transakcja `tx:<eventId>`.

### Kwoty reguł (`AmountSpec`)
`fixed` · `variable` (baza ± `spreadBps`, losowane deterministycznie) · `contract` (kwota z umowy — jedno źródło prawdy).

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

1. Saldo rachunku = suma wpisów rejestru; saldo ≥ 0.
2. Wpisy: kwoty całkowite i ≠ 0, unikalne id, chronologia, każdy oznaczony jako przetworzony.
3. Zobowiązania: unikalne id, termin ≥ naliczenia; **rozliczone ⇔ dokładnie 1 transakcja o właściwej kwocie i znaku**; otwarte nie mają transakcji; zaległość nie przed terminem.
4. **Tożsamość księgowa**: majątek netto = kapitał początkowy + Σ naliczone przychody − Σ naliczone koszty.
5. Zegar i historia: ostatni punkt historii = dziś, zgodny z gotówką i majątkiem; daty historii ściśle rosnące.
6. Unikalne id zdarzeń; odwołania reguł do umów i kontrahentów istnieją.

## 8. Dane i wersjonowanie prawa

- **Nie wymyślamy obowiązujących stawek.** Wszystkie parametry v0.1 (pensja, czynsz, koszty życia) mają `dataStatus: 'placeholder'` i są oznaczone w UI jako „przykładowe”. Brak modelu podatków i składek (kwoty netto).
- Zasada docelowa: przepisy/stawki jako **tabele z datami obowiązywania** (`{od, do?, wartość, źródło}`), wybierane według daty gry (np. `valueAt(tabela, data)`), tak by gra poprawnie odtwarzała zmiany prawa w czasie. Zweryfikowana wartość wymaga źródła (akt prawny/link/data). Implementacja — etap podatkowy (patrz `IMPLEMENTATION_PLAN.md`).

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
| Harmonogram | projekcja przyszłych zdarzeń zgodna z tym, co faktycznie się wydarzy |

Wymóg: każda nowa mechanika dodaje niezmienniki i testy zachowania; nie wystarczy, że „kompiluje się”.
