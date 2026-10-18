# PROJECT_STATUS — stan projektu

> Aktualizuj po każdym zadaniu. Opisuje **stan faktyczny**, nie plany. Ostatnia aktualizacja: 2026-10-18.

## Wersja

**v0.1.0 — Fundament ekonomii** (zakończona; kolejna wersja czeka na zatwierdzenie).

## Co działa (zweryfikowane)

- **Nowa gra:** imię i nazwisko (walidowane), seed (domyślnie losowy, można wpisać własny), wiek startowy 22 lata, Olsztyn, 1 stycznia 2026, 5 000 zł.
- **Czas:** „Następny dzień” i „Do następnego miesiąca” (zawsze na 1. dzień kolejnego miesiąca); każdy dzień jest przetwarzany po kolei; poprawne lata przestępne i granice miesięcy/lat.
- **Życie prywatne i finanse:** etat (należność naliczana ostatniego dnia miesiąca, wpływ 10. następnego), wynajem (czynsz naliczany 1., płatny 10.), koszty życia (media, telefon/internet, żywność, transport, rozrywka ±15% losowo z seeda), urodziny.
- **Księgowanie:** rejestr transakcji, zobowiązania i należności z terminami, automatyczne płatności bez debetu, zaległości (ostrzeżenie + ponawianie), majątek netto, miesięczne podsumowania (memoriałowo i gotówkowo), struktura kosztów.
- **Niezmienniki** finansowe sprawdzane w testach co miesiąc symulacji i przy każdym wczytaniu zapisu.
- **Interfejs (6 ekranów):** Pulpit (karty wskaźników, wykres majątku/gotówki z zakresami, bieżący miesiąc, słupki przychody/koszty, najbliższe płatności, ostatnie zdarzenia, alert o zaległościach), Postać, Finanse (podsumowanie miesiąca + donut, zobowiązania, rejestr z saldem po transakcji), Kalendarz (przeszłość z dziennika + projekcja przyszłości), Historia zdarzeń (filtry), Nowa gra / Wczytaj. Pasek HUD z datą, gotówką, majątkiem i sterowaniem czasem. Układ desktop + telefon (bez poziomego przewijania).
- **Zapis:** 3 sloty ręczne + autozapis (IndexedDB), wczytanie, usuwanie, wersjonowanie formatu (`SAVE_VERSION = 1`), walidacja Zod + niezmienniki; odrzuca uszkodzone, zmanipulowane i nowsze zapisy; fallback do pamięci przy niedostępnym IndexedDB (z ostrzeżeniem).
- **Dokumentacja:** `AGENTS.md`, `README.md`, `docs/` (GAME_DESIGN, WORLD_MODEL, ECONOMY_ENGINE, IMPLEMENTATION_PLAN, ARCHITECTURE, DECISIONS, PROJECT_STATUS).

## Czego NIE ma (świadomie poza zakresem v0.1)

- **Brak decyzji gracza** — gracz może tylko przesuwać czas i oglądać skutki. To fundament ekonomii, **nie jeszcze pełna gra**.
- Podatki, składki ZUS, PIT (kwoty są netto), JDG, spółki, pracownicy, kredyty, leasing, odsetki, giełda, nieruchomości, branża remontowa, gospodarstwo domowe wieloosobowe, rynki regionalne i konkurenci.
- Backend, konta użytkowników, synchronizacja zapisów między urządzeniami.
- **Wszystkie parametry ekonomiczne są przykładowe** (pensja 4 600 zł netto, czynsz 1 700 zł, koszty życia…) — niezweryfikowane z danymi rzeczywistymi; w UI oznaczone „przykładowe”.

## Wykonane testy (2026-10-18)

| Polecenie | Wynik |
|---|---|
| `npm run typecheck` | ✅ bez błędów |
| `npm test` (Vitest) | ✅ **64/64**: kalendarz 8, pieniądze/RNG/formatowanie 8, silnik 34, zapis i repozytoria 14 |
| `npm run build` | ✅ `dist/` ≈ 440 kB (JS 391 kB / 117 kB gzip, CSS 39 kB / 7 kB gzip) |
| `npm run test:e2e` (Playwright, Chromium) | ✅ **4/4**: walidacja formularza; nowa gra + upływ czasu + spójność kwot; wszystkie ekrany + kalendarz; zapis ręczny i autozapis po przeładowaniu |
| `npm run dev` | ✅ serwer startuje i serwuje aplikację |

Pokrycie wymagań z specyfikacji (§7): upływ czasu, wynagrodzenia, koszty utrzymania, saldo, brak podwójnego księgowania, majątek netto, powtarzalność seeda, zapis/odczyt, symulacje 12 i 120 miesięcy (niezmienniki co miesiąc) — wszystko pokryte testami zachowania (mapa w `ECONOMY_ENGINE.md` §9).

Pomiary: symulacja 120 miesięcy ≈ 0,9 s; zapis po 10 latach ≈ 1,4 MB, serializacja ≈ 50 ms, wczytanie z walidacją ≈ 70 ms.
Wygląd ekranów sprawdzony ręcznie na zrzutach (desktop 1360 px, telefon 390 px); układ mobilny nie ma testu automatycznego.

## Wdrożenie (Vercel)

- Repozytorium `Wielop1/polish-game`, gałąź `main`, połączone z Vercel. Konfiguracja: `vercel.json` (framework vite, `dist`, fallback SPA). Brak sekretów i zmiennych środowiskowych.
- Lokalnie: `npm run build` ✅, podgląd (`vite preview`) obsługuje e2e ✅.
- Wynik wdrożenia na Vercel: patrz sekcja „Wdrożenie — wynik” poniżej (uzupełniana po pushu).

## Znane problemy i uproszczenia

1. **Wykres majątku netto ma „piłę”** — pensja jest uznawana jako przychód ostatniego dnia miesiąca (ADR-006/007), więc majątek skacze o pensję 31. i spada przez miesiąc wraz z naliczaniem kosztów. To wynik przyjętego modelu, nie błąd; do rewizji (naliczanie dzienne) w v0.2+.
2. **Autozapis jest asynchroniczny** — zamknięcie karty tuż po przesunięciu czasu może zgubić ostatni autozapis (poprzedni pozostaje).
3. Zobowiązania opłacane „od najstarszego terminu, każde niezależnie” — mniejsze późniejsze może być opłacone przed większym starszym (ADR-008).
4. Rozmiar zapisu rośnie liniowo (dzienna historia majątku ≈ 3,6 tys. punktów / 10 lat); kompaktowanie historii — przyszła decyzja.
5. Potwierdzenia (nowa gra / nadpisanie / wczytanie) używają `window.confirm` — tymczasowe, do zastąpienia własnym oknem dialogowym.
6. Brak routera i głębokich linków (ADR-012). Brak ESLint/formatera i testów komponentów (jest typecheck + e2e).
7. Testy e2e wymagają bibliotek systemowych Chromium; w środowisku bez roota patrz `AGENTS.md` §5 i ADR-013.

## Następne zadanie (propozycja — wymaga zatwierdzenia)

**v0.2 — Decyzje gracza i życie prywatne:** warstwa komend gracza w silniku (zmiana mieszkania, zmiana pracy, styl życia), zdarzenia losowe życia na seedowanym RNG, drugi rachunek (oszczędności) z przelewami własnymi, migracja zapisu v1 → v2. Szczegóły i kryteria: `IMPLEMENTATION_PLAN.md`.

Nie rozpoczynać v0.2 bez zatwierdzenia.
