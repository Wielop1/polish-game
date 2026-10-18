# DECISIONS — dziennik decyzji architektonicznych

Format: **ID · tytuł** — status — kontekst — decyzja — konsekwencje. Nowe decyzje dopisuj na końcu. Nie zmieniaj treści zaakceptowanych decyzji — dodaj nową, która je zastępuje (i oznacz starą jako *Zastąpiona przez ADR-xxx*).
Statusy: *Zaakceptowana* · *Proponowana* (czeka na zatwierdzenie) · *Zastąpiona*.

---

## ADR-001 · Aplikacja SPA: Vite + React + TypeScript, statyczny build — *Zaakceptowana* (specyfikacja startowa)
**Kontekst:** gra ma działać w przeglądarce i być wdrażana przez Vercel; na start bez backendu.
**Decyzja:** Vite + React 19 + TypeScript (strict) + Tailwind 4 + Zustand + Zod + Vitest + Playwright. Bez Next.js, Supabase, n8n, logowania, multiplayera, płatnych API, generatywnego AI w grze.
**Konsekwencje:** prosty, szybki build statyczny; wszystko po stronie klienta; dodanie backendu lub SSR wymaga nowej decyzji i zatwierdzenia.

## ADR-002 · Pieniądze jako całkowite grosze — *Zaakceptowana*
**Kontekst:** błędy zmiennoprzecinkowe niszczą spójność finansową (`0.1 + 0.2`).
**Decyzja:** `Grosze = number` (safe integer), `assertGrosze`, ułamki przez `mulBps/roundDiv`; `Intl` tylko do wyświetlania. Zod odrzuca nie-całkowite kwoty w zapisie.
**Konsekwencje:** zakres ±9·10¹⁵ groszy (≈ 90 bln zł) — wystarcza; zamiast `BigInt` zachowujemy prostotę i serializację JSON. Zmiana na `BigInt` wymagałaby migracji zapisu.

## ADR-003 · Silnik czysty, deterministyczny, oddzielony od UI — *Zaakceptowana*
**Decyzja:** `src/engine` bez I/O, DOM, zegara i `Math.random`; zależy tylko od `zod`. UI i store wywołują funkcje silnika. `advanceDays` klonuje stan raz (`structuredClone`) i zwraca nowy stan.
**Konsekwencje:** pełna testowalność w Node, łatwe przyszłe przeniesienie silnika do workera/serwera; koszt: klon stanu przy każdej akcji czasu. Pomiar (2026-10-18, Node 22): 120 miesięcy ≈ 0,9 s łącznie; jeden miesiąc na stanie po 10 latach ≈ 14 ms.

## ADR-004 · Daty jako napisy ISO bez `Date` — *Zaakceptowana*
**Decyzja:** `IsoDate = "YYYY-MM-DD"`, własna arytmetyka na numerze dnia. **Konsekwencje:** brak problemów ze strefami czasowymi/DST i niedeterminizmem; własny kod kalendarza ma testy odwracalności 1900–2200.

## ADR-005 · Losowość wyprowadzana z (seed, id zdarzenia) — *Zaakceptowana*
**Kontekst:** powtarzalność i brak konieczności zapisywania stanu generatora.
**Decyzja:** `createRng(seed, streamId)` (xmur3 → mulberry32); każde losowanie ma własny strumień z id wystąpienia reguły.
**Konsekwencje:** wynik nie zależy od kolejności losowań ani od przeskoku/zapisu; nie nadaje się do kryptografii (nie jest potrzebne); nowe losowe mechaniki muszą mieć stabilne id strumienia — zmiana id zmienia historię seedów.

## ADR-006 · Model naliczenie → rozliczenie (zobowiązania i należności) — *Zaakceptowana*
**Kontekst:** wymóg: przychód ≠ wpływ gotówki; koszt ≠ wypływ tego samego dnia; zobowiązania mają wierzyciela, dłużnika, kwotę i termin.
**Decyzja:** każdy przychód/koszt cykliczny to `Obligation`; gotówka rusza przy rozliczeniu w terminie. Rejestr transakcji jest jedyną drogą zmiany salda.
**Konsekwencje:** majątek netto uwzględnia należności i zobowiązania; tożsamość księgowa jest sprawdzalna; wykresy majątku mają „piłę” (pensja uznawana ostatniego dnia miesiąca) — świadome uproszczenie (alternatywa: naliczanie dzienne, do rozważenia w v0.2+).

## ADR-007 · Pensja: naliczenie ostatniego dnia miesiąca, wypłata 10. następnego — *Zaakceptowana (parametr przykładowy)*
**Decyzja:** zgodnie z modelem ADR-006; dni i kwoty to placeholdery w `config.ts`. **Konsekwencje:** pierwsza pensja wpływa 10.02.2026 — styczeń jest „chudy” (5 000 zł startu musi wystarczyć), co daje wczesne napięcie płynności bez żadnego skryptu.

## ADR-008 · Automatyczne płatności, brak debetu, brak płatności częściowych (v0.1) — *Zaakceptowana*
**Decyzja:** zobowiązania są regulowane automatycznie w terminie, w całości lub wcale; saldo nie spada poniżej 0; brak środków ⇒ `overdueSince` + jedno zdarzenie ostrzegawcze; ponawianie codziennie.
**Konsekwencje:** prosty i przewidywalny model; brak odsetek/windykacji (v0.4). Znane uproszczenie: kolejność „od najstarszego terminu”, każde zobowiązanie próbowane niezależnie.

## ADR-009 · Parametry startowe kopiowane do stanu, oznaczone `placeholder` — *Zaakceptowana*
**Kontekst:** wymóg: nie wymyślać obowiązujących wartości; zapisy muszą być stabilne.
**Decyzja:** `config.ts` tworzy umowy i reguły w `createNewGame`; od tej pory żyją w stanie z `dataStatus: 'placeholder'`; UI pokazuje „przykładowe”. Prawo/podatki — docelowo tabele z datami obowiązywania (v0.3).
**Konsekwencje:** zmiana `config.ts` nie rusza istniejących zapisów; zweryfikowane wartości będą wymagały źródła i zmiany `dataStatus`.

## ADR-010 · Zapis: koperta JSON w IndexedDB + walidacja Zod + niezmienniki + migracje — *Zaakceptowana*
**Decyzja:** koperta `{format, version, savedAt, meta, state}`; `SAVE_VERSION = 1`; `MIGRATIONS[n]`; wczytanie = parse → migracje → schemat Zod → `checkInvariants`; sloty `autosave` + 3 ręczne; autozapis po każdej akcji czasu; fallback do pamięci, gdy IndexedDB niedostępne.
**Konsekwencje:** zmanipulowany/uszkodzony zapis jest odrzucany z komunikatem; zapisy są lokalne (brak synchronizacji między urządzeniami); rozmiar zapisu rośnie z historią — pomiar: po 10 latach gry ≈ 1,4 MB JSON (3 653 punkty historii dziennej, 840 transakcji, 1 691 zdarzeń), serializacja ≈ 50 ms, wczytanie z walidacją ≈ 70 ms. Największy udział ma dzienna historia majątku; przy większych modelach rozważyć kompaktowanie (np. dzienne punkty tylko z ostatniego roku, starsze miesięczne) — wymagałoby nowej decyzji i migracji.

## ADR-011 · Własne wykresy SVG zamiast biblioteki — *Zaakceptowana*
**Decyzja:** `LineChart`, `BarChart`, `Donut`, `ProgressBar` w `src/ui/components/charts.tsx`. **Konsekwencje:** brak zależności i mały bundle (≈ 117 kB gzip całość); koszt: własne utrzymanie, brak zaawansowanych interakcji. Zmiana na bibliotekę — nowa decyzja.

## ADR-012 · Nawigacja bez routera (stan `screen`) + `vercel.json` z fallbackiem SPA — *Zaakceptowana*
**Decyzja:** ekran to pole w store; brak adresów podstron w v0.1. `vercel.json` zawiera rewrite `/(.*) → /index.html` (system plików ma pierwszeństwo) na wypadek przyszłego routingu. **Konsekwencje:** brak głębokich linków i przycisku „wstecz” między ekranami — do rewizji, gdy pojawi się potrzeba udostępniania/podstron.

## ADR-013 · Obsługa środowiska testów e2e bez roota — *Zaakceptowana*
**Kontekst:** w środowisku deweloperskim (WSL) brakowało bibliotek systemowych Chromium (`libnspr4`, `libnss3`, `libasound2`) i brak sudo.
**Decyzja:** biblioteki z `.deb` (`apt-get download`) rozpakowane lokalnie poza repozytorium + `LD_LIBRARY_PATH`; opis w `AGENTS.md` §5. **Konsekwencje:** `npm run test:e2e` wymaga działającego Chromium; w CI użyć `npx playwright install --with-deps`.

## ADR-014 · Wersja i zakres wzorców UI v0.1 — *Zaakceptowana*
**Decyzja:** ciemny interfejs „HUD”: pasek daty/gotówki/majątku + sterowanie czasem zawsze widoczne; nawigacja boczna (desktop) i dolna (telefon); karty wskaźników, wykresy, kalendarz miesięczny z projekcją przyszłych zdarzeń. **Konsekwencje:** UI nie zawiera logiki gospodarczej; wszystkie liczby pochodzą z silnika/selektorów.
