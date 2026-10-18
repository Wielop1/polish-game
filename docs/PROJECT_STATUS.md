# PROJECT_STATUS — stan projektu

> Aktualizuj po każdym zadaniu. Opisuje **stan faktyczny**, nie plany. Ostatnia aktualizacja: 2026-10-18.

## Wersja

**v0.2.0 — Życie prywatne, decyzje, czas i oszczędności** (zakończona; v0.3 czeka na zatwierdzenie). Zapisy: `SAVE_VERSION = 2` (migracja z v1).

## Co działa (zweryfikowane testami)

Wszystko z v0.1 (nowa gra, czas, rejestr, zobowiązania, majątek netto, kalendarz, dziennik, zapisy, 6 ekranów) plus:

- **Praca i kariera.** 8 fikcyjnych ofert (tylko umowa o pracę; inne formy są w modelu jako `employmentForm`, ale nieobsługiwane): stanowisko, pracodawca, brutto i *szacowane* netto, wymiar godzin, wymagane umiejętności, lokalizacja, okres wypowiedzenia. Aplikacja → decyzja pracodawcy po 5–12 dniach (deterministyczna, zależna od umiejętności i zmęczenia) → propozycja ważna 7 dni → przyjęcie z automatycznym wypowiedzeniem obecnej umowy i startem od 1. dnia miesiąca po jej końcu. Rezygnacja z pracy. Jedna praca naraz. Pensja nadal przez tę samą mechanikę (naliczenie ostatniego dnia miesiąca, wypłata 10. następnego) — jedno naliczenie na miesiąc przy zmianie pracy.
- **Mieszkanie.** 5 fikcyjnych ofert najmu w Olsztynie (czynsz, opłaty eksploatacyjne, kaucja, koszt przeprowadzki, standard, powierzchnia, dzielnica). Podgląd warunków przed podpisaniem (kaucja, przeprowadzka, nakładanie umów, zwrot starej kaucji). Zmiana mieszkania aktualizuje przyszłe naliczenia (reguły wiązane z umową); podwójny czynsz tylko przy świadomym nakładaniu okresów. **Kaucja = aktywo** (majątek netto bez zmian), zwrot 14 dni po końcu umowy.
- **Budżet czasu.** Doba 24 h: praca, sen, obowiązki, rezerwa na działalność (v0.5+), kursy/zlecenia, czas wolny jako reszta; walidacja planu na rok do przodu (także przyszłe umowy). Zmęczenie 0–100 i wydajność w pracy.
- **Styl życia.** Oszczędny / standardowy / komfortowy zmieniają kwoty żywności, transportu i rozrywki (przez zobowiązania). **Wskaźnik jakości życia** (nie funkcja majątku; bezpieczeństwo finansowe 15% z sufitem).
- **Oszczędności.** Rachunek oszczędnościowy, przelewy własne (neutralne dla majątku netto i przepływów), odsetki nominalne kapitalizowane miesięcznie (jedno zaokrąglenie), podatek od odsetek jako osobna operacja (parametr przykładowy), historia operacji.
- **Wydarzenia życiowe (7).** Awaria sprzętu (3 opcje), niespodziewany wydatek, premia, propozycja awansu, utrata pracy, dorywcze zlecenie, kurs (+1 umiejętność). Zależne od stanu gry, deterministyczne, z identyfikatorami, historią, terminem decyzji i opcją domyślną; skutki nie wykonują się dwa razy; część wyników jest nieznana z góry.
- **UI:** nowa grupa „Życie” (Oferty pracy, Mieszkanie, Styl życia, Budżet czasu, Oszczędności, Decyzje i wydarzenia) z plakietką oczekujących decyzji, alert na pulpicie, oszczędności w HUD, komunikaty jako toasty, menu „Więcej” na telefonie.
- **Zapisy:** migracja v1 → v2 sprawdzona na **prawdziwym zapisie wygenerowanym przez v0.1** (`src/persistence/fixtures/`): historia finansowa nietknięta, brak zgadywania nieznanych danych, gra toczy się dalej bez dubli; zapis/odczyt zachowuje salda, kaucje, plan czasu, wydarzenia i kolejkę akcji.

## Czego NIE ma (poza zakresem lub niedokończone)

- Zweryfikowany kalkulator płac, podatki, ZUS (netto = **szacunek 73% brutto**, oznaczony w UI), JDG, spółki, branża remontowa, giełda, nieruchomości inwestycyjne, kredyty, backend, logowanie. **Wdrożenie na Vercel odłożone** zgodnie z poleceniem (repo nadal nie jest podpięte do żadnego projektu Vercel; kod jest na `main`).
- **Wszystkie parametry są przykładowe**: płace, czynsze, kaucje, koszty stylu życia, stopa i podatek od odsetek, prawdopodobieństwa i kwoty wydarzeń, wagi jakości życia.
- Katalogi ofert pracy i mieszkań są **stałe** (brak odświeżania, rynku, negocjacji). Inne formy zatrudnienia, wypowiedzenie umowy najmu bez nowej umowy, wycofanie aplikacji i anulowanie podpisanej umowy — niezaimplementowane.

## Wykonane testy (2026-10-18)

| Polecenie | Wynik |
|---|---|
| `npm run typecheck` | ✅ bez błędów |
| `npm test` (Vitest) | ✅ **126/126**: kalendarz 8, pieniądze/RNG/formatowanie 8, silnik bazowy 34, **mechaniki v0.2 51**, zapis i repozytoria 14, **migracja i zapis v2 11** |
| `npm run build` | ✅ JS 486 kB / 144 kB gzip, CSS 42 kB / 7 kB gzip |
| `npm run test:e2e` (Chromium) | ✅ **10/10** (4 z v0.1 + 6 nowych: praca, mieszkanie z kaucją, styl życia i budżet czasu, oszczędności, decyzja z wydarzenia, zapis stanu v2) |

Pomiary (Node 22, gra z włączonymi wydarzeniami): symulacja 120 miesięcy ≈ 0,85 s, jeden miesiąc na stanie po 10 latach ≈ 13 ms; zapis po 10 latach ≈ 1,2 MB, serializacja ≈ 10 ms, wczytanie z walidacją ≈ 50 ms.
Wygląd nowych ekranów sprawdzony ręcznie na zrzutach (desktop 1360 px; menu mobilne 390 px); układ mobilny większości nowych ekranów nie ma testu automatycznego.

**Kryterium ukończenia v0.2** (12 miesięcy aktywnego zarządzania pracą, mieszkaniem, czasem i oszczędnościami z poprawnym śladem w stanie i finansach) jest pokryte testem `ciągłość 12 miesięcy aktywnego zarządzania` (niezmienniki sprawdzane co miesiąc; w tym scenariuszu wystąpiła m.in. utrata pracy, przeprowadzka, 12 przelewów i 11 księgowań odsetek) oraz testami poszczególnych komend.

## Znane problemy i uproszczenia

1. **Bierna gra jest karana.** Z włączonymi wydarzeniami samo przewijanie czasu przez lata kończy się utratą pracy (prawdopodobna już po ok. 90 dniach stażu) i zaległościami — brak zasiłku, odprawy i pomocy w poszukiwaniu pracy. Prawdopodobieństwa nie były kalibrowane na danych z rozgrywek.
2. **Staż liczony od początku bieżącej umowy** — awans tworzy nową umowę, więc zeruje staż (wpływa na kwalifikowanie do premii i awansu).
3. Pierwsza przeprowadzka nie zwraca kaucji (mieszkanie startowe jest bez kaucji — parametr przykładowy); zwrot kaucji zawsze pełny, bez potrąceń.
4. Przeprowadzki tylko na 1. dzień miesiąca, bez proporcjonalnych czynszów i kar za wcześniejsze rozwiązanie.
5. Dzień roboczy = pon–pt, bez świąt i urlopów; „działalność” w budżecie czasu tylko zajmuje godziny (nie ma jeszcze działalności).
6. Umiejętności rosną wyłącznie przez kursy (brak nauki w pracy).
7. Odsetki liczone od salda na początek dnia: przelew wykonany dziś liczy się od jutra.
8. Autozapis jest asynchroniczny (zamknięcie karty tuż po akcji może zgubić ostatni zapis); zapis rośnie ≈ 0,12 MB/rok (dzienna historia majątku) — kompaktowanie historii to przyszła decyzja.
9. Potwierdzenia (nowa gra, nadpisanie, wczytanie, rezygnacja, umowa najmu) używają `window.confirm`; brak routera i głębokich linków (ADR-012).
10. Testy e2e wymagają bibliotek systemowych Chromium (`AGENTS.md` §5, ADR-013).

## Następne zadanie (propozycja — wymaga zatwierdzenia)

**v0.3 — Model podatkowy i ZUS (wersjonowany datami):** zamiana szacunku 73% na zweryfikowany kalkulator brutto → netto, tabele przepisów z datami obowiązywania i źródłami, roczne rozliczenie. **Warunek wejścia:** zatwierdzony, zweryfikowany zestaw źródeł prawnych na 2026 (do tego czasu placeholdery). Szczegóły: `IMPLEMENTATION_PLAN.md`.

Nie rozpoczynać v0.3 bez zatwierdzenia.
