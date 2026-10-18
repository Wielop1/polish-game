# POLSKI TYCOON

Symulator życia i przedsiębiorczości w Polsce — otwarty sandbox ekonomiczny w przeglądarce.
Stan projektu: **v0.5 (etat + JDG + branża remontowa: zapytania, wyceny, kontrakty, materiały, reputacja, księgowość)** — patrz [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testy silnika i zapisów
npm run build      # build produkcyjny (dist/)
npm run test:e2e   # testy przeglądarkowe (Playwright)
```

Dla agentów (Codex / Claude Code): zacznij od [`AGENTS.md`](AGENTS.md). Dokumentacja: [`docs/`](docs/).

Parametry prawne (podatki, ZUS) są zweryfikowane tylko dla 2026 r. — rejestr w [`docs/LEGAL_SOURCES.md`](docs/LEGAL_SOURCES.md). To symulacja, nie porada prawna ani podatkowa.

## Wdrożenie na Vercel

Aplikacja jest statyczna (Vite → `dist/`), zapisy gry trzymane są lokalnie w przeglądarce (IndexedDB) — nie wymaga zmiennych środowiskowych ani backendu.
1. Vercel → **Add New… → Project** → importuj repo `Wielop1/polish-game` (gałąź produkcyjna: `main`).
2. Ustawienia zostają z `vercel.json` (framework Vite, `npm ci`, `npm run build`, katalog `dist`) — nic nie zmieniaj.
3. **Deploy.** Każdy push na `main` wdraża nową wersję.
