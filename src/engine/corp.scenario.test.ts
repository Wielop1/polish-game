import { describe, expect, it } from 'vitest';
import { commands } from './commands.ts';
import { addDays } from './date.ts';
import { checkInvariants } from './invariants.ts';
import { zl } from './money.ts';
import { advanceDays } from './simulate.ts';
import { netWorth, netWorthBreakdown } from './selectors.ts';
import { company, ok, shapePartner, toDate, richGame, foundCompany, playCompany, addSales } from './corpkit.ts';
import { distributable } from './companyFinance.ts';
import { activeBusiness } from './business.ts';
import { REG } from './testkit.ts';
import { contract, runUntil, buyAll } from './testkit.ts';

/**
 * Scenariusz 36 miesięcy (v0.8): gracz prowadzi JDG, zakłada spółkę z drugim wspólnikiem, wnosi kapitał, pozyskuje kontrakty, zatrudnia pracowników,
 * podejmuje uchwały, rozlicza CIT i wypłaca dopuszczalną dywidendę. Intensywne przychody B2B (jeszcze niezaimplementowane w grze) odwzorowano
 * dokumentami sprzedaży spółki — wyłącznie po to, by spółka miała z czego płacić CIT i dywidendę.
 */
describe('scenariusz 36 miesięcy: JDG + spółka z o.o. z drugim wspólnikiem', () => {
  it('JDG działa obok spółki; spółka: wkłady, kontrakty, pracownicy, uchwały, CIT, dywidenda; niezmienniki i rozdział majątku przez cały czas', () => {
    // ----- JDG gracza (luty 2026) -----
    let s = richGame('scn-36', zl(400_000));
    s = ok(commands.registerBusiness(s, { ...REG, startDate: '2026-02-01', vatStatus: 'exempt' }));
    s = toDate(s, '2026-02-01');
    s = ok(commands.transferFunds(s, s.playerAccountId, activeBusiness(s)!.accountId, zl(60_000)));
    for (const e of ['paint-basic', 'paint-basic']) s = ok(commands.buyEquipment(s, e));
    let jdg = contract(s, {}); s = jdg.s;
    s = buyAll(s, jdg.job.id);
    s = runUntil(s, (x) => x.reno.jobs.find((j) => j.id === jdg.job.id)!.stage === 'done', 120);
    expect(s.reno.jobs.filter((j) => j.stage === 'done')).toHaveLength(1);
    // ----- spółka z drugim wspólnikiem (60/40), zarząd: oboje, reprezentacja samodzielna -----
    s = shapePartner(s, 'partner:1', { trust: 70, capital: zl(300_000), riskTolerance: 60, competence: 60, dividendPreference: 60, goal: 'income' });
    s = toDate(s, '2026-06-01');
    s = foundCompany(s, { draft: { capital: zl(150_000), vatPlan: 'active' }, partnerId: 'partner:1', partnerShares: 1_200, board: 'both' });
    expect(company(s).status).toBe('registered');
    s = ok(commands.startCompanyOperation(s, 'co:1', {}));
    s = toDate(s, company(s).operation!.startDate);
    s = ok(commands.selectOperator(s, 'co:1'));
    for (const e of ['paint-basic', 'paint-basic']) s = ok(commands.buyEquipment(s, e));
    // ----- 14 miesięcy pracy spółki z botem + przychody B2B na koniec 2026 -----
    s = playCompany(s, 5, {});
    s = addSales(s, zl(420_000), { cost: zl(80_000) });
    s = toDate(s, '2027-01-02');
    expect(company(s).yearResults.map((y) => y.year)).toEqual([2026]);
    expect(company(s).yearResults[0]!.netProfit).toBeGreaterThan(zl(100_000));
    expect(s.corp.citReturns.find((r) => r.year === 2026)!.rateBps).toBe(900);
    expect(checkInvariants(s)).toEqual([]);
    // ----- zgromadzenie: sprawozdanie, potem dywidenda -----
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'approve_statements', year: 2026 }));
    s = advanceDays(s, 14);
    expect(company(s).statementsApproved).toEqual([2026]);
    const d = distributable(s, company(s));
    expect(d.max).toBeGreaterThan(zl(50_000));
    const gross = Math.floor((d.max / 2) / 10_000) * 10_000;
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'allocate_profit', year: 2026, dividendGross: gross, toReserve: 0, dividendDay: addDays(s.clock.today, 14), payDay: addDays(s.clock.today, 28) }));
    s = advanceDays(s, 30);
    const div = s.corp.dividends[0]!;
    expect(div.grossTotal).toBe(gross);
    expect(div.status === 'declared' || div.status === 'paid').toBe(true);
    s = advanceDays(s, 60);
    expect(s.corp.dividends[0]!.status).toBe('paid');
    // ----- kolejne lata -----
    s = playCompany(s, 10, { marketing: false });
    s = addSales(s, zl(300_000), { cost: zl(60_000) });
    s = toDate(s, '2028-01-02');
    expect(company(s).yearResults.map((y) => y.year)).toEqual([2026, 2027]);
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'approve_statements', year: 2027 }));
    s = advanceDays(s, 14);
    const d2 = distributable(s, company(s));
    if (d2.max > zl(20_000)) {
      s = ok(commands.proposeResolution(s, 'co:1', { type: 'allocate_profit', year: 2027, dividendGross: Math.floor(d2.max / 20_000) * 10_000, toReserve: 0, dividendDay: addDays(s.clock.today, 14), payDay: addDays(s.clock.today, 21) }));
      s = advanceDays(s, 40);
    }
    s = toDate(s, '2029-02-01');
    expect(checkInvariants(s)).toEqual([]);
    // rozdział majątku: dokumenty JDG i spółki nie mieszają się, a JDG nadal jest JDG
    const opId = company(s).operation!.id;
    expect(s.documents.filter((x) => x.businessId === opId).length).toBeGreaterThan(20);
    expect(s.documents.filter((x) => x.businessId === activeBusiness(s)!.id).length).toBeGreaterThan(0);
    expect(activeBusiness(s)!.ownerId).toBe(s.person.id);
    const nw = netWorthBreakdown(s);
    expect(nw.shares).toBeGreaterThan(0);
    expect(nw.netWorth).toBe(netWorth(s));
    // brak podwójnych dywidend: jedna wypłata na uchwałę
    expect(new Set(s.corp.dividends.map((x) => x.resolutionId)).size).toBe(s.corp.dividends.length);
    // CIT rozliczony za 2026–2028 (zaliczki + zeznania)
    expect(s.corp.citReturns.map((r) => r.year)).toEqual([2026, 2027, 2028]);
  }, 600_000);
});
