# AGENTS.md — instrukcja dla Codex, Claude Code i innych agentów

Projekt: **POLSKI TYCOON — Symulator Życia i Przedsiębiorczości w Polsce**
Język dokumentacji i interfejsu: **polski**. Kod i identyfikatory: angielski/polski mieszany zgodnie z istniejącym kodem — dopasuj się do otoczenia.

## 0. OBOWIĄZEK PRZED KAŻDYM ZADANIEM

**Przed rozpoczęciem KAŻDEGO zadania — także małego — przeczytaj ponownie, w tej kolejności:**

1. `AGENTS.md` (ten plik)
2. `docs/PROJECT_STATUS.md` — co działa, co nie, jakie jest następne zadanie
3. `docs/IMPLEMENTATION_PLAN.md` — zakres bieżącego etapu
4. `docs/DECISIONS.md` — decyzje, których nie wolno cicho łamać
5. **`docs/FEATURE_EVOLUTION.md` — rejestr rozwoju mechanik**: znajdź pozycje (`FE-…`) dotknięte zadaniem, sprawdź ich stan obecny, docelowe zachowanie, brakujące funkcje i znane uproszczenia (§14). Po zadaniu **zaktualizuj wyłącznie pozycje dotknięte zmianą**; nowe uproszczenia dopisz do §14, nowe pomysły do §15. Nie usuwaj pozycji ani pomysłów, nie realizuj zaległości spoza zakresu zadania.
6. `docs/LEGAL_SOURCES.md` — **zawsze**, gdy zadanie dotyka podatków, ZUS, VAT, rejestracji działalności lub innych przepisów
7. `docs/ARCHITECTURE.md`, `docs/ECONOMY_ENGINE.md`, `docs/WORLD_MODEL.md`, `docs/GAME_DESIGN.md` — w zakresie, którego dotyczy zadanie

Dokumentacja w repozytorium jest **głównym źródłem prawdy**. Pamięć rozmowy, poprzednie sesje i domysły nią nie są.
Sprawdź też `git log` i `git status` — dokumentacja mogła zostać zmieniona przez innego agenta.

## 1. Zasady pracy

- **Nie odchodź od ustalonej architektury** bez wyraźnego uzasadnienia i **zatwierdzenia przez właściciela projektu**. Pomysł zmiany zapisz w `docs/DECISIONS.md` jako propozycję (status: *Proponowana*) i zapytaj; nie wdrażaj na własną rękę.
- **Nie implementuj funkcji poza zakresem bieżącego etapu** (`docs/IMPLEMENTATION_PLAN.md`). Nie zaczynaj kolejnej wersji bez zatwierdzenia.
- **Nie zmieniaj głównych założeń gry** (`docs/GAME_DESIGN.md`) samodzielnie.
- **Nie przedstawiaj nieukończonych mechanik jako gotowych** — ani w kodzie, ani w UI, ani w `PROJECT_STATUS.md`.
- Nie nadpisuj istniejących decyzji bez analizy. Jeśli decyzja przestała pasować — zgłoś to, nie omijaj.

## 2. Niezmienniki projektu (łamanie = błąd)

1. **Pieniądze = całkowite grosze** (`number`, safe integer; moduł `src/engine/money.ts`). Żadnego `float` do przechowywania ani sumowania kwot. Ułamki tylko przez `mulBps`/`roundDiv`. `Intl` wyłącznie do wyświetlania.
2. **Silnik jest czysty i deterministyczny.** `src/engine/` nie importuje Reacta, DOM, `Date.now()`, `Math.random()`, IndexedDB ani niczego spoza silnika. Losowość wyłącznie przez `src/engine/rng.ts` (strumień z pary seed + id zdarzenia).
3. **Obliczenia gospodarcze wykonuje silnik**, nie UI i nie model językowy. UI tylko wyświetla i wywołuje akcje.
4. **Każda zmiana salda przechodzi przez `postTransaction`** i zostawia wpis w rejestrze. Zdarzenia mają unikalne, deterministyczne id; podwójne księgowanie jest niemożliwe (idempotencja + wyjątek).
5. **Osoba fizyczna ≠ podmiot prawny.** JDG nie jest odrębną osobą prawną; spółka jest. Udziały, zarządzanie i prawo do wypłat to trzy różne rzeczy. Pieniądze prywatne i firmowe można ewidencjonować osobno, ale status prawny musi być poprawny.
6. **Przychód ≠ wpływ gotówki; koszt ≠ wypływ gotówki.** Najpierw naliczenie (zobowiązanie/należność z kwotą, stronami i terminem), potem rozliczenie.
7. **Prawo i podatki są wersjonowane datami. Nie wymyślaj obowiązujących stawek.** Wartość niezweryfikowana ma `dataStatus: 'placeholder'` i jest tak oznaczona w UI. Każda reguła prawna w silniku musi mieć wpis w `src/engine/legal.ts` (id, zakres, daty, **źródło urzędowe**, data weryfikacji, status `VERIFIED`/`SIMPLIFIED`/`DEFERRED`) i odpowiadać `docs/LEGAL_SOURCES.md`. Jeśli nie możesz zweryfikować zasady na stronie urzędowej — **nie zgaduj**: oznacz `DEFERRED` (albo jawnie `SIMPLIFIED`) i nie przedstawiaj wyniku jako dokładnego. Obliczenia podatkowe to symulacja, nie porada.
8. **Format zapisu jest wersjonowany.** Zmiana kształtu `GameState` ⇒ podniesienie `SAVE_VERSION` + migracja w `src/persistence/save.ts`. Nigdy nie usuwaj starych zapisów ani nie zmieniaj formatu „po cichu”.
9. **Niezmienniki finansowe** (`src/engine/invariants.ts`) muszą przechodzić po każdej symulacji i przy wczytywaniu zapisu. Nowa mechanika = nowe niezmienniki + testy.
10. **Brak sekretów w repozytorium.** `.env*` jest w `.gitignore`.
11. **JDG nie jest osobą prawną.** Rachunek firmowy należy do osoby fizycznej gracza; „firmowa” jest wyłącznie ewidencja (`scope: 'business'`, rachunek typu `business`). Majątek netto obejmuje wszystko. Pieniądze między rachunkami własnymi przenosi tylko `transferFunds`.
12. **Wszystkie decyzje gracza przechodzą przez `commands.*`** (czyste, na kopii stanu); UI niczego nie liczy sam.
13. **Spółka z o.o. (v0.8) ma odrębny majątek.** Własność wynika z właściciela rachunku (`Account.ownerId`); `scope: 'company'` nie wchodzi do rozliczeń JDG ani majątku netto gracza (tam tylko szacunkowa wartość jego udziałów). Przepływy osoba↔spółka wyłącznie jako wkład na kapitał, dywidenda i transakcje na udziałach (niezmiennik w `corpInvariants.ts`). Moduły firmowe pracują na bieżącym operatorze (`withOperator`) — nie kopiuj ich dla spółki. Przed zmianą reguł spółek sprawdź `LEGAL_SOURCES.md` (sekcja v0.8) i `legalCorp.ts`.

## 3. Stos (zatwierdzony)

TypeScript · React 19 · Vite · Tailwind CSS v4 · Zustand · Zod · Vitest · Playwright · IndexedDB (zapisy lokalne) · wdrożenie statyczne na Vercel.

**Nie dodawaj bez zatwierdzenia:** Supabase/inna baza, n8n, Next.js, backend/API, logowanie, multiplayer, płatne API, generatywne AI w rozgrywce, bibliotek wykresów/UI (wykresy są własnymi komponentami SVG). Phaser — dopiero przy mapie miasta.

## 4. Definicja „zrobione”

Zadanie jest zakończone dopiero, gdy:

```bash
npm run typecheck   # tsc -b, bez błędów
npm test            # Vitest: silnik + zapisy (musi być zielony)
npm run build       # produkcyjny build bez błędów
npm run test:e2e    # Playwright (dla zmian w UI / zapisach)
```

oraz:
- nowa logika ma testy sprawdzające **zachowanie** (nie tylko kompilację); reguły prawne mają testy na przykładach zweryfikowanych w źródłach urzędowych,
- zaktualizowano `docs/PROJECT_STATUS.md` (stan faktyczny, wyniki testów, znane problemy, następne zadanie),
- decyzje architektoniczne dopisano do `docs/DECISIONS.md`,
- **`docs/FEATURE_EVOLUTION.md` zaktualizowano dla dotkniętych pozycji**, a reguły prawne — w `docs/LEGAL_SOURCES.md`,
- dokumenty, których dotyka zmiana (`WORLD_MODEL`, `ECONOMY_ENGINE`, `ARCHITECTURE`…), są aktualne.

Po dużej zmianie **samodzielnie** przeszukaj repozytorium pod kątem nieaktualnych fragmentów (dokumenty, komentarze, testy) — nie czekaj, aż ktoś je znajdzie.

## 5. Komendy

| Komenda | Działanie |
|---|---|
| `npm run dev` | serwer deweloperski Vite |
| `npm run build` | `tsc -b` + build produkcyjny do `dist/` |
| `npm run preview` | podgląd buildu |
| `npm test` | testy jednostkowe (Vitest) |
| `npm run test:e2e` | testy przeglądarkowe (Playwright, buduje i uruchamia `preview` na porcie 4173) |

Playwright wymaga zainstalowanego Chromium (`npx playwright install chromium`) i bibliotek systemowych (`npx playwright install-deps` albo pakiety `libnspr4 libnss3 libasound2t64`). Bez roota: pobierz `.deb` przez `apt-get download`, rozpakuj `dpkg -x` i ustaw `LD_LIBRARY_PATH`.

## 6. Git i wdrożenie

- Gałąź robocza i produkcyjna: **`main`**. Repozytorium jest połączone z Vercel — **push na `main` uruchamia wdrożenie**, więc pushuj dopiero po zielonym `typecheck` + `test` + `build`.
- Małe, opisowe commity (po polsku lub angielsku, spójnie z historią). Nie przepisuj historii opublikowanych commitów.
- Nie twórz nowego repozytorium ani projektu Vercel; nie zmieniaj destrukcyjnie istniejącej konfiguracji (`vercel.json`).

## 7. Mapa repozytorium

```
src/engine/        czysty silnik symulacji (bez UI i I/O) + testy
src/persistence/   format zapisu, walidacja, migracje, IndexedDB
src/store/         stan aplikacji (Zustand) — łączy silnik z UI i zapisami
src/ui/            React: ekrany, komponenty, wykresy SVG
e2e/               testy Playwright
docs/              dokumentacja projektu (źródło prawdy)
```
