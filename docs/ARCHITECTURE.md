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
| `newGame.ts` | `createNewGame`, walidacja postaci, umowy i reguły startowe |
| `simulate.ts` | `postTransaction`, naliczenia, rozliczenia, `processDay`, `advanceDays`, `advanceToNextMonth` |
| `schedule.ts` | Reguły dnia, termin płatności, urodziny, **projekcja** przyszłych zdarzeń (kalendarz, „najbliższe płatności”) |
| `selectors.ts` | `netWorthBreakdown`, `monthlySummaries`, zaległości, wiek |
| `invariants.ts` | `checkInvariants(state)` |

## 3. Interfejsy kluczowe

```ts
// Silnik (czysty)
createNewGame({ firstName, lastName, seed }): GameState          // rzuca ZodError przy złych danych
advanceDays(state, n): GameState                                  // nowy stan; wejście nietknięte
advanceToNextMonth(state): GameState
checkInvariants(state): string[]                                  // [] = spójny
scheduledItems(state, from, to): ScheduledItem[]                  // projekcja, nic nie księguje

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
- **Wersjonowanie:** `SAVE_VERSION = 1`. Zmiana kształtu `GameState` ⇒ `SAVE_VERSION + 1` + `MIGRATIONS[n]` (stan v n → n+1). Zapis z nowszej wersji jest odrzucany z czytelnym komunikatem.
- **Walidacja przy wczytaniu** (`parseSave`): poprawny JSON → koperta → migracje → **schemat Zod całego stanu** → **`checkInvariants`**. Dopiero wtedy stan trafia do gry. Błąd = komunikat w UI, bieżąca gra nietknięta.
- **Walidacja przy zapisie** (`serializeSave`): odmowa zapisu stanu naruszającego niezmienniki.
- **Autozapis:** po każdym przesunięciu czasu i po starcie nowej gry (asynchroniczny, bez blokowania UI; błąd → komunikat).
- Brak stanu RNG w zapisie (patrz `ECONOMY_ENGINE.md` §6).

## 6. UI

- Brak routera: aktualny ekran to pole `screen` w store (SPA bez adresów podstron). `vercel.json` ma mimo to fallback na `index.html` pod przyszły routing.
- Ekrany: Pulpit, Postać, Finanse, Kalendarz, Historia zdarzeń, Nowa gra/Wczytaj. Pasek HUD (data, gotówka, majątek, sterowanie czasem) nad każdym ekranem gry; nawigacja boczna (desktop) / dolna (telefon).
- Wykresy: własne komponenty SVG (`LineChart`, `BarChart`, `Donut`, `ProgressBar`) — bez biblioteki wykresów.
- Wartości przykładowe oznaczone badge „przykładowe”.
- Dostępność: role/aria dla grup przycisków, wykresów (`role="img"` + `aria-label`), komunikatów (`role="alert"`), `prefers-reduced-motion`.

## 7. Build i wdrożenie

- `npm run build` = `tsc -b && vite build` ⇒ `dist/` (statyczny).
- `vercel.json`: `framework: vite`, `buildCommand`, `outputDirectory: dist`, rewrite `/(.*) → /index.html` (system plików ma pierwszeństwo, więc zasoby statyczne działają).
- Brak zmiennych środowiskowych i sekretów.

## 8. Strategia testowania

| Poziom | Narzędzie | Zakres |
|---|---|---|
| Silnik | Vitest | czas, pieniądze, wynagrodzenia, koszty, saldo, majątek netto, brak podwójnego księgowania, seed, 12/120 miesięcy, zaległości, projekcja |
| Zapis | Vitest + fake-indexeddb | round-trip, odporność na uszkodzenia/manipulacje, wersje, repozytoria |
| UI/e2e | Playwright (Chromium) | walidacja formularza, nowa gra, upływ czasu, spójność kwot na ekranach, nawigacja, kalendarz, zapis/wczytanie/autozapis po przeładowaniu |

Szczegóły i mapa testów silnika: `ECONOMY_ENGINE.md` §9. Wymagane komendy: `AGENTS.md` §4.
