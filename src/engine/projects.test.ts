import { describe, expect, it } from 'vitest';
import { commands } from './commands.ts';
import { checkInvariants } from './invariants.ts';
import { currentOperator } from './operator.ts';
import { zl } from './money.ts';
import { referencePrice } from './renovationCatalog.ts';
import { PROJECT_TEMPLATES, TIER_REQUIREMENTS, tierOfValue } from './projectsCatalog.ts';
import { buildProject, companyReferences, defaultPlanInput, ensureB2BPool, planProject, projectAcceptance, projectById, projectValueNet, requirementChecks, segmentComparison } from './projects.ts';
import { advanceDays } from './simulate.ts';
import type { GameState, RenoProject } from './state.ts';
import { buyAll, ok, opsGame } from './testkit.ts';

const NO_REQ = { minCompleted: 0, minValueNet: 0, minRating10: 0, minProjectTier: 0, minWorkers: 0 };

/** Gra z właścicielem wykwalifikowanym do wszystkich czterech usług i ze sprzętem; projekt wstawiony „z rynku” (wymagania wyzerowane, jeśli `open`). */
function projectGame(o: { seed?: string; open?: boolean; template?: 'flat_finish' | 'finish_package' | 'serial_flats'; client?: number; tier?: number } = {}): { s: GameState; p: RenoProject } {
  let s = opsGame({ seed: o.seed ?? 'proj-1', equip: ['hand-tools', 'paint-basic', 'trowel-set', 'panel-kit'] });
  for (const id of ['gladzie', 'panele', 'drobne']) s = ok(commands.addSpecialization(s, id));
  s = structuredClone(s);
  const clients = ensureB2BPool(s);
  const p = buildProject(s, currentOperator(s)!, clients[o.client ?? 2]!, o.template ?? 'flat_finish', o.tier ?? 1, s.clock.today);
  if (!p) throw new Error('nie udało się zbudować projektu o żądanym poziomie');
  for (const pkg of p.packages) { pkg.complexity = 'standard'; pkg.refPriceNet = referencePrice(pkg.serviceId, pkg.units, 'standard', pkg.qualityReq); }
  if (o.open !== false) p.requirements = { ...NO_REQ };
  s.reno.projects.push(p);
  return { s, p };
}

const accept = (s: GameState, id: string): GameState => {
  const c = structuredClone(s);
  const p = projectById(c, id)!;
  p.status = 'accepted';
  p.signBy = c.clock.today;
  return c;
};

/** Gra do zakończenia projektu: materiały dla każdego pakietu kupowane, gdy pakiet się zaczyna. */
function runProject(s0: GameState, id: string, maxDays = 220): GameState {
  let s = s0;
  for (let d = 0; d < maxDays && projectById(s, id)!.status === 'signed'; d++) {
    for (const j of s.reno.jobs.filter((x) => x.projectId === id && x.stage !== 'done' && x.stage !== 'cancelled' && x.startDate <= s.clock.today)) {
      if (Object.keys(j.need).some((k) => (j.consumed[k]?.qty ?? 0) < j.need[k]!)) s = buyAll(s, j.id);
    }
    s = advanceDays(s, 1);
  }
  return s;
}

describe('v0.8.1 · większe projekty: struktura, wymagania i plan', () => {
  it('szablony: projekt → etapy → pakiety z zależnościami; wartości trafiają w poziomy 1–3, a seria deweloperska jest największa', () => {
    for (const tpl of Object.values(PROJECT_TEMPLATES)) {
      const specs = tpl.spec(tpl.areaRange[0], tpl.flatsRange[0]);
      const keys = specs.map((x) => x.key);
      specs.forEach((sp, i) => { for (const d of sp.deps) expect(keys.indexOf(d)).toBeLessThan(i); });
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(tierOfValue(projectValueNet('flat_finish', 45, 1))).toBe(1);
    expect(tierOfValue(projectValueNet('local_remont', 240, 1))).toBe(2);
    expect(tierOfValue(projectValueNet('serial_flats', 50, 10))).toBe(3);
    expect(projectValueNet('serial_flats', 45, 8)).toBeGreaterThan(projectValueNet('flat_finish', 90, 1) * 2);
  });

  it('wymagania i referencje: nowa firma nie spełnia progów żadnego poziomu; JDG i spółka mają te same progi (forma prawna nie odblokowuje dużych projektów)', () => {
    const { s } = projectGame({ open: false });
    const refs = companyReferences(s);
    expect(refs.tier).toBe(0);
    expect(refs.completedJobs).toBe(0);
    for (const t of [1, 2, 3] as const) expect(requirementChecks(refs, TIER_REQUIREMENTS[t]).some((c) => !c.ok)).toBe(true);
    // progi są jednakowe dla wszystkich form prawnych: wymagania nie zawierają pola o formie prawnej
    expect(Object.keys(TIER_REQUIREMENTS[3]).sort()).toEqual(['minCompleted', 'minProjectTier', 'minRating10', 'minValueNet', 'minWorkers']);
    const p = projectById(s, s.reno.projects[0]!.id)!;
    const plan = planProject(s, p, defaultPlanInput(s, p));
    expect(plan.blockers.some((b) => /Wymagania klienta/.test(b))).toBe(true);
    const r = commands.sendProjectQuote(s, p.id, defaultPlanInput(s, p));
    expect(r.ok).toBe(false);
  });

  it('plan: ekonomia projektu to suma pakietów; praca właściciela jest kalkulacyjna; harmonogram jest łańcuchem zależności', () => {
    const { s, p } = projectGame();
    const plan = planProject(s, p, defaultPlanInput(s, p));
    expect(plan.blockers).toEqual([]);
    expect(plan.packages).toHaveLength(p.packages.length);
    const sum = (f: (x: (typeof plan.packages)[number]) => number) => plan.packages.reduce((a, x) => a + f(x), 0);
    expect(plan.economics.revenueNet).toBe(sum((x) => x.priceNet));
    expect(plan.economics.externalCost).toBe(sum((x) => x.preview.economics.external.total));
    expect(plan.economics.surplus).toBe(plan.economics.revenueNet - plan.economics.externalCost);
    expect(plan.economics.economicProfit).toBe(plan.economics.surplus - plan.economics.ownerLabor);
    expect(plan.economics.ownerLabor).toBeGreaterThan(0);
    for (const x of plan.packages) for (const d of x.pkg.dependsOn) {
      const dep = plan.packages.find((y) => y.pkg.id === d)!;
      expect(x.startDate > dep.endDate).toBe(true);
    }
    expect(plan.chainDays).toBeGreaterThan(plan.packages.length);
  });

  it('akceptacja klienta zależy od ceny względem budżetu, referencji i terminu płatności — wyższa cena obniża szansę', () => {
    const { s, p } = projectGame();
    let c = ok(commands.sendProjectQuote(s, p.id, defaultPlanInput(s, p)));
    const base = projectAcceptance(c, projectById(c, p.id)!).pAccept;
    const cheap = structuredClone(c);
    const q = projectById(cheap, p.id)!.quote!;
    q.priceNet = Math.round(projectById(cheap, p.id)!.budgetNet * 0.85);
    const dear = structuredClone(c);
    projectById(dear, p.id)!.quote!.priceNet = Math.round(projectById(dear, p.id)!.walkAwayNet * 1.2);
    expect(projectAcceptance(cheap, projectById(cheap, p.id)!).pAccept).toBeGreaterThan(base);
    expect(projectAcceptance(dear, projectById(dear, p.id)!).pAccept).toBeLessThan(base);
    c = advanceDays(c, 8);
    expect(['accepted', 'counter', 'rejected']).toContain(projectById(c, p.id)!.status);
  });
});

describe('v0.8.1 · większe projekty: realizacja, zależności, płatności i referencje', () => {
  it('podpisanie tworzy pakiety jako zwykłe kontrakty z zależnościami; pakiet czeka na poprzednika; po zakończeniu projekt trafia do referencji', () => {
    const { s: s0, p } = projectGame();
    let s = ok(commands.sendProjectQuote(s0, p.id, defaultPlanInput(s0, p)));
    s = accept(s, p.id);
    s = ok(commands.signProject(s, p.id));
    const sp = projectById(s, p.id)!;
    expect(sp.status).toBe('signed');
    const jobs = s.reno.jobs.filter((j) => j.projectId === p.id);
    expect(jobs.every((j) => j.paymentTermDays === sp.quote!.paymentTermDays)).toBe(true);
    expect(s.serviceOrders.filter((o) => jobs.some((j) => j.orderId === o.id)).every((o) => o.latePenaltyBps === sp.penaltyBpsPerWeek)).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
    // po podpisaniu kontraktem jest tylko pakiet bez poprzedników; kolejne powstają po odbiorze poprzednika (aktywacja „na czas”)
    expect(jobs).toHaveLength(1);
    expect(sp.packages.filter((x) => x.jobId)).toHaveLength(1);
    let cur = s;
    let maxJobs = 1;
    for (let d = 0; d < 260 && projectById(cur, p.id)!.status === 'signed'; d++) {
      for (const j of cur.reno.jobs.filter((x) => x.projectId === p.id && x.stage !== 'done' && x.stage !== 'cancelled' && x.startDate <= cur.clock.today)) {
        if (Object.keys(j.need).some((k) => (j.consumed[k]?.qty ?? 0) < j.need[k]!)) cur = buyAll(cur, j.id);
      }
      const pj = cur.reno.jobs.filter((x) => x.projectId === p.id);
      // każdy istniejący pakiet ma odebranych poprzedników; liczba kontraktów rośnie o jeden na raz
      for (const j of pj) for (const dep of j.dependsOn) expect(cur.reno.jobs.find((x) => x.id === dep)!.stage).toBe('done');
      expect(pj.length).toBeLessThanOrEqual(maxJobs + 1);
      maxJobs = Math.max(maxJobs, pj.length);
      cur = advanceDays(cur, 1);
    }
    expect(projectById(cur, p.id)!.status).toBe('done');
    const done = projectById(cur, p.id)!;
    expect(done.outcome!.revenueNet).toBeGreaterThan(0);
    expect(done.outcome!.workedHours).toBeGreaterThan(0);
    const refs = companyReferences(cur);
    expect(refs.projectsDone[done.tier - 1]).toBe(1);
    expect(refs.completedJobs).toBeGreaterThanOrEqual(p.packages.length);
    expect(cur.reno.b2bClients.find((c) => c.id === p.b2bId)!.projectsDone).toBe(1);
    expect(checkInvariants(cur)).toEqual([]);
  }, 180_000);

  it('płatnik B2B: termin płatności z umowy + zwłoka wynikająca z jego rzetelności; zwłoka jest deterministyczna', () => {
    const { s: s0, p } = projectGame({ seed: 'proj-pay' });
    const lowRel = structuredClone(s0);
    lowRel.reno.b2bClients.find((c) => c.id === p.b2bId)!.reliability = 40;
    let s = ok(commands.sendProjectQuote(lowRel, p.id, defaultPlanInput(lowRel, p)));
    s = runProject(accept(s, p.id) && ok(commands.signProject(accept(s, p.id), p.id)), p.id);
    const jobs = s.reno.jobs.filter((j) => j.projectId === p.id && j.stage === 'done');
    expect(jobs.length).toBe(p.packages.length);
    expect(jobs.some((j) => j.paymentDelayDays > 0)).toBe(true);
    for (const j of jobs) {
      expect(j.paymentDelayDays).toBeLessThanOrEqual(Math.round((100 - 40) * 0.4));
      const doc = s.documents.find((d) => d.id === j.finalDocId)!;
      const ob = s.obligations.find((o) => o.occurrenceId.startsWith(`${doc.id}:`) && o.direction === 'receivable');
      if (ob) expect(ob.dueDate >= doc.issueDate).toBe(true);
    }
    expect(checkInvariants(s)).toEqual([]);
  }, 180_000);

  it('porównanie segmentów: kontrakty projektu liczą się do „większych remontów”/B2B, zwykłe zlecenia do prywatnych; model mieszany = suma', () => {
    const { s: s0, p } = projectGame({ seed: 'proj-seg', client: 4, template: 'finish_package', tier: 1 });
    let s = ok(commands.sendProjectQuote(s0, p.id, defaultPlanInput(s0, p)));
    s = runProject(ok(commands.signProject(accept(s, p.id), p.id)), p.id);
    const seg = segmentComparison(s);
    const by = Object.fromEntries(seg.map((x) => [x.key, x]));
    expect(by.b2b!.contracts).toBe(p.packages.length);
    expect(by.private!.contracts).toBe(0);
    expect(by.mixed!.contracts).toBe(by.private!.contracts + by.bigger!.contracts + by.b2b!.contracts);
    expect(by.mixed!.revenueNet).toBe(by.private!.revenueNet + by.bigger!.revenueNet + by.b2b!.revenueNet);
    expect(by.b2b!.surplusNet).toBe(by.b2b!.revenueNet - by.b2b!.externalCost);
  }, 180_000);

  it('deterministyczność: ten sam seed i te same komendy dają identyczny przebieg projektu', () => {
    const run = () => {
      const { s: s0, p } = projectGame({ seed: 'proj-det' });
      let s = ok(commands.sendProjectQuote(s0, p.id, defaultPlanInput(s0, p)));
      s = runProject(ok(commands.signProject(accept(s, p.id), p.id)), p.id);
      return { project: projectById(s, p.id), jobs: s.reno.jobs, ledger: s.ledger.length, cash: s.accounts[currentOperator(s)!.accountId]!.balance };
    };
    expect(run()).toEqual(run());
  }, 240_000);

  it('limity: nowa firma widzi rzadkie zapytania B2B (najwyżej 2 otwarte) i żadne nie jest automatycznie przyznane', () => {
    let s = opsGame({ seed: 'proj-gen', equip: ['paint-basic'] });
    let maxOpen = 0;
    for (let d = 0; d < 400; d++) {
      s = advanceDays(s, 1);
      maxOpen = Math.max(maxOpen, s.reno.projects.filter((p) => ['enquiry', 'quoted', 'counter', 'accepted'].includes(p.status)).length);
    }
    expect(maxOpen).toBeLessThanOrEqual(2);
    expect(s.reno.projects.length).toBeLessThan(20);
    expect(s.reno.projects.every((p) => p.status !== 'signed' && p.status !== 'done')).toBe(true);
    expect(s.reno.b2bClients).toHaveLength(10);
    expect(checkInvariants(s)).toEqual([]);
  }, 240_000);

  it('seria deweloperska (poziom 3) wymaga referencji skali i zespołu — samotny wykonawca bez historii dostaje blokady, a nie projekt', () => {
    const { s, p } = projectGame({ seed: 'proj-t3', open: false, template: 'serial_flats', client: 8, tier: 3 });
    const plan = planProject(s, p, defaultPlanInput(s, p));
    expect(plan.blockers.length).toBeGreaterThan(0);
    expect(plan.checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(expect.arrayContaining(['Ukończone kontrakty', 'Zdolność realizacyjna (liczba wykonawców)']));
    expect(zl(1)).toBe(100);
  });
});
