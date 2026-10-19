import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { commands } from '../engine/commands.ts';
import { createNewGame } from '../engine/newGame.ts';
import { advanceDays } from '../engine/simulate.ts';
import type { GameState } from '../engine/state.ts';
import { craftEnquiry, ok, opsGame } from '../engine/testkit.ts';
import { ScreenHelp } from './ScreenHelp.tsx';
import { firstSteps, nextSteps } from './guide.ts';
import { ALL_NAV, NAV_SECTIONS, visibleSections } from './nav.ts';
import { SCREEN_HELP } from './screenHelp.ts';
import { FirmSnapshot, GuideScreen, NextStepsCard } from './screens/GuideScreen.tsx';

const fake: { state: Record<string, unknown> } = { state: {} };
vi.mock('../store/gameStore.ts', () => ({ useGameStore: (sel: (x: unknown) => unknown) => sel(fake.state) }));
const setGame = (game: GameState) => { fake.state = { game, screen: 'dashboard', navigate: () => true, run: () => true, selectOperator: () => true, visited: {} }; };
const html = (el: ReturnType<typeof createElement>) => renderToString(el);
const fresh = () => createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed: 'guide-1', lifeEvents: false });

describe('menu: nowy gracz widzi tylko to, czego może użyć', () => {
  it('bez firmy ukryte są zlecenia, ludzie, rynek, projekty i wyniki; po założeniu firmy remontowej pojawiają się wszystkie grupy', () => {
    const titles = (g: GameState) => visibleSections(g, 'dashboard').map((s) => s.title);
    const t0 = titles(fresh());
    for (const hidden of ['Zlecenia', 'Ludzie i sprzęt', 'Rynek i marketing', 'Większe projekty (B2B)', 'Wyniki']) expect(t0).not.toContain(hidden);
    expect(t0).toEqual(expect.arrayContaining(['Start', 'Życie prywatne', 'Moja firma', 'Spółki i inwestycje prywatne', 'System']));
    const firmItems = visibleSections(fresh(), 'dashboard').find((s) => s.title === 'Moja firma')!.blocks.flatMap((b) => b.items.map((i) => i.id));
    expect(firmItems).toEqual(['bizRegister']);
    const biz = advanceDays(opsGame({ seed: 'guide-2' }), 3);
    const t1 = visibleSections(biz, 'dashboard');
    expect(t1.map((s) => s.title)).toEqual(expect.arrayContaining(['Zlecenia', 'Ludzie i sprzęt', 'Rynek i marketing', 'Większe projekty (B2B)', 'Wyniki']));
    const ids = t1.flatMap((s) => s.blocks.flatMap((b) => b.items.map((i) => i.id)));
    expect(ids).toContain('renoEnquiries');
    expect(ids).not.toContain('bizOrders'); // zlecenia usługowe dotyczą innych branż niż remonty
  });

  it('każda grupa ma opis, każdy ekran (poza przewodnikiem i zapisem) ma pomoc i podpowiedź; bieżący ekran nie znika z menu', () => {
    expect(NAV_SECTIONS.every((s) => s.description.length > 10)).toBe(true);
    for (const n of ALL_NAV) {
      expect(n.hint.length).toBeGreaterThan(5);
      if (n.id !== 'guide' && n.id !== 'game') expect(SCREEN_HELP[n.id], `brak pomocy dla ${n.id}`).toBeDefined();
    }
    expect(visibleSections(fresh(), 'renoQuotes').flatMap((s) => s.blocks.flatMap((b) => b.items.map((i) => i.id)))).toContain('renoQuotes');
    expect(new Set(ALL_NAV.map((n) => n.id)).size).toBe(ALL_NAV.length);
  });
});

describe('podpowiedzi „co zrobić teraz?” i pierwsze kroki', () => {
  it('bez firmy jedyną podpowiedzią jest założenie firmy; z firmą — marketing i narzędzia, a nowe zapytanie ma pierwszeństwo', () => {
    expect(nextSteps(fresh()).map((s) => s.id)).toEqual(['register']);
    let s = advanceDays(opsGame({ seed: 'guide-3', equip: [] }), 3);
    const ids = nextSteps(s).map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['marketing', 'equipment']));
    s = structuredClone(s);
    craftEnquiry(s, {});
    expect(nextSteps(s)[0]!.id).toBe('renoEnquiries');
    expect(nextSteps(s).every((x) => x.title.length > 0 && x.why.length > 0)).toBe(true);
  });

  it('pierwsze kroki odzwierciedlają stan gry (firma, narzędzia, marketing) i rosną wraz z postępem', () => {
    const g0 = fresh();
    expect(firstSteps(g0).filter((x) => x.done)).toHaveLength(0);
    let g1 = opsGame({ seed: 'guide-4', equip: ['paint-basic'] });
    g1 = ok(commands.setMarketingBudget(g1, 'local_ads', 40_000));
    const done = firstSteps(g1).filter((x) => x.done).map((x) => x.id);
    expect(done).toEqual(expect.arrayContaining(['biz', 'equip', 'marketing']));
    expect(firstSteps(g1).find((x) => x.id === 'sign')!.done).toBe(false);
  });
});

describe('ekrany pomocy i przewodnika (render)', () => {
  it('przewodnik zawiera cel gry, pierwsze kroki, pętlę zarabiania, mapę menu i słownik; pulpit — kartę „Co zrobić teraz?”', () => {
    setGame(fresh());
    const g = html(createElement(GuideScreen));
    for (const id of ['first-steps', 'loop', 'nav-map', 'glossary', 'next-steps']) expect(g).toContain(id);
    expect(g).toContain('O co w tej grze chodzi');
    expect(g).toContain('Zysk ekonomiczny');
    expect(html(createElement(NextStepsCard, { compact: true }))).toContain('Załóż własną firmę remontową');
    expect(html(createElement(FirmSnapshot))).toBe(''); // bez firmy karta firmy się nie pokazuje
  });

  it('z firmą: karta firmy z kluczowymi liczbami; pomoc ekranu opisuje, do czego służy ekran i co dalej', () => {
    setGame(advanceDays(opsGame({ seed: 'guide-5' }), 3));
    expect(html(createElement(FirmSnapshot))).toContain('firm-snapshot');
    const h = html(createElement(ScreenHelp, { screen: 'renoQuotes' }));
    expect(h).toContain('Do czego służy ten ekran');
    expect(h).toContain('Co dalej');
    expect(html(createElement(ScreenHelp, { screen: 'guide' }))).toBe('');
  });
});
