import { describe, expect, it } from 'vitest';
import { commands } from './commands.ts';
import { activeBusiness } from './business.ts';
import { addDays } from './date.ts';
import { checkInvariants } from './invariants.ts';
import { zl } from './money.ts';
import { computePayroll } from './payroll.ts';
import { advanceDays, processDay } from './simulate.ts';
import { businessSummaries, netWorth } from './selectors.ts';
import { yearReport } from './report.ts';
import { budgetFor } from './time.ts';
import type { GameState } from './state.ts';
import { bizBalance, craftCandidate, fail, hireEmployee, ok, opsGame, toDate } from './testkit.ts';
import { employerContributions, giveNotice, minGrossFor, monthlyEmployerCost, noticePeriod, payrollMonth, personLevel, personPerformanceBps } from './workforce.ts';

const consistent = (s: GameState) => expect(checkInvariants(s)).toEqual([]);

describe('1. rekrutacja', () => {
  it('ogłoszenie: koszt jako dokument firmy, 1 godz. dziennie przez 5 dni, limity i ochrona przed duplikatem', () => {
    let s = opsGame();
    const docs0 = s.documents.length;
    const cash0 = bizBalance(s);
    s = ok(commands.publishListing(s, { role: 'malarz', minLevel: 2, tier: 'basic' }));
    expect(s.documents.length).toBe(docs0 + 1);
    expect(s.documents.at(-1)).toMatchObject({ kind: 'cost', net: zl(300) });
    const l = s.ops.listings[0]!;
    expect(l).toMatchObject({ role: 'malarz', skillId: 'malowanie', minLevel: 2, status: 'active', endsOn: addDays(s.clock.today, 21) });
    const c = s.commitments.find((x) => x.id === l.commitmentId)!;
    expect(c).toMatchObject({ hoursPerDay: 1, startDate: addDays(s.clock.today, 1), endDate: addDays(s.clock.today, 5) });
    expect(budgetFor(s, addDays(s.clock.today, 2)).commitments).toBe(1);
    expect(fail(commands.publishListing(s, { role: 'malarz', minLevel: 1, tier: 'premium' }))).toMatch(/już aktywne/);
    expect(fail(commands.publishListing(s, { role: 'nieznane', minLevel: 1, tier: 'basic' }))).toMatch(/stanowisko/);
    expect(fail(commands.publishListing(s, { role: 'gipsiarz', minLevel: 9, tier: 'basic' }))).toMatch(/od 1 do 5/);
    expect(bizBalance(advanceDays(s, 2))).toBeLessThan(cash0);
    consistent(s);
  });

  it('brak środków lub wolnych godzin blokuje rekrutację z czytelnym komunikatem', () => {
    expect(fail(commands.publishListing(opsGame({ business: zl(500), equip: [] }), { role: 'malarz', minLevel: 1, tier: 'premium' }))).toMatch(/Za mało środków/);
    let s = opsGame();
    s.commitments.push({ id: 'c:test', label: 'obciążenie', startDate: addDays(s.clock.today, 1), endDate: addDays(s.clock.today, 30), hoursPerDay: 4, sourceEventId: null });
    expect(fail(commands.publishListing(s, { role: 'malarz', minLevel: 1, tier: 'basic' }))).toMatch(/Rekrutacja zajmuje 1 godz./);
  });

  it('zgłoszenia napływają deterministycznie, nie są same ideały i wygasają razem z ogłoszeniem', () => {
    const run = () => {
      let s = opsGame({ seed: 'hr-seed' });
      s = ok(commands.publishListing(s, { role: 'gipsiarz', minLevel: 3, tier: 'premium' }));
      return toDate(s, '2026-03-30');
    };
    const a = run();
    expect(run().ops.candidates).toEqual(a.ops.candidates);
    expect(a.ops.listings[0]!.status).toBe('closed'); // 21 dni
    // statystyka wielu kandydatów (kolejne ogłoszenia w różnych seedach): poziomy zróżnicowane, oczekiwania ≥ minimalne
    const levels: number[] = [];
    const expectedPay: number[] = [];
    for (const seed of ['hr-a', 'hr-b', 'hr-c', 'hr-d', 'hr-e', 'hr-f']) {
      let s = opsGame({ seed });
      s = ok(commands.publishListing(s, { role: 'gipsiarz', minLevel: 3, tier: 'premium' }));
      s = advanceDays(s, 21);
      for (const c of s.ops.candidates) {
        const p = s.ops.people.find((x) => x.id === c.personId)!;
        levels.push(personLevel(p, 'gladzie'));
        expectedPay.push(p.expectedGross);
        expect(p.status === 'candidate' || p.status === 'withdrawn').toBe(true);
        expect(p.birthDate < '2008-01-01' && p.birthDate > '1971-01-01').toBe(true); // 19–54 lata
      }
    }
    expect(levels.length).toBeGreaterThan(12);
    expect(levels.some((l) => l < 3)).toBe(true); // są osoby poniżej wymaganego poziomu
    expect(levels.some((l) => l >= 3)).toBe(true);
    expect(new Set(levels).size).toBeGreaterThanOrEqual(3);
    expect(Math.min(...expectedPay)).toBeGreaterThanOrEqual(zl(4_806));
    expect(Math.max(...expectedPay)).toBeGreaterThan(Math.min(...expectedPay));
    const closed = a.ops.candidates.filter((c) => c.status === 'new' || c.status === 'countered');
    expect(a.ops.candidates.length).toBeLessThanOrEqual(6);
    void closed;
  });
});

describe('2. zatrudnianie i negocjacja', () => {
  const offerAt = (s: GameState, candId: string, personExpected: number, ratio: number, over: { hours?: number; start?: string } = {}) =>
    commands.makeOffer(s, candId, { gross: Math.round((personExpected * ratio) / 10_000 / 10) * 10, hoursPerMonth: over.hours ?? 160, startDate: over.start ?? addDays(s.clock.today, 2) });

  it('oferta ≥ oczekiwań zwykle jest przyjmowana (kandydaci mogą odmówić), tworzy umowę i osobę-pracownika', () => {
    let hired = 0, declined = 0;
    for (let i = 0; i < 30; i++) {
      const s = opsGame({ seed: `neg-${i}` });
      const { cand, person } = craftCandidate(s, { expected: zl(5_400) });
      const r = offerAt(s, cand.id, person.expectedGross, 10_000);
      const next = ok(r);
      const c = next.ops.candidates.find((x) => x.id === cand.id)!;
      if (c.status === 'hired') {
        hired += 1;
        const e = next.ops.employments.find((x) => x.id === c.employmentId)!;
        expect(e).toMatchObject({ grossMonthly: zl(5_400), hoursPerMonth: 160, status: 'active', endDate: null });
        expect(e.wageHistory).toEqual([{ from: e.startDate, gross: zl(5_400) }]);
        expect(next.ops.people.find((p) => p.id === person.id)!.status).toBe('employee');
        expect(e.hourlyCost).toBe(Math.round(monthlyEmployerCost(zl(5_400)) / 160));
      } else { declined += 1; expect(c.status).toBe('declined'); }
    }
    expect(hired).toBeGreaterThan(22);
    expect(declined).toBeGreaterThanOrEqual(0);
  });

  it('negocjacja: poniżej 92% odmowa, 92–100% kontrpropozycja do oczekiwań (jedna runda), po kontrpropozycji akceptacja', () => {
    const s0 = opsGame();
    const a = craftCandidate(s0, { expected: zl(6_000) });
    const low = ok(offerAt(s0, a.cand.id, a.person.expectedGross, 8_500));
    expect(low.ops.candidates.find((c) => c.id === a.cand.id)).toMatchObject({ status: 'declined', note: 'oferta zbyt niska' });
    const mid = ok(offerAt(s0, a.cand.id, a.person.expectedGross, 9_500));
    const c = mid.ops.candidates.find((x) => x.id === a.cand.id)!;
    expect(c).toMatchObject({ status: 'countered', counterGross: zl(6_000) });
    // przyjęcie kontrpropozycji = zatrudnienie
    const hired = ok(commands.makeOffer(mid, a.cand.id, { gross: zl(6_000), hoursPerMonth: 160, startDate: addDays(mid.clock.today, 3) }));
    expect(hired.ops.candidates.find((x) => x.id === a.cand.id)!.status).toBe('hired');
    // za niska druga oferta po kontrpropozycji kończy rozmowy
    const stubborn = ok(offerAt(mid, a.cand.id, a.person.expectedGross, 9_300));
    expect(stubborn.ops.candidates.find((x) => x.id === a.cand.id)!.status).toBe('declined');
  });

  it('walidacje oferty: płaca minimalna proporcjonalnie do wymiaru, dostępność kandydata, termin, wymiar i limit zatrudnienia', () => {
    const s = opsGame();
    const { cand, person } = craftCandidate(s, { expected: zl(5_400), availableFrom: addDays(s.clock.today, 20) });
    const base = { gross: zl(5_400), hoursPerMonth: 160, startDate: addDays(s.clock.today, 25) };
    expect(fail(commands.makeOffer(s, cand.id, { ...base, gross: zl(4_000) }))).toMatch(/minimalne/);
    expect(minGrossFor(80)).toBe(zl(2_403));
    expect(fail(commands.makeOffer(s, cand.id, { ...base, gross: zl(2_000), hoursPerMonth: 80 }))).toMatch(/minimalne/);
    expect(fail(commands.makeOffer(s, cand.id, { ...base, startDate: addDays(s.clock.today, 5) }))).toMatch(/dostępny dopiero od/);
    expect(fail(commands.makeOffer(s, cand.id, { ...base, startDate: s.clock.today }))).toMatch(/najwcześniej jutro/);
    expect(fail(commands.makeOffer(s, cand.id, { ...base, hoursPerMonth: 200 }))).toMatch(/od 80 do 168/);
    expect(person.availableFrom).toBe(addDays(s.clock.today, 20));
    // limit 8 pracowników
    let full = opsGame();
    for (let i = 0; i < 8; i++) full = hireEmployee(full, { expected: zl(5_000) + i * 10 }).s;
    const extra = craftCandidate(full, { expected: zl(5_000) });
    expect(fail(commands.makeOffer(full, extra.cand.id, { gross: zl(5_100), hoursPerMonth: 160, startDate: addDays(full.clock.today, 2) }))).toMatch(/Limit zatrudnienia: 8/);
    consistent(full);
  });

  it('odrzucenie kandydata, wygaśnięcie zgłoszeń i niedostępność komend poza biznesem', () => {
    let s = opsGame();
    const { cand } = craftCandidate(s);
    s = ok(commands.rejectCandidate(s, cand.id));
    expect(s.ops.candidates.find((c) => c.id === cand.id)!.status).toBe('rejected');
    expect(fail(commands.rejectCandidate(s, cand.id))).toMatch(/nie czeka/);
    const g = opsGame();
    craftCandidate(g);
    g.ops.listings[0]!.status = 'closed'; // bez nowych zgłoszeń — sprawdzamy samo wygasanie
    const later = advanceDays(g, 16);
    expect(later.ops.candidates.every((c) => c.status === 'expired')).toBe(true);
    expect(later.ops.people.every((p) => p.status === 'withdrawn')).toBe(true);
  });
});

describe('3. wynagrodzenia i koszty pracodawcy', () => {
  it('składki pracodawcy 2026: przykład wzorcowy 4 806 zł → 984,28 zł (koszt 5 790,28 zł); limit 30-krotności; FP/FGŚP od progu płacy minimalnej', () => {
    const e = employerContributions(zl(4_806), zl(4_806), zl(4_806));
    expect(e).toEqual({ emerytalna: zl(469.07), rentowa: zl(312.39), wypadkowa: zl(80.26), fp: zl(117.75), fgsp: zl(4.81), total: zl(984.28) });
    expect(monthlyEmployerCost(zl(4_806))).toBe(zl(5_790.28));
    // powyżej rocznego limitu podstaw emerytalna i rentowa znikają, wypadkowa/FP/FGŚP zostają
    const capped = employerContributions(zl(10_000), 0, zl(10_000));
    expect(capped).toMatchObject({ emerytalna: 0, rentowa: 0, wypadkowa: zl(167), fp: zl(245), fgsp: zl(10), total: zl(422) });
    // niepełny etat poniżej płacy minimalnej: bez FP i FGŚP, reszta składek jest
    const part = employerContributions(zl(2_800), zl(2_800), zl(2_800));
    expect(part.fp).toBe(0);
    expect(part.fgsp).toBe(0);
    expect(part.emerytalna).toBe(zl(273.28));
    expect(part.wypadkowa).toBe(zl(46.76));
  });

  it('lista płac po miesiącu: kalkulator płac (netto, ZUS, PIT), dokument kosztowy = brutto + składki pracodawcy, 3 zobowiązania z terminami 10./20./20.', () => {
    let { s, emp } = hireEmployee(opsGame(), { expected: zl(5_400), start: '2026-02-02' });
    expect(emp.startDate).toBe('2026-02-02');
    s = toDate(s, '2026-03-02');
    const slip = s.ops.payslips.find((p) => p.employmentId === emp.id && p.month === '2026-02')!;
    expect(slip.factorBps).toBe(Math.round((27 * 10_000) / 28)); // 2–28 lutego
    const calc = computePayroll({ gross: slip.gross, accrualDate: '2026-02-28', payDate: '2026-03-10', birthDate: s.ops.people[0]!.birthDate, ytdPensionBase: 0, ytdPitBase: 0, ytdExempt: 0, pit2: true });
    expect(slip).toMatchObject({ net: calc.net, pitAdvance: calc.pitAdvance, socialTotal: calc.socialTotal, health: calc.health });
    expect(slip.totalCost).toBe(slip.gross + slip.employer.total);
    const doc = s.documents.find((d) => d.id === slip.docId)!;
    expect(doc).toMatchObject({ kind: 'cost', part: 'payroll', net: slip.totalCost, taxAmount: slip.totalCost, vatTreatment: 'exempt' });
    const obs = slip.obligationIds.map((id) => s.obligations.find((o) => o.id === id)!);
    expect(obs.map((o) => [o.category, o.dueDate]).sort()).toEqual([['skladki_pracownicze', '2026-03-20'], ['wynagrodzenie_pracownika', '2026-03-10'], ['zaliczka_pit_pracownicza', '2026-03-20']].sort());
    expect(obs.reduce((a, o) => a + o.amount, 0)).toBe(slip.totalCost);
    expect(obs.find((o) => o.category === 'wynagrodzenie_pracownika')!.amount).toBe(slip.net);
    expect(obs.find((o) => o.category === 'skladki_pracownicze')!.amount).toBe(slip.socialTotal + slip.health + slip.employer.total);
    consistent(s);
  });

  it('pełny miesiąc: koszt podatkowy, podsumowania firmy i roczny raport zawierają koszt zatrudnienia; zapłata rozlicza zobowiązania bez podwójnego księgowania', () => {
    let { s, emp } = hireEmployee(opsGame(), { expected: zl(5_400), start: '2026-03-01' });
    s = toDate(s, '2026-05-05');
    const slips = s.ops.payslips.filter((p) => p.employmentId === emp.id);
    expect(slips.map((p) => p.month)).toEqual(['2026-03', '2026-04']);
    expect(slips.every((p) => p.factorBps === 10_000 && p.gross === zl(5_400))).toBe(true);
    const total = slips.reduce((a, p) => a + p.totalCost, 0);
    const costsByMonth = businessSummaries(s).filter((m) => m.month === '2026-03' || m.month === '2026-04').map((m) => m.costs);
    expect(costsByMonth.every((c) => c >= slips[0]!.totalCost)).toBe(true);
    expect(yearReport(s, 2026).costs).toBeGreaterThanOrEqual(total);
    // wszystkie zobowiązania marcowe są już opłacone (termin 10./20. kwietnia), każde raz
    const marchObs = slips[0]!.obligationIds.map((id) => s.obligations.find((o) => o.id === id)!);
    expect(marchObs.every((o) => o.status === 'settled')).toBe(true);
    const txs = s.ledger.filter((t) => t.obligationId && marchObs.some((o) => o.id === t.obligationId));
    expect(txs).toHaveLength(marchObs.length);
    // ponowne przetworzenie dnia nie tworzy drugiej listy płac
    const again = structuredClone(s);
    processDay(again, '2026-04-30');
    expect(again.ops.payslips.length).toBe(s.ops.payslips.length);
    consistent(s);
  });

  it('płaca z limitem rocznym i ulgą dla młodych: pracownik ≤ 26 lat ma PIT 0, a składki pracodawcy bez zmian', () => {
    const s0 = opsGame();
    const { cand, person } = craftCandidate(s0, { expected: zl(5_400), birth: '2003-06-15' });
    let s = ok(commands.makeOffer(s0, cand.id, { gross: zl(5_400), hoursPerMonth: 160, startDate: '2026-03-01' }));
    if (s.ops.candidates.find((c) => c.id === cand.id)!.status !== 'hired') s = ok(commands.makeOffer(s, cand.id, { gross: zl(5_400), hoursPerMonth: 160, startDate: '2026-03-01' }));
    if (s.ops.candidates.find((c) => c.id === cand.id)!.status === 'hired') {
      s = toDate(s, '2026-04-02');
      const slip = s.ops.payslips.find((p) => p.personId === person.id)!;
      expect(slip.pitAdvance).toBe(0);
      expect(slip.exemptGross).toBe(slip.gross);
      expect(slip.employer.total).toBe(employerContributions(slip.gross, slip.pensionBase, zl(5_400)).total);
    }
  });

  it('koszt zatrudnienia widać w majątku netto (wydatek), a zmiana wynagrodzenia obowiązuje od następnego miesiąca z historią', () => {
    let { s, emp } = hireEmployee(opsGame(), { expected: zl(5_400), start: '2026-03-01' });
    const nwBefore = netWorth(toDate(s, '2026-03-31'));
    s = toDate(s, '2026-03-20');
    expect(fail(commands.setWage(s, emp.id, zl(3_000)))).toMatch(/minimalne/);
    s = ok(commands.setWage(s, emp.id, zl(6_000)));
    const e = s.ops.employments.find((x) => x.id === emp.id)!;
    expect(e.wageHistory).toEqual([{ from: '2026-03-01', gross: zl(5_400) }, { from: '2026-04-01', gross: zl(6_000) }]);
    expect(e.hourlyCost).toBe(Math.round(monthlyEmployerCost(zl(6_000)) / 160));
    s = toDate(s, '2026-05-03');
    expect(s.ops.payslips.map((p) => p.gross)).toEqual([zl(5_400), zl(6_000)]);
    expect(netWorth(s)).toBeLessThan(nwBefore);
    consistent(s);
  });

  it('morale i zmęczenie zmieniają wydajność pracownika; zmęczony ma niższą wydajność', () => {
    const { s, emp } = hireEmployee(opsGame(), { expected: zl(5_400) });
    const p = s.ops.people.find((x) => x.id === emp.personId)!;
    const fresh = personPerformanceBps({ ...p, fatigue: 0, morale: 80 });
    expect(personPerformanceBps({ ...p, fatigue: 90, morale: 80 })).toBeLessThan(fresh);
    expect(personPerformanceBps({ ...p, fatigue: 0, morale: 10 })).toBeLessThan(fresh);
    expect(personPerformanceBps({ ...p, diligence: 95, fatigue: 0, morale: 60 })).toBeGreaterThan(personPerformanceBps({ ...p, diligence: 40, fatigue: 0, morale: 60 }));
  });
});

describe('4. wypowiedzenie umowy', () => {
  it('okres wypowiedzenia wg stażu: 2 tygodnie (koniec w sobotę), 1 miesiąc i 3 miesiące (koniec miesiąca)', () => {
    const { emp } = hireEmployee(opsGame(), { start: '2026-02-03' });
    const e = { ...emp, startDate: '2026-02-03' };
    const early = noticePeriod(e, '2026-03-10');
    expect(early.label).toBe('2 tygodnie');
    expect(early.endDate >= '2026-03-23' && early.endDate <= '2026-03-29').toBe(true);
    expect(new Date(`${early.endDate}T00:00:00Z`).getUTCDay()).toBe(6);
    expect(noticePeriod(e, '2026-08-12')).toEqual({ label: '1 miesiąc', endDate: '2026-09-30' });
    expect(noticePeriod(e, '2029-03-12')).toEqual({ label: '3 miesiące', endDate: '2029-06-30' });
  });

  it('wypowiedzenie: praca i płaca trwają do końca okresu (z proporcją), potem zatrudnienie wygasa, a historia osoby zostaje', () => {
    let { s, emp } = hireEmployee(opsGame(), { expected: zl(5_400), start: '2026-02-02' });
    s = toDate(s, '2026-09-10');
    s = ok(commands.giveNotice(s, emp.id));
    const e = s.ops.employments.find((x) => x.id === emp.id)!;
    expect(e).toMatchObject({ noticeGivenOn: '2026-09-10', noticeLabel: '1 miesiąc', endDate: '2026-10-31' });
    expect(fail(commands.giveNotice(s, emp.id))).toMatch(/już złożone/);
    s = toDate(s, '2026-11-03');
    const ended = s.ops.employments.find((x) => x.id === emp.id)!;
    expect(ended.status).toBe('ended');
    expect(s.ops.people.find((p) => p.id === emp.personId)!.status).toBe('former');
    expect(s.ops.payslips.filter((p) => p.employmentId === emp.id).map((p) => p.month)).toContain('2026-10');
    expect(s.ops.payslips.filter((p) => p.employmentId === emp.id && p.month > '2026-10')).toHaveLength(0);
    expect(s.ops.payslips.filter((p) => p.employmentId === emp.id).every((p) => p.factorBps === 10_000 || p.month === '2026-02')).toBe(true);
    const after = toDate(s, '2026-12-05');
    expect(after.ops.payslips.length).toBe(s.ops.payslips.length); // po zakończeniu nie ma kolejnych płac
    expect(after.events.some((ev) => ev.title.startsWith('Zakończono zatrudnienie'))).toBe(true);
    consistent(after);
  });

  it('wypowiedzenie dwutygodniowe: ostatnia lista płac jest proporcjonalna do dni zatrudnienia w miesiącu', () => {
    let { s, emp } = hireEmployee(opsGame(), { expected: zl(5_400), start: '2026-03-02' });
    s = toDate(s, '2026-04-08');
    s = ok(commands.giveNotice(s, emp.id));
    const end = s.ops.employments.find((x) => x.id === emp.id)!.endDate!;
    s = toDate(s, '2026-06-02');
    const month = end.slice(0, 7);
    const last = s.ops.payslips.find((p) => p.employmentId === emp.id && p.month === month)!;
    expect(last.factorBps).toBeLessThan(10_000);
    expect(last.gross).toBe(Math.round((zl(5_400) * last.factorBps) / 10_000));
    consistent(s);
  });
});

void payrollMonth; void giveNotice; void activeBusiness; void yearReport;
