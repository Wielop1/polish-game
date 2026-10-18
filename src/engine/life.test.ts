import { describe, expect, it } from 'vitest';
import { ECONOMY_V01, JOB_CATALOG, LIFESTYLE, SAVINGS, estimateNet } from './config.ts';
import { commands } from './commands.ts';
import type { CommandResult } from './commands.ts';
import { recordHistory } from './core.ts';
import { currentEmployment, currentLease, employmentContracts, employmentStatus } from './contracts.ts';
import { addDays, diffDays } from './date.ts';
import { allowedMoveInDates, previewLease } from './housing.ts';
import { checkInvariants } from './invariants.ts';
import { applicationChanceBps, applicationBlocker } from './jobs.ts';
import { pendingLifeEvents } from './lifeEvents.ts';
import { mulBps, roundDiv, zl } from './money.ts';
import { createNewGame } from './newGame.ts';
import { SAVINGS_ACCOUNT_ID } from './newGame.ts';
import { monthlySummaries, netWorth, netWorthBreakdown, overdueObligations, playerAccount, qualityOfLife, savingsBalance } from './selectors.ts';
import { advanceDays, advanceOneDay, advanceToNextMonth, applyScheduledOccurrences, processDay } from './simulate.ts';
import { applySavingsInterest } from './savings.ts';
import type { GameState } from './state.ts';
import { budgetFor, firstOverload, performanceBps, validatePlan } from './time.ts';

const game = (seed = 'life', lifeEvents = false) => createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed, lifeEvents });
const ok = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(`komenda odrzucona: ${r.error}`);
  return r.state;
};
const consistent = (s: GameState) => expect(checkInvariants(s)).toEqual([]);

/** Wstrzykuje kapitał (jako wpłatę kapitałową) tak, by niezmienniki pozostały spełnione — tylko do testów. */
function fund(state: GameState, amount: number): GameState {
  const s = structuredClone(state);
  const n = (s.counters.testfund ?? 0) + 1;
  s.counters.testfund = n;
  s.accounts[s.playerAccountId]!.balance += amount;
  s.openingCash += amount;
  s.ledger.push({
    id: `tx:test-fund:${n}`, date: s.clock.today, accountId: s.playerAccountId, amount, category: 'kapital_poczatkowy',
    description: 'test', counterpartyId: null, obligationId: null, transferId: null, eventId: `test-fund:${n}`,
  });
  s.processed[`tx:test-fund:${n}`] = true;
  recordHistory(s, s.clock.today);
  return s;
}

/** Wstrzykuje propozycję pracy (jak po pozytywnej decyzji pracodawcy). */
function withOffer(state: GameState, offerId: string): { state: GameState; appId: string } {
  const s = structuredClone(state);
  const appId = `app:${offerId}@${s.clock.today}`;
  s.applications.push({
    id: appId, offerId, appliedOn: s.clock.today, status: 'offered', decisionOn: s.clock.today,
    offerExpiresOn: addDays(s.clock.today, 7), decidedOn: s.clock.today, startDate: null, chanceBps: 5_000,
  });
  return { state: s, appId };
}

const salaryTx = (s: GameState) => s.ledger.filter((t) => t.category === 'wynagrodzenie');
const OLD_NET = ECONOMY_V01.netSalary;

describe('praca: oferty i aplikacje', () => {
  it('szansa zależy od umiejętności; duże braki = brak szans', () => {
    const s = game();
    const byId = (id: string) => JOB_CATALOG.find((o) => o.id === id)!;
    expect(applicationChanceBps(s, byId('job:asystent-biura'))).toBe(3_500); // biuro 2 = wymóg 2
    expect(applicationChanceBps(s, byId('job:handlowiec'))).toBe(0); // sprzedaż 1 vs 3
    expect(applicationChanceBps(s, byId('job:mlodszy-it'))).toBe(0);
    expect(applicationChanceBps(s, byId('job:magazynier-pt'))).toBe(3_500); // technika 1 = wymóg 1
  });

  it('zmęczenie obniża szansę na rozmowie', () => {
    const s = structuredClone(game());
    const offer = JOB_CATALOG.find((o) => o.id === 'job:asystent-biura')!;
    const rested = applicationChanceBps(s, offer);
    s.life.fatigue = 90;
    expect(applicationChanceBps(s, offer)).toBe(rested - 1_200);
  });

  it('aplikacja → decyzja pracodawcy po kilku dniach (deterministycznie), zdarzenia w dzienniku', () => {
    const s0 = advanceDays(game('app-1'), 5);
    const s1 = ok(commands.applyForJob(s0, 'job:asystent-biura'));
    const app = s1.applications[0]!;
    expect(app.status).toBe('pending');
    expect(diffDays(app.decisionOn, s1.clock.today)).toBeGreaterThanOrEqual(5);
    expect(diffDays(app.decisionOn, s1.clock.today)).toBeLessThanOrEqual(12);
    const done = advanceDays(s1, 13);
    const decided = done.applications[0]!;
    expect(['offered', 'rejected']).toContain(decided.status);
    expect(done.events.some((e) => e.type === 'job.decision')).toBe(true);
    // ten sam stan i ta sama komenda => ta sama decyzja
    expect(advanceDays(ok(commands.applyForJob(s0, 'job:asystent-biura')), 13).applications[0]).toEqual(decided);
    consistent(done);
  });

  it('brak szans = zawsze odmowa; ponowna aplikacja zablokowana na 60 dni', () => {
    let s = advanceDays(game(), 2);
    s = advanceDays(ok(commands.applyForJob(s, 'job:handlowiec')), 13);
    expect(s.applications[0]!.status).toBe('rejected');
    const blocked = commands.applyForJob(s, 'job:handlowiec');
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.error).toMatch(/ponownie/);
    expect(applicationBlocker(s, 'job:handlowiec')).not.toBeNull();
    const later = advanceDays(s, 61);
    expect(applicationBlocker(later, 'job:handlowiec')).toBeNull();
  });

  it('nie można aplikować dwa razy na tę samą ofertę ani do pracy, w której się jest', () => {
    const s = ok(commands.applyForJob(game(), 'job:asystent-biura'));
    expect(commands.applyForJob(s, 'job:asystent-biura')).toMatchObject({ ok: false });
    expect(commands.applyForJob(s, 'job:nie-ma')).toMatchObject({ ok: false });
  });

  it('pełna ścieżka z prawdziwą aplikacją: znajduje się seed z propozycją i można ją przyjąć', () => {
    let accepted: GameState | null = null;
    for (let i = 0; i < 40 && !accepted; i++) {
      const s = advanceDays(ok(commands.applyForJob(advanceDays(game(`offer-${i}`), 3), 'job:asystent-biura')), 13);
      if (s.applications[0]!.status === 'offered') accepted = ok(commands.respondToJobOffer(s, s.applications[0]!.id, true));
    }
    expect(accepted).not.toBeNull();
    const a = accepted!;
    expect(a.applications[0]!.status).toBe('accepted');
    expect(employmentContracts(a)).toHaveLength(2);
    consistent(a);
  });
});

describe('praca: zmiana zatrudnienia i wypłaty', () => {
  it('zmiana pracy: stara pensja do końca wypowiedzenia, nowa od 1. dnia następnego miesiąca, bez dubli', () => {
    const base = advanceDays(game(), 14); // 15 stycznia
    const { state, appId } = withOffer(base, 'job:technik-serwisu');
    const s = ok(commands.respondToJobOffer(state, appId, true));
    const oldC = s.contracts.find((c) => c.id === 'contract:employment')!;
    const newC = employmentContracts(s).find((c) => c.id !== 'contract:employment')!;
    expect(oldC).toMatchObject({ endDate: '2026-02-28', terminatedBy: 'employee' });
    expect(newC).toMatchObject({ startDate: '2026-03-01', endDate: null, grossMonthly: zl(7_200), monthlyAmount: estimateNet(zl(7_200)) });
    expect(s.rules.find((r) => r.id === 'rule:salary')).toMatchObject({ endDate: '2026-02-28' });
    expect(employmentStatus(s)).toBe('notice');

    const later = advanceDays(s, diffDays('2026-05-01', s.clock.today));
    const salaryAccruals = later.obligations.filter((o) => o.category === 'wynagrodzenie');
    expect(salaryAccruals.map((o) => o.issueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']); // 1 naliczenie na miesiąc
    expect(salaryAccruals.map((o) => o.amount)).toEqual([OLD_NET, OLD_NET, estimateNet(zl(7_200)), estimateNet(zl(7_200))]);
    expect(salaryTx(later).map((t) => t.date)).toEqual(['2026-02-10', '2026-03-10', '2026-04-10']);
    expect(currentEmployment(later)!.id).toBe(newC.id);
    expect(later.events.some((e) => e.type === 'job.started')).toBe(true);
    expect(later.events.some((e) => e.type === 'job.ended')).toBe(true);
    consistent(later);
  });

  it('rezygnacja: wypłaty do końca wypowiedzenia, potem brak pensji i status bezrobotny', () => {
    const s = ok(commands.resignFromJob(advanceDays(game(), 14)));
    expect(s.contracts.find((c) => c.id === 'contract:employment')).toMatchObject({ endDate: '2026-02-28', terminatedBy: 'employee' });
    expect(commands.resignFromJob(s)).toMatchObject({ ok: false }); // już wypowiedziana
    const later = advanceDays(s, diffDays('2026-06-01', s.clock.today));
    expect(later.obligations.filter((o) => o.category === 'wynagrodzenie').map((o) => o.issueDate)).toEqual(['2026-01-31', '2026-02-28']);
    expect(employmentStatus(later)).toBe('unemployed');
    expect(currentEmployment(later)).toBeNull();
    expect(budgetFor(later, later.clock.today).work).toBe(0);
    consistent(later);
  });

  it('nie można mieć dwóch umów o pracę naraz ani podpisać drugiej przed startem pierwszej', () => {
    const { state, appId } = withOffer(advanceDays(game(), 3), 'job:technik-serwisu');
    const s = ok(commands.respondToJobOffer(state, appId, true));
    const second = withOffer(s, 'job:asystent-biura');
    const r = commands.respondToJobOffer(second.state, second.appId, true);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/podpisaną umowę/);
  });

  it('propozycja po terminie jest odrzucana, odrzucenie propozycji nie zmienia umów', () => {
    const { state, appId } = withOffer(game(), 'job:technik-serwisu');
    const declined = ok(commands.respondToJobOffer(state, appId, false));
    expect(declined.applications[0]!.status).toBe('declined');
    expect(employmentContracts(declined)).toHaveLength(1);
    const late = advanceDays(state, 8); // oferta wygasa po 7 dniach (akcja wygaśnięcia nie była zaplanowana w tym wstrzyknięciu)
    expect(commands.respondToJobOffer(late, appId, true)).toMatchObject({ ok: false });
  });

  it('praca musi mieścić się w budżecie czasu', () => {
    let s = game();
    s = ok(commands.setTimePlan(s, { sleepHours: 9, businessHours: 3 })); // 8 praca + 9 sen + 4 obowiązki + 3 = 24, czas wolny 0
    expect(budgetFor(s, '2026-01-05').free).toBe(0);
    const { state, appId } = withOffer(s, 'job:kierownik-zmiany'); // 180 h/mies. ≈ 9 godz./dzień
    const r = commands.respondToJobOffer(state, appId, true);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/budżecie czasu/);
    expect(employmentContracts(state)).toHaveLength(1); // stan wejściowy nietknięty
  });

  it('wynagrodzenie brutto jest zapisane, a netto to oznaczony szacunek (nie wyliczenie prawne)', () => {
    const c = game().contracts.find((x) => x.type === 'employment')!;
    expect(c.type === 'employment' && c.grossMonthly).toBe(ECONOMY_V01.grossSalary);
    expect(c.monthlyAmount).toBe(mulBps(ECONOMY_V01.grossSalary, 7_300));
    expect(c.dataStatus).toBe('placeholder');
  });
});

describe('mieszkanie i kaucja', () => {
  it('dozwolone daty: od najbliższego 1. dnia do dnia po wygaśnięciu obecnej umowy', () => {
    expect(allowedMoveInDates(game())).toEqual(['2026-02-01', '2026-03-01']);
    expect(allowedMoveInDates(advanceDays(game(), 40))).toEqual(['2026-03-01', '2026-04-01']);
  });

  it('podgląd pokazuje nakładanie się umów, kaucję i koszty', () => {
    const s = fund(game(), zl(20_000));
    const overlap = previewLease(s, 'flat:2pok-jaroty', '2026-02-01')!;
    expect(overlap.overlapMonths).toBe(1);
    expect(overlap.overlapCost).toBe(zl(1_700) + zl(300));
    expect(overlap.depositNow).toBe(zl(2_100));
    const clean = previewLease(s, 'flat:2pok-jaroty', '2026-03-01')!;
    expect(clean.overlapMonths).toBe(0);
  });

  it('kaucja jest aktywem, nie kosztem: majątek netto bez zmian, gotówka niższa', () => {
    const s0 = fund(game(), zl(5_000));
    const before = netWorthBreakdown(s0);
    const s1 = ok(commands.signLease(s0, 'flat:2pok-jaroty', '2026-03-01'));
    const after = netWorthBreakdown(s1);
    expect(after.cash).toBe(before.cash - zl(2_100));
    expect(after.deposits).toBe(zl(2_100));
    expect(after.netWorth).toBe(before.netWorth);
    expect(s1.assets[0]).toMatchObject({ type: 'deposit', amount: zl(2_100), status: 'held' });
    consistent(s1);
  });

  it('przeprowadzka bez nakładania: dokładnie jeden czynsz w miesiącu, nowe stawki od wprowadzenia, koszt przeprowadzki', () => {
    const s1 = ok(commands.signLease(fund(game(), zl(8_000)), 'flat:2pok-jaroty', '2026-03-01'));
    expect(currentLease(s1)!.id).toBe('contract:lease'); // do 28 lutego mieszka w starym
    const s = advanceDays(s1, diffDays('2026-05-02', s1.clock.today));
    const rents = s.obligations.filter((o) => o.category === 'czynsz');
    expect(rents.map((o) => [o.issueDate, o.amount])).toEqual([
      ['2026-01-01', zl(1_700)], ['2026-02-01', zl(1_700)], ['2026-03-01', zl(2_100)], ['2026-04-01', zl(2_100)], ['2026-05-01', zl(2_100)],
    ]);
    const utilities = s.obligations.filter((o) => o.category === 'media');
    expect(utilities.map((o) => o.amount)).toEqual([zl(300), zl(300), zl(350), zl(350)]); // 5 maja jeszcze nie naliczono
    const moving = s.obligations.filter((o) => o.category === 'przeprowadzka');
    expect(moving).toHaveLength(1);
    expect(moving[0]).toMatchObject({ amount: zl(600), issueDate: '2026-03-01' });
    expect(currentLease(s)).toMatchObject({ listingId: 'flat:2pok-jaroty', standard: 'dobry' });
    expect(s.events.some((e) => e.type === 'housing.move_in')).toBe(true);
    expect(s.events.some((e) => e.type === 'housing.lease_ended')).toBe(true);
    consistent(s);
  });

  it('nakładanie się umów: za miesiąc nakładania płacisz oba czynsze (świadomie)', () => {
    const s1 = ok(commands.signLease(fund(game(), zl(8_000)), 'flat:kawalerka-nagorki', '2026-02-01'));
    const s = advanceDays(s1, diffDays('2026-03-02', s1.clock.today));
    const feb = s.obligations.filter((o) => o.category === 'czynsz' && o.issueDate === '2026-02-01');
    expect(feb.map((o) => o.amount).sort()).toEqual([zl(1_500), zl(1_700)]);
    const mar = s.obligations.filter((o) => o.category === 'czynsz' && o.issueDate === '2026-03-01');
    expect(mar.map((o) => o.amount)).toEqual([zl(1_500)]);
    consistent(s);
  });

  it('kaucja wraca po wyprowadzce (14 dni po końcu umowy) bez wpływu na majątek netto', () => {
    // 1. przeprowadzka z kaucją, 2. kolejna przeprowadzka — zwrot pierwszej kaucji
    let s = ok(commands.signLease(fund(game(), zl(15_000)), 'flat:2pok-jaroty', '2026-03-01'));
    s = advanceDays(s, diffDays('2026-04-05', s.clock.today));
    expect(allowedMoveInDates(s)).toEqual(['2026-05-01', '2026-06-01']);
    s = ok(commands.signLease(s, 'flat:3pok-kormoran', '2026-06-01')); // stara umowa do 31.05
    const refund = s.pending.find((p) => p.type === 'deposit.refund')!;
    expect(refund.date).toBe('2026-06-14');
    const beforeRefund = advanceDays(s, diffDays('2026-06-13', s.clock.today));
    const nw = netWorth(beforeRefund);
    const cash = playerAccount(beforeRefund).balance;
    const afterRefund = advanceOneDay(beforeRefund); // 14 czerwca
    expect(afterRefund.assets.find((a) => a.id === refund.assetId)).toMatchObject({ status: 'refunded', refundedOn: '2026-06-14' });
    expect(playerAccount(afterRefund).balance).toBe(cash + zl(2_100));
    expect(netWorthBreakdown(afterRefund).deposits).toBe(zl(3_200)); // teraz trzyma tylko nową kaucję
    expect(netWorth(afterRefund)).toBe(nw); // 14 czerwca nie ma żadnych naliczeń — zwrot kaucji nie zmienia majątku netto
    expect(afterRefund.ledger.filter((t) => t.category === 'zwrot_kaucji')).toHaveLength(1);
    consistent(afterRefund);
    // kaucje i zwroty nie są przychodem ani kosztem w podsumowaniach miesięcznych
    const june = monthlySummaries(afterRefund).find((m) => m.month === '2026-06')!;
    expect(june.cashIn).toBe(OLD_NET); // tylko pensja za maj; zwrot kaucji nie jest przychodem
  });

  it('walidacje: brak środków na kaucję, zła data, ten sam lokal, druga umowa przed startem', () => {
    const poor = structuredClone(game());
    expect(commands.signLease(advanceDays(poor, 20), 'flat:3pok-kormoran', '2026-03-01')).toMatchObject({ ok: false }); // kaucja 3 200 zł > gotówka
    const s = fund(game(), zl(9_000));
    expect(commands.signLease(s, 'flat:2pok-jaroty', '2026-01-15')).toMatchObject({ ok: false });
    expect(commands.signLease(s, 'flat:2pok-jaroty', '2026-06-01')).toMatchObject({ ok: false }); // zbyt późno (bezdomność)
    expect(commands.signLease(s, 'flat:nie-ma', '2026-03-01')).toMatchObject({ ok: false });
    const signed = ok(commands.signLease(s, 'flat:2pok-jaroty', '2026-03-01'));
    expect(commands.signLease(signed, 'flat:kawalerka-nagorki', '2026-03-01')).toMatchObject({ ok: false });
  });

  it('stan wejściowy komendy pozostaje nietknięty', () => {
    const s = fund(game(), zl(5_000));
    const snapshot = structuredClone(s);
    commands.signLease(s, 'flat:2pok-jaroty', '2026-03-01');
    expect(s).toEqual(snapshot);
  });
});

describe('budżet czasu i zmęczenie', () => {
  it('doba ma 24 godziny, a czas wolny to reszta (dzień roboczy i weekend)', () => {
    const s = game();
    const work = budgetFor(s, '2026-01-05'); // poniedziałek
    expect(work).toMatchObject({ workday: true, work: 8, sleep: 8, duties: 4, business: 0, free: 4 });
    expect(work.work + work.sleep + work.duties + work.business + work.commitments + work.free).toBe(24);
    const weekend = budgetFor(s, '2026-01-03'); // sobota
    expect(weekend).toMatchObject({ workday: false, work: 0, duties: 3, free: 13 });
  });

  it('plan nie może przekroczyć 24 godzin (te same godziny nie służą dwóm czynnościom)', () => {
    const s = game();
    expect(validatePlan(s, { sleepHours: 10, businessHours: 4 })).toMatch(/24 godzinach/);
    expect(validatePlan(s, { sleepHours: 3, businessHours: 0 })).toMatch(/Sen/);
    expect(validatePlan(s, { sleepHours: 8, businessHours: 9 })).toMatch(/Działalność/);
    expect(commands.setTimePlan(s, { sleepHours: 10, businessHours: 4 })).toMatchObject({ ok: false });
    expect(validatePlan(s, { sleepHours: 8, businessHours: 4 })).toBeNull(); // 8+8+4+4 = 24, wolny 0
  });

  it('plan uwzględnia też przyszłe umowy i zobowiązania czasowe', () => {
    const s = game();
    expect(firstOverload(s, '2026-01-05', '2026-01-20', { extraHoursPerDay: 5 })).toMatchObject({ missing: 1 });
    const withGig = structuredClone(s);
    withGig.commitments.push({ id: 'c1', label: 'Kurs', startDate: '2026-02-01', endDate: '2026-02-28', hoursPerDay: 3, sourceEventId: null });
    expect(budgetFor(withGig, '2026-02-02').free).toBe(1);
    expect(validatePlan(withGig, { sleepHours: 8, businessHours: 2 })).toMatch(/24 godzinach/); // w lutym zabrakłoby 2 godz.
  });

  it('zmiana planu dnia jest księgowana w dzienniku i zmienia budżet', () => {
    const s = ok(commands.setTimePlan(game(), { sleepHours: 7, businessHours: 1 }));
    expect(s.life.timePlan).toEqual({ sleepHours: 7, businessHours: 1 });
    expect(budgetFor(s, '2026-01-05').free).toBe(4 + 1 - 1);
    expect(s.events.some((e) => e.type === 'time.plan_changed')).toBe(true);
    expect(commands.setTimePlan(s, { sleepHours: 7, businessHours: 1 })).toMatchObject({ ok: false }); // bez zmian
  });

  it('zbyt napięty plan zwiększa zmęczenie i obniża wydajność; zdrowy plan utrzymuje wypoczęcie', () => {
    const healthy = advanceDays(game(), 90);
    expect(healthy.life.fatigue).toBeLessThan(25);
    expect(performanceBps(healthy.life.fatigue)).toBe(10_000);

    const stressed0 = ok(commands.setTimePlan(game(), { sleepHours: 6, businessHours: 3 })); // sen 6 godz. + 3 godz. dodatkowych
    const stressed = advanceDays(stressed0, 60);
    expect(stressed.life.fatigue).toBeGreaterThan(80);
    expect(performanceBps(stressed.life.fatigue)).toBeLessThan(6_000);
    expect(qualityOfLife(stressed).components.find((c) => c.id === 'fatigue')!.score).toBeLessThan(20);
  });

  it('zmęczenie jest idempotentne w obrębie dnia i zawsze w zakresie 0–100', () => {
    const s = structuredClone(ok(commands.setTimePlan(game(), { sleepHours: 5, businessHours: 4 })));
    const next = addDays(s.clock.today, 1);
    processDay(s, next);
    const once = s.life.fatigue;
    processDay(s, next);
    expect(s.life.fatigue).toBe(once);
    const long = advanceDays(s, 200);
    expect(long.life.fatigue).toBeLessThanOrEqual(100);
    expect(long.life.fatigue).toBeGreaterThanOrEqual(0);
  });

  it('wydajność rośnie z odpoczynkiem (tabela)', () => {
    expect(performanceBps(0)).toBe(10_000);
    expect(performanceBps(30)).toBe(10_000);
    expect(performanceBps(100)).toBe(5_100);
  });
});

describe('styl życia', () => {
  it('zmiana poziomu zmienia kwoty kolejnych naliczeń księgowanych przez silnik zobowiązań', () => {
    let s = ok(commands.setLifestyle(game(), 'komfortowy'));
    s = advanceToNextMonth(s); // 1 lutego
    const feb = advanceDays(s, 30); // 3 marca — naliczenia z lutego i marca
    const groceries = feb.obligations.filter((o) => o.category === 'zywnosc');
    expect(groceries.at(-1)!.amount).toBe(LIFESTYLE.groceries.komfortowy);
    const leisure = feb.obligations.filter((o) => o.category === 'rozrywka').at(-1)!;
    expect(leisure.amount).toBeGreaterThan(mulBps(LIFESTYLE.leisure.komfortowy, 8_400));
    expect(leisure.amount).toBeLessThan(mulBps(LIFESTYLE.leisure.komfortowy, 11_600));
    expect(feb.ledger.some((t) => t.category === 'zywnosc' && t.amount === -LIFESTYLE.groceries.komfortowy)).toBe(true);
    expect(feb.events.some((e) => e.type === 'lifestyle.changed')).toBe(true);
    consistent(feb);
  });

  it('oszczędny jest tańszy niż standardowy, a wskaźnik jakości życia różni się nie tylko ceną', () => {
    const cheap = ok(commands.setLifestyle(game(), 'oszczedny'));
    const std = game();
    const comfy = ok(commands.setLifestyle(game(), 'komfortowy'));
    const a = advanceDays(cheap, 35).obligations.find((o) => o.category === 'zywnosc')!.amount;
    expect(a).toBe(LIFESTYLE.groceries.oszczedny);
    expect(qualityOfLife(cheap).score).toBeLessThan(qualityOfLife(std).score);
    expect(qualityOfLife(std).score).toBeLessThan(qualityOfLife(comfy).score);
    expect(commands.setLifestyle(std, 'standardowy')).toMatchObject({ ok: false });
  });

  it('jakość życia NIE jest funkcją majątku: ogromna gotówka prawie jej nie zmienia i ma sufit', () => {
    const s = game();
    const rich = fund(s, zl(200_000));
    const richer = fund(s, zl(2_000_000));
    const base = qualityOfLife(s).score;
    expect(qualityOfLife(rich).score - base).toBeLessThanOrEqual(15); // bezpieczeństwo finansowe to tylko 15% wagi
    expect(qualityOfLife(richer).score).toBe(qualityOfLife(rich).score); // sufit bufora
    // a zmęczenie i brak czasu potrafią zrujnować jakość życia mimo pieniędzy
    const exhausted = structuredClone(rich);
    exhausted.life.fatigue = 100;
    expect(qualityOfLife(exhausted).score).toBeLessThan(qualityOfLife(rich).score - 15);
  });

  it('standard mieszkania i bezrobocie wpływają na wskaźnik', () => {
    const s = fund(game(), zl(10_000));
    const moved = advanceDays(ok(commands.signLease(s, 'flat:2pok-srodmiescie', '2026-03-01')), 70);
    const housing = (st: GameState) => qualityOfLife(st).components.find((c) => c.id === 'housing')!.score;
    expect(housing(moved)).toBe(90);
    expect(housing(s)).toBe(65);
    const jobless = advanceDays(ok(commands.resignFromJob(s)), 70);
    expect(qualityOfLife(jobless).components.find((c) => c.id === 'security')!.detail).toMatch(/brak pracy/);
  });
});

describe('oszczędności: przelewy i odsetki', () => {
  const savings = (s: GameState) => s.accounts[SAVINGS_ACCOUNT_ID]!;

  it('przelew między własnymi rachunkami nie zmienia majątku netto i nie jest przychodem ani kosztem', () => {
    const s0 = advanceDays(game(), 45);
    const nw = netWorth(s0);
    const s1 = ok(commands.transferFunds(s0, s0.playerAccountId, SAVINGS_ACCOUNT_ID, zl(1_000)));
    expect(netWorth(s1)).toBe(nw);
    expect(savingsBalance(s1)).toBe(zl(1_000));
    expect(playerAccount(s1).balance).toBe(playerAccount(s0).balance - zl(1_000));
    const [out, inn] = s1.ledger.slice(-2);
    expect(out!.transferId).toBe(inn!.transferId);
    expect(out!.amount + inn!.amount).toBe(0);
    expect(out!.category).toBe('przelew_wlasny');
    const back = ok(commands.transferFunds(s1, SAVINGS_ACCOUNT_ID, s0.playerAccountId, zl(400)));
    expect(netWorth(back)).toBe(nw);
    const month = monthlySummaries(back).find((m) => m.month === '2026-02')!;
    const monthBefore = monthlySummaries(s0).find((m) => m.month === '2026-02')!;
    expect(month.cashIn).toBe(monthBefore.cashIn);
    expect(month.cashOut).toBe(monthBefore.cashOut);
    expect(back.history.at(-1)).toMatchObject({ cash: playerAccount(back).balance, savings: zl(600), netWorth: nw });
    consistent(back);
  });

  it('walidacje przelewu: za mało środków, ta sama strona, kwota ≤ 0, ułamek grosza', () => {
    const s = game();
    const t = (from: string, to: string, amount: number) => commands.transferFunds(s, from, to, amount);
    expect(t(s.playerAccountId, SAVINGS_ACCOUNT_ID, zl(999_999))).toMatchObject({ ok: false });
    expect(t(s.playerAccountId, s.playerAccountId, 100)).toMatchObject({ ok: false });
    expect(t(s.playerAccountId, SAVINGS_ACCOUNT_ID, 0)).toMatchObject({ ok: false });
    expect(t(s.playerAccountId, SAVINGS_ACCOUNT_ID, -5)).toMatchObject({ ok: false });
    expect(t(s.playerAccountId, SAVINGS_ACCOUNT_ID, 10.5)).toMatchObject({ ok: false });
    expect(t('acc:nie-ma', SAVINGS_ACCOUNT_ID, 100)).toMatchObject({ ok: false });
    expect(t(SAVINGS_ACCOUNT_ID, s.playerAccountId, 100)).toMatchObject({ ok: false }); // puste konto oszczędnościowe
  });

  it('odsetki: jedno zaokrąglenie z sumy sald dziennych, osobna operacja podatku, na rachunku oszczędnościowym', () => {
    let s = ok(commands.transferFunds(fund(game(), zl(5_000)), 'acc:player:main', SAVINGS_ACCOUNT_ID, zl(4_000)));
    // saldo 4 000 zł naliczane od 2 stycznia do 31 stycznia = 30 dni
    s = advanceDays(s, 31); // 1 lutego
    const interest = roundDiv(zl(4_000) * 30 * SAVINGS.rateBps, 10_000 * 365);
    const tax = mulBps(interest, SAVINGS.taxBps);
    const inc = s.obligations.find((o) => o.category === 'odsetki')!;
    const taxOb = s.obligations.find((o) => o.category === 'podatek_odsetki')!;
    expect(inc).toMatchObject({ direction: 'receivable', amount: interest, accountId: SAVINGS_ACCOUNT_ID, issueDate: '2026-01-31', status: 'settled' });
    expect(taxOb).toMatchObject({ direction: 'payable', amount: tax, accountId: SAVINGS_ACCOUNT_ID, status: 'settled' });
    expect(savings(s).balance).toBe(zl(4_000) + interest - tax);
    expect(savings(s).interest!.accumulator).toBeGreaterThan(0); // luty już się nalicza
    expect(interest).toBeGreaterThan(0);
    consistent(s);
  });

  it('odsetki zwiększają majątek netto o odsetki po podatku (przychód − koszt), przelew nie', () => {
    const base = fund(game(), zl(5_000));
    const withSavings = ok(commands.transferFunds(base, 'acc:player:main', SAVINGS_ACCOUNT_ID, zl(4_000)));
    const a = advanceDays(base, 31);
    const b = advanceDays(withSavings, 31);
    const interest = roundDiv(zl(4_000) * 30 * SAVINGS.rateBps, 10_000 * 365);
    expect(netWorth(b) - netWorth(a)).toBe(interest - mulBps(interest, SAVINGS.taxBps));
  });

  it('zerowa stopa podatku: brak operacji podatku; puste konto: brak odsetek', () => {
    const empty = advanceDays(game(), 40);
    expect(empty.obligations.some((o) => o.category === 'odsetki')).toBe(false);
    const s = structuredClone(fund(game(), zl(5_000)));
    s.accounts[SAVINGS_ACCOUNT_ID]!.interest!.taxBps = 0;
    const t = advanceDays(ok(commands.transferFunds(s, 'acc:player:main', SAVINGS_ACCOUNT_ID, zl(4_000))), 31);
    expect(t.obligations.some((o) => o.category === 'odsetki')).toBe(true);
    expect(t.obligations.some((o) => o.category === 'podatek_odsetki')).toBe(false);
  });

  it('kapitalizacja jest idempotentna (podwójne przetworzenie dnia nie dolicza dwa razy)', () => {
    const s = structuredClone(ok(commands.transferFunds(fund(game(), zl(5_000)), 'acc:player:main', SAVINGS_ACCOUNT_ID, zl(4_000))));
    const rule = s.rules.find((r) => r.kind === 'savings_interest')!;
    if (rule.kind !== 'savings_interest') throw new Error();
    applySavingsInterest(s, rule, '2026-01-02');
    const once = s.accounts[SAVINGS_ACCOUNT_ID]!.interest!.accumulator;
    applySavingsInterest(s, rule, '2026-01-02');
    expect(s.accounts[SAVINGS_ACCOUNT_ID]!.interest!.accumulator).toBe(once);
    applyScheduledOccurrences(s, '2026-01-31');
    applyScheduledOccurrences(s, '2026-01-31');
    expect(s.obligations.filter((o) => o.category === 'odsetki')).toHaveLength(1);
  });

  it('historia operacji zawiera przelewy i odsetki; saldo oszczędności = suma jego wpisów', () => {
    const s = advanceDays(ok(commands.transferFunds(fund(game(), zl(5_000)), 'acc:player:main', SAVINGS_ACCOUNT_ID, zl(4_000))), 95);
    const entries = s.ledger.filter((t) => t.accountId === SAVINGS_ACCOUNT_ID);
    expect(entries.map((t) => t.category)).toContain('przelew_wlasny');
    expect(entries.filter((t) => t.category === 'odsetki')).toHaveLength(3);
    expect(entries.reduce((a, t) => a + t.amount, 0)).toBe(savingsBalance(s));
  });
});

describe('wydarzenia życiowe', () => {
  const run = (seed: string, months: number) => {
    let s = game(seed, true);
    for (let i = 0; i < months; i++) s = advanceToNextMonth(s);
    return s;
  };
  /** Pierwszy dzień miesiąca po wydarzeniu (decyzje czekają 5–14 dni, więc stan jest „w trakcie”). */
  const until = (seed: string, date: string) => advanceDays(game(seed, true), diffDays(date, '2026-01-01'));

  it('deterministyczność: ten sam seed → ta sama historia wydarzeń; inne seedy → inne', () => {
    const a = run('v2-0', 18);
    expect(run('v2-0', 18).lifeEvents).toEqual(a.lifeEvents);
    expect(run('v2-0', 18)).toEqual(a);
    expect(a.lifeEvents.length).toBeGreaterThan(0);
    expect(run('v2-1', 18).lifeEvents.map((e) => e.id)).not.toEqual(a.lifeEvents.map((e) => e.id));
    expect(new Set(a.lifeEvents.map((e) => e.id)).size).toBe(a.lifeEvents.length);
    consistent(a);
  });

  it('wydarzenia nie zależą od ścieżki dojścia (skok = dni = miesiące)', () => {
    const a = advanceDays(game('v2-0', true), 200);
    let b = game('v2-0', true);
    for (let i = 0; i < 4; i++) b = advanceDays(b, 50);
    expect(b).toEqual(a);
  });

  it('wyłączenie wydarzeń w ustawieniach gry wyłącza losowanie', () => {
    const s = advanceDays(game('v2-0', false), 400);
    expect(s.lifeEvents).toHaveLength(0);
  });

  it('awaria sprzętu: decyzja z trzema opcjami, każda księgowana przez silnik zobowiązań; powtórna decyzja odrzucona', () => {
    const s = until('v2-0', '2026-07-10');
    const ev = pendingLifeEvents(s).find((e) => e.templateId === 'appliance')!;
    expect(ev).toBeDefined();
    expect(ev.options.map((o) => o.id)).toEqual(['repair', 'replace', 'wait']);
    expect(ev.options.every((o) => o.hint.length > 10)).toBe(true);
    const obligationsBefore = s.obligations.length;

    const repaired = ok(commands.resolveLifeEvent(s, ev.id, 'repair'));
    const cost = repaired.obligations.filter((o) => o.category === 'awaria');
    expect(cost).toHaveLength(1);
    expect(cost[0]!.amount).toBeGreaterThanOrEqual(zl(200));
    expect(cost[0]!.amount).toBeLessThanOrEqual(zl(500));
    expect(repaired.obligations.length).toBe(obligationsBefore + 1);
    expect(repaired.lifeEvents.find((e) => e.id === ev.id)).toMatchObject({ status: 'resolved', chosenOptionId: 'repair' });
    expect(commands.resolveLifeEvent(repaired, ev.id, 'replace')).toMatchObject({ ok: false }); // nie dwa razy

    const replaced = ok(commands.resolveLifeEvent(s, ev.id, 'replace'));
    expect(replaced.obligations.find((o) => o.category === 'awaria')!.amount).toBeGreaterThanOrEqual(zl(1_000));
    const waited = ok(commands.resolveLifeEvent(s, ev.id, 'wait'));
    expect(waited.life.fatigue).toBe(s.life.fatigue + 8);

    // wynik zależy tylko od (seed, wydarzenie, opcja) — nie od momentu decyzji
    const later = ok(commands.resolveLifeEvent(advanceDays(s, 2), ev.id, 'repair'));
    expect(later.obligations.find((o) => o.category === 'awaria')!.amount).toBe(cost[0]!.amount);
    expect(commands.resolveLifeEvent(s, ev.id, 'nie-ma-takiej')).toMatchObject({ ok: false });
    consistent(repaired);
    consistent(replaced);
    consistent(waited);
  });

  it('brak decyzji do terminu stosuje opcję domyślną dokładnie raz', () => {
    const s = until('v2-0', '2026-07-10');
    const ev = pendingLifeEvents(s).find((e) => e.templateId === 'appliance')!;
    const expired = advanceDays(s, diffDays(ev.expiresOn!, s.clock.today) + 1);
    const after = expired.lifeEvents.find((e) => e.id === ev.id)!;
    expect(after).toMatchObject({ status: 'expired', chosenOptionId: 'wait' });
    expect(after.outcome).toMatch(/Brak decyzji/);
    const further = advanceDays(expired, 40);
    expect(further.lifeEvents.find((e) => e.id === ev.id)).toEqual(after);
    expect(further.events.filter((e) => e.id === `life.decision:${ev.id}`)).toHaveLength(1);
    expect(commands.resolveLifeEvent(expired, ev.id, 'repair')).toMatchObject({ ok: false });
    consistent(further);
  });

  it('niespodziewany wydatek (bez decyzji): zobowiązanie 150–600 zł naliczone raz', () => {
    const s = until('v2-0', '2026-01-18');
    const ev = s.lifeEvents.find((e) => e.templateId === 'unexpected_expense')!;
    expect(ev).toMatchObject({ status: 'resolved', options: [] });
    const costs = s.obligations.filter((o) => o.ruleId === 'evt:unexpected_expense');
    expect(costs).toHaveLength(1);
    expect(costs[0]!.amount).toBeGreaterThanOrEqual(zl(150));
    expect(costs[0]!.amount).toBeLessThanOrEqual(zl(600));
    const again = structuredClone(s);
    processDay(again, '2026-01-17'); // ponowne przetworzenie dnia wydarzenia
    expect(again.obligations.filter((o) => o.ruleId === 'evt:unexpected_expense')).toHaveLength(1);
  });

  it('awans: przyjęcie tworzy nową umowę z wyższą pensją od następnego miesiąca bez dublowania wypłat', () => {
    const s = until('v2-2', '2026-08-13');
    const ev = pendingLifeEvents(s).find((e) => e.templateId === 'promotion')!;
    expect(ev).toBeDefined();
    const before = currentEmployment(s)!;
    const accepted = ok(commands.resolveLifeEvent(s, ev.id, 'accept'));
    const promoted = employmentContracts(accepted).find((c) => c.id !== before.id)!;
    expect(promoted.startDate).toBe('2026-09-01');
    expect(promoted.monthlyAmount).toBeGreaterThan(before.monthlyAmount * 1.09);
    expect(promoted.monthlyAmount).toBeLessThan(before.monthlyAmount * 1.19);
    expect(accepted.contracts.find((c) => c.id === before.id)!.endDate).toBe('2026-08-31');
    const later = advanceDays(accepted, 80);
    const months = later.obligations.filter((o) => o.category === 'wynagrodzenie').map((o) => o.issueDate.slice(0, 7));
    expect(new Set(months).size).toBe(months.length); // jedno naliczenie pensji na miesiąc
    expect(later.obligations.find((o) => o.issueDate === '2026-09-30' && o.category === 'wynagrodzenie')!.amount).toBe(promoted.monthlyAmount);
    consistent(later);
    // odmowa nic nie zmienia
    const declined = ok(commands.resolveLifeEvent(s, ev.id, 'decline'));
    expect(employmentContracts(declined)).toHaveLength(employmentContracts(s).length);
  });

  it('utrata zatrudnienia: wypowiedzenie przez pracodawcę z zachowaniem okresu, potem brak pensji', () => {
    const s = until('v2-0', '2027-07-28');
    const ev = s.lifeEvents.find((e) => e.templateId === 'job_loss')!;
    expect(ev).toBeDefined();
    const c = employmentContracts(s).find((x) => x.terminatedBy === 'employer')!;
    expect(c).toMatchObject({ terminatedBy: 'employer', endDate: '2027-08-31' });
    expect(employmentStatus(s)).toBe('notice');
    const later = advanceDays(s, 120);
    expect(employmentStatus(later)).toBe('unemployed');
    expect(later.obligations.filter((o) => o.category === 'wynagrodzenie').at(-1)!.issueDate).toBe('2027-08-31');
    consistent(later);
  });

  it('premia: należność z umowy płatna po 10 dniach', () => {
    const s = until('v2-2', '2027-08-26');
    const ev = s.lifeEvents.find((e) => e.templateId === 'bonus')!;
    expect(ev).toBeDefined();
    const bonus = s.obligations.find((o) => o.category === 'premia')!;
    expect(bonus.direction).toBe('receivable');
    expect(bonus.dueDate).toBe('2027-09-04');
    consistent(advanceDays(s, 15));
  });

  it('dorywcze zlecenie: zajmuje godziny w budżecie czasu i wypłaca po zakończeniu (kwota nieznana z góry)', () => {
    const s = until('v2-1', '2026-04-06');
    const ev = pendingLifeEvents(s).find((e) => e.templateId === 'side_gig')!;
    expect(ev).toBeDefined();
    const accepted = ok(commands.resolveLifeEvent(s, ev.id, 'accept'));
    expect(accepted.commitments).toHaveLength(1);
    const freeBefore = budgetFor(s, '2026-04-08').free;
    expect(budgetFor(accepted, '2026-04-08').free).toBe(freeBefore - 2);
    expect(accepted.lifeEvents.find((e) => e.id === ev.id)!.outcome).not.toMatch(/zł/); // dokładna kwota ukryta do końca zlecenia
    const done = advanceDays(accepted, 30);
    const payout = done.obligations.find((o) => o.category === 'dodatkowy_zarobek')!;
    expect(payout.amount).toBeGreaterThanOrEqual(zl(700));
    expect(payout.amount).toBeLessThanOrEqual(zl(1_100));
    expect(payout.status).toBe('settled');
    expect(done.commitments[0]!.endDate < done.clock.today).toBe(true);
    consistent(done);
  });

  it('kurs: opłata, godziny w budżecie i +1 poziom umiejętności po ukończeniu', () => {
    const s = until('v2-0', '2028-01-15');
    const ev = pendingLifeEvents(s).find((e) => e.templateId === 'course')!;
    expect(ev).toBeDefined();
    const skill = String(ev.params.skill);
    const lvl = s.life.skills[skill]!;
    const enrolled = ok(commands.resolveLifeEvent(s, ev.id, 'enroll'));
    expect(enrolled.obligations.some((o) => o.category === 'szkolenie' && o.amount === zl(900))).toBe(true);
    expect(enrolled.life.skills[skill]).toBe(lvl); // jeszcze nie ukończony
    const done = advanceDays(enrolled, 35);
    expect(done.life.skills[skill]).toBe(lvl + 1);
    expect(done.events.some((e) => e.title.startsWith('Ukończono kurs'))).toBe(true);
    consistent(done);
  });

  it('decyzja niewykonalna (brak wolnych godzin) jest odrzucana bez zmiany stanu', () => {
    const s = until('v2-1', '2026-04-06');
    const ev = pendingLifeEvents(s).find((e) => e.templateId === 'side_gig')!;
    const packed = ok(commands.setTimePlan(s, { sleepHours: 8, businessHours: 3 })); // wolne 1 godz. w dni robocze
    const snapshot = structuredClone(packed);
    const r = commands.resolveLifeEvent(packed, ev.id, 'accept');
    expect(r).toMatchObject({ ok: false });
    expect(packed).toEqual(snapshot);
    expect(packed.lifeEvents.find((e) => e.id === ev.id)!.status).toBe('pending');
  });

  it('ciągłość 12 miesięcy aktywnego zarządzania: praca, mieszkanie, czas, styl życia, oszczędności', () => {
    let s = game('year-1', true);
    s = fund(s, zl(6_000));
    s = ok(commands.setLifestyle(s, 'oszczedny'));
    s = ok(commands.signLease(s, 'flat:kawalerka-nagorki', '2026-03-01'));
    s = ok(commands.setTimePlan(s, { sleepHours: 8, businessHours: 1 }));
    for (let m = 0; m < 12; m++) {
      s = advanceToNextMonth(s);
      // co miesiąc: odkładaj nadwyżkę ponad bufor i rozstrzygaj oczekujące decyzje opcją domyślną
      const spare = playerAccount(s).balance - zl(3_000);
      if (spare > zl(100)) s = ok(commands.transferFunds(s, s.playerAccountId, SAVINGS_ACCOUNT_ID, Math.floor(spare / 100) * 100));
      for (const ev of pendingLifeEvents(s)) if (ev.defaultOptionId) {
        const r = commands.resolveLifeEvent(s, ev.id, ev.defaultOptionId);
        if (r.ok) s = r.state;
      }
      expect(checkInvariants(s), `miesiąc ${m + 1}`).toEqual([]);
    }
    expect(s.clock.today).toBe('2027-01-01');
    expect(s.assets.length).toBeGreaterThan(0);
    expect(currentLease(s)!.listingId).toBe('flat:kawalerka-nagorki');
    expect(savingsBalance(s)).toBeGreaterThan(0);
    expect(s.ledger.some((t) => t.category === 'odsetki')).toBe(true);
    expect(s.events.filter((e) => e.type === 'lifestyle.changed')).toHaveLength(1);
    expect(new Set(s.ledger.map((t) => t.id)).size).toBe(s.ledger.length);
    expect(overdueObligations(s).length).toBeLessThanOrEqual(1);
  });
});
