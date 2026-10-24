import { describe, expect, it } from 'vitest';
import { commands } from './commands.ts';
import { checkInvariants } from './invariants.ts';
import { currentOperator } from './operator.ts';
import { zl } from './money.ts';
import { referencePrice } from './renovationCatalog.ts';
import { B2B_CLIENT_POOL, B2B_KINDS, B2B_LEGACY_POOL, B2B_RULES, PROJECT_TEMPLATES, TIER_REQUIREMENTS, tierOfValue } from './projectsCatalog.ts';
import { suggestCrews, buildProject, companyReferences, defaultPlanInput, ensureB2BPool, planProject, projectAcceptance, projectById, projectValueNet, requirementChecks, segmentComparison } from './projects.ts';
import { advanceDays } from './simulate.ts';
import { addDays } from './date.ts';
import type { GameState, RenoProject } from './state.ts';
import { buyAll, contract, craftEnquiry, hireEmployee, ok, opsGame, runUntil } from './testkit.ts';
import { crewKey, defaultQuoteInput, previewQuote } from './renovation.ts';

const NO_REQ = { minCompleted: 0, minValueNet: 0, minRating10: 0, minProjectTier: 0, minWorkers: 0 };

/** Gra z właścicielem wykwalifikowanym do wszystkich czterech usług i ze sprzętem; projekt wstawiony „z rynku” (wymagania wyzerowane, jeśli `open`). */
function projectGame(o: { seed?: string; open?: boolean; template?: 'flat_finish' | 'finish_package' | 'serial_flats'; client?: number; tier?: number } = {}): { s: GameState; p: RenoProject } {
  let s = opsGame({ seed: o.seed ?? 'proj-1', equip: ['hand-tools', 'paint-basic', 'trowel-set', 'panel-kit'] });
  for (const id of ['gladzie', 'panele', 'drobne']) s = ok(commands.addSpecialization(s, id));
  s = structuredClone(s);
  for (const c of s.contracts) if (c.type === 'employment') c.hoursPerMonth = 0; // właściciel pracuje w firmie (etat obciążałby budżet czasu i zmęczenie, a plan uwzględnia zmęczenie)
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

  it('limity: nowa firma widzi rzadkie zapytania B2B (najwyżej 4 otwarte) i żadne nie jest automatycznie przyznane', () => {
    let s = opsGame({ seed: 'proj-gen', equip: ['paint-basic'] });
    let maxOpen = 0;
    for (let d = 0; d < 400; d++) {
      s = advanceDays(s, 1);
      maxOpen = Math.max(maxOpen, s.reno.projects.filter((p) => ['enquiry', 'quoted', 'counter', 'accepted'].includes(p.status)).length);
    }
    expect(maxOpen).toBeLessThanOrEqual(B2B_RULES.maxOpen);
    expect(s.reno.projects.length).toBeGreaterThan(0);
    expect(s.reno.projects.length).toBeLessThan(40);
    expect(s.reno.projects.every((p) => p.status !== 'signed' && p.status !== 'done')).toBe(true);
    expect(s.reno.b2bClients).toHaveLength(B2B_CLIENT_POOL.length);
    expect(checkInvariants(s)).toEqual([]);
  }, 240_000);

  it('okno realizacji klienta jest spełnialne: ekipa o wielkości poziomu (3 podwykonawców na pakiet) mieści się w oknie poziomu 3, sam właściciel jest blokowany', () => {
    const { s, p } = projectGame({ seed: 'proj-window', template: 'serial_flats', client: 8, tier: 3 });
    const crewOf = (n: number) => Object.fromEntries(p.packages.map((pk) => {
      const subs = s.ops.subcontractors.filter((x) => x.services.includes(pk.serviceId)).slice(0, n);
      return [pk.id, subs.length ? crewKey(subs.map((x) => ({ kind: 'sub' as const, id: x.id }))) : null];
    }));
    const solo = planProject(s, p, { ...defaultPlanInput(s, p), crews: Object.fromEntries(p.packages.map((pk) => [pk.id, null])) });
    expect(solo.chainDays).toBeGreaterThan(p.maxDays * 1.5);
    expect(solo.blockers.join(' ')).toContain('Najdłuższy pakiet');
    const team3 = planProject(s, p, { ...defaultPlanInput(s, p), crews: crewOf(3) });
    expect(team3.chainDays).toBeLessThanOrEqual(p.maxDays);
    expect(team3.blockers.filter((b) => /Harmonogram/.test(b))).toEqual([]);
  });

  it('seria deweloperska (poziom 3) wymaga referencji skali i zespołu — samotny wykonawca bez historii dostaje blokady, a nie projekt', () => {
    const { s, p } = projectGame({ seed: 'proj-t3', open: false, template: 'serial_flats', client: 8, tier: 3 });
    const plan = planProject(s, p, defaultPlanInput(s, p));
    expect(plan.blockers.length).toBeGreaterThan(0);
    expect(plan.checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(expect.arrayContaining(['Ukończone kontrakty', 'Zdolność realizacyjna (liczba wykonawców)']));
    expect(zl(1)).toBe(100);
  });
});

describe('v0.8.1 · klienci B2B, referencje i zdolność realizacyjna', () => {
  it('pula klientów B2B: 18 fikcyjnych podmiotów, deterministyczna z seeda, o różnych typach, terminach płatności i rzetelności', () => {
    const a = opsGame({ seed: 'pool-a' });
    const b = opsGame({ seed: 'pool-a' });
    const c = opsGame({ seed: 'pool-b' });
    const pa = structuredClone(ensureB2BPool(structuredClone(a)));
    expect(ensureB2BPool(structuredClone(b))).toEqual(pa);
    expect(ensureB2BPool(structuredClone(c))).not.toEqual(pa);
    expect(pa).toHaveLength(B2B_CLIENT_POOL.length);
    expect(new Set(pa.map((x) => x.kind)).size).toBe(Object.keys(B2B_KINDS).length);
    expect(pa.every((x) => x.name.includes('fikcyjn') && x.termDays >= 7 && x.termDays <= 60 && x.reliability >= 40 && x.relationship === 40)).toBe(true);
    // ponowne wywołanie nie dubluje klientów ani stron
    const s = structuredClone(a);
    ensureB2BPool(s); ensureB2BPool(s);
    expect(s.reno.b2bClients).toHaveLength(B2B_CLIENT_POOL.length);
    expect(Object.keys(s.parties).filter((id) => id.startsWith('party:b2b:'))).toHaveLength(B2B_CLIENT_POOL.length);
  });

  it('stary zapis z 10 klientami dostaje resztę puli bez zmiany istniejących klientów (relacja i historia zostają)', () => {
    const fresh = structuredClone(opsGame({ seed: 'pool-legacy' }));
    const full = structuredClone(ensureB2BPool(structuredClone(fresh)));
    const old = structuredClone(fresh);
    old.reno.b2bClients = full.slice(0, B2B_LEGACY_POOL).map((c, i) => ({ ...c, relationship: 40 + i, projectsDone: i % 2 }));
    const migrated = ensureB2BPool(old);
    expect(migrated).toHaveLength(B2B_CLIENT_POOL.length);
    expect(migrated.slice(0, B2B_LEGACY_POOL).map((c) => [c.relationship, c.projectsDone])).toEqual(old.reno.b2bClients.slice(0, B2B_LEGACY_POOL).map((c) => [c.relationship, c.projectsDone]));
    expect(migrated.slice(B2B_LEGACY_POOL)).toEqual(full.slice(B2B_LEGACY_POOL));
    expect(checkInvariants(old)).toEqual([]);
  });

  it('różnorodność: każdy poziom ma kilka różnych typów projektów, a zapytania nowych klientów (spółdzielnie, sieci handlowe) są wyceniane przez te same reguły', () => {
    const s = structuredClone(opsGame({ seed: 'proj-variety' }));
    const clients = ensureB2BPool(s);
    const op = currentOperator(s)!;
    const reach = (tier: number) => {
      const out = new Set<string>();
      for (const c of clients) for (const tpl of B2B_KINDS[c.kind].templates) if (buildProject(s, op, c, tpl, tier, s.clock.today)) out.add(tpl);
      return out;
    };
    expect(reach(1).size).toBeGreaterThanOrEqual(5);
    expect(reach(2).size).toBeGreaterThanOrEqual(6);
    expect(reach(3).size).toBeGreaterThanOrEqual(2);
    for (const k of ['housing_coop', 'retail_chain'] as const) {
      const c = clients.find((x) => x.kind === k)!;
      const p = B2B_KINDS[k].templates.map((tpl) => buildProject(s, op, c, tpl, 1, s.clock.today) ?? buildProject(s, op, c, tpl, 2, s.clock.today)).find((x) => x)!;
      const plan = planProject(s, p, defaultPlanInput(s, p));
      expect(plan.packages.length).toBe(p.packages.length);
      expect(p.requirements).toEqual(TIER_REQUIREMENTS[p.tier as 1 | 2 | 3]);
    }
  });

  it('referencje rosną wyłącznie z rzeczywiście wykonanych robót: ukończone kontrakty odblokowują poziom 1, a ocena i liczba kontraktów mają znaczenie', () => {
    let s = opsGame({ seed: 'refs-1', equip: ['paint-basic', 'paint-basic'] });
    expect(companyReferences(s).tier).toBe(0);
    for (let i = 0; i < 3; i++) {
      const c = contract(s, { quote: { hoursPerDay: 3, durationDays: 20, startDate: addDays(s.clock.today, 3), priceNet: zl(3_200) } });
      s = buyAll(c.s, c.job.id);
      s = runUntil(s, (x) => x.reno.jobs.find((j) => j.id === c.job.id)!.stage === 'done', 120);
    }
    const refs = companyReferences(s);
    expect(refs.completedJobs).toBe(3);
    expect(refs.completedValueNet).toBeGreaterThanOrEqual(zl(9_000));
    expect(refs.avgRating10).not.toBeNull();
    expect(refs.workers).toBeGreaterThanOrEqual(1);
    // sama liczba kontraktów i wartość spełniają poziom 1; o dostępie decyduje jeszcze ocena
    const checks = requirementChecks(refs, TIER_REQUIREMENTS[1]);
    expect(checks.find((x) => x.label === 'Ukończone kontrakty')!.ok).toBe(true);
    expect(refs.tier).toBe(refs.avgRating10! >= TIER_REQUIREMENTS[1].minRating10 ? 1 : 0);
    expect(refs.tier).toBeLessThan(2); // poziom 2 wymaga ukończonego projektu poziomu 1 i 8 kontraktów
  }, 180_000);

  it('zdolność realizacyjna: brak umiejętności, brak gotówki na start i nierealny termin blokują ofertę z konkretnym powodem', () => {
    const { s, p } = projectGame({ seed: 'cap-1' });
    // brak specjalizacji w panelach i drobnych pracach (nowa gra bez szkoleń)
    let g = opsGame({ seed: 'cap-1', equip: ['paint-basic'] });
    g = structuredClone(g);
    const clients = ensureB2BPool(g);
    const q = buildProject(g, currentOperator(g)!, clients[2]!, 'flat_finish', 1, g.clock.today)!;
    q.requirements = { ...NO_REQ };
    g.reno.projects.push(q);
    // domyślnie program dobiera podwykonawców tam, gdzie właściciel nie ma umiejętności; wymuszenie pracy właściciela daje blokadę
    expect(Object.values(defaultPlanInput(g, q).crews!).some((k) => k !== null)).toBe(true);
    const forced = Object.fromEntries(q.packages.map((x) => [x.id, null]));
    const plan = planProject(g, q, { ...defaultPlanInput(g, q), crews: forced });
    expect(plan.blockers.some((b) => /specjalizacji|umiejętno/i.test(b))).toBe(true);
    // brak gotówki: rachunek firmy opróżniony
    const poor = structuredClone(s);
    const acc = poor.accounts[currentOperator(poor)!.accountId]!;
    acc.balance = 0;
    const planPoor = planProject(poor, projectById(poor, p.id)!, defaultPlanInput(poor, projectById(poor, p.id)!));
    expect(planPoor.blockers.some((b) => /Brakuje gotówki na start/.test(b))).toBe(true);
    // nierealny termin: okno klienta skrócone do 10 dni
    const rush = structuredClone(s);
    projectById(rush, p.id)!.maxDays = 10;
    const planRush = planProject(rush, projectById(rush, p.id)!, defaultPlanInput(rush, projectById(rush, p.id)!));
    expect(planRush.blockers.some((b) => /nierealny/.test(b))).toBe(true);
  });

  it('klient odrzuca ofertę powyżej swojej granicy; kontroferta rabatowa zmniejsza cenę wszystkich pakietów proporcjonalnie, a suma cen pakietów = cena oferty', () => {
    const { s: s0, p } = projectGame({ seed: 'counter-1' });
    const input = { ...defaultPlanInput(s0, p), totalPriceNet: Math.round(p.walkAwayNet * 1.5) };
    let s = ok(commands.sendProjectQuote(s0, p.id, input));
    const c = structuredClone(s);
    const pc = projectById(c, p.id)!;
    expect(pc.quote!.priceNet).toBe(pc.packages.reduce((a, x) => a + x.priceNet, 0));
    expect(projectAcceptance(c, pc).pAccept).toBeLessThanOrEqual(300);
    // kontroferta
    pc.status = 'counter';
    pc.signBy = addDays(c.clock.today, 5);
    pc.quote!.counter = { discountBps: 1_000, termDays: Math.min(pc.maxTermDays, pc.paymentTermDays + 5) };
    const before = pc.quote!.priceNet;
    s = ok(commands.respondProjectCounter(c, p.id, 'accept'));
    const after = projectById(s, p.id)!;
    expect(after.status).toBe('accepted');
    expect(after.quote!.priceNet).toBe(after.packages.reduce((a, x) => a + x.priceNet, 0));
    expect(after.quote!.priceNet).toBeLessThan(before);
    expect(Math.abs(after.quote!.priceNet - Math.round(before * 0.9))).toBeLessThanOrEqual(after.packages.length * 100);
    expect(after.quote!.paymentTermDays).toBe(pc.quote!.counter?.termDays ?? after.quote!.paymentTermDays);
    expect(checkInvariants(s)).toEqual([]);
  });
});

describe('v0.8.1 · aktywacja pakietów „na czas”', () => {
  it('pakiet startuje w najwcześniejszym terminie, gdy wykonawcy są wolni (rezerwacja na przyszłość), zamiast czekać w nieskończoność na wolny dzień', () => {
    let s = opsGame({ seed: 'jit-1', equip: ['hand-tools', 'paint-basic', 'trowel-set', 'panel-kit'] });
    for (const c of s.contracts) if (c.type === 'employment') c.hoursPerMonth = 0; // plan uwzględnia zmęczenie właściciela — bez etatu
    for (const id of ['gladzie', 'panele', 'drobne']) s = ok(commands.addSpecialization(s, id));
    s = hireEmployee(s, { expected: zl(5_400), start: addDays(s.clock.today, 1) }).s;
    const emp = s.ops.employments.at(-1)!;
    s = ok(commands.createTeam(s, 'Ekipa JIT', [{ kind: 'employee', id: emp.id }]));
    const teamId = s.ops.teams.at(-1)!.id;
    s = advanceDays(s, 3);
    // pracownik zajęty prywatnym kontraktem przez ~30 dni
    const busy = contract(s, { quote: { teamId, supervision: 'hands-off', hoursPerDay: 1, durationDays: 30, startDate: addDays(s.clock.today, 2), priceNet: zl(4_000) } });
    s = structuredClone(busy.s);
    const clients = ensureB2BPool(s);
    const p = buildProject(s, currentOperator(s)!, clients[2]!, 'flat_finish', 1, s.clock.today)!;
    for (const pkg of p.packages) { pkg.complexity = 'standard'; pkg.refPriceNet = referencePrice(pkg.serviceId, pkg.units, 'standard', pkg.qualityReq); }
    p.requirements = { ...NO_REQ };
    s.reno.projects.push(p);
    const input = { ...defaultPlanInput(s, p), crews: Object.fromEntries(p.packages.map((x) => [x.id, x.serviceId === 'drobne' || x.serviceId === 'malowanie' ? crewKey([{ kind: 'employee', id: emp.id }]) : null])) };
    let q = ok(commands.sendProjectQuote(s, p.id, input));
    q = accept(q, p.id);
    q = ok(commands.signProject(q, p.id));
    const first = q.reno.jobs.find((j) => j.projectId === p.id)!;
    expect(first.startDate > busy.job.deadline).toBe(true); // po zakończeniu prywatnego kontraktu pracownika
    // żadnych nakładających się rezerwacji tego samego pracownika
    const asg = q.ops.assignments.filter((a) => a.kind === 'employee' && a.resourceId === emp.id).sort((a, b) => a.from.localeCompare(b.from));
    for (let i = 1; i < asg.length; i++) expect(asg[i]!.from > asg[i - 1]!.to).toBe(true);
    expect(checkInvariants(q)).toEqual([]);
  }, 120_000);
});

describe('v0.8.1 · zespoły, płynność i anulowanie (poprawki po benchmarku)', () => {
  it('domyślne wykonawcy pakietów: zatrudnieni przed właścicielem (właściciel zostaje wolny do własnych zleceń), właściciel tylko gdy nikt inny nie ma umiejętności', () => {
    let s = opsGame({ seed: 'crew-1', equip: ['hand-tools', 'paint-basic', 'trowel-set', 'panel-kit'] });
    for (const id of ['gladzie', 'panele', 'drobne']) s = ok(commands.addSpecialization(s, id));
    s = hireEmployee(s, { expected: zl(5_400), start: addDays(s.clock.today, 1) }).s;
    const emp = s.ops.employments.at(-1)!;
    s = advanceDays(s, 3);
    s = structuredClone(s);
    const p = buildProject(s, currentOperator(s)!, ensureB2BPool(s)[2]!, 'flat_finish', 1, s.clock.today)!;
    for (const pkg of p.packages) pkg.complexity = 'standard';
    const crews = suggestCrews(s, p);
    const mal = p.packages.find((x) => x.serviceId === 'malowanie')!;
    expect(crews[mal.id]).toBe(crewKey([{ kind: 'employee', id: emp.id }])); // pracownik-malarz
    const gl = p.packages.find((x) => x.serviceId === 'gladzie')!;
    expect(crews[gl.id]).toBeNull(); // nikt z zatrudnionych nie ma gładzi → właściciel samodzielnie
  });

  it('koszty płac zatrudnionych nie zwiększają zapotrzebowania na gotówkę przy starcie pakietu (płacisz je co miesiąc niezależnie), a podwykonawcy i materiały — tak', () => {
    let s = opsGame({ seed: 'liq-1', equip: ['paint-basic', 'paint-basic'] });
    s = hireEmployee(s, { expected: zl(5_400), start: addDays(s.clock.today, 1) }).s;
    const emp = s.ops.employments.at(-1)!;
    s = ok(commands.createTeam(s, 'Ekipa', [{ kind: 'employee', id: emp.id }]));
    const teamId = s.ops.teams.at(-1)!.id;
    s = advanceDays(s, 3);
    const enq = craftEnquiry(structuredClone(s), { units: 80 });
    const base = defaultQuoteInput(s, enq);
    const withEmp = previewQuote(s, { ...base, teamId, supervision: 'hands-off', priceNet: zl(4_000), durationDays: 30, hoursPerDay: 4 });
    const e = withEmp.economics;
    expect(e.external.hiredLabor).toBeGreaterThan(0);
    // wydatki gotówkowe = brakujące materiały + transport + drobne (bez płac zatrudnionych)
    expect(e.liquidity.cashOutBeforePayment).toBeLessThan(e.external.materials + e.external.hiredLabor + e.external.transport + e.external.other);
    expect(e.liquidity.cashOutBeforePayment).toBeLessThanOrEqual(e.external.materials + e.external.transport + e.external.other);
  });

  it('oferta projektu wymaga środków: zapotrzebowanie na gotówkę większe niż prognozowane saldo blokuje wysłanie oferty (bez kredytu firma nie sfinansuje projektu)', () => {
    const { s, p } = projectGame({ seed: 'liq-2' });
    const poor = structuredClone(s);
    poor.accounts[currentOperator(poor)!.accountId]!.balance = zl(300);
    const plan = planProject(poor, projectById(poor, p.id)!, defaultPlanInput(poor, projectById(poor, p.id)!));
    expect(plan.blockers.some((b) => /Brakuje gotówki na start|Zapotrzebowanie na gotówkę/.test(b))).toBe(true);
    expect(commands.sendProjectQuote(poor, p.id, defaultPlanInput(poor, projectById(poor, p.id)!)).ok).toBe(false);
  });

  it('anulowany kontrakt nie zajmuje już godzin w dniu anulowania (wcześniej rezerwacja była wydłużana do tego dnia i dawała ujemny wolny czas)', () => {
    let s = opsGame({ seed: 'cancel-1', equip: ['paint-basic'] });
    const c = contract(s, { quote: { hoursPerDay: 3, durationDays: 10, startDate: addDays(s.clock.today, 2), priceNet: zl(3_000) } });
    s = c.s; // materiałów nie kupujemy — kontrakt stoi i po 45 dniach od terminu klient odstępuje od umowy
    s = runUntil(s, (x) => x.reno.jobs.find((j) => j.id === c.job.id)!.stage === 'cancelled', 120);
    const job = s.reno.jobs.find((j) => j.id === c.job.id)!;
    expect(job.stage).toBe('cancelled');
    const commit = s.commitments.find((x) => x.id === `commit:${job.orderId}`)!;
    expect(commit.endDate < job.settledOn!).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  }, 120_000);
});
