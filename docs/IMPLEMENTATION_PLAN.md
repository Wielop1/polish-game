# IMPLEMENTATION_PLAN — plan wersji

> Plan jest propozycją kierunku. **Kolejną wersję rozpoczynamy dopiero po zatwierdzeniu przez właściciela projektu.** Zakresy wersji po v0.1 mogą się zmienić; zmiany zapisujemy w `DECISIONS.md`.

## Zasady planu

- Jedna wersja = jeden spójny, testowalny przyrost. Nie mieszamy zakresów.
- Każda wersja kończy się: zielonymi testami (`typecheck`, `test`, `build`, w razie zmian UI `test:e2e`), aktualnym `PROJECT_STATUS.md`, migracją zapisu (jeśli zmienił się `GameState`).
- Przed implementacją mechaniki prawnej/podatkowej: **weryfikacja źródeł** i wpis w `DECISIONS.md` (do tego czasu — placeholdery).

## v0.1 — Fundament ekonomii ✅ (zakończona, patrz `PROJECT_STATUS.md`)

**Zakres:** nowa gra (postać, 22 lata, Olsztyn, 1.01.2026, 5 000 zł); czas (dzień / do następnego miesiąca); etat + najem + koszty życia; rachunek, rejestr transakcji, zobowiązania/należności, majątek netto, podsumowania miesięczne; harmonogram zdarzeń bez podwójnego księgowania; ciemny UI (6 ekranów, karty, wykresy); zapis/wczytanie z wersjonowaniem i walidacją; testy silnika i e2e; konfiguracja Vercel.

**Poza zakresem (świadomie):** decyzje gracza, podatki/ZUS, JDG, spółki, kredyty, giełda, nieruchomości, pracownicy, branża remontowa, backend.

## v0.2 — Decyzje gracza i życie prywatne ✅ (zakończona, patrz `PROJECT_STATUS.md`)

**Cel:** pierwsza prawdziwa pętla „decyzja → czas → skutek”.
**Zakres:**
- Warstwa **komend gracza** w silniku (deterministyczne, logowane do dziennika): zmiana mieszkania (inny czynsz/lokalizacja), zmiana pracy (inne warunki, okres wypowiedzenia), regulacja stylu życia (budżet kategorii), wydatki jednorazowe.
- **Zdarzenia losowe życia** (awaria, nieplanowany wydatek, okazja) na seedowanym RNG per-zdarzenie.
- Oszczędności: drugi rachunek (oszczędnościowy) i przelewy między rachunkami własnymi (przelew nie zmienia majątku netto — nowy niezmiennik).
- Migracja zapisu v1 → v2.
**Zależności:** v0.1. **Kryteria ukończenia:** każda komenda ma testy (w tym determinizm i niezmienniki); UI do wydawania komend; zapisy v1 wczytują się po migracji.

**Zrealizowano w v0.2** (zakres rozszerzony względem pierwotnego szkicu): oferty pracy i aplikacje (tylko umowa o pracę), zmiana/rezygnacja z pracy, oferty najmu z kaucją i przeprowadzką, budżet czasu z zarządzaniem zmęczeniem, 3 style życia, rachunek oszczędnościowy z odsetkami, 7 wydarzeń życiowych, migracja v1 → v2. **Nie zrealizowano z pierwotnego szkicu:** wydatki jednorazowe jako komenda gracza (są tylko jako skutki wydarzeń).

## v0.3 — Pierwsza działalność gospodarcza (JDG) z modelem podatkowo-składkowym ✅ (zakończona, patrz `PROJECT_STATUS.md`)

**Zrealizowano (zakres rozszerzony względem pierwotnego szkicu „model podatkowy i ZUS”):** jedna JDG usługowa równolegle z etatem; skala/liniowy/ryczałt; ZUS (ulga na start, preferencyjne, standard, zbieg z etatem); składka zdrowotna; VAT (zwolnienie/czynny, limit); zlecenia usługowe z budżetem czasu; dokumenty; kalendarz obowiązków; rejestr `legal.ts` + `LEGAL_SOURCES.md`; `FEATURE_EVOLUTION.md`; migracja v2 → v3. **Nie zrealizowano** (patrz `FEATURE_EVOLUTION.md`): model podatkowy dla etatu (netto nadal szacunek), Mały ZUS Plus, zawieszenie, zmiana formy, roczna zdrowotna, straty i ulgi.

### Pierwotny szkic (zachowany)


**Cel:** przejście z kwot netto na brutto → netto, fundament pod JDG.
**Zakres:** tabele przepisów z datami obowiązywania (`valueAt`), źródła i status weryfikacji; umowa o pracę brutto/netto, składki, PIT; roczne rozliczenie; deklaracje jako zobowiązania wobec urzędu.
**Warunek wejścia:** zatwierdzony, zweryfikowany zestaw źródeł prawnych na 2026 (do tego czasu placeholdery).
**Kryteria:** testy na przypadkach wzorcowych z udokumentowanych źródeł; wyniki powtarzalne po dacie.

## v0.4 — Poprawność rozliczeń i rozwój JDG ✅ (zakończona, patrz `PROJECT_STATUS.md`)

Weryfikacja źródeł i wdrożenie pozycji z `FEATURE_EVOLUTION.md` oznaczonych v0.4: zmiana formy opodatkowania w kolejnym roku, zawieszenie/wznowienie, Mały ZUS Plus, roczne rozliczenie składki zdrowotnej, straty z lat ubiegłych, łączne rozliczenie etat+JDG, zweryfikowany kalkulator netto z etatu, planowanie i podsumowanie roku. **Wykonane.** Zestaw wartości 2027 — nadal do weryfikacji źródeł (bez automatycznego przełączania). Bez zatrudniania pracowników.

## v0.5+ — Kredyty, leasing, odsetki (dawniej v0.4)

Harmonogramy rat (kapitał + odsetki, w groszach, bez dryfu zaokrągleń), zdolność kredytowa (uproszczona), odsetki za zwłokę, windykacja (poziom 1). Banki jako strony z własną logiką.

## v0.6 — Pierwszy moduł branżowy: remonty i wykończenia → **pierwszy grywalny prototyp** (dawniej v0.5; samo założenie JDG zrealizowano już w v0.3)

**Cel:** pełna ścieżka „etat → własna firma”.
**Zakres:** założenie JDG (osoba fizyczna prowadząca działalność — bez odrębnej osobowości prawnej), ewidencja firmowa, rejestr kontraktów/zleceń, **moduł remontów** (wycena, kontrakt, materiały, robocizna, terminy, odbiory, płatności z opóźnieniem), pierwszy pracownik, regionalny rynek zleceń (Olsztyn), konkurenci (uproszczeni).
**Kryteria „grywalnego prototypu”:** gracz może przez kilka lat pracować na etacie, odłożyć kapitał, założyć JDG, zdobywać i realizować zlecenia remontowe, zatrudnić pracownika, płacić podatki i składki, **zbankrutować lub rosnąć**; wszystko deterministyczne i zgodne z niezmiennikami; zapisy migrowane.

## v0.7+ — Spółki i inwestycje (kierunek)

Spółka z o.o. (udziały, wspólnicy, zarząd ≠ udziały ≠ dywidendy), wypłaty, kapitał zakładowy; gospodarstwo domowe wieloosobowe; giełda i obligacje; nieruchomości (zakup, wynajem, kredyt hipoteczny); kolejne branże; (opcjonalnie) mapa miasta w Phaser.

## Zależności

```
v0.1 ──► v0.2 ──► v0.3 ──► v0.5 (JDG + remonty)
             └──► v0.4 ──┘
                           └──► v0.6+ (spółki, inwestycje)
```

## Ryzyka

| Ryzyko | Zapobieganie |
|---|---|
| Dryf zaokrągleń w ratach/podatkach | tylko grosze całkowite, testy sum kontrolnych na pełnym harmonogramie |
| Błędne stawki prawne | status `placeholder` do czasu weryfikacji źródeł; wersjonowanie datami |
| Rozrost `GameState` (rozmiar zapisu, wydajność) | pomiary przy 120 mies.; w razie potrzeby kompaktowanie historii (decyzja w `DECISIONS.md`) |
| Niekompatybilne zapisy | `SAVE_VERSION` + migracje + testy migracji na zapisach wzorcowych |
| Rozjazd dokumentacji i kodu | obowiązek aktualizacji dokumentów w „definicji zrobione” (`AGENTS.md` §4) |
