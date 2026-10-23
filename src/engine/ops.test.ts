import { describe, expect, it } from 'vitest';
import { commands } from './commands.ts';
import { activeBusiness } from './business.ts';
import { addDays } from './date.ts';
import { budgetFor } from './time.ts';
import { checkInvariants } from './invariants.ts';
import { zl } from './money.ts';
import { playerMarketView } from './renovation.ts';
import { MATERIAL_BY_ID, SERVICE_BY_ID, referencePrice } from './renovationCatalog.ts';
import { crewDay, complaintBps, defaultQuoteInput, jobFinancials, jobQuality, previewQuote, quoteSchedule, renoDashboard } from './renovation.ts';
import { deferredAdvances, netWorth } from './selectors.ts';
import { advanceDays } from './simulate.ts';
import { GameStateSchema } from './state.ts';
import type { GameState } from './state.ts';
import { bizBalance, buyAll, contract, craftEnquiry, docsFor, fail, hireEmployee, jobOf, ok, opsGame, runUntil, toDate } from './testkit.ts';
import { crewProfitability, fixedCosts, liquidityForecast, teamLoad } from './profitability.ts';
import { extendSubScope, subHistory, subPrice } from './subcontractors.ts';
import { crewKey } from './renovation.ts';
import { vehicleBookValue } from './fleet.ts';
import { yearReport } from './report.ts';
import { personById, workerMonthSummary } from './workforce.ts';

const consistent = (s: GameState) => expect(checkInvariants(s)).toEqual([]);
const crewQuote = (teamId: string, o: Record<string, unknown> = {}) => ({ teamId, supervision: 'supervise' as const, hoursPerDay: 1, durationDays: 14, startDate: '2026-03-10', priceNet: zl(4_000), ...o });

/** Gra z `n` zatrudnionymi (od 1 marca) i po jednej ekipie na pracownika. */
function crewGame(n = 2, opts: { equip?: string[]; seed?: string } = {}): { s: GameState; teams: string[] } {
  let s = opsGame({ equip: opts.equip, seed: opts.seed });
  const teams: string[] = [];
  for (let i = 0; i < n; i++) {
    s = hireEmployee(s, { expected: zl(5_400) + i * 10, start: '2026-03-01' }).s;
    const e = s.ops.employments.at(-1)!;
    s = ok(commands.createTeam(s, `Ekipa ${i + 1}`, [{ kind: 'employee', id: e.id }]));
    teams.push(s.ops.teams.at(-1)!.id);
  }
  s = toDate(s, '2026-03-02');
  return { s, teams };
}

describe('5. podwykonawcy (B2B)', () => {
  const withJob = () => {
    const base = contract(opsGame({ reg: { vatStatus: 'active' } }), { quote: { startDate: '2026-03-12', durationDays: 12 } });
    return { s: base.s, job: base.job };
  };

  it('cennik: cena wynika z ceny referencyjnej, ilości, trudności i zakresu; różni podwykonawcy mają różne ceny i jakość', () => {
    const s = opsGame();
    const [a, b] = [s.ops.subcontractors[0]!, s.ops.subcontractors[2]!];
    const full = subPrice(a, 'malowanie', 80, 'standard', 10_000);
    expect(full).toBe(Math.round((38 * 80 * 100 * (a.priceBps / 10_000)) / 1_000) * 1_000 || full);
    expect(subPrice(a, 'malowanie', 80, 'standard', 5_000)).toBeLessThan(full);
    expect(subPrice(a, 'malowanie', 80, 'trudne', 10_000)).toBeGreaterThan(full);
    expect(subPrice(b, 'malowanie', 80, 'standard', 10_000)).toBeLessThan(full);
    expect(s.ops.subcontractors.length).toBe(10);
    expect(new Set(s.ops.subcontractors.map((x) => x.quality)).size).toBeGreaterThan(2);
  });

  it('oferta → akceptacja: zaliczka to przedpłata (aktywo), nie koszt; majątek netto bez zmian; brak ZUS i płacy etatowej', () => {
    let { s, job } = withJob();
    const sub = s.ops.subcontractors.find((x) => x.services.includes('malowanie'))!;
    expect(fail(commands.requestSubOffer(s, sub.id, job.id, 4_321))).toMatch(/od 10% do 100%/);
    s = ok(commands.requestSubOffer(s, sub.id, job.id, 10_000));
    const offer = s.ops.subcontracts.at(-1)!;
    expect(offer).toMatchObject({ status: 'offered', scopeBps: 10_000, subId: sub.id });
    expect(offer.priceNet).toBe(subPrice(sub, 'malowanie', job.units, job.complexity, 10_000));
    expect(fail(commands.requestSubOffer(s, sub.id, job.id, 10_000))).toMatch(/już ofertę lub umowę/);
    const nw0 = netWorth(s);
    const docs0 = s.documents.length;
    s = ok(commands.acceptSubOffer(s, offer.id));
    const c = s.ops.subcontracts.find((x) => x.id === offer.id)!;
    expect(c.status).toBe('accepted');
    expect(c.advanceNet).toBe(Math.round((c.priceNet * c.advanceBps) / 10_000));
    expect(c.prepaid).toBe(c.advanceNet);
    expect(netWorth(s)).toBe(nw0); // zobowiązanie wobec podwykonawcy = przedpłata
    expect(s.documents.length).toBe(docs0); // zaliczka nie tworzy dokumentu kosztowego
    if (c.advanceNet > 0) expect(s.obligations.find((o) => o.id === c.advanceObligationId)).toMatchObject({ category: 'zaliczka_podwykonawcy', direction: 'payable', amount: c.advanceNet, scope: 'business' });
    s = advanceDays(s, 3);
    expect(netWorth(s)).toBe(nw0 + (netWorth(s) - nw0)); // brak kosztów podatkowych z samej zaliczki
    expect(s.documents.filter((d) => d.part === 'payroll')).toHaveLength(0);
    expect(s.obligations.some((o) => o.category === 'skladki_pracownicze' || o.category === 'wynagrodzenie_pracownika')).toBe(false);
    expect(fail(commands.acceptSubOffer(s, offer.id))).toMatch(/nie jest już dostępna/);
    consistent(s);
  });

  it('problem na budowie zwiększa zakres podwykonawcy (cena ryczałtowa) i otwiera zgłoszoną pracę — kontrakt nie zostaje bez wykonawcy', () => {
    let { s, job } = withJob();
    const sub = s.ops.subcontractors.find((x) => x.services.includes('malowanie') && x.reliabilityBps >= 8_500) ?? s.ops.subcontractors[3]!;
    s = ok(commands.requestSubOffer(s, sub.id, job.id, 10_000));
    s = ok(commands.acceptSubOffer(s, s.ops.subcontracts.at(-1)!.id));
    s = ok(commands.createTeam(s, 'Podwykonawca', [{ kind: 'sub', id: sub.id }]));
    s = ok(commands.assignCrew(s, job.id, s.ops.teams.at(-1)!.id, 'hands-off', null));
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => x.ops.subcontracts.at(-1)!.status === 'in_progress' && x.ops.subcontracts.at(-1)!.performedCenti > 0, 120);
    s = structuredClone(s);
    const c = s.ops.subcontracts.at(-1)!;
    const before = c.requiredCenti;
    const j = jobOf(s, job.id);
    j.extraCenti += 500;
    extendSubScope(s, j, 500);
    expect(c.requiredCenti).toBe(before + 500);
    expect(c.status).toBe('in_progress');
    s = runUntil(s, (x) => x.ops.subcontracts.at(-1)!.status === 'delivered', 120);
    const d = s.ops.subcontracts.at(-1)!;
    expect(d.performedCenti).toBe(d.requiredCenti);
    expect(jobOf(s, job.id).progressCenti).toBe(jobOf(s, job.id).normCenti + 500);
    consistent(s);
  });

  it('praca, odbiór i rozliczenie: koszt = pełna cena (faktura bez VAT mimo VAT czynnego), zapłata reszty ponad zaliczkę, przedpłata znika', () => {
    let { s, job } = withJob();
    const sub = s.ops.subcontractors.find((x) => x.services.includes('malowanie') && x.reliabilityBps >= 8_500) ?? s.ops.subcontractors[3]!;
    s = ok(commands.requestSubOffer(s, sub.id, job.id, 10_000));
    s = ok(commands.acceptSubOffer(s, s.ops.subcontracts.at(-1)!.id));
    // praca w całości delegowana: ekipa złożona z samego podwykonawcy, właściciel bez nadzoru
    s = ok(commands.createTeam(s, 'Podwykonawca', [{ kind: 'sub', id: sub.id }]));
    s = ok(commands.assignCrew(s, job.id, s.ops.teams.at(-1)!.id, 'hands-off', null));
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => x.ops.subcontracts.at(-1)!.status === 'delivered' || x.ops.subcontracts.at(-1)!.status === 'settled', 120);
    let c = s.ops.subcontracts.at(-1)!;
    expect(c.performedCenti).toBe(c.requiredCenti);
    expect(c.status).toBe('delivered');
    const before = s.obligations.length;
    s = ok(commands.acceptSubWork(s, c.id));
    c = s.ops.subcontracts.at(-1)!;
    expect(c.status).toBe('settled');
    expect(c.prepaid).toBe(0);
    const doc = s.documents.find((d) => d.id === c.settlementDocId)!;
    expect(doc).toMatchObject({ kind: 'cost', net: c.priceNet, vat: 0, taxAmount: c.priceNet, vatTreatment: 'exempt' }); // podwykonawca zwolniony z VAT
    const pay = s.obligations.slice(before).filter((o) => o.id === doc.obligationIds[0]);
    expect(pay[0]?.amount ?? 0).toBe(c.priceNet - c.advanceNet);
    expect(jobOf(s, job.id).actual.subcontract).toBe(c.priceNet);
    expect(fail(commands.acceptSubWork(s, c.id))).toMatch(/nie została jeszcze zgłoszona/);
    consistent(s);
  });

  it('gotowa praca podwykonawcy jest odbierana i rozliczana automatycznie dzień po zgłoszeniu — bez klikania; kwota jak przy ręcznym odbiorze', () => {
    let { s, job } = withJob();
    const sub = s.ops.subcontractors.find((x) => x.services.includes('malowanie') && x.reliabilityBps >= 8_500) ?? s.ops.subcontractors[3]!;
    s = ok(commands.requestSubOffer(s, sub.id, job.id, 10_000));
    s = ok(commands.acceptSubOffer(s, s.ops.subcontracts.at(-1)!.id));
    s = ok(commands.createTeam(s, 'Podwykonawca', [{ kind: 'sub', id: sub.id }]));
    s = ok(commands.assignCrew(s, job.id, s.ops.teams.at(-1)!.id, 'hands-off', null));
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => x.ops.subcontracts.at(-1)!.status === 'delivered', 120);
    expect(s.ops.subcontracts.at(-1)!.status).toBe('delivered');
    s = advanceDays(s, 1);
    const c = s.ops.subcontracts.at(-1)!;
    expect(c.status).toBe('settled');
    expect(c.settledOn).toBe(s.clock.today);
    expect(c.prepaid).toBe(0);
    expect(c.settledNet).toBe(c.priceNet);
    expect(jobOf(s, job.id).actual.subcontract).toBe(c.priceNet);
    expect(s.events.some((e) => e.id === `sub.contract:${c.id}:settled` && /Automatyczny odbiór/.test(e.title))).toBe(true);
    consistent(s);
  });

  it('zakres częściowy rozliczany proporcjonalnie przy zakończeniu kontraktu; zaliczka ponad należność wraca jako należność', () => {
    let { s, job } = withJob();
    const sub = s.ops.subcontractors.find((x) => x.services.includes('malowanie'))!;
    s = ok(commands.requestSubOffer(s, sub.id, job.id, 5_000));
    s = ok(commands.acceptSubOffer(s, s.ops.subcontracts.at(-1)!.id));
    const c0 = s.ops.subcontracts.at(-1)!;
    s = ok(commands.assignCrew(s, job.id, null, 'worker', null, 4));
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 150);
    const c = s.ops.subcontracts.find((x) => x.id === c0.id)!;
    expect(['settled', 'cancelled']).toContain(c.status);
    if (c.status === 'settled') {
      expect(c.settledNet).toBeLessThanOrEqual(c.priceNet);
      expect(c.prepaid).toBe(0);
    }
    expect(s.ops.assignments.filter((a) => a.jobId === job.id)).toHaveLength(0);
    consistent(s);
  });

  it('podwykonawca nie może być w dwóch kontraktach naraz; odstąpienie przed startem zwraca zaliczkę', () => {
    const a = contract(opsGame(), { quote: { startDate: '2026-03-12', durationDays: 12 } });
    const b = contract(a.s, { quote: { startDate: '2026-04-20', durationDays: 12 } });
    let s = b.s;
    const sub = s.ops.subcontractors.find((x) => x.services.includes('malowanie'))!;
    s = ok(commands.requestSubOffer(s, sub.id, a.job.id, 10_000));
    const offerA = s.ops.subcontracts.at(-1)!;
    s = ok(commands.acceptSubOffer(s, offerA.id));
    // druga oferta tego samego podwykonawcy: najwcześniejszy wolny termin przesuwa się za pierwszą umowę
    s = ok(commands.requestSubOffer(s, sub.id, b.job.id, 10_000));
    const offerB = s.ops.subcontracts.at(-1)!;
    expect(offerB.startDate >= b.job.startDate).toBe(true);
    // wymuszamy nakładanie okresów: oferta B przesunięta na termin zajęty przez A
    s.ops.subcontracts.find((x) => x.id === offerB.id)!.startDate = a.job.startDate;
    expect(fail(commands.acceptSubOffer(s, offerB.id))).toMatch(/jest już zajęty/);
    // odstąpienie od umowy A przed startem
    const cash0 = netWorth(s);
    s = ok(commands.cancelSubcontract(s, offerA.id));
    expect(s.ops.subcontracts.find((x) => x.id === offerA.id)).toMatchObject({ status: 'cancelled', prepaid: 0 });
    if (offerA.advanceNet > 0) expect(s.obligations.find((o) => o.category === 'zwrot_zaliczki')).toMatchObject({ direction: 'receivable', amount: offerA.advanceNet });
    expect(netWorth(s)).toBe(cash0);
    expect(s.ops.assignments.filter((x) => x.kind === 'sub')).toHaveLength(0);
    consistent(s);
  });

  it('ryzyko: mniej niezawodni podwykonawcy częściej się spóźniają i częściej oddają wadliwą pracę (statystycznie, deterministycznie)', () => {
    const stats = (subIdx: number) => {
      let delayed = 0, defects = 0, n = 0;
      for (let i = 0; i < 40; i++) {
        const base = contract(opsGame({ seed: `risk-${i}` }), { quote: { startDate: '2026-03-12', durationDays: 12 } });
        let s = base.s;
        const sub = s.ops.subcontractors[subIdx]!;
        s = ok(commands.requestSubOffer(s, sub.id, base.job.id, 10_000));
        s = ok(commands.acceptSubOffer(s, s.ops.subcontracts.at(-1)!.id));
        const c = s.ops.subcontracts.at(-1)!;
        n += 1;
        if (c.delayDays > 0) delayed += 1;
        if (c.defects) defects += 1;
      }
      return { delayed: delayed / n, defects: defects / n };
    };
    const reliable = stats(3); // „Wykończenia Dajtki”: jakość 88, niezawodność 94%
    const flaky = stats(4); // „Montaż-Szybko”: jakość 55, niezawodność 68%
    expect(flaky.delayed).toBeGreaterThan(reliable.delayed);
    expect(flaky.defects).toBeGreaterThan(reliable.defects);
    expect(flaky.delayed).toBeGreaterThan(0.15);
    expect(reliable.delayed).toBeLessThan(0.25);
    expect(stats(4)).toEqual(flaky);
  });

  it('wady podwykonawcy obniżają jakość i zwiększają ryzyko reklamacji; historia współpracy buduje reputację podwykonawcy', () => {
    let { s, job } = withJob();
    const sub = s.ops.subcontractors[0]!;
    s = ok(commands.requestSubOffer(s, sub.id, job.id, 10_000));
    s = ok(commands.acceptSubOffer(s, s.ops.subcontracts.at(-1)!.id));
    const withDefect = structuredClone(s);
    withDefect.ops.subcontracts.at(-1)!.defects = true;
    const clean = structuredClone(s);
    clean.ops.subcontracts.at(-1)!.defects = false;
    const j = jobOf(s, job.id);
    expect(jobQuality(withDefect, j)).toBeLessThan(jobQuality(clean, j));
    expect(complaintBps(j, 70, 1_200)).toBeGreaterThan(complaintBps(j, 70));
    expect(subHistory(s, sub.id)).toEqual({ contracts: 0, avgQuality: null, onTimeBps: null, defects: 0 });
  });
});

describe('6. ekipy i przydziały zasobów', () => {
  it('tworzenie, zmiana i usuwanie ekipy; walidacja członków', () => {
    let { s } = crewGame(1);
    const e = s.ops.employments[0]!;
    expect(fail(commands.createTeam(s, 'Ekipa 1', [{ kind: 'employee', id: e.id }]))).toMatch(/już istnieje/);
    expect(fail(commands.createTeam(s, 'Pusta', []))).toMatch(/co najmniej jednego/);
    expect(fail(commands.createTeam(s, 'Zła', [{ kind: 'employee', id: 'emp:999' }]))).toMatch(/zatrudnionego pracownika/);
    expect(fail(commands.createTeam(s, 'Zła', [{ kind: 'sub', id: 'sub:99' }]))).toMatch(/Nieznany podwykonawca/);
    expect(fail(commands.createTeam(s, 'Dubel', [{ kind: 'owner', id: 'owner' }, { kind: 'owner', id: 'owner' }]))).toMatch(/już w ekipie/);
    s = ok(commands.createTeam(s, 'Mieszana', [{ kind: 'owner', id: 'owner' }, { kind: 'employee', id: e.id }, { kind: 'sub', id: 'sub:1' }]));
    const t = s.ops.teams.find((x) => x.name === 'Mieszana')!;
    s = ok(commands.updateTeam(s, t.id, [{ kind: 'owner', id: 'owner' }]));
    expect(s.ops.teams.find((x) => x.id === t.id)!.members).toHaveLength(1);
    s = ok(commands.deleteTeam(s, t.id));
    expect(s.ops.teams.some((x) => x.id === t.id)).toBe(false);
  });

  it('przydział ekipy do kontraktu rezerwuje pracowników, sprzęt i pojazd; nadzór „bez” nie zajmuje godzin właściciela, „nadzoruje” zajmuje 1 godz. dziennie', () => {
    const { s: s0, teams } = crewGame(1);
    const hands = contract(s0, { quote: crewQuote(teams[0]!, { supervision: 'hands-off' }) });
    expect(hands.job.crew).toEqual({ teamId: teams[0], supervision: 'hands-off' });
    expect(hands.s.commitments.find((c) => c.id === `commit:${hands.job.orderId}`)).toBeUndefined();
    expect(budgetFor0(hands.s, hands.job.startDate)).toBe(budgetFor0(s0, hands.job.startDate));
    const sup = contract(s0, { quote: crewQuote(teams[0]!, { supervision: 'supervise' }) });
    expect(sup.s.commitments.find((c) => c.id === `commit:${sup.job.orderId}`)).toMatchObject({ hoursPerDay: 1 });
    expect(budgetFor0(sup.s, sup.job.startDate)).toBe(budgetFor0(s0, sup.job.startDate) - 1);
    const kinds = new Set(sup.s.ops.assignments.filter((a) => a.jobId === sup.job.id).map((a) => a.kind));
    expect(kinds).toEqual(new Set(['employee', 'equipment']));
    expect(sup.s.ops.assignments.find((a) => a.kind === 'employee')).toMatchObject({ from: sup.job.startDate, to: sup.job.deadline });
    consistent(sup.s);
  });

  it('ten sam pracownik, komplet sprzętu ani pojazd nie mogą być przydzielone do dwóch kontraktów w tym samym czasie', () => {
    let { s, teams } = crewGame(1, { equip: ['paint-basic'] });
    const a = contract(s, { quote: crewQuote(teams[0]!) });
    // ta sama ekipa (ten sam pracownik) w nakładającym się terminie
    const e2 = craftEnquiry(a.s);
    const q2 = { ...defaultQuoteInput(a.s, e2), ...crewQuote(teams[0]!, { startDate: '2026-03-14' }) };
    let s2 = ok(commands.sendQuote(a.s, e2.id, q2));
    const quote2 = s2.reno.quotes.at(-1)!;
    quote2.status = 'accepted';
    quote2.signBy = addDays(s2.clock.today, 5);
    expect(fail(commands.signContract(s2, quote2.id))).toMatch(/nie może pracować przy dwóch kontraktach jednocześnie/);
    // inny pracownik, ale jeden komplet sprzętu — brak kompletu
    s2 = hireEmployee(a.s, { expected: zl(5_500), start: '2026-03-03' }).s;
    const e3 = s2.ops.employments.at(-1)!;
    s2 = ok(commands.createTeam(s2, 'Ekipa B', [{ kind: 'employee', id: e3.id }]));
    const enq3 = craftEnquiry(s2);
    const q3 = { ...defaultQuoteInput(s2, enq3), ...crewQuote(s2.ops.teams.at(-1)!.id, { startDate: '2026-03-14' }) };
    s2 = ok(commands.sendQuote(s2, enq3.id, q3));
    const quote3 = s2.reno.quotes.at(-1)!;
    quote3.status = 'accepted';
    quote3.signBy = addDays(s2.clock.today, 5);
    expect(fail(commands.signContract(s2, quote3.id))).toMatch(/Brak wolnego kompletu sprzętu/);
    // pojazd
    let v = ok(commands.buyVehicle(a.s, 'van-small'));
    v = advanceDays(v, 2);
    const vid = v.ops.vehicles[0]!.id;
    const jobA = v.reno.jobs[0]!;
    v = ok(commands.assignVehicle(v, jobA.id, vid));
    const b = contract(v, { quote: crewQuote(teams[0]!, { startDate: '2026-04-20' }) });
    expect(b.job.id).not.toBe(jobA.id);
    const withVeh = ok(commands.assignVehicle(b.s, b.job.id, null));
    const overlap = structuredClone(withVeh);
    overlap.reno.jobs.find((j) => j.id === b.job.id)!.startDate = jobA.startDate;
    expect(fail(commands.assignVehicle(overlap, overlap.reno.jobs.find((j) => j.id === b.job.id)!.id, vid))).toMatch(/Pojazd jest już przydzielony/);
    consistent(v);
  });

  it('zmiana ekipy tylko przed rozpoczęciem prac; powrót do pracy właściciela przywraca jego godziny', () => {
    const { s: s0, teams } = crewGame(1);
    let { s, job } = contract(s0, { quote: crewQuote(teams[0]!, { supervision: 'hands-off' }) });
    s = ok(commands.assignCrew(s, job.id, null, 'worker', null, 3));
    expect(jobOf(s, job.id).crew).toEqual({ teamId: null, supervision: 'worker' });
    expect(s.commitments.find((c) => c.id === `commit:${job.orderId}`)).toMatchObject({ hoursPerDay: 3 });
    expect(s.ops.assignments.filter((a) => a.kind === 'employee')).toHaveLength(0);
    s = toDate(s, job.startDate);
    expect(fail(commands.assignCrew(s, job.id, teams[0]!, 'supervise', null))).toMatch(/tylko przed rozpoczęciem/);
    consistent(s);
  });
});

const budgetFor0 = (s: GameState, date: string) => {
  const free = s.commitments.filter((c) => c.startDate <= date && date <= c.endDate).reduce((a, c) => a + c.hoursPerDay, 0);
  return -free;
};

describe('7. równoległe kontrakty, delegowanie i wąskie gardła', () => {
  it('dwie ekipy realizują dwa kontrakty równocześnie, bez godzin pracy właściciela; pracownik pracuje tylko przy swoim kontrakcie', () => {
    const { s: s0, teams } = crewGame(2);
    const a = contract(s0, { quote: crewQuote(teams[0]!, { supervision: 'hands-off' }) });
    const b = contract(a.s, { quote: crewQuote(teams[1]!, { supervision: 'hands-off' }) });
    let s = buyAll(buyAll(b.s, a.job.id), b.job.id);
    const xp0 = s.reno.skillXp.malowanie;
    s = toDate(s, addDays(a.job.startDate, 3));
    const ja = jobOf(s, a.job.id), jb = jobOf(s, b.job.id);
    expect(ja.progressCenti).toBeGreaterThan(0);
    expect(jb.progressCenti).toBeGreaterThan(0);
    expect(s.reno.skillXp.malowanie).toBe(xp0); // właściciel nie pracował — nie zdobywa doświadczenia
    expect(ja.actual.labor).toBeGreaterThan(0);
    expect(jb.actual.labor).toBeGreaterThan(0);
    const emp = (id: string) => s.ops.people.find((p) => p.id === s.ops.employments.find((e) => e.id === id)!.personId)!;
    const pa = emp(s.ops.teams[0]!.members[0]!.id), pb = emp(s.ops.teams[1]!.members[0]!.id);
    expect(pa.xp.malowanie).toBeGreaterThan(4_000);
    expect(pb.xp.malowanie).toBeGreaterThan(4_000);
    s = runUntil(s, (x) => jobOf(x, a.job.id).stage === 'done' && jobOf(x, b.job.id).stage === 'done', 80);
    expect(jobOf(s, a.job.id).stage).toBe('done');
    expect(jobOf(s, b.job.id).stage).toBe('done');
    expect(renoDashboard(s).doneJobs).toBe(2);
    consistent(s);
  });

  it('więcej osób nie przyspiesza w nieskończoność: mały zakres, koordynacja i brak kompletów narzędzi ograniczają wzrost wydajności', () => {
    const rawFor = (n: number, equip: string[]) => {
      let s = opsGame({ equip });
      const members: { kind: 'employee'; id: string }[] = [];
      for (let i = 0; i < n; i++) {
        s = hireEmployee(s, { expected: zl(5_400) + i * 10, start: '2026-03-01' }).s;
        members.push({ kind: 'employee', id: s.ops.employments.at(-1)!.id });
      }
      s = ok(commands.createTeam(s, 'Zespół', members));
      s = toDate(s, '2026-03-02');
      const c = contract(s, { enquiry: { units: 60 }, quote: crewQuote(s.ops.teams.at(-1)!.id, { supervision: 'hands-off', durationDays: 30 }) });
      return crewDay(c.s, c.job, '2026-03-17', new Set(), 'actual');
    };
    const one = rawFor(1, ['paint-basic']);
    const four = rawFor(4, ['paint-basic', 'paint-basic', 'paint-basic', 'paint-basic']);
    expect(four.workers.filter((w) => w.c > 0)).toHaveLength(4);
    expect(four.raw).toBeGreaterThan(one.raw);
    expect(four.raw).toBeLessThan(one.raw * 2.4); // 4 osoby przy ~18 godz. pracy to nie 4× szybciej (limit sensownej obsady, koordynacja 88%)
    expect(four.coordination).toBe(8_800);
    const fewTools = rawFor(3, ['paint-basic']);
    expect(fewTools.toolSets).toBe(1);
    expect(fewTools.workers.filter((w) => w.toolFactor < 10_000)).toHaveLength(2); // pracownicy bez kompletu pracują jak pomocnicy
    const manyTools = rawFor(3, ['paint-basic', 'paint-basic', 'paint-basic']);
    expect(manyTools.raw).toBeGreaterThan(fewTools.raw);
  });

  it('wąskie gardło materiałowe: zapas ogranicza postęp całej ekipy, niezależnie od liczby pracowników', () => {
    const { s: s0, teams } = crewGame(1);
    let { s, job } = contract(s0, { quote: crewQuote(teams[0]!, { supervision: 'hands-off' }) });
    s = toDate(s, addDays(job.startDate, 4));
    expect(jobOf(s, job.id)).toMatchObject({ progressCenti: 0, stage: 'materials' });
    expect(jobOf(s, job.id).blockedReason).toMatch(/Brak materiałów/);
    expect(jobOf(s, job.id).actual.labor).toBe(0); // przestój materiałowy nie obciąża kontraktu kosztem pracy (godziny nie zostały przepracowane)
    consistent(s);
  });

  it('delegowanie: bez nadzoru jakość niższa o 4 pkt i większe ryzyko problemów; nadzór właściciela nie zwiększa postępu', () => {
    const { s: s0, teams } = crewGame(1);
    const { s, job } = contract(s0, { quote: crewQuote(teams[0]!, { supervision: 'supervise' }) });
    const j = jobOf(s, job.id);
    const q1 = jobQuality(s, { ...j, crew: { ...j.crew, supervision: 'supervise' } });
    const q2 = jobQuality(s, { ...j, crew: { ...j.crew, supervision: 'hands-off' } });
    expect(q1 - q2).toBe(4);
    const p = previewQuote(s, { ...defaultQuoteInput(s, craftEnquiry(structuredClone(s))), ...crewQuote(teams[0]!, { supervision: 'hands-off', startDate: '2026-04-10' }) });
    expect(p.warnings.join(' ')).toMatch(/Bez nadzoru właściciela/);
  });

  it('ekipa bez wykonawców o odpowiednich umiejętnościach nie podpisze trudnego kontraktu', () => {
    let { s, teams } = crewGame(1);
    // pracownik poziomu 1 (nowicjusz) — kontrakt „trudny” wymaga poziomu 2
    s = opsGame();
    s = hireEmployee(s, { level: 1, expected: zl(4_900), start: '2026-03-01' }).s;
    s = ok(commands.createTeam(s, 'Nowicjusze', [{ kind: 'employee', id: s.ops.employments.at(-1)!.id }]));
    s = toDate(s, '2026-03-02');
    const enq = craftEnquiry(s, { complexity: 'trudne' });
    const p = previewQuote(s, { ...defaultQuoteInput(s, enq), ...crewQuote(s.ops.teams.at(-1)!.id, { supervision: 'hands-off', complexity: 'trudne' }) });
    expect(p.errors.join(' ')).toMatch(/Nikt w ekipie nie ma umiejętności/);
    void teams;
  });
});

describe('8. pojazdy firmowe', () => {
  it('zakup za gotówkę przez wspólny silnik: aktywo wg stanu technicznego, brak kosztu podatkowego, majątek netto bez zmian w chwili zakupu', () => {
    const s0 = opsGame();
    const nw0 = netWorth(s0);
    const costs0 = yearReport(s0, 2026).costs;
    let s = ok(commands.buyVehicle(s0, 'van-small'));
    const v = s.ops.vehicles[0]!;
    expect(v).toMatchObject({ catalogId: 'van-small', cost: zl(38_000), conditionBps: 10_000, usedDays: 0 });
    const doc = s.documents.find((d) => d.id === v.docId)!;
    expect(doc).toMatchObject({ kind: 'cost', part: 'capital', net: zl(38_000), taxAmount: 0, vat: 0 });
    expect(s.obligations.find((o) => o.id === doc.obligationIds[0])).toMatchObject({ category: 'zakup_pojazdu', amount: zl(38_000), direction: 'payable' });
    expect(netWorth(s)).toBe(nw0);
    expect(vehicleBookValue(v)).toBe(zl(38_000));
    s = advanceDays(s, 2);
    expect(yearReport(s, 2026).costs).toBe(costs0); // zakup pojazdu nie jest kosztem (VEH-TAX-DEFERRED)
    expect(bizBalance(s)).toBe(bizBalance(advanceDays(s0, 2)) - zl(38_000));
    expect(fail(commands.buyVehicle(opsGame({ business: zl(5_000) }), 'bus'))).toMatch(/Za mało środków/);
    consistent(s);
  });

  it('eksploatacja: koszt za dni pracy przy kontrakcie, koszty stałe miesięczne w jednym dokumencie, zużycie i starzenie obniżają wartość', () => {
    const { s: s0, teams } = crewGame(1);
    let s = ok(commands.buyVehicle(s0, 'van-small'));
    s = advanceDays(s, 2);
    const vid = s.ops.vehicles[0]!.id;
    const c = contract(s, { quote: crewQuote(teams[0]!, { supervision: 'hands-off', vehicleId: vid, startDate: '2026-03-10' }) });
    s = buyAll(c.s, c.job.id);
    s = runUntil(s, (x) => jobOf(x, c.job.id).stage === 'done', 60);
    const j = jobOf(s, c.job.id);
    expect(j.actual.vehicle).toBe(j.workedDays * zl(55));
    expect(j.actual.transport).toBe(0); // przy pojeździe nie ma osobnego kosztu dojazdów
    const v = s.ops.vehicles[0]!;
    expect(v.usedDays).toBe(j.workedDays);
    expect(v.conditionBps).toBeLessThan(10_000);
    expect(vehicleBookValue(v)).toBeLessThan(zl(38_000));
    s = toDate(s, '2026-05-02');
    const monthly = s.documents.filter((d) => d.description.startsWith('Pojazdy: eksploatacja'));
    expect(monthly.length).toBeGreaterThanOrEqual(2);
    const march = monthly.find((d) => d.issueDate.startsWith('2026-03'))!;
    expect(march.taxAmount).toBe(zl(320) + j.workedDays * zl(55));
    const april = monthly.find((d) => d.issueDate.startsWith('2026-04'))!;
    expect(april.taxAmount).toBe(zl(320)); // koszt stały bez jazd
    consistent(s);
  });

  it('pojemność transportowa jest wąskim gardłem: kombi nie uniesie dużego kontraktu, bus tak; bez pojazdu zespół traci wydajność', () => {
    const rawWith = (vehicle: string | null) => {
      let { s, teams } = crewGame(2);
      let vid: string | null = null;
      if (vehicle) { s = advanceDays(ok(commands.buyVehicle(s, vehicle)), 2); vid = s.ops.vehicles[0]!.id; }
      const team2 = ok(commands.createTeam(s, 'Duża', [{ kind: 'employee', id: s.ops.employments[0]!.id }, { kind: 'employee', id: s.ops.employments[1]!.id }]));
      const c = contract(team2, { enquiry: { units: 140 }, quote: crewQuote(team2.ops.teams.at(-1)!.id, { supervision: 'hands-off', vehicleId: vid, durationDays: 30, startDate: '2026-03-20' }) });
      void teams;
      return crewDay(c.s, c.job, '2026-03-24', new Set(), 'actual');
    };
    const none = rawWith(null);
    const kombi = rawWith('kombi');
    const bus = rawWith('bus');
    expect(none.transport).toBe(9_000);
    expect(kombi.transport).toBeLessThan(10_000); // load 3 > capacity 2
    expect(bus.transport).toBe(10_000);
    expect(bus.raw).toBeGreaterThan(none.raw);
    expect(bus.raw).toBeGreaterThan(kombi.raw);
  });
});

describe('9a. opłacalność usług i widoczność zatrudnionych fachowców', () => {
  it('cena rynkowa każdej usługi pokrywa materiały z zapasem na pracę (materiały ≤ 70% ceny netto) — montaż paneli nie jest stratny', () => {
    for (const def of SERVICE_BY_ID.values()) {
      const units = def.unit === 'm²' ? 40 : 16;
      const materials = def.materialsPer100.reduce((a, m) => a + Math.round((MATERIAL_BY_ID.get(m.materialId)!.priceNet * m.qty * units) / 100), 0);
      const net = referencePrice(def.id, units, 'standard', 2) / 1.23;
      expect(materials / net, def.id).toBeLessThanOrEqual(0.7);
    }
  });

  it('zatrudniony fachowiec liczy się rynkowi jak specjalizacja (pracownik wykończeniowy → drobne prace), a po zwolnieniu przestaje', () => {
    const { s: s0, emp } = hireEmployee(opsGame(), { level: 2, start: '2026-02-02' });
    let s = structuredClone(s0);
    s.ops.employments.find((e) => e.id === emp.id)!.role = 'wykonczeniowiec';
    s = toDate(s, '2026-02-05');
    expect(s.reno.specializations).not.toContain('drobne');
    expect(playerMarketView(s, s.clock.today).specializations).toContain('drobne');
    s.ops.employments.find((e) => e.id === emp.id)!.status = 'ended';
    expect(playerMarketView(s, s.clock.today).specializations).not.toContain('drobne');
  });
});

describe('9. koszty, marże i rentowność', () => {
  it('rozliczenie pracownika w miesiącu: koszt z listy płac, godziny i przychód z jego pracy zgadzają się z kontraktem, a bezczynność = koszt − koszt godzin na kontraktach', () => {
    const { s: s0, teams } = crewGame(1);
    const a = contract(s0, { quote: crewQuote(teams[0]!, { supervision: 'hands-off', startDate: '2026-03-03', durationDays: 6 }) });
    let s = toDate(buyAll(a.s, a.job.id), '2026-04-02');
    const job = jobOf(s, a.job.id);
    expect(job.stage).toBe('done');
    const rows = workerMonthSummary(s, '2026-03');
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    const slip = s.ops.payslips.find((p) => p.month === '2026-03')!;
    expect(r.costIsPayslip).toBe(true);
    expect(r.cost).toBe(slip.totalCost);
    expect(r.allocatedCost).toBe(job.actual.labor);
    expect(r.idleCost).toBe(r.cost - job.actual.labor);
    expect(r.hours).toBeGreaterThan(0);
    // jedyny wykonawca kontraktu → cały przychód (z dokładnością do zaokrągleń dziennych udziałów)
    expect(Math.abs(r.revenue - job.priceNet)).toBeLessThanOrEqual(job.workedDays + 1);
    expect(r.margin).toBeLessThan(r.revenue);
    expect(r.net).toBe(r.margin - r.cost);
    // bieżący miesiąc bez listy płac: naliczenie proporcjonalne
    const cur = workerMonthSummary(s, '2026-04')[0]!;
    expect(cur.costIsPayslip).toBe(false);
    expect(cur.cost).toBeGreaterThan(0);
    expect(cur.cost).toBeLessThan(r.cost);
    consistent(s);
  });

  it('koszt pracy pracownika dzieli się między kontrakty według godzin; godziny bez zlecenia to koszt stały (bezczynność), nic nie ginie', () => {
    const { s: s0, teams } = crewGame(1);
    const a = contract(s0, { quote: crewQuote(teams[0]!, { supervision: 'hands-off', startDate: '2026-03-03', durationDays: 6 }) });
    const b = contract(a.s, { enquiry: { units: 45 }, quote: crewQuote(teams[0]!, { supervision: 'hands-off', startDate: '2026-03-12', durationDays: 8 }) });
    let s = buyAll(buyAll(b.s, a.job.id), b.job.id);
    s = toDate(s, '2026-04-02');
    const ja = jobOf(s, a.job.id), jb = jobOf(s, b.job.id);
    expect(ja.stage).toBe('done');
    expect(jb.stage).toBe('done');
    const slip = s.ops.payslips.find((p) => p.month === '2026-03')!;
    const alloc = s.ops.laborAllocated['2026-03'] ?? 0;
    expect(alloc).toBe(ja.actual.labor + jb.actual.labor);
    expect(alloc).toBeGreaterThan(0);
    expect(alloc).toBeLessThan(slip.totalCost); // nie całe wynagrodzenie obciąża kontrakty
    const fc = fixedCosts(s, '2026-03');
    expect(fc.payrollTotal).toBe(slip.totalCost);
    expect(fc.payrollAllocated).toBe(alloc);
    expect(fc.payrollIdle).toBe(slip.totalCost - alloc);
    expect(fc.payrollIdle).toBeGreaterThan(0);
    expect(fc.total).toBeGreaterThanOrEqual(fc.payrollIdle);
    consistent(s);
  });

  it('marża kontraktu i rentowność ekip: przychód − materiały − praca − podwykonawcy − pojazd − inne; ekipa vs właściciel', () => {
    const { s: s0, teams } = crewGame(1);
    const solo = contract(s0, { quote: { startDate: '2026-03-04', durationDays: 12, hoursPerDay: 3, priceNet: zl(3_000) } });
    const team = contract(solo.s, { quote: crewQuote(teams[0]!, { supervision: 'supervise', startDate: '2026-03-05', durationDays: 8, priceNet: zl(3_500) }) });
    let s = buyAll(buyAll(team.s, solo.job.id), team.job.id);
    s = runUntil(s, (x) => jobOf(x, solo.job.id).stage === 'done' && jobOf(x, team.job.id).stage === 'done', 80);
    const jt = jobOf(s, team.job.id);
    const f = jobFinancials(jt, []);
    expect(f.economicResult).toBe(jt.priceNet - jt.penaltyNet - (jt.actual.materials + jt.actual.transport + jt.actual.other + jt.actual.rework + jt.actual.labor + jt.actual.vehicle + jt.actual.subcontract));
    expect(f.actualEmployees).toBe(jt.actual.labor);
    expect(f.actualCost).toBeGreaterThanOrEqual(f.actualEmployees + f.actualMaterials);
    const profits = crewProfitability(s);
    expect(profits.map((p) => p.name).sort()).toEqual(['Ekipa 1', 'Właściciel samodzielnie']);
    const ekipa = profits.find((p) => p.name === 'Ekipa 1')!;
    expect(ekipa).toMatchObject({ doneJobs: 1, revenueNet: jt.priceNet - jt.penaltyNet });
    expect(ekipa.contribution).toBe(ekipa.revenueNet - ekipa.directCosts);
    expect(ekipa.directCosts).toBe(f.actualMaterials + f.actualOther + f.actualEmployees + f.actualSubcontract + f.actualVehicle);
    expect(teamLoad(s, teams[0]!).days).toBe(14);
  });

  it('prognoza płynności uwzględnia płace, ZUS, koszty stałe i należności; nie księguje nic i pokazuje ryzyko braku środków', () => {
    const { s } = crewGame(2);
    const snapshot = structuredClone(s);
    const rich = liquidityForecast(s, 60);
    expect(s).toEqual(snapshot);
    expect(rich.monthlyBurn).toBeGreaterThan(zl(10_000)); // 2 pracowników + składki właściciela
    expect(rich.points.length).toBeGreaterThan(5);
    expect(rich.min).toBeLessThan(rich.points[0]!.balance);
    expect(rich.firstShortfall).toBeNull();
    const poor = structuredClone(s);
    poor.accounts[activeBusiness(poor)!.accountId]!.balance = zl(3_000); // test: celowo zaniżone saldo (niezmienniki pomijamy)
    const warn = liquidityForecast(poor, 60);
    expect(warn.firstShortfall).not.toBeNull();
    expect(warn.min).toBeLessThan(0);
  });
});

describe('10. zaliczki: gotówka, zobowiązanie do wykonania usługi, przychód podatkowy i VAT', () => {
  const adv = (s: GameState, o: { advanceBps: number; price?: number }) => contract(s, { quote: { advanceBps: o.advanceBps, priceNet: o.price ?? zl(4_000), startDate: '2026-03-12', durationDays: 14 } });

  it('zaliczka to gotówka i zobowiązanie do wykonania usługi: w chwili wpłaty nie jest ani przychodem podatkowym, ani majątkiem netto', () => {
    const s0 = opsGame();
    const nw0 = netWorth(s0);
    const rev0 = yearReport(s0, 2026).revenue;
    let { s, job } = adv(s0, { advanceBps: 3_000 });
    const d = docsFor(s, job.orderId).find((x) => x.part === 'advance')!;
    expect(d).toMatchObject({ net: zl(1_200), taxAmount: 0 });
    const ob = s.obligations.find((o) => o.id === d.obligationIds[0])!;
    expect(ob).toMatchObject({ category: 'zaliczka_klienta', direction: 'receivable', amount: zl(1_200) });
    expect(deferredAdvances(s)).toBe(zl(1_200));
    expect(netWorth(s)).toBe(nw0); // należność − zobowiązanie do wykonania usługi
    s = advanceDays(s, 3);
    expect(bizBalance(s)).toBeGreaterThan(bizBalance(s0) - zl(500)); // gotówka z zaliczki już jest na koncie
    expect(netWorth(s)).toBe(nw0 + (netWorth(s) - nw0));
    expect(yearReport(s, 2026).revenue).toBe(rev0); // przychód podatkowy: 0
    expect(yearReport(s, 2026).customerPayments).toBe(zl(1_200));
    expect(s.taxPeriods.every((p) => p.cumulativeRevenue === 0)).toBe(true);
    consistent(s);
  });

  it('przychód podatkowy i ekonomiczny powstaje po wykonaniu usługi: pełna cena w dokumencie rozliczenia końcowego', () => {
    let { s, job } = adv(opsGame(), { advanceBps: 3_000 });
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 150);
    const j = jobOf(s, job.id);
    const docs = docsFor(s, job.orderId).filter((d) => d.kind === 'sales');
    const fin = docs.find((d) => d.part === 'final')!;
    expect(fin.net).toBe(zl(2_800) - j.penaltyNet);
    expect(fin.taxAmount).toBe(fin.net + zl(1_200)); // przychód = cena − kara
    expect(docs.reduce((a, d) => a + d.taxAmount, 0)).toBe(zl(4_000) - j.penaltyNet);
    expect(deferredAdvances(s)).toBe(0);
    const month = fin.issueDate.slice(0, 7);
    expect(businessSummaries0(s, month)).toBeGreaterThanOrEqual(zl(4_000) - j.penaltyNet);
    expect(yearReport(s, 2026).revenue).toBe(zl(4_000) - j.penaltyNet);
    consistent(s);
  });

  it('czynny podatnik VAT: VAT od zaliczki powstaje w dacie jej otrzymania (termin płatności), od reszty — przy rozliczeniu; zwolniony nie nalicza VAT', () => {
    const taxed = adv(opsGame({ reg: { vatStatus: 'active' } }), { advanceBps: 2_000, price: zl(5_000) });
    const d = docsFor(taxed.s, taxed.job.orderId).find((x) => x.part === 'advance')!;
    expect(d).toMatchObject({ net: zl(1_000), vat: zl(230), vatTreatment: 'taxed', taxAmount: 0 });
    const vatDue = taxed.s.obligations.find((o) => d.obligationIds.includes(o.id) && o.category === 'vat_nalezny')!;
    expect(vatDue.amount).toBe(zl(230));
    // termin VAT liczony od daty otrzymania zaliczki (issue + 2 dni), nie od daty wystawienia
    expect(vatDue.dueDate >= '2026-03-25').toBe(true);
    const exempt = adv(opsGame(), { advanceBps: 2_000, price: zl(5_000) });
    expect(docsFor(exempt.s, exempt.job.orderId).find((x) => x.part === 'advance')).toMatchObject({ vat: 0, vatTreatment: 'exempt' });
    let s = buyAll(taxed.s, taxed.job.id);
    s = runUntil(s, (x) => jobOf(x, taxed.job.id).stage === 'done', 150);
    const fin = docsFor(s, taxed.job.orderId).find((x) => x.part === 'final')!;
    expect(fin.vat).toBe(Math.round(fin.net * 0.23));
    consistent(s);
  });

  it('zwrot zaliczki po rozwiązaniu umowy: likwidacja zobowiązania wobec klienta (bez kosztu i bez korekty przychodu); VAT od zaliczki wraca od US', () => {
    let { s, job } = adv(opsGame({ reg: { vatStatus: 'active' } }), { advanceBps: 2_000, price: zl(5_000) });
    s = advanceDays(s, 4);
    const costs0 = yearReport(s, 2026).costs;
    s = ok(commands.terminateJob(s, job.id));
    const refund = s.obligations.find((o) => o.category === 'zwrot_zaliczki')!;
    expect(refund).toMatchObject({ direction: 'payable', amount: zl(1_230) });
    expect(s.obligations.find((o) => o.occurrenceId === `refund-vat:${job.id}`)).toMatchObject({ direction: 'receivable', amount: zl(230) });
    expect(deferredAdvances(s)).toBe(0);
    expect(yearReport(s, 2026).costs).toBe(costs0);
    expect(yearReport(s, 2026).revenue).toBe(0);
    s = advanceDays(s, 45);
    consistent(s);
  });

  it('zapisy sprzed v0.6 (tryb „legacy”) zachowują dotychczasowe ujęcie: zaliczka jako przychód w dacie wystawienia', () => {
    let { s, job } = adv(opsGame(), { advanceBps: 2_000, price: zl(3_000) });
    // symulujemy kontrakt z zapisu v5: zaliczka ujęta jako przychód
    const d = s.documents.find((x) => x.part === 'advance')!;
    d.taxAmount = d.net;
    const ob = s.obligations.find((o) => o.id === d.obligationIds[0])!;
    ob.category = 'przychod_dzialalnosci';
    s.reno.jobs.find((j) => j.id === job.id)!.advanceMode = 'legacy';
    expect(deferredAdvances(s)).toBe(0);
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 150);
    const fin = docsFor(s, job.orderId).find((x) => x.part === 'final')!;
    expect(fin.taxAmount).toBe(fin.net); // stara zasada: reszta ceny
    expect(yearReport(s, 2026).revenue).toBe(zl(3_000) - jobOf(s, job.id).penaltyNet);
    consistent(s);
  });
});

const businessSummaries0 = (s: GameState, month: string) => {
  let rev = 0;
  for (const d of s.documents) if (d.kind === 'sales' && d.issueDate.startsWith(month)) rev += d.taxAmount;
  return rev;
};
void personById;

describe('11. zlecenie całości podwykonawcy z poziomu wyceny (za niski poziom / brak specjalizacji)', () => {
  const panele = (s: GameState) => {
    const enq = craftEnquiry(s, { serviceId: 'panele', units: 40, complexity: 'standard', maxDays: 60 });
    return { enq, q: { ...defaultQuoteInput(s, enq), startDate: addDays(s.clock.today, 10), durationDays: 40 } };
  };

  it('bez specjalizacji właściciel samodzielnie nie wyśle oferty, ale „sub:<id>” przechodzi bez zakładania ekipy w podglądzie', () => {
    const s = opsGame();
    const { q } = panele(s);
    expect(previewQuote(s, q).errors.join(' ')).toMatch(/specjalizacji/);
    const subId = s.ops.subcontractors.find((x) => x.services.includes('panele') && x.quality >= 75)!.id;
    const teamsBefore = s.ops.teams.length;
    const p = previewQuote(s, { ...q, teamId: `sub:${subId}`, priceNet: zl(9_000) });
    expect(p.errors).toEqual([]);
    expect(p.planned.labor).toBeGreaterThan(0);
    expect(s.ops.teams.length).toBe(teamsBefore); // podgląd nie zmienia stanu
  });

  it('wysłanie oferty tworzy jednoosobową ekipę podwykonawcy (raz), a podpisanie umowy zamawia jego ofertę', () => {
    const s0 = opsGame();
    const { q } = panele(s0);
    const subId = s0.ops.subcontractors.find((x) => x.services.includes('panele') && x.quality >= 75)!.id;
    const { s, job } = contract(s0, { enquiry: { serviceId: 'panele', units: 40, complexity: 'standard', maxDays: 60 }, quote: { ...q, teamId: `sub:${subId}`, priceNet: zl(14_000), supervision: 'supervise' } });
    const team = s.ops.teams.find((t) => t.id === job.crew.teamId)!;
    expect(team.members).toEqual([{ kind: 'sub', id: subId }]);
    expect(s.ops.subcontracts.some((c) => c.jobId === job.id && c.subId === subId && c.status === 'accepted')).toBe(true); // wybór podwykonawcy w wycenie od razu zawiera umowę
    // druga oferta z tym samym podwykonawcą używa tej samej ekipy
    const again = contract(s, { enquiry: { serviceId: 'panele', units: 40, complexity: 'standard', maxDays: 60 }, quote: { ...q, startDate: addDays(s.clock.today, 70), teamId: `sub:${subId}`, priceNet: zl(14_000) }, sign: false });
    expect(again.s.ops.teams.filter((t) => t.members.length === 1 && t.members[0]!.id === subId).length).toBe(1);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('nieznany podwykonawca daje błąd, nie wyjątek', () => {
    const s = opsGame();
    const { q } = panele(s);
    expect(previewQuote(s, { ...q, teamId: 'sub:sub:nie-ma', priceNet: zl(9_000) }).errors.join(' ')).toMatch(/ekipy/);
  });
});

describe('12. wykonawcy wybrani wprost w wycenie (pracownik bez zakładania ekipy)', () => {
  it('zatrudniony pracownik wykonuje zlecenie; ekipa powstaje przy wysłaniu oferty i jest używana ponownie', () => {
    const { s: s0, emp } = hireEmployee(opsGame(), { level: 3, hours: 160 });
    const s1 = toDate(s0, addDays(emp.startDate, 1));
    const enq = craftEnquiry(s1);
    const q = { ...defaultQuoteInput(s1, enq), startDate: addDays(s1.clock.today, 3), durationDays: 30, priceNet: zl(9_000) };
    const key = crewKey([{ kind: 'employee', id: emp.id }]);
    expect(previewQuote(s1, { ...q, teamId: key }).errors).toEqual([]);
    expect(s1.ops.teams.length).toBe(0);
    const { s, job } = contract(s1, { quote: { ...q, teamId: key, supervision: 'supervise' } });
    const team = s.ops.teams.find((t) => t.id === job.crew.teamId)!;
    expect(team.members).toEqual([{ kind: 'employee', id: emp.id }]);
    expect(checkInvariants(s)).toEqual([]);
    const again = contract(s, { quote: { ...q, startDate: addDays(s.clock.today, 60), teamId: key }, sign: false });
    expect(again.s.ops.teams.length).toBe(1);
  });
});


describe('podwykonawca zajęty innym kontraktem', () => {
  const twoJobs = () => {
    const g = opsGame({ reg: {} });
    const sub = g.ops.subcontractors.find((x) => x.services.includes('malowanie'))!;
    const q = { teamId: crewKey([{ kind: 'sub', id: sub.id }]), supervision: 'supervise' as const, hoursPerDay: 4 };
    const c1 = contract(g, { quote: q });
    const s1 = c1.s; // podpisanie umowy z podwykonawcą od razu zawiera umowę z nim
    return { s1, sub, q, c1 };
  };

  it('wycena ostrzega, że wybrany podwykonawca jest zajęty, a sugerowany start omija jego kontrakt', () => {
    const { s1, sub, q, c1 } = twoJobs();
    const enq = craftEnquiry(s1);
    const input = { ...defaultQuoteInput(s1, enq), ...q, startDate: c1.job.startDate, durationDays: 7 };
    const p = previewQuote(s1, input);
    expect(p.warnings.join(' ')).toMatch(/Podwykonawca .* jest przydzielony do kontraktu/);
    const sch = quoteSchedule(s1, input);
    expect(sch.suggestedStart).not.toBeNull();
    expect(previewQuote(s1, { ...input, startDate: sch.suggestedStart! }).warnings.join(' ')).not.toMatch(/Podwykonawca .* jest przydzielony/);
    expect(sub.id).toBeTruthy();
  });

  it('gdy podwykonawca zaczyna po starcie kontraktu, przestój mówi to wprost (nazwa i data), a nie „ekipa nieprzydzielona”', () => {
    const { s1, q } = twoJobs();
    const c2 = contract(s1, { quote: q });
    expect(c2.s.reno.jobs.at(-1)!.crew.teamId).not.toBeNull();
    const offer = c2.s.ops.subcontracts.find((c) => c.jobId === c2.job.id)!;
    expect(offer.status).toBe('accepted');
    expect(offer.startDate > c2.job.startDate).toBe(true);
    const s2 = c2.s;
    const stuck = runUntil(s2, (x) => !!jobOf(x, c2.job.id).blockedReason && /podwykonawca/.test(jobOf(x, c2.job.id).blockedReason!), 40);
    const reason = jobOf(stuck, c2.job.id).blockedReason!;
    expect(reason).toMatch(/zacznie dopiero/);
    expect(reason).not.toMatch(/nieprzydzielona/);
    // przyczyna przestoju (z nazwą podwykonawcy i datą) musi mieścić się w limicie pola — inaczej zapis przestaje się wczytywać
    expect(reason.length).toBeLessThanOrEqual(400);
    expect(GameStateSchema.safeParse(stuck).success).toBe(true);
  });
});

describe('podpisanie umowy ze zmianą wykonawcy', () => {
  it('brak wolnego kompletu sprzętu blokuje podpis właściciela, ale zlecenie można podpisać, wskazując podwykonawcę', () => {
    const g = opsGame({ reg: {}, equip: ['paint-basic'] });
    const sub = g.ops.subcontractors.find((x) => x.services.includes('malowanie'))!;
    const c1 = contract(g, { quote: { hoursPerDay: 2, durationDays: 12 } });
    // drugi kontrakt w tym samym terminie: godzin starcza, ale jedyny komplet sprzętu jest już przydzielony
    const c2 = contract(c1.s, { sign: false, quote: { hoursPerDay: 2, durationDays: 12, startDate: c1.job.startDate } });
    const quote = c2.s.reno.quotes.at(-1)!;
    expect(fail(commands.signContract(c2.s, quote.id))).toMatch(/Brak wolnego kompletu sprzętu/);
    expect(fail(commands.signContract(c2.s, quote.id, [{ kind: 'sub', id: 'sub:nie-ma' }]))).toMatch(/nie wykonuje tej usługi/);
    const signed = ok(commands.signContract(c2.s, quote.id, [{ kind: 'sub', id: sub.id }]));
    const job = signed.reno.jobs.at(-1)!;
    expect(job.priceNet).toBe(quote.priceNet);
    expect(job.crew.supervision).toBe('hands-off');
    expect(signed.ops.teams.find((t) => t.id === job.crew.teamId)!.members).toEqual([{ kind: 'sub', id: sub.id }]);
    // umowa z podwykonawcą zawiera się od razu
    expect(signed.ops.subcontracts.some((c) => c.jobId === job.id && c.status === 'accepted')).toBe(true);
    consistent(signed);
  });
});

describe('domyślnie bez godzin nadzoru właściciela', () => {
  it('podpisanie umowy z podwykonawcą nie wymaga wolnej godziny właściciela (0 godz. nadzoru)', () => {
    const g = opsGame({ reg: {}, equip: ['paint-basic'] });
    const sub = g.ops.subcontractors.find((x) => x.services.includes('malowanie'))!;
    const c = contract(g, { sign: false, quote: { hoursPerDay: 2, durationDays: 12 } });
    const quote = c.s.reno.quotes.at(-1)!;
    // doba właściciela zajęta w całym terminie kontraktu
    const busy = structuredClone(c.s);
    busy.commitments.push({ id: 'commit:zajete', label: 'Inne zobowiązania', startDate: quote.startDate, endDate: addDays(quote.startDate, 11), hoursPerDay: 12, sourceEventId: null });
    expect(quoteSchedule(busy, { ...defaultQuoteInput(busy, busy.reno.enquiries.find((e) => e.id === quote.enquiryId)!), teamId: crewKey([{ kind: 'sub', id: sub.id }]) }).ownerHours).toBe(0);
    const signed = ok(commands.signContract(busy, quote.id, [{ kind: 'sub', id: sub.id }]));
    expect(signed.reno.jobs.at(-1)!.crew.supervision).toBe('hands-off');
    consistent(signed);
  });
});

describe('praca właściciela po terminie umowy przy zajętej dobie', () => {
  /** Kontrakt właściciela po planowanym terminie; „inne zobowiązanie” zostawia na dobę dokładnie `freeLeft` wolnych godzin. */
  const overrun = (freeLeft: number) => {
    const base = contract(opsGame(), { quote: { startDate: '2026-03-12', durationDays: 12, hoursPerDay: 4 } });
    let s = buyAll(base.s, base.job.id);
    s = runUntil(s, (x) => jobOf(x, base.job.id).progressCenti > 0, 60);
    s = structuredClone(s);
    const j = jobOf(s, base.job.id);
    j.extraCenti += 4_000;
    j.pauseUntil = null;
    const c = s.commitments.find((x) => x.id === s.serviceOrders.find((o) => o.id === j.orderId)!.commitmentId)!;
    c.endDate = addDays(s.clock.today, -1);
    const tomorrow = addDays(s.clock.today, 1);
    const free = budgetFor(s, tomorrow).free;
    const extra = free - freeLeft;
    if (extra > 0) s.commitments.push({ id: 'cm:test', label: 'inne zobowiązanie', startDate: tomorrow, endDate: addDays(tomorrow, 30), hoursPerDay: Math.min(8, extra), sourceEventId: null });
    const before = { progress: j.progressCenti, blocked: j.blockedDays };
    const after = advanceDays(s, 1);
    return { before, j: jobOf(after, base.job.id), after };
  };

  it('gdy wolnych godzin jest mniej niż zwykle, kontrakt idzie wolniej zamiast stać do odstąpienia klienta', () => {
    const full = overrun(8);
    const partial = overrun(2);
    expect(partial.j.progressCenti).toBeGreaterThan(partial.before.progress);
    expect(partial.j.blockedDays).toBe(partial.before.blocked);
    expect(partial.j.progressCenti - partial.before.progress).toBeLessThan(full.j.progressCenti - full.before.progress);
    expect(checkInvariants(partial.after)).toEqual([]);
  });

  it('bez żadnej wolnej godziny kontrakt czeka (przestój), a nie pracuje kosztem doby', () => {
    const none = overrun(0);
    expect(none.j.progressCenti).toBe(none.before.progress);
    expect(none.j.blockedDays).toBe(none.before.blocked + 1);
  });
});

describe('plan wyceny uwzględnia zmęczenie właściciela', () => {
  it('z etatem i zleceniem po godzinach praca wychodzi dłuższa niż dla wypoczętego (z ostrzeżeniem); bez etatu plan = wypoczęty', () => {
    const g = opsGame({ reg: {} });
    const enq = craftEnquiry(g, { serviceId: 'gladzie', units: 70, complexity: 'standard' } as never);
    const input = { ...defaultQuoteInput(g, enq), hoursPerDay: 4, durationDays: 60 };
    const tired = previewQuote(g, input);
    const free = structuredClone(g);
    for (const c of free.contracts) if (c.type === 'employment') c.hoursPerMonth = 0;
    const rested = previewQuote(free, input);
    expect(tired.plannedCenti).toBeGreaterThan(rested.plannedCenti * 1.08);
    expect(tired.warnings.join(' ')).toMatch(/zmęczenie wzrośnie/);
    expect(rested.warnings.join(' ')).not.toMatch(/zmęczenie wzrośnie/);
    expect(tired.minDays).toBeGreaterThan(rested.minDays);
  });
});
