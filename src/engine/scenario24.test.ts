import { describe, expect, it } from 'vitest';
import { commands } from './commands.ts';
import { activeBusiness } from './business.ts';
import { addDays, diffDays } from './date.ts';
import { checkInvariants } from './invariants.ts';
import { zl } from './money.ts';
import { defaultQuoteInput, jobFinancials, jobShortage, previewQuote, renoDashboard } from './renovation.ts';
import { netWorth } from './selectors.ts';
import { advanceDays } from './simulate.ts';
import type { GameState } from './state.ts';
import { crewProfitability, fixedCosts } from './profitability.ts';
import { subcontractsOfJob } from './subcontractors.ts';
import { yearReport } from './report.ts';
import { opsGame, ok } from './testkit.ts';

/**
 * Polityka gracza przez zadaną liczbę miesięcy: reklama, biuro, rekrutacja pracownika i ekipa, pojazd, wyceny z ekipą lub samodzielnie,
 * podwykonawcy dla zleceń bez ekipy, zakupy materiałów, naprawa reklamacji, konserwacja sprzętu.
 */
function play(seed: string, months: number): GameState {
  let s = opsGame({ seed, equip: ['paint-basic', 'sprayer', 'paint-basic', 'laser'], business: zl(150_000) });
  s = ok(commands.hireAccountingOffice(s, 'standard'));
  for (const [ch, amount] of [['search', zl(800)], ['portals', zl(600)], ['local_ads', zl(400)]] as const) s = ok(commands.setMarketingBudget(s, ch, amount));
  const end = addDays('2026-02-01', months * 30);
  let day = 0;
  while (s.clock.today < end) {
    s = advanceDays(s, 1);
    day += 1;
    const backlog = s.reno.enquiries.filter((e) => e.status === 'open' || e.status === 'quoted').length;
    if (day >= 30 && s.ops.employments.length < 1 && backlog >= 2 && !s.ops.listings.some((l) => l.status === 'active')) {
      const r = commands.publishListing(s, { role: 'malarz', minLevel: 1, tier: 'premium' });
      if (r.ok) s = r.state;
    }
    for (const c of s.ops.candidates.filter((x) => x.status === 'new' || x.status === 'countered')) {
      if (s.ops.employments.length >= 1) break;
      const p = s.ops.people.find((x) => x.id === c.personId)!;
      const r = commands.makeOffer(s, c.id, { gross: Math.max(c.counterGross ?? 0, p.expectedGross), hoursPerMonth: 160, startDate: addDays(s.clock.today, Math.max(1, diffDays(p.availableFrom, s.clock.today))) });
      if (r.ok) s = r.state;
    }
    for (const e of s.ops.employments.filter((x) => x.status === 'active')) {
      if (s.ops.teams.some((t) => t.members.some((m) => m.id === e.id))) continue;
      const r = commands.createTeam(s, 'Ekipa malarska', [{ kind: 'employee', id: e.id }]);
      if (r.ok) s = r.state;
    }
    if (day === 90 && s.ops.vehicles.length === 0) { const r = commands.buyVehicle(s, 'van-small'); if (r.ok) s = r.state; }
    // rynek (v0.7) daje kilkaset zapytań rocznie, a firma o takiej mocy obsłuży najwyżej kilka dziennie — wyceniamy dwa najstarsze (reszta wygasa), żeby test nie kopiował stanu setki razy
    for (const e of s.reno.enquiries.filter((x) => x.status === 'open').slice(0, 2)) {
      let q: ReturnType<typeof defaultQuoteInput> = { ...defaultQuoteInput(s, e), advanceBps: 1_500 };
      if (e.serviceId === 'malowanie') {
        for (const tm of s.ops.teams) {
          let cand = { ...q, teamId: tm.id, supervision: 'hands-off' as const, vehicleId: s.ops.vehicles[0]?.id ?? null };
          let pv = previewQuote(s, cand);
          if (pv.errors.length) continue;
          cand = { ...cand, durationDays: Math.max(cand.durationDays, pv.minDays + 3) };
          pv = previewQuote(s, cand);
          if (pv.errors.length || pv.warnings.some((w) => w.includes('przydzielony') || w.includes('Kolizja'))) continue;
          q = { ...cand, priceNet: Math.round((pv.planned.total * 1.3) / 1_000) * 1_000 };
          break;
        }
      }
      const r = commands.sendQuote(s, e.id, q);
      if (r.ok) s = r.state;
    }
    for (const q of s.reno.quotes.filter((x) => x.status === 'counter')) { const r = commands.respondToCounter(s, q.id, 'accept'); if (r.ok) s = r.state; }
    for (const q of s.reno.quotes.filter((x) => x.status === 'accepted')) { const r = commands.signContract(s, q.id); if (r.ok) s = r.state; }
    if (day % 7 === 0) {
      for (const j of s.reno.jobs.filter((x) => x.stage === 'preparation' && x.crew.teamId === null && diffDays(x.startDate, s.clock.today) > 4)) {
        if (s.ops.subcontracts.some((c) => c.jobId === j.id)) continue;
        const sub = s.ops.subcontractors.find((x) => x.services.includes(j.serviceId) && x.reliabilityBps >= 8_500);
        if (!sub) continue;
        const r = commands.requestSubOffer(s, sub.id, j.id, 10_000);
        if (r.ok) s = r.state;
      }
    }
    for (const c of s.ops.subcontracts.filter((x) => x.status === 'offered')) { const r = commands.acceptSubOffer(s, c.id); if (r.ok) s = r.state; }
    for (const c of s.ops.subcontracts.filter((x) => x.status === 'delivered')) { const r = commands.acceptSubWork(s, c.id); if (r.ok) s = r.state; }
    for (const j of s.reno.jobs.filter((x) => x.stage !== 'done' && x.stage !== 'cancelled')) {
      if (diffDays(j.startDate, s.clock.today) <= 3 && Object.keys(jobShortage(s, j)).length > 0) { const r = commands.buyMissingForJob(s, j.id); if (r.ok) s = r.state; }
    }
    for (const c of s.reno.complaints.filter((x) => x.status === 'open')) { const r = commands.resolveComplaint(s, c.id, 'repair'); if (r.ok) s = r.state; }
    for (const it of s.reno.equipment) if (it.conditionBps < 3_500) { const r = commands.maintainEquipment(s, it.id); if (r.ok) s = r.state; }
    if (s.clock.today.endsWith('-15')) expect(checkInvariants(s), s.clock.today).toEqual([]);
  }
  return s;
}

describe('11. scenariusz 24 miesięcy: firma zatrudniająca ludzi i korzystająca z podwykonawców', () => {
  it('pracownik, ekipa, podwykonawcy, pojazd i równoległe kontrakty działają przez 24 miesiące przy spójnych finansach', () => {
    const s = play('ops-24', 24);
    const dash = renoDashboard(s);
    expect(checkInvariants(s)).toEqual([]);
    expect(s.clock.today >= '2028-01-20').toBe(true);
    // ludzie: zatrudnienie, listy płac co miesiąc, brak dubli
    expect(s.ops.employments.length).toBeGreaterThanOrEqual(1);
    const emp = s.ops.employments[0]!;
    expect(s.ops.payslips.filter((p) => p.employmentId === emp.id).length).toBeGreaterThanOrEqual(12);
    expect(new Set(s.ops.payslips.map((p) => p.id)).size).toBe(s.ops.payslips.length);
    expect(new Set(s.obligations.map((o) => o.id)).size).toBe(s.obligations.length);
    // ekipa realizuje kontrakty bez godzin pracy właściciela
    const teamJobs = s.reno.jobs.filter((j) => j.crew.teamId !== null && j.stage === 'done');
    expect(teamJobs.length).toBeGreaterThanOrEqual(3);
    expect(teamJobs.every((j) => j.crew.supervision === 'hands-off')).toBe(true);
    expect(teamJobs.every((j) => j.actual.labor > 0)).toBe(true);
    // podwykonawcy: umowy, odbiory i rozliczenia
    const settled = s.ops.subcontracts.filter((c) => c.status === 'settled');
    expect(settled.length).toBeGreaterThanOrEqual(3);
    expect(settled.every((c) => c.prepaid === 0 && c.settledNet > 0)).toBe(true);
    // pojazd użyty, koszty eksploatacji rozliczone dokumentami
    expect(s.ops.vehicles).toHaveLength(1);
    expect(s.ops.vehicles[0]!.usedDays).toBeGreaterThan(0);
    expect(s.documents.filter((d) => d.description.startsWith('Pojazdy: eksploatacja')).length).toBeGreaterThanOrEqual(12);
    // równoległość: były okresy z co najmniej dwoma jednocześnie realizowanymi kontraktami
    const days = new Map<string, number>();
    for (const j of s.reno.jobs) if (j.stage === 'done' && j.finishedOn) for (let d = j.startDate; d <= j.finishedOn; d = addDays(d, 1)) days.set(d, (days.get(d) ?? 0) + 1);
    expect(Math.max(...days.values())).toBeGreaterThanOrEqual(2);
    // zaliczki: przychód podatkowy dopiero po wykonaniu usługi, bez dubli
    for (const j of s.reno.jobs.filter((x) => x.stage === 'done' && x.advanceNet > 0 && x.advanceMode === 'deferred')) {
      const adv = s.documents.find((d) => d.id === j.advanceDocId)!;
      const fin = s.documents.find((d) => d.id === j.finalDocId)!;
      expect(adv.taxAmount).toBe(0);
      expect(fin.taxAmount).toBe(fin.net + j.advanceNet);
    }
    // rentowność: koszty stałe oddzielone od kosztów kontraktów; wynik kontraktów dodatni; ekipy i właściciel rozliczone osobno
    const profits = crewProfitability(s);
    expect(profits.some((p) => p.teamId !== null && p.doneJobs > 0)).toBe(true);
    expect(dash.economicResultDone).toBeGreaterThan(zl(10_000));
    const fc = fixedCosts(s, '2027-06');
    expect(fc.payrollTotal).toBeGreaterThan(0);
    expect(fc.payrollAllocated + fc.payrollIdle).toBe(fc.payrollTotal);
    expect(fc.total).toBeGreaterThan(fc.payrollIdle);
    // spójność majątku: zapasy, sprzęt i pojazd jako aktywa, raport roczny zgodny z dokumentami
    expect(netWorth(s)).toBeGreaterThan(zl(50_000));
    const y27 = yearReport(s, 2027);
    expect(y27.revenue).toBe(s.documents.filter((d) => d.kind === 'sales' && d.issueDate.startsWith('2027-')).reduce((a, d) => a + d.taxAmount, 0));
    expect(y27.economicResult).toBe(y27.result + y27.inventoryChange);
    for (const j of s.reno.jobs.filter((x) => x.stage === 'done')) expect(jobFinancials(j, subcontractsOfJob(s, j.id)).settled).toBe(true);
    expect(activeBusiness(s)).not.toBeNull();
  }, 300_000);

  it('deterministyczność: ten sam seed i te same decyzje dają identyczny stan; zapis w środku nie zmienia wyniku', () => {
    const a = play('ops-det', 8);
    expect(play('ops-det', 8)).toEqual(a);
    const copy = JSON.parse(JSON.stringify(a)) as GameState;
    expect(advanceDays(copy, 30)).toEqual(advanceDays(a, 30));
  }, 300_000);
});
