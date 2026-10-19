# ARCHITECTURE — architektura techniczna

## 1. Stos

| Warstwa | Technologia (wersje z `package.json`) |
|---|---|
| Język | TypeScript 7 (`strict`, `noUncheckedIndexedAccess`) |
| UI | React 19, Tailwind CSS 4 (`@tailwindcss/vite`), własne komponenty SVG (wykresy) |
| Build | Vite 8 |
| Stan aplikacji | Zustand 5 |
| Walidacja | Zod 4 (jedno źródło prawdy: schematy ⇒ typy `z.infer`) |
| Zapis lokalny | IndexedDB (własna cienka warstwa, bez zależności) |
| Testy | Vitest 5 (jednostkowe), Playwright (e2e), fake-indexeddb (testy repozytorium) |
| Wdrożenie | Vercel, statyczny frontend (`dist/`), SPA |

Brak backendu, bazy zewnętrznej, logowania, płatnych API, generatywnego AI. Patrz `AGENTS.md` §3 — dodatki wymagają zatwierdzenia.

## 2. Moduły i zależności

```
          ┌─────────────────────────────────────────────┐
          │ src/ui  (React: ekrany, komponenty, SVG)    │
          └──────────────┬──────────────────────────────┘
                         │ czyta stan, wywołuje akcje
          ┌──────────────▼──────────────┐      ┌──────────────────────────┐
          │ src/store (Zustand)         │─────►│ src/persistence          │
          │ gameStore: game, screen,    │      │ save.ts  (koperta, zod,  │
          │ saves, notice, akcje        │      │   migracje, niezmienniki)│
          └──────────────┬──────────────┘      │ repository.ts (IndexedDB,│
                         │                     │   pamięć)                │
                         │                     │ service.ts (save/load)   │
                         │                     └──────────┬───────────────┘
          ┌──────────────▼─────────────────────────────────▼──┐
          │ src/engine  — czysty silnik (zero zależności)      │
          │ state · date · money · rng · config · categories   │
          │ newGame · simulate · schedule · selectors          │
          │ invariants                                         │
          └────────────────────────────────────────────────────┘
```

**Reguła zależności:** `engine` nie importuje niczego z `persistence`, `store` ani `ui` (poza `zod`). `persistence` zależy tylko od `engine`. `store` łączy je. `ui` zależy od `store` i `engine` (selektory/formatowanie), **nie** od `persistence` poza typami/stałymi slotów.

### Pliki silnika

| Plik | Odpowiedzialność |
|---|---|
| `state.ts` | Schematy Zod i typy: `GameState`, `Person`, `Account`, `Contract`, `Rule`, `Obligation`, `LedgerEntry`, `GameEvent`, … |
| `money.ts` | Grosze, `zl`, `mulBps`, `roundDiv`, `formatPLN` |
| `date.ts` | Kalendarz ISO, arytmetyka dni/miesięcy, nazwy polskie, wiek |
| `rng.ts` | `createRng(seed, streamId)`, `randomSeed` (tylko UI) |
| `config.ts` | Parametry startowe v0.1 (**przykładowe**), miasta |
| `categories.ts` | Kategorie transakcji (etykiety, kolory) |
| `newGame.ts` | `createNewGame`, walidacja postaci, umowy i reguły startowe, rachunek oszczędnościowy |
| `core.ts` | Wspólne prymitywy: `postTransaction` (dowolny rachunek), `createObligation`, `recordHistory`, `CommandError` |
| `commands.ts` | **Komendy gracza** (`commands.*`, `runCommand`) — jedyne wejście decyzji do silnika |
| `jobs.ts` · `housing.ts` · `savings.ts` | Kariera (aplikacje, umowy, rezygnacja, awans), najem (podgląd, umowa, kaucja), przelewy i odsetki |
| `time.ts` | Budżet czasu, zmęczenie, wydajność, walidacja planu |
| `lifeEvents.ts` · `pending.ts` | Katalog wydarzeń życiowych (losowanie, decyzje, wygaśnięcie); wykonywanie akcji zaplanowanych |
| `contracts.ts` | Pomocnicze zapytania o umowy (aktualna praca/najem, status zatrudnienia, staż w firmie i na stanowisku) |
| `labor.ts` | Klimat gospodarczy i kondycja pracodawcy; ryzyko zwolnienia z czynników |
| `legal.ts` | **Rejestr reguł prawnych** (`LEGAL_RULES`: źródła, statusy) i wartości 2026 (`RULES_2026`) |
| `tax.ts` | Czyste kalkulatory ZUS, składki zdrowotnej, PIT, limitu VAT (grosze) |
| `business.ts` · `businessCatalog.ts` | JDG: rejestracja, dokumenty (VAT), zlecenia, miesięczne i roczne rozliczenia; profile usługowe z PKD 2025 |
| `industry.ts` · `industries.ts` · `industryDefaults.ts` | **Interfejs modułów branżowych** (`IndustryModule`: `onRegister`, `processDay`, `gaps`) i rejestr; moduł działa na wspólnym silnikiem (dokumenty, zobowiązania, czas, rachunki) — nie liczy podatków i nie księguje na własną rękę |
| `renovation.ts` · `renovationCatalog.ts` | Moduł **remontów** (v0.5): zapytania, wyceny, negocjacje, kontrakt (`ServiceOrder kind: renovation` + `RenoJob`), materiały i zapas, sprzęt, realizacja, jakość, reklamacje, reputacja; katalog usług/materiałów/sprzętu (parametry symulacyjne) |
| `workforce.ts` · `teams.ts` · `subcontractors.ts` · `fleet.ts` · `profitability.ts` · `opsCommon.ts` | **Wspólny silnik firmy (v0.6)**: pracownicy, rekrutacja, umowy, listy płac i koszty pracodawcy; ekipy i kalendarz zasobów (przydziały); podwykonawcy B2B (oferta, przedpłata, odbiór, rozliczenie); pojazdy; rentowność i prognoza płynności; wspólne kontrole gotówki i zakupów |
| `market.ts` · `marketConfig.ts` · `macro.ts` · `renovationMarket.ts` · `marketAnalytics.ts` | **Rynek lokalny (v0.7), wspólna warstwa silnika**: popyt miasta, koniunktura miesięczna (`macroAt`, zakotwiczona w `economicClimate`), segmenty klientów, konkurenci, kanały marketingowe, pozycjonowanie firmy, alokacja klientów i rozstrzyganie konkurencji; branża przekazuje `MarketIndustry` (usługi, sezonowość, losowanie zlecenia) i `MarketHooks`; `marketConfig.ts` = cała konfiguracja (parametry kalibracyjne); `marketAnalytics.ts` = selektory dla UI i symulatora |
| `accounting.ts` | Księgowość: biuro rachunkowe (abonament jako dokument kosztowy, powiadomienia, automatyczny wniosek o zwrot, porównanie form z obliczeń silnika) |
| `operator.ts` · `company.ts` · `shares.ts` · `partners.ts` · `negotiation.ts` · `resolutions.ts` · `dividends.ts` · `cit.ts` · `companyFinance.ts` · `partnerAi.ts` · `corp.ts` · `corpConfig.ts` · `legalCorp.ts` · `corpInvariants.ts` | **Spółki z o.o. (v0.8)**: abstrakcja operatora i podmiana kontekstu (`withOperator`, `operatorView`), zakładanie/KRS/zarząd/reprezentacja, rejestr udziałów, pula wspólników AI, negocjacje i emisje, uchwały i głosowanie, dywidendy, CIT, bilans/wycena/kwota do podziału, inicjatywy postaci AI, dzienny orkiestrator (`processCorp`), stałe i reguły prawne, niezmienniki |
| `simulate.ts` | naliczenia z reguł, rozliczenia, zmęczenie, `processDay`, `advanceDays`, `advanceToNextMonth` |
| `schedule.ts` | Reguły dnia, termin płatności, urodziny, **projekcja** przyszłych zdarzeń (kalendarz, „najbliższe płatności”) |
| `selectors.ts` | `netWorthBreakdown`, `monthlySummaries`, zaległości, wiek |
| `invariants.ts` | `checkInvariants(state)` |

## 3. Interfejsy kluczowe

```ts
// Silnik (czysty)
createNewGame({ firstName, lastName, seed, lifeEvents? }): GameState  // rzuca ZodError przy złych danych
advanceDays(state, n): GameState                                  // nowy stan; wejście nietknięte
advanceToNextMonth(state): GameState
checkInvariants(state): string[]                                  // [] = spójny
scheduledItems(state, from, to): ScheduledItem[]                  // projekcja, nic nie księguje
commands.applyForJob | respondToJobOffer | resignFromJob | signLease | setLifestyle
        | setTimePlan | transferFunds | resolveLifeEvent
        | registerBusiness | closeBusiness | acceptServiceOffer | declineServiceOffer  (state, …) → { ok, state, message } | { ok:false, error }

// Zapis
serializeSave(state, savedAt): string                             // odmawia niespójnego stanu
parseSave(json): { ok: true, state, meta, savedAt } | { ok: false, error }
interface SaveRepository { list(); get(slot); put(slot, json, savedAt, meta); remove(slot) }
```

## 4. Przechowywanie stanu

- **Źródło prawdy gry:** jeden obiekt `GameState` (JSON-owalny: bez klas, funkcji, `Date`, `Map`/`Set`). W Zustand trzymany jako **niezmienna migawka** (`game`); każda akcja czasu podmienia go nowym stanem z silnika.
- **Stan UI** (aktualny ekran, komunikaty, lista zapisów) jest osobno, poza `GameState` i poza zapisem.
- Selektory pochodne (`netWorthBreakdown`, `monthlySummaries`, projekcja) liczone w render z `useMemo`; nie są przechowywane.
- `GameState` zawiera m.in.: `seed`, `clock`, `person`, `parties`, `accounts`, `contracts`, `rules`, `ledger`, `obligations`, `events`, `processed`, `history`, `openingCash`.

## 5. Zapis rozgrywki

- **Magazyn:** IndexedDB (baza `polski-tycoon`, store `saves`, klucz `slot`). Rekord: `{slot, savedAt, meta, json}`. Sloty: `autosave`, `slot-1`, `slot-2`, `slot-3`. Gdy IndexedDB jest niedostępne, store przełącza się na magazyn w pamięci i UI pokazuje ostrzeżenie.
- **Koperta zapisu (JSON):** `{ format: "polski-tycoon-save", version, savedAt, meta, state }`.
- **Wersjonowanie:** `SAVE_VERSION = 8` (migracje v1 → … → v8 w `src/persistence/migrations.ts`, ADR-024/031/039/046/054/060/071). Zmiana kształtu `GameState` ⇒ `SAVE_VERSION + 1` + `MIGRATIONS[n]` (stan v n → n+1). Zapis z nowszej wersji jest odrzucany z czytelnym komunikatem.
- **Walidacja przy wczytaniu** (`parseSave`): poprawny JSON → koperta → migracje → **schemat Zod całego stanu** → **`checkInvariants`**. Dopiero wtedy stan trafia do gry. Błąd = komunikat w UI, bieżąca gra nietknięta.
- **Walidacja przy zapisie** (`serializeSave`): odmowa zapisu stanu naruszającego niezmienniki.
- **Autozapis:** po każdym przesunięciu czasu i po starcie nowej gry (asynchroniczny, bez blokowania UI; błąd → komunikat).
- Brak stanu RNG w zapisie (patrz `ECONOMY_ENGINE.md` §6).

## 6. UI

- Brak routera: aktualny ekran to pole `screen` w store (SPA bez adresów podstron). `vercel.json` ma mimo to fallback na `index.html` pod przyszły routing.
- Ekrany: Pulpit, Postać, Finanse, Kalendarz, Historia zdarzeń; od v0.2 grupa „Życie” (Oferty pracy, Mieszkanie, Styl życia, Budżet czasu, Oszczędności, Decyzje i wydarzenia z plakietką) oraz grupa **„Firma (JDG)”** (Rejestracja JDG, Moja działalność, Oferty i kontrakty, Finanse firmy, Podatki i ZUS, Dokumenty, Kalendarz obowiązków; wszystkie z banerem „Symulacja — nie porada prawna/podatkowa”); Nowa gra/Wczytaj. Na telefonie dolny pasek ma 3 skróty + „Więcej”. Komunikaty to toasty (prawy dolny róg). Pasek HUD (data, gotówka, majątek, sterowanie czasem) nad każdym ekranem gry; nawigacja boczna (desktop) / dolna (telefon).
- Wykresy: własne komponenty SVG (`LineChart`, `BarChart`, `Donut`, `ProgressBar`) — bez biblioteki wykresów.
- Wartości przykładowe oznaczone badge „przykładowe”.
- Dostępność: role/aria dla grup przycisków, wykresów (`role="img"` + `aria-label`), komunikatów (`role="alert"`), `prefers-reduced-motion`.

## 7. Build i wdrożenie

- `npm run build` = `tsc -b && vite build` ⇒ `dist/` (statyczny).
- `vercel.json`: `framework: vite`, `buildCommand`, `outputDirectory: dist`, rewrite `/(.*) → /index.html` (system plików ma pierwszeństwo, więc zasoby statyczne działają).
- Brak zmiennych środowiskowych i sekretów.

### Narzędzia developerskie (`tools/`)

`tools/balance/` — symulator balansu (`npm run balance`, ADR-061): `bot.ts` (strategie i bot gracza grający przez `commands.*`), `port.ts` (warstwa zależna od wersji modelu rynku), `worker.ts` + `cli.ts` (wątki robocze, parametry `--years --runs --policies --capital --quick --trace`), `report.ts` (agregacja, podsumowanie). Typy sprawdza `tsconfig.tools.json` (w `tsc -b`), testy w `tools/**/*.test.ts` (Vitest).

## 8. Strategia testowania

| Poziom | Narzędzie | Zakres |
|---|---|---|
| Silnik | Vitest | czas, pieniądze, wynagrodzenia, koszty, saldo, majątek netto, brak podwójnego księgowania, seed, 12/120 miesięcy, zaległości, projekcja |
| Zapis | Vitest + fake-indexeddb | round-trip, odporność na uszkodzenia/manipulacje, wersje, repozytoria |
| UI/e2e | Playwright (Chromium) | walidacja formularza, nowa gra, upływ czasu, spójność kwot, nawigacja, kalendarz, zapis/wczytanie; v0.2: aplikacja o pracę, kaucja i umowa najmu, styl życia, walidacja 24 h, przelew, decyzja z wydarzenia, zapis stanu v2 |

Szczegóły i mapa testów silnika: `ECONOMY_ENGINE.md` §9. Wymagane komendy: `AGENTS.md` §4.
