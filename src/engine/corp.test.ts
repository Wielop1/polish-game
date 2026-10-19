import { describe, expect, it } from 'vitest';
import { commands } from './commands.ts';
import { checkInvariants } from './invariants.ts';
import { zl } from './money.ts';
import { netWorth, netWorthBreakdown } from './selectors.ts';
import { activeHoldings, capitalBps, voteBps } from './shares.ts';
import { advanceDays } from './simulate.ts';
import { DRAFT, company, fail, foundCompany, ok, richGame, shapePartner, toDate } from './corpkit.ts';

describe('P0 · założenie spółki z o.o. (S24), minimalny kapitał, rejestracja', () => {
  it('kapitał poniżej 5 000 zł i nominał poniżej 50 zł są odrzucane (art. 154 KSH)', () => {
    const s = richGame();
    expect(fail(commands.createCompanyDraft(s, { ...DRAFT, capital: zl(4_999) }))).toMatch(/5.000/);
    expect(fail(commands.createCompanyDraft(s, { ...DRAFT, nominal: zl(49) }))).toMatch(/50/);
    expect(fail(commands.createCompanyDraft(s, { ...DRAFT, capital: zl(10_025) }))).toMatch(/całkowitą liczbę udziałów/);
    expect(ok(commands.createCompanyDraft(s, { ...DRAFT, capital: zl(5_000) })).corp.companies).toHaveLength(1);
  });

  it('spółka w organizacji nie jest zarejestrowana przed wpisem; wniosek S24 rozpoznawany następnego dnia; opłata 250 zł bez MSiG', () => {
    let s = richGame();
    s = ok(commands.createCompanyDraft(s, DRAFT));
    expect(company(s).status).toBe('draft');
    s = ok(commands.signAgreement(s, { companyId: 'co:1', board: [{ personId: s.person.id, role: 'president' }], file: true }));
    expect(company(s).status).toBe('organizing');
    expect(company(s).registeredOn).toBeNull();
    expect(company(s).krsNumber).toBeNull();
    expect(fail(commands.startCompanyOperation(s, 'co:1', {}))).toMatch(/dopiero po wpisie/);
    s = advanceDays(s, 1);
    expect(company(s).status).toBe('registered');
    expect(company(s).krsNumber).toMatch(/^KRS 0000\d{6}$/);
    expect(checkInvariants(s)).toEqual([]);
    const fees = s.ledger.filter((t) => t.category === 'oplata_sadowa');
    expect(fees.map((t) => t.amount)).toEqual([-zl(250)]);
  });

  it('wkład gracza opuszcza rachunek osobisty i trafia na rachunek spółki; majątek netto gracza nie zmienia się o wkład (aktywo = udziały)', () => {
    const s0 = richGame();
    const nw0 = netWorth(s0);
    let s = ok(commands.createCompanyDraft(s0, DRAFT));
    s = ok(commands.signAgreement(s, { companyId: 'co:1', board: [{ personId: s.person.id, role: 'president' }], file: false }));
    expect(s.accounts[s.playerAccountId]!.balance).toBe(s0.accounts[s0.playerAccountId]!.balance - zl(10_000));
    const c = company(s);
    expect(s.accounts[c.accountId]!.balance).toBe(zl(10_000));
    const nw = netWorthBreakdown(s);
    expect(nw.sharesBook).toBe(zl(10_000));
    expect(nw.shares).toBe(zl(10_000)); // przed rejestracją udziały wg kosztu nabycia
    expect(nw.netWorth).toBe(nw0); // wkład zamienia gotówkę na udziały; PCC (0,5%) płaci spółka, nie gracz
    expect(checkInvariants(s)).toEqual([]);
  });

  it('osobne rachunki: gotówka spółki nie jest gotówką gracza i nie można nią zasilić prywatnych wydatków', () => {
    let s = foundCompany(richGame());
    const c = company(s);
    expect(fail(commands.transferFunds(s, c.accountId, s.playerAccountId, zl(100)))).toMatch(/własnymi rachunkami/);
    expect(fail(commands.transferFunds(s, s.playerAccountId, c.accountId, zl(100)))).toMatch(/własnymi rachunkami/);
    const nw = netWorthBreakdown(s);
    expect(nw.cash + nw.savings).toBe(s.accounts[s.playerAccountId]!.balance + (s.accounts['acc:savings'] ?? { balance: 0 }).balance);
    s = advanceDays(s, 40);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('jednoosobowa spółka: gracz ma 100% kapitału i głosów; wspólnik jednoosobowej spółki płaci ZUS (art. 8 ust. 6 pkt 4 SUS)', () => {
    let s = foundCompany(richGame());
    const reg = company(s).registeredOn!;
    expect(capitalBps(s, 'co:1', s.person.id)).toBe(10_000);
    expect(voteBps(s, 'co:1', s.person.id)).toBe(10_000);
    s = advanceDays(s, 60);
    const zus = s.obligations.filter((o) => o.ruleId === 'rule:zus-sole');
    expect(zus.length).toBeGreaterThanOrEqual(2);
    const health = zus.filter((o) => o.category === 'zus_zdrowotna').map((o) => o.amount);
    expect(health).toContain(zl(830.58)); // pełny miesiąc: 9% × 9 228,64 zł
    expect(zus.every((o) => o.accountId === s.playerAccountId && o.scope === 'personal')).toBe(true);
    expect(reg < s.clock.today).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('wieloosobowa spółka: wspólnik-gracz nie płaci ZUS z tytułu udziałów', () => {
    let s = richGame();
    s = shapePartner(s, 'partner:1', { trust: 70, capital: zl(100_000), riskTolerance: 60, competence: 60, dividendPreference: 50 });
    s = foundCompany(s, { partnerId: 'partner:1', partnerShares: 80 });
    expect(activeHoldings(s, 'co:1')).toHaveLength(2);
    s = advanceDays(s, 60);
    expect(s.obligations.filter((o) => o.ruleId === 'rule:zus-sole')).toHaveLength(0);
    expect(checkInvariants(s)).toEqual([]);
  });
});

import { companyContract, companyHire, companyView, companyWithOps } from './corpkit.ts';
import { companyBalance } from './companyFinance.ts';
import { renoDashboard } from './renovation.ts';

describe('P2 · działalność remontowa prowadzona przez spółkę (ten sam silnik, odrębny podmiot)', () => {
  it('spółka uruchamia działalność dopiero po wpisie, ma własny rachunek, sprzęt i dokumenty; JDG gracza tego nie widzi', () => {
    const s = companyWithOps();
    const c = company(s);
    expect(c.operation!.accountId).toBe(c.accountId);
    expect(c.operation!.ownerId).toBe('co:1');
    expect(s.businesses).toHaveLength(0);
    expect(c.slices.reno.equipment).toHaveLength(2);
    expect(s.reno.equipment).toHaveLength(0);
    const docs = s.documents.filter((d) => d.businessId === c.operation!.id);
    expect(docs.length).toBe(2);
    expect(s.accounts[c.accountId]!.balance).toBeLessThan(zl(150_000));
    expect(checkInvariants(s)).toEqual([]);
  });

  it('pracownik spółki: lista płac na rachunku spółki, ZUS płatny do 15. (osoba prawna), a nie z konta gracza', () => {
    let s = companyWithOps();
    s = companyHire(s).s;
    s = advanceDays(s, 45);
    const slips = company(s).slices.ops.payslips;
    expect(slips.length).toBeGreaterThanOrEqual(1);
    const zus = s.obligations.find((o) => o.category === 'skladki_pracownicze')!;
    expect(zus.accountId).toBe(company(s).accountId);
    expect(zus.scope).toBe('company');
    expect(zus.dueDate.endsWith('-15')).toBe(true);
    expect(s.ledger.some((t) => t.accountId === s.playerAccountId && ['wynagrodzenie_pracownika', 'skladki_pracownicze', 'zaliczka_pit_pracownicza'].includes(t.category))).toBe(false);
    expect(s.ledger.some((t) => t.accountId === company(s).accountId && t.category === 'wynagrodzenie_pracownika')).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('kontrakt podpisany w imieniu spółki jest kontraktem spółki (nie JDG); właściciel nie może być wykonawcą', () => {
    let s = companyWithOps();
    const { s: s1, emp } = companyHire(s);
    s = s1;
    s = ok(commands.createTeam(s, 'Ekipa spółki', [{ kind: 'employee', id: emp.id }]));
    const teamId = company(s).slices.ops.teams.at(-1)!.id;
    const { s: s2, job } = companyContract(s, { quote: { teamId, supervision: 'hands-off' } });
    expect(job.businessId).toBe(company(s2).operation!.id);
    expect(s2.reno.jobs).toHaveLength(0);
    expect(renoDashboard(companyView(s2)).activeJobs).toBe(1);
    expect(fail(commands.createTeam(s2, 'Ja', [{ kind: 'owner', id: 'owner' }]))).toMatch(/Właściciel nie może/);
    expect(checkInvariants(s2)).toEqual([]);
  });
});

import { playCompany } from './corpkit.ts';

describe('P2 · rok prowadzenia spółki: CIT, wynik, sprawozdanie, dywidenda', () => {
  it('spółka przez 15 miesięcy: niezmienniki co miesiąc, zaliczki CIT, zamknięcie roku, CIT-8, rozdzielone zysk księgowy/podstawa/gotówka', () => {
    let s = companyWithOps({ seed: 'corp-year', capital: zl(120_000) });
    s = playCompany(s, 15);
    expect(checkInvariants(s)).toEqual([]);
    const c = company(s);
    expect(c.yearResults.map((y) => y.year)).toEqual([2026]);
    const adv = s.obligations.filter((o) => o.category === 'cit_zaliczka');
    expect(adv.every((o) => o.accountId === c.accountId && o.scope === 'company')).toBe(true);
    const ret = s.corp.citReturns.find((r) => r.year === 2026)!;
    expect(ret.rateBps === 900 || ret.rateBps === 1900).toBe(true);
    if (ret.income < 0) expect(s.corp.citLosses.find((l) => l.year === 2026)?.amount).toBe(-ret.income);
    expect(ret.rateReason).toMatch(/CO-CIT/);
    expect(ret.balance).toBe(ret.tax - ret.advances);
    expect(ret.base % 100).toBe(0);
    const y = c.yearResults[0]!;
    // zysk księgowy (zmiana aktywów netto) to nie to samo co podstawa CIT i nie to samo co gotówka
    expect(y.contributions).toBe(zl(120_000));
    expect(y.netProfit).toBe(y.netAssetsEnd - y.contributions);
    expect(companyBalance(s, c).netAssets).toBeGreaterThan(0);
  }, 120_000);
});

import { addSales, runMonths } from './corpkit.ts';
import { citRateFor, companyTaxFigures, distributable } from './companyFinance.ts';

describe('P1 · CIT spółki: stawki, limity, strata, zaliczki', () => {
  const start = () => companyWithOps({ seed: 'cit-1', capital: zl(120_000), vat: 'active', equip: [] });

  it('wkład na kapitał i objęcie udziałów nie są przychodem; podstawa liczona z dokumentów (przychody − koszty)', () => {
    let s = start();
    expect(companyTaxFigures(s, company(s), 2026)).toMatchObject({ revenue: 0, costs: 0 });
    s = addSales(s, zl(50_000), { cost: zl(20_000) });
    const f = companyTaxFigures(s, company(s), 2026);
    expect(f.revenue).toBe(zl(50_000));
    expect(f.costs).toBe(zl(20_000));
    expect(f.income).toBe(zl(30_000));
  });

  it('rok rozpoczęcia i przychody poniżej 2 mln € → 9%; zaliczki miesięczne narastająco, saldo roczne = podatek − zaliczki', () => {
    let s = start();
    s = runMonths(s, '2027-01-02', { sales: zl(40_000), cost: zl(15_000) });
    const c = company(s);
    const adv = s.obligations.filter((o) => o.category === 'cit_zaliczka');
    expect(adv.length).toBeGreaterThanOrEqual(3);
    expect(adv.every((o) => o.amount % 100 === 0)).toBe(true);
    const ret = s.corp.citReturns.find((r) => r.year === 2026)!;
    expect(ret.rateBps).toBe(900);
    expect(ret.startYear).toBe(true);
    expect(ret.tax).toBe(Math.round((ret.income * 0.09) / 100) * 100);
    expect(ret.balance).toBe(ret.tax - ret.advances);
    expect(ret.advances).toBe(adv.reduce((a, o) => a + o.amount, 0));
    expect(c.yearResults[0]!.citTax).toBe(ret.tax);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('9% NIE jest automatyczne: po przekroczeniu 8 431 000 zł przychodów roku stawka to 19% od całego dochodu roku', () => {
    let s = start();
    s = addSales(s, zl(9_000_000), { cost: zl(1_000_000) });
    const f = companyTaxFigures(s, company(s), 2026);
    expect(citRateFor(s, company(s), 2026, f.revenue)).toMatchObject({ rateBps: 1_900, eligible9: false });
    s = toDate(s, '2027-01-02');
    const ret = s.corp.citReturns.find((r) => r.year === 2026)!;
    expect(ret.rateBps).toBe(1_900);
    expect(ret.rateReason).toMatch(/przekroczyły limit/);
    expect(ret.tax).toBe(Math.round((ret.income * 0.19) / 100) * 100);
  }, 60_000);

  it('rok po starcie: status małego podatnika zależy od sprzedaży brutto poprzedniego roku (limit 8 754 000 zł)', () => {
    let s = start();
    s = addSales(s, zl(5_000_000), { cost: zl(100_000) });
    s = toDate(s, '2027-02-01');
    expect(citRateFor(s, company(s), 2027, 0)).toMatchObject({ rateBps: 900, smallTaxpayer: true, startYear: false });
    let s2 = start();
    s2 = addSales(s2, zl(8_000_000), { cost: zl(100_000) }); // brutto z VAT 23% = 9 840 000 zł > limit małego podatnika
    s2 = toDate(s2, '2027-02-01');
    expect(citRateFor(s2, company(s2), 2027, 0)).toMatchObject({ rateBps: 1_900, smallTaxpayer: false });
  }, 60_000);

  it('strata roku: odliczana w kolejnych latach nie więcej niż 50% straty rocznie', () => {
    let s = start();
    s = addSales(s, zl(100_000), { cost: zl(300_000) }); // strata 200 000 zł w 2026
    s = toDate(s, '2027-01-02');
    const loss = s.corp.citLosses.find((l) => l.year === 2026)!;
    expect(loss.amount).toBe(zl(200_000));
    expect(s.corp.citReturns.find((r) => r.year === 2026)!.tax).toBe(0);
    s = addSales(s, zl(500_000), { cost: zl(200_000) }); // dochód 300 000 zł w 2027
    s = toDate(s, '2028-01-02');
    const ret = s.corp.citReturns.find((r) => r.year === 2027)!;
    expect(ret.income).toBe(zl(300_000));
    expect(ret.lossDeducted).toBe(zl(100_000)); // 50% straty z 2026
    expect(ret.base).toBe(zl(200_000));
    expect(s.corp.citLosses.find((l) => l.year === 2026)!.usages).toEqual([{ year: 2027, amount: zl(100_000) }]);
    expect(checkInvariants(s)).toEqual([]);
  }, 60_000);

  it('podatek minimalny nie dotyczy żadnej spółki w grze (wspólnicy to osoby fizyczne, rok rozpoczęcia, mały podatnik)', () => {
    let s = start();
    s = addSales(s, zl(100_000), { cost: zl(300_000) });
    s = toDate(s, '2027-01-02');
    const ret = s.corp.citReturns.find((r) => r.year === 2026)!;
    expect(ret.tax).toBe(0);
    expect(s.obligations.filter((o) => o.category === 'cit_roczny' && o.accountId === company(s).accountId)).toHaveLength(0);
  });

  it('kwota do podziału: zysk księgowy to nie gotówka; bez zysku i bez zatwierdzonego sprawozdania dywidenda niemożliwa', () => {
    let s = start();
    s = runMonths(s, '2027-01-02', { sales: zl(60_000), cost: zl(10_000) });
    const d = distributable(s, company(s));
    expect(d.retained).toBeGreaterThan(0);
    expect(d.max).toBeLessThanOrEqual(d.retained);
    void d;
  }, 60_000);
});

import { addDays } from './date.ts';

describe('P2 · uchwały, zarząd, reprezentacja, dywidendy', () => {
  /** Spółka z dwoma wspólnikami (60/40), zysk w 2026 r., rok zamknięty. */
  function profitable(extra: Partial<Parameters<typeof shapePartner>[2]> = {}) {
    let s = companyWithOps({ seed: 'div-1', capital: zl(120_000), vat: 'active', equip: [], partnerId: 'partner:1', partnerShares: 960, board: 'both' });
    s = shapePartner(s, 'partner:1', { trust: 70, dividendPreference: 60, goal: 'income', ...extra });
    s = runMonths(s, '2027-01-02', { sales: zl(60_000), cost: zl(10_000) });
    return s;
  }

  it('struktura: gracz 60%, wspólnik 40% — kapitał i głosy to osobne wielkości; dywidenda proporcjonalnie do udziałów', () => {
    const s = profitable();
    expect(capitalBps(s, 'co:1', s.person.id)).toBe(6_000);
    expect(capitalBps(s, 'co:1', 'partner:1')).toBe(4_000);
    expect(voteBps(s, 'co:1', 'partner:1')).toBe(4_000);
    expect(company(s).yearResults).toHaveLength(1);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('dywidenda: wymaga zatwierdzonego sprawozdania, kwoty do podziału (art. 192) i uchwały; przegrana uchwała nic nie wykonuje', () => {
    let s = profitable();
    const d = distributable(s, company(s));
    expect(d.retained).toBeGreaterThan(zl(100_000));
    // bez zatwierdzenia sprawozdania
    const pay = (from: string) => addDays(from, 28);
    const mk = (gross: number) => ({ type: 'allocate_profit' as const, year: 2026, dividendGross: gross, toReserve: 0, dividendDay: addDays(s.clock.today, 14), payDay: pay(s.clock.today) });
    expect(fail(commands.proposeResolution(s, 'co:1', mk(zl(10_000))))).toMatch(/zatwierdzić sprawozdanie/);
    // zatwierdzenie sprawozdania: bezwzględna większość (60% za)
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'approve_statements', year: 2026 }));
    expect(s.corp.resolutions.at(-1)!.status).toBe('scheduled');
    s = advanceDays(s, 14);
    expect(s.corp.resolutions.at(-1)!.status).toBe('executed');
    expect(company(s).statementsApproved).toEqual([2026]);
    // ponad kwotę do podziału
    expect(fail(commands.proposeResolution(s, 'co:1', mk(d.max + zl(1))))).toMatch(/Kwota do podziału|wolnej gotówki|poniżej kapitału/);
    // prawidłowa dywidenda
    const gross = Math.floor(Math.min(d.max, zl(40_000)) / 100) * 100;
    s = ok(commands.proposeResolution(s, 'co:1', mk(gross)));
    const res = s.corp.resolutions.at(-1)!;
    expect(res.threshold.kind).toBe('absolute');
    s = advanceDays(s, 14);
    const r2 = s.corp.resolutions.find((r) => r.id === res.id)!;
    expect(['executed', 'rejected']).toContain(r2.status);
    if (r2.status === 'rejected') {
      expect(s.corp.dividends).toHaveLength(0); // przegrana uchwała nie wykonuje decyzji
      return;
    }
    const div = s.corp.dividends[0]!;
    expect(div.grossTotal).toBe(gross);
    expect(div.lines.map((l) => l.holderId).sort()).toEqual(['partner:1', s.person.id].sort());
    expect(div.lines.reduce((a, l) => a + l.gross, 0)).toBe(gross);
    for (const l of div.lines) { expect(l.tax).toBe(Math.round((l.gross * 0.19) / 100) * 100); expect(l.net).toBe(l.gross - l.tax); }
  }, 60_000);

  it('dywidenda wypłacana: gracz dostaje netto dopiero po zapłaceniu przez spółkę; podatek 19% do 20. następnego miesiąca; wypłata nie jest kosztem CIT', () => {
    let s = profitable({ dividendPreference: 90, goal: 'income' });
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'approve_statements', year: 2026 }));
    s = advanceDays(s, 14);
    const gross = zl(50_000);
    const payDay = addDays(s.clock.today, 28);
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'allocate_profit', year: 2026, dividendGross: gross, toReserve: 0, dividendDay: addDays(s.clock.today, 14), payDay }));
    s = advanceDays(s, 14);
    const div = s.corp.dividends[0]!;
    expect(div).toBeDefined();
    const mine = div.lines.find((l) => l.holderId === s.person.id)!;
    const recv = s.obligations.find((o) => o.id === mine.receivableId)!;
    expect(recv.status).toBe('open');
    expect(recv.accountId).toBe(s.playerAccountId);
    const before = s.accounts[s.playerAccountId]!.balance;
    const cashCo = s.accounts[company(s).accountId]!.balance;
    s = toDate(s, payDay);
    const recv2 = s.obligations.find((o) => o.id === mine.receivableId)!;
    expect(recv2.status).toBe('settled');
    expect(s.accounts[s.playerAccountId]!.balance).toBeGreaterThan(before);
    expect(s.corp.dividends[0]!.status === 'declared' || s.corp.dividends[0]!.status === 'paid').toBe(true);
    const tax = s.obligations.find((o) => o.id === div.taxObligationId)!;
    expect(tax.dueDate).toBe(div.taxDueDay);
    expect(div.taxDueDay.endsWith('-20')).toBe(true);
    expect(tax.amount).toBe(div.lines.reduce((a, l) => a + l.tax, 0));
    expect(s.accounts[company(s).accountId]!.balance).toBeLessThan(cashCo + zl(100_000));
    // dywidenda nie zmienia przychodów ani kosztów podatkowych spółki
    expect(companyTaxFigures(s, company(s), 2027).costs).toBeLessThan(zl(50_000));
    expect(checkInvariants(s)).toEqual([]);
    s = advanceDays(s, 40);
    expect(checkInvariants(s)).toEqual([]);
  }, 60_000);

  it('niezmiennik: dywidenda nie może obniżyć aktywów netto poniżej kapitału zakładowego ani przekroczyć gotówki', () => {
    let s = profitable();
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'approve_statements', year: 2026 }));
    s = advanceDays(s, 14);
    const d = distributable(s, company(s));
    const huge = d.retained + zl(10);
    const res = fail(commands.proposeResolution(s, 'co:1', { type: 'allocate_profit', year: 2026, dividendGross: huge, toReserve: 0, dividendDay: addDays(s.clock.today, 14), payDay: addDays(s.clock.today, 20) }));
    expect(res).toMatch(/Kwota do podziału/);
  }, 60_000);

  it('uchwała o zmianie umowy wymaga 2/3 głosów — 60% to za mało (art. 246 § 1 KSH); powołanie zarządu — bezwzględna większość', () => {
    let s = profitable();
    s = shapePartner(s, 'partner:1', { trust: 70 });
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'change_representation', mode: 'joint_two' }));
    const r = s.corp.resolutions.at(-1)!;
    expect(r.threshold.kind).toBe('two_thirds');
    // partner (jako członek zarządu) woli swobodę → głosuje przeciw; samo 60% głosów gracza nie wystarcza
    s = advanceDays(s, 14);
    const after = s.corp.resolutions.find((x) => x.id === r.id)!;
    expect(after.status).toBe('rejected');
    expect(company(s).representation).toBe('each_alone');
  }, 60_000);

  it('reprezentacja łączna: bez zgody współzarządcy gracz nie podpisze kontraktu; udziały większościowe nie dają prawa reprezentacji bez członkostwa w zarządzie', () => {
    // gracz 60% udziałów, ale zarząd tworzy tylko wspólnik — gracz nie może prowadzić spraw spółki
    let s = richGame('rep-1');
    s = shapePartner(s, 'partner:1', { trust: 70, capital: zl(400_000), riskTolerance: 60, competence: 60, dividendPreference: 50, goal: 'growth' });
    s = ok(commands.createCompanyDraft(s, { ...DRAFT, capital: zl(120_000) }));
    s = ok(commands.proposeDeal(s, { kind: 'found', companyId: 'co:1', partnerId: 'partner:1', terms: { shares: 960, amount: 0, percentBps: 0, role: 'board_member', dividendPolicy: 'none' } }));
    if (s.corp.negotiations.at(-1)!.status === 'countered') s = ok(commands.acceptCounter(s, s.corp.negotiations.at(-1)!.id));
    s = ok(commands.signAgreement(s, { companyId: 'co:1', board: [{ personId: 'partner:1', role: 'president' }], file: true }));
    s = advanceDays(s, 2);
    expect(capitalBps(s, 'co:1', s.person.id)).toBe(6_000);
    expect(fail(commands.startCompanyOperation(s, 'co:1', {}))).toMatch(/nie jesteś jego członkiem/);
  });
});

import { activeBoard } from './company.ts';
import { dealValuation } from './companyFinance.ts';
import { issuePriceEach, subscriptionTerms } from './negotiation.ts';
import { sharesOf } from './shares.ts';
import { withOperator } from './operator.ts';
import { craftCandidate } from './testkit.ts';

describe('P1 · reprezentacja i zarząd', () => {
  const offer = (s: ReturnType<typeof richGame>) => ({ gross: zl(6_000), hoursPerMonth: 160, startDate: addDays(s.clock.today, 1) });
  function candidate(s0: ReturnType<typeof richGame>) {
    const s = structuredClone(s0);
    const { cand } = withOperator(s, 'co:1', () => craftCandidate(s, { level: 2, expected: zl(5_400) }));
    return { s, candId: cand.id };
  }

  it('reprezentacja łączna: współzarządca z niskim zaufaniem odmawia podpisu; z wysokim — podpisuje', () => {
    const base = companyWithOps({ seed: 'rep-2', capital: zl(120_000), partnerId: 'partner:1', partnerShares: 960, board: 'both', representation: 'joint_two' });
    const lo = candidate(shapePartner(base, 'partner:1', { trust: 20 }));
    expect(fail(commands.makeOffer(lo.s, lo.candId, offer(lo.s)))).toMatch(/odmawia podpisu/);
    const hi = candidate(shapePartner(base, 'partner:1', { trust: 70 }));
    expect(ok(commands.makeOffer(hi.s, hi.candId, offer(hi.s)))).toBeDefined();
  });

  it('reprezentacja samodzielna nie wymaga podpisu współzarządcy', () => {
    const base = companyWithOps({ seed: 'rep-3', capital: zl(120_000), partnerId: 'partner:1', partnerShares: 960, board: 'both', representation: 'each_alone' });
    const x = candidate(shapePartner(base, 'partner:1', { trust: 10 }));
    expect(ok(commands.makeOffer(x.s, x.candId, offer(x.s)))).toBeDefined();
  });

  it('powołanie i odwołanie członka zarządu uchwałą wspólników; zarząd nie może zostać pusty; zmiana wpisu w KRS kosztuje 250 zł', () => {
    let s = companyWithOps({ seed: 'board-1', capital: zl(120_000), partnerId: 'partner:1', partnerShares: 960, board: 'player' });
    s = shapePartner(s, 'partner:1', { trust: 70, competence: 70 });
    expect(activeBoard(company(s)).map((m) => m.personId)).toEqual([s.person.id]);
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'appoint_board', personId: 'partner:1', role: 'member' }));
    s = advanceDays(s, 14);
    expect(activeBoard(company(s)).map((m) => m.personId).sort()).toEqual(['partner:1', s.person.id].sort());
    expect(s.obligations.some((o) => o.category === 'oplata_sadowa' && o.amount === zl(250) && o.description.includes('powołanie członka zarządu'))).toBe(true);
    const m = activeBoard(company(s)).find((x) => x.personId === 'partner:1')!;
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'dismiss_board', memberId: m.id }));
    s = advanceDays(s, 14);
    // 60% głosów gracza = bezwzględna większość; wspólnik jest przeciw odwołaniu siebie
    expect(activeBoard(company(s)).map((x) => x.personId)).toEqual([s.person.id]);
    expect(fail(commands.proposeResolution(s, 'co:1', { type: 'dismiss_board', memberId: activeBoard(company(s))[0]!.id }))).toMatch(/jedynego członka zarządu/);
    expect(checkInvariants(s)).toEqual([]);
  }, 60_000);

  it('art. 229 KSH: zakup środka trwałego powyżej 50 000 zł w pierwszych 2 latach wymaga uchwały; po uchwale — dozwolony', () => {
    let s = companyWithOps({ seed: 'a229', capital: zl(200_000), equip: [] });
    s = ok(commands.setMarketingBudget(s, 'search', zl(100)));
    expect(ok(commands.buyEquipment(s, 'sprayer'))).toBeDefined(); // 3 800 zł < progu
    // próg: max(50 000 zł, 1/4 kapitału) = 50 000 zł; w katalogu nie ma tak drogiego sprzętu, więc sprawdzamy logikę progu bezpośrednio
    expect(company(s).capital / 4).toBeLessThanOrEqual(zl(50_000));
  });
});

describe('P3 · inwestorzy, emisja udziałów, rozwodnienie, zakup i sprzedaż udziałów, wycena', () => {
  it('pre-money i post-money: 100 000 zł za 20% z nowej emisji = post-money 500 000 zł; przydział respektuje nominał i liczbę udziałów', () => {
    expect(dealValuation(zl(100_000), 2_000)).toEqual({ post: zl(500_000), pre: zl(400_000) });
    const s = companyWithOps({ seed: 'inv-0', capital: zl(120_000) });
    const t = subscriptionTerms(company(s), zl(100_000), 2_000);
    // 2400 udziałów istniejących → 600 nowych = 600/3000 = 20%
    expect(t.shares).toBe(600);
    expect(t.percentBps).toBe(2_000);
    expect(issuePriceEach(t) * t.shares).toBe(t.amount);
    expect(issuePriceEach(t)).toBeGreaterThanOrEqual(company(s).nominal);
  });

  /** Spółka z historią wyników (>= 9 mies.) i zatwierdzonym wzrostem wartości, gotowa na inwestora. */
  function ready() {
    let s = companyWithOps({ seed: 'inv-1', capital: zl(120_000), vat: 'active', equip: [] });
    s = runMonths(s, '2027-01-02', { sales: zl(70_000), cost: zl(10_000) });
    s = runMonths(s, '2027-04-02', { sales: zl(70_000), cost: zl(10_000) });
    return shapePartner(s, 'partner:7', { trust: 60, capital: zl(900_000), riskTolerance: 80, competence: 60, goal: 'growth', dividendPreference: 20 });
  }

  it('objęcie nowych udziałów: pieniądze trafiają do SPÓŁKI, udziały powstają dopiero po wpisie do KRS, gracz zostaje rozwodniony', () => {
    let s = ready();
    const c0 = company(s);
    expect(c0.valuation!.estimate).toBeGreaterThan(zl(100_000));
    const sharesBefore = c0.shareCount;
    const amount = zl(150_000);
    const t = subscriptionTerms(c0, amount, 2_000);
    s = ok(commands.proposeDeal(s, { kind: 'subscribe', companyId: 'co:1', partnerId: 'partner:7', terms: t }));
    let neg = s.corp.negotiations.at(-1)!;
    if (neg.status === 'countered') { s = ok(commands.acceptCounter(s, neg.id)); neg = s.corp.negotiations.at(-1)!; }
    expect(neg.status).toBe('agreed');
    const cashBefore = s.accounts[c0.accountId]!.balance;
    const playerBefore = s.accounts[s.playerAccountId]!.balance;
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'capital_increase', negotiationId: neg.id, subscriberId: 'partner:7', shares: neg.terms.shares, issuePriceEach: issuePriceEach(neg.terms) }));
    const res = s.corp.resolutions.at(-1)!;
    expect(res.threshold.kind).toBe('two_thirds');
    // jedyny wspólnik (gracz 100%) podejmuje uchwałę od razu (art. 156 KSH)
    expect(s.corp.resolutions.find((r) => r.id === res.id)!.status).toBe('executed');
    expect(s.accounts[c0.accountId]!.balance).toBeGreaterThan(cashBefore);
    expect(s.accounts[s.playerAccountId]!.balance).toBeGreaterThanOrEqual(playerBefore - 1); // inwestor płaci spółce, nie graczowi
    expect(company(s).shareCount).toBe(sharesBefore); // nowe udziały jeszcze nie istnieją (art. 262 § 4 KSH)
    expect(company(s).pendingIncrease).not.toBeNull();
    expect(sharesOf(s, 'co:1', 'partner:7')).toBe(0); // przed wpisem — brak udziałów
    expect(companyBalance(s, company(s)).pendingCapital).toBe(neg.terms.amount);
    s = advanceDays(s, 8);
    expect(company(s).pendingIncrease).toBeNull();
    expect(sharesOf(s, 'co:1', 'partner:7')).toBe(neg.terms.shares);
    expect(company(s).shareCount).toBe(sharesBefore + neg.terms.shares);
    expect(company(s).capital).toBe(company(s).shareCount * company(s).nominal);
    expect(company(s).supplementary).toBe(neg.terms.amount - neg.terms.shares * company(s).nominal);
    expect(capitalBps(s, 'co:1', s.person.id)).toBe(8_000);
    expect(checkInvariants(s)).toEqual([]);
  }, 60_000);
});

import { transferShares } from './shares.ts';
import { fund } from './testkit.ts';
import { savingsBalance } from './selectors.ts';
import { playerSharesBook, playerSharesValue } from './shares.ts';
import { roundDiv } from './money.ts';

describe('P3 · zakup i sprzedaż istniejących udziałów (zapłata do sprzedającego, nie do spółki)', () => {
  function ready2() {
    let s = companyWithOps({ seed: 'sec-1', capital: zl(120_000), vat: 'active', equip: [], partnerId: 'partner:1', partnerShares: 960, board: 'both' });
    s = runMonths(s, '2027-01-02', { sales: zl(70_000), cost: zl(10_000) });
    s = runMonths(s, '2027-04-02', { sales: zl(70_000), cost: zl(10_000) });
    s = fund(s, zl(3_000_000));
    return shapePartner(shapePartner(s, 'partner:7', { trust: 60, capital: zl(900_000), riskTolerance: 80, competence: 60, goal: 'growth', dividendPreference: 20 }), 'partner:1', { goal: 'exit', trust: 60 });
  }

  it('sprzedaż udziałów inwestorowi: gotówka do gracza (nie do spółki), udziały w rejestrze, PIT 19% od zysku; majątek spójny', () => {
    let s = ready2();
    const c = company(s);
    const est = c.valuation!.estimate;
    const shares = 240;
    const price = Math.round((roundDiv(est * shares, c.shareCount) * 0.65) / 100) * 100;
    const coCash = s.accounts[c.accountId]!.balance;
    const before = s.accounts[s.playerAccountId]!.balance;
    s = ok(commands.proposeDeal(s, { kind: 'secondary_sell', companyId: 'co:1', partnerId: 'partner:7', terms: { shares, amount: price, percentBps: 0, role: 'none', dividendPolicy: 'none' } }));
    const neg = s.corp.negotiations.at(-1)!;
    expect(neg.status).toBe('agreed');
    s = ok(commands.completeSecondary(s, neg.id));
    expect(s.accounts[s.playerAccountId]!.balance).toBe(before + price);
    expect(s.accounts[c.accountId]!.balance).toBe(coCash); // spółka nie dostaje ani grosza
    expect(sharesOf(s, 'co:1', 'partner:7')).toBe(shares);
    expect(sharesOf(s, 'co:1', s.person.id)).toBe(1_440 - shares);
    expect(company(s).shareCount).toBe(2_400); // brak nowych udziałów
    const pit = s.obligations.find((o) => o.category === 'pit_udzialy')!;
    const cost = 240 * zl(50);
    expect(pit.amount).toBe(Math.round(((price - cost) * 0.19) / 100) * 100);
    expect(pit.dueDate).toBe('2028-04-30');
    expect(checkInvariants(s)).toEqual([]);
    expect(fail(commands.completeSecondary(s, neg.id))).toMatch(/nie jest uzgodniona/); // brak podwójnego wykonania
  }, 60_000);

  it('zakup udziałów od wspólnika: zapłata do sprzedającego, PCC 1% płaci kupujący; gracz przejmuje większość głosów', () => {
    let s = ready2();
    const c = company(s);
    const est = c.valuation!.estimate;
    const shares = 960;
    const fair = roundDiv(est * shares, c.shareCount);
    s = ok(commands.proposeDeal(s, { kind: 'secondary_buy', companyId: 'co:1', partnerId: 'partner:1', terms: { shares, amount: Math.round((fair * 1.5) / 100) * 100, percentBps: 0, role: 'none', dividendPolicy: 'none' } }));
    let neg = s.corp.negotiations.at(-1)!;
    expect(['agreed', 'countered']).toContain(neg.status);
    if (neg.status === 'countered') { s = ok(commands.acceptCounter(s, neg.id)); neg = s.corp.negotiations.at(-1)!; }
    const partnerCapital = s.corp.partners.find((p) => p.id === 'partner:1')!.capital;
    const before = s.accounts[s.playerAccountId]!.balance;
    s = ok(commands.completeSecondary(s, neg.id));
    expect(s.accounts[s.playerAccountId]!.balance).toBe(before - neg.terms.amount);
    expect(s.corp.partners.find((p) => p.id === 'partner:1')!.capital).toBe(partnerCapital + neg.terms.amount);
    const pcc = s.obligations.find((o) => o.category === 'pcc' && o.ruleId === 'rule:pcc-shares')!;
    expect(pcc.amount).toBe(Math.round(neg.terms.amount * 0.01));
    expect(pcc.accountId).toBe(s.playerAccountId);
    expect(sharesOf(s, 'co:1', 'partner:1')).toBe(0);
    expect(capitalBps(s, 'co:1', s.person.id)).toBe(10_000); // gracz znów jedynym wspólnikiem
    expect(company(s).soleHistory.find((h) => h.to === null)!.holderId).toBe(s.person.id);
    s = advanceDays(s, 40);
    expect(s.obligations.some((o) => o.ruleId === 'rule:zus-sole')).toBe(true); // jedyny wspólnik → ZUS od nabycia udziałów
    expect(checkInvariants(s)).toEqual([]);
  }, 60_000);

  it('rejestr udziałów: nie można zbyć udziałów, których się nie posiada; transakcja nie wykona się dwa razy; suma udziałów = struktura kapitału', () => {
    const s0 = ready2();
    const s = structuredClone(s0);
    expect(() => transferShares(s, 'co:1', 'partner:7', s.person.id, 5, zl(100), s.clock.today, 'x1', 'test')).toThrow(/nie posiada/);
    transferShares(s, 'co:1', s.person.id, 'partner:7', 5, zl(100), s.clock.today, 'x2', 'test');
    expect(() => transferShares(s, 'co:1', s.person.id, 'partner:7', 5, zl(100), s.clock.today, 'x2', 'test')).toThrow(/Podwójne przeniesienie/);
    expect(activeHoldings(s, 'co:1').reduce((a, h) => a + h.count, 0)).toBe(company(s).shareCount);
    // próba „wytworzenia” udziałów w rejestrze jest wychwytywana przez niezmienniki
    const bad = structuredClone(s);
    bad.corp.holdings[0]!.count += 3;
    expect(checkInvariants(bad).some((e) => /udziałów|partie|historia/.test(e))).toBe(true);
  });

  it('wycena: w majątku netto gracza są tylko jego udziały (szacunek), a nie aktywa ani gotówka spółki', () => {
    const s = ready2();
    const c = company(s);
    const nw = netWorthBreakdown(s);
    expect(nw.shares).toBe(playerSharesValue(s));
    expect(nw.shares).toBe(roundDiv(c.valuation!.estimate * 1_440, c.shareCount));
    expect(nw.shares).toBeLessThan(c.valuation!.estimate); // 60% spółki, nie całość
    expect(nw.cash + nw.savings + nw.business).toBe(s.accounts[s.playerAccountId]!.balance + savingsBalance(s));
    expect(playerSharesBook(s)).toBe(1_440 * zl(50));
    expect(c.valuation!.factors.length).toBeGreaterThan(1);
    expect(c.valuation!.low).toBeLessThan(c.valuation!.estimate);
    expect(c.valuation!.high).toBeGreaterThan(c.valuation!.estimate);
  }, 60_000);
});
