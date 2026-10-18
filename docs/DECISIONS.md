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

---

# v0.2 — decyzje gracza i życie prywatne

## ADR-015 · Komendy gracza: czyste funkcje na kopii stanu, błąd walidacji bez efektów ubocznych — *Zaakceptowana*
**Decyzja:** wszystkie decyzje gracza przechodzą przez `commands.*` (`src/engine/commands.ts`). `runCommand` klonuje stan, wykonuje logikę, odświeża migawkę historii dnia i zwraca `{ok, state, message}` albo `{ok:false, error}` (`CommandError`). Stan wejściowy nigdy nie jest mutowany, a odrzucona komenda nie zostawia śladów.
**Konsekwencje:** UI nie liczy niczego sam; testy komend są proste (stan wejściowy vs wyjściowy). Komendy działają „dziś” — dzień jest już zamknięty, więc nowe zobowiązania rozliczą się najwcześniej następnego dnia.

## ADR-016 · Akcje zaplanowane (`pending`) zamiast zdarzeń w przyszłości — *Zaakceptowana*
**Decyzja:** skutki w przyszłości (decyzja pracodawcy, wygaśnięcie propozycji, zwrot kaucji, koszt przeprowadzki, wypłata za zlecenie, +1 umiejętność, termin decyzji) są jednorazowymi akcjami w `state.pending`, wykonywanymi na początku `processDay` w kolejności (data, id), idempotentnie (`processed`). Dziennik zdarzeń zawiera wyłącznie to, co już się stało.
**Konsekwencje:** brak „przyszłych” wpisów w dzienniku; zapis zawiera kolejkę, więc wczytanie nie gubi ani nie dubluje skutków.

## ADR-017 · Kaucja jest aktywem, nie kosztem — *Zaakceptowana*
**Decyzja:** wpłata kaucji = transakcja gotówkowa + `Asset` (`held`); zwrot po wyprowadzce (14 dni po końcu umowy) = transakcja + status `refunded`. Aktywo wlicza się do majątku netto. Tożsamość księgowa pozostaje: majątek netto (rachunki + kaucje + należności − zobowiązania) = kapitał początkowy + przychody − koszty, bo kaucje nie są zobowiązaniami P&L. Kategorie `kaucja`, `zwrot_kaucji`, `przelew_wlasny` są poza przepływami miesięcznymi.
**Konsekwencje:** pełny zwrot (bez potrąceń za szkody) — uproszczenie v0.2. Mieszkanie startowe jest bez kaucji (parametr przykładowy), więc nie ma zwrotu przy pierwszej przeprowadzce.

## ADR-018 · Zmiana mieszkania: przyszłe naliczenia z reguł wiązanych z umową; nakładanie świadome, bezdomność niemożliwa — *Zaakceptowana*
**Decyzja:** każda umowa najmu ma własne reguły czynszu i opłat (`rule.contractId`); koniec umowy ustawia `endDate` reguł (niezmiennik: reguła kończy się razem z umową). Przeprowadzka tylko na 1. dzień miesiąca, od najbliższego do dnia po wygaśnięciu obecnej umowy (wypowiedzenie = ostatni dzień miesiąca po okresie wypowiedzenia). Wcześniejsza data = nakładanie się umów (podwójny czynsz, pokazany w podglądzie); późniejszej nie ma. Umowy o pracę nie mogą się nakładać (jedna praca naraz).
**Konsekwencje:** brak naliczania dwóch czynszów poza jawnym nakładaniem; brak proporcjonalnych czynszów za część miesiąca.

## ADR-019 · Jedna mechanika wynagrodzeń; netto to oznaczony szacunek — *Zaakceptowana*
**Decyzja:** zmiana pracy, awans i utrata pracy działają przez `Contract(employment)` + `rule:salary:<contractId>` — ta sama reguła naliczenia ostatniego dnia miesiąca i wypłaty 10. następnego co w v0.1; brak drugiego systemu pensji. Oferta ma brutto; netto = `estimateNet` (73% brutto, `NET_ESTIMATE_BPS`, placeholder) i jest tak opisane w UI. Zapisy v1 mają `grossMonthly: null` (brak danych nie jest zgadywany).
**Konsekwencje:** do v0.3 (zweryfikowany kalkulator płac) żadna liczba netto nie jest wyliczeniem prawnym.

## ADR-020 · Budżet czasu, zmęczenie i wydajność — *Zaakceptowana*
**Decyzja:** doba = praca + sen + obowiązki + działalność (rezerwa) + zobowiązania czasowe + czas wolny (reszta). Każda zmiana (plan dnia, nowa praca, kurs, zlecenie) jest walidowana na rok do przodu, uwzględniając podpisane przyszłe umowy — nie można przeznaczyć tych samych godzin na dwie rzeczy. Zmęczenie (0–100) zmienia się o całkowitą deltę dzienną z budżetu godzin (wzory w `ECONOMY_ENGINE.md`); wydajność = 100% − 0,7 p.p. za każdy punkt zmęczenia powyżej 30. Wydajność wpływa na premię, awans, ryzyko utraty pracy i szansę w rekrutacji — nie na pensję bezpośrednio.
**Konsekwencje:** brak rozbudowanego systemu zdrowia; święta i urlopy nieuwzględnione (dzień roboczy = pon–pt).

## ADR-021 · Jakość życia nie jest funkcją majątku — *Zaakceptowana*
**Decyzja:** wskaźnik 0–100 = styl życia 25% + standard mieszkania 20% + czas na odpoczynek 20% + kondycja (100 − zmęczenie) 20% + bezpieczeństwo finansowe 15%. Bezpieczeństwo ma sufit (bufor ≥ 3 miesiące kosztów = 100) i kary za zaległości i bezrobocie.
**Konsekwencje:** pieniądze pomagają tylko pośrednio (wybór stylu życia/mieszkania, bufor); wagi i progi są parametrami do kalibracji.

## ADR-022 · Oszczędności: odsetki z sumy sald dziennych, jedno zaokrąglenie, odrębne operacje — *Zaakceptowana*
**Decyzja:** codziennie saldo na początek dnia jest dodawane do akumulatora (grosze·dni); ostatniego dnia miesiąca odsetki = `round(akumulator × stawka_bps / (10 000 × 365))` (jedno zaokrąglenie, brak dryfu), księgowane jako należność na rachunku oszczędnościowym; podatek od odsetek to osobne zobowiązanie (`taxBps`, 0 = brak). Stawki to konfigurowalne parametry (`dataStatus: placeholder`), nie fakty prawne. Przelew własny to dwa wpisy o sumie zero z wspólnym `transferId`, poza przepływami miesięcznymi i bez wpływu na majątek netto.
**Konsekwencje:** zobowiązania i należności mają teraz `accountId` (rozliczenie z właściwego rachunku); invariants sprawdzają saldo każdego rachunku i pary przelewów.

## ADR-023 · Wydarzenia życiowe: katalog z losowaniem miesięcznym, decyzje z domyślnym wygaśnięciem — *Zaakceptowana*
**Decyzja:** 7 szablonów (awaria sprzętu, niespodziewany wydatek, premia, awans, utrata pracy, dorywcze zlecenie, kurs). W `rollDay` każdego miesiąca losowane jest wystąpienie z prawdopodobieństwem zależnym od stanu (umowa, staż, wydajność, czas wolny, gotówka). Losowanie i wynik mają osobne strumienie z (seed, id wydarzenia[, opcja]), więc wynik decyzji nie zależy od momentu jej podjęcia. Decyzje mają termin; po jego upływie stosowana jest opcja domyślna. Skutki liczy ten sam silnik zobowiązań/umów; status wydarzenia i `processed` chronią przed podwójnym zastosowaniem. Opcja `settings.lifeEvents` (domyślnie włączona) pozwala testom mechaniki bazowej wyłączyć losowość.
**Konsekwencje:** zmiana id szablonu/strumienia zmienia historię seedów; kalibracja częstości wymaga danych z rozgrywek.

## ADR-024 · Migracja zapisu v1 → v2 z zamrożonymi wartościami domyślnymi — *Zaakceptowana*
**Decyzja:** `migrateV1ToV2` (`src/persistence/migrations.ts`) nie zmienia historii finansowej, dodaje nowe struktury z zamrożonymi stałymi (nie importuje `config.ts`), nie zgaduje nieznanych danych (`grossMonthly`, standard i powierzchnia lokalu → `null`), przenosi opłaty z reguły „media” do umowy najmu, a wydatki stylu życia mapuje tak, że „standardowy” = kwoty z v1. Test używa **prawdziwego zapisu wygenerowanego przez v0.1** (`fixtures/save-v1.json`).
**Konsekwencje:** zapisy v1 działają dalej bez resetu; kolejne migracje dopisujemy w `MIGRATIONS`, fixture’ów nie usuwamy.
