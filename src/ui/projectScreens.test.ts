import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { commands } from '../engine/commands.ts';
import { currentOperator } from '../engine/operator.ts';
import { buildProject, defaultPlanInput, ensureB2BPool, projectById } from '../engine/projects.ts';
import { referencePrice } from '../engine/renovationCatalog.ts';
import { advanceDays } from '../engine/simulate.ts';
import type { GameState } from '../engine/state.ts';
import { buyAll, ok, opsGame } from '../engine/testkit.ts';
import { B2BClientsScreen, ProjectPackagesScreen, ProjectReferencesScreen, ProjectsScreen } from './screens/ProjectScreens.tsx';
import { QuoteEconomicsPanel } from './screens/EconomicsPanel.tsx';
import { previewQuote, defaultQuoteInput } from '../engine/renovation.ts';
import { craftEnquiry } from '../engine/testkit.ts';

const fake: { state: Record<string, unknown> } = { state: {} };
vi.mock('../store/gameStore.ts', () => ({ useGameStore: (sel: (x: unknown) => unknown) => sel(fake.state) }));
const setGame = (game: GameState) => { fake.state = { game, screen: 'projects', run: () => true, navigate: () => true, selectOperator: () => true }; };
const html = (el: ReturnType<typeof createElement>) => renderToString(el);
const all = [B2BClientsScreen, ProjectsScreen, ProjectPackagesScreen, ProjectReferencesScreen];

function gameWithProject(open = true): { s: GameState; id: string } {
  let s = opsGame({ seed: 'ui-proj', equip: ['hand-tools', 'paint-basic', 'trowel-set', 'panel-kit'] });
  for (const id of ['gladzie', 'panele', 'drobne']) s = ok(commands.addSpecialization(s, id));
  s = structuredClone(s);
  for (const c of s.contracts) if (c.type === 'employment') c.hoursPerMonth = 0; // plan uwzględnia zmęczenie właściciela — bez etatu
  const clients = ensureB2BPool(s);
  const p = buildProject(s, currentOperator(s)!, clients[2]!, 'flat_finish', 1, s.clock.today)!;
  for (const pkg of p.packages) { pkg.complexity = 'standard'; pkg.refPriceNet = referencePrice(pkg.serviceId, pkg.units, 'standard', pkg.qualityReq); }
  if (open) p.requirements = { minCompleted: 0, minValueNet: 0, minRating10: 0, minProjectTier: 0, minWorkers: 0 };
  s.reno.projects.push(p);
  return { s, id: p.id };
}

describe('ekrany większych projektów B2B (render)', () => {
  it('bez firmy: komunikat o założeniu firmy, bez wyjątków', () => {
    setGame(structuredClone(opsGame({ seed: 'ui-p0' })));
    const g = structuredClone(opsGame({ seed: 'ui-p0b' }));
    g.businesses = [];
    setGame(g);
    for (const S of all) expect(() => html(createElement(S))).not.toThrow();
  });

  it('nowa firma: lista klientów po pierwszym dniu, poziomy dostępu zablokowane, brak projektów w realizacji', () => {
    setGame(advanceDays(opsGame({ seed: 'ui-p1' }), 3));
    for (const S of all) expect(() => html(createElement(S))).not.toThrow();
    const refs = html(createElement(ProjectReferencesScreen));
    expect(refs).toContain('tier-ladder');
    expect(refs).toContain('zablokowany');
    expect(html(createElement(B2BClientsScreen))).toContain('b2b-clients');
    expect(html(createElement(ProjectPackagesScreen))).toContain('Brak podpisanych projektów');
  });

  it('zapytanie o projekt: karta z wymaganiami klienta, kalkulator i blokady wymagań pokazane przed wysłaniem oferty', () => {
    const { s, id } = gameWithProject(false);
    setGame(s);
    const page = html(createElement(ProjectsScreen));
    expect(page).toContain(`project-${id}`);
    expect(page).toContain('requirement-checks');
    expect(page).toContain('Wymagania klienta wobec wykonawcy');
    expect(page).toContain('Odrzuć zapytanie');
  });

  it('po akceptacji i podpisaniu: pakiety z zależnościami, zadania i przycisk zakupu materiałów; po ukończeniu — historia i porównanie segmentów', () => {
    const { s: s0, id } = gameWithProject();
    let s = ok(commands.sendProjectQuote(s0, id, defaultPlanInput(s0, projectById(s0, id)!)));
    const c = structuredClone(s);
    projectById(c, id)!.status = 'accepted';
    projectById(c, id)!.signBy = c.clock.today;
    s = ok(commands.signProject(c, id));
    setGame(s);
    const pk = html(createElement(ProjectPackagesScreen));
    expect(pk).toContain(`packages-${id}`);
    expect(pk).toContain('Zadania pakietu');
    expect(pk).toContain('oczekuje na poprzedników');
    expect(pk).toContain('Kup brakujące materiały');
    for (let d = 0; d < 240 && projectById(s, id)!.status === 'signed'; d++) {
      for (const j of s.reno.jobs.filter((x) => x.projectId === id && x.stage !== 'done' && x.stage !== 'cancelled' && x.startDate <= s.clock.today)) {
        if (Object.keys(j.need).some((k) => (j.consumed[k]?.qty ?? 0) < j.need[k]!)) s = buyAll(s, j.id);
      }
      s = advanceDays(s, 1);
    }
    expect(projectById(s, id)!.status).toBe('done');
    setGame(s);
    const refs = html(createElement(ReferencesPage()));
    expect(refs).toContain('project-history');
    expect(refs).toContain('segment-comparison');
    expect(refs).toContain('Model mieszany');
  }, 180_000);

  it('panel ekonomii wyceny: osobno przychód, koszty rzeczywiste, nadwyżka, praca właściciela, zysk ekonomiczny i płynność', () => {
    const g = opsGame({ seed: 'ui-econ' });
    const enq = craftEnquiry(structuredClone(g), { units: 60 });
    const p = previewQuote(g, { ...defaultQuoteInput(g, enq), priceNet: 300_000, hoursPerDay: 3, durationDays: 25 });
    const out = html(createElement(QuoteEconomicsPanel, { e: p.economics, laborRate: 6_000, priceGross: p.priceGross, vatRateBps: p.vatRateBps }));
    for (const t of ['Cena kontraktu netto', 'Koszty rzeczywiste', 'Nadwyżka przed obciążeniami właściciela', 'Kalkulacyjna wartość Twojej pracy', 'Zysk ekonomiczny', 'Wpływ na płynność firmy', 'nie wypłata i nie koszt podatkowy JDG']) expect(out).toContain(t);
  });
});

const ReferencesPage = () => ProjectReferencesScreen;
