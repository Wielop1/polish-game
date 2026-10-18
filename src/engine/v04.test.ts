import { describe, expect, it } from 'vitest';
import { etatYear, lossRemaining } from './annual.ts';
import { activeBusiness, allowedResumeDates, businessState, formForYear, issueDocument, malyZusStatus } from './business.ts';
import type { RegisterInput } from './business.ts';
import { commands } from './commands.ts';
import type { CommandResult } from './commands.ts';
import { recordHistory } from './core.ts';
import { diffDays, addDays } from './date.ts';
import { checkInvariants } from './invariants.ts';
import { mulBps, roundDiv, zl } from './money.ts';
import { createNewGame } from './newGame.ts';
import { computePayroll, typicalMonthlyNet, youthReliefEnds } from './payroll.ts';
import { DEFAULT_ASSUMPTIONS, runPlanning, standardScenarios } from './planning.ts';
import { yearReport } from './report.ts';
import { businessSummaries, netWorth } from './selectors.ts';
import { advanceDays, advanceToNextMonth } from './simulate.ts';
import type { GameState } from './state.ts';
import { roundZl, scaleTax, socialContributions } from './tax.ts';

const game = (seed = 'v04', birth = '1990-05-05', events = false) => {
  const s = createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed, lifeEvents: events });
  s.person.birthDate = birth; // dorosły (bez ulgi dla młodych), chyba że test mówi inaczej
  return s;
};
const ok = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(`komenda odrzucona: ${r.error}`);
  return r.state;
};
const consistent = (s: GameState) => expect(checkInvariants(s)).toEqual([]);
const REG: RegisterInput = { name: 'Jan Kowalski Usługi', profileId: 'it-programowanie', taxForm: 'skala', vatStatus: 'exempt', startDate: '2026-02-01', zusStart: 'standard', sickness: false };

function fund(state: GameState, amount: number): GameState {
  const s = structuredClone(state);
  const n = (s.counters.testfund ?? 0) + 1;
  s.counters.testfund = n;
  s.accounts[s.playerAccountId]!.balance += amount;
  s.openingCash += amount;
  s.ledger.push({ id: `tx:test-fund:${n}`, date: s.clock.today, accountId: s.playerAccountId, amount, category: 'kapital_poczatkowy', description: 'test', counterpartyId: null, obligationId: null, transferId: null, eventId: `test-fund:${n}` });
  s.processed[`tx:test-fund:${n}`] = true;
  recordHistory(s, s.clock.today);
  return s;
}
function withDoc(state: GameState, kind: 'sales' | 'cost', net: number, termDays = 14): GameState {
  const s = structuredClone(state);
  const b = activeBusiness(s)!;
  s.parties['party:test'] ??= { id: 'party:test', name: 'Kontrahent testowy', role: 'service' };
  issueDocument(s, b, { kind, issueDate: s.clock.today, counterpartyId: 'party:test', orderId: null, description: 'Test', net, termDays });
  recordHistory(s, s.clock.today);
  return s;
}
/** JDG z zasilonym rachunkiem firmowym, po starcie (1 lutego 2026). */
function started(o: Partial<RegisterInput> = {}, opts: { birth?: string; employmentGross?: number | null; fundZl?: number } = {}): GameState {
  let s = fund(game('v04', opts.birth ?? '1990-05-05'), zl(200_000));
  s = ok(commands.registerBusiness(s, { ...REG, ...o }));
  s = advanceDays(s, diffDays('2026-02-01', s.clock.today));
  if (opts.employmentGross !== undefined) {
    const emp = s.contracts.find((c) => c.type === 'employment')!;
    if (emp.type === 'employment') emp.grossMonthly = opts.employmentGross;
  }
  return ok(commands.transferFunds(s, s.playerAccountId, activeBusiness(s)!.accountId, zl(opts.fundZl ?? 100_000)));
}
const toDate = (s: GameState, date: string) => advanceDays(s, diffDays(date, s.clock.today));
const period = (s: GameState, month: string) => s.taxPeriods.find((p) => p.month === month)!;
const returns = (s: GameState, year: number) => s.taxReturns.filter((r) => r.year === year);

describe('1. kalkulator wynagrodzenia z etatu (brutto → netto 2026)', () => {
  const base = { accrualDate: '2026-03-31', payDate: '2026-04-10', birthDate: '1990-01-01', ytdPensionBase: 0, ytdPitBase: 0, ytdExempt: 0, pit2: true };

  it('płaca minimalna 4 806 zł: składki 658,91 zł, składka zdrowotna 373,24 zł (przykład zus.pl), zaliczka 168 zł, netto 3 605,85 zł', () => {
    const c = computePayroll({ ...base, gross: zl(4_806) });
    expect(c).toMatchObject({ emerytalna: zl(469.07), rentowa: zl(72.09), chorobowa: zl(117.75), socialTotal: zl(658.91), health: zl(373.24), koszty: zl(250), pitBase: zl(3_897), pitAdvance: zl(168), net: zl(3_605.85) });
    expect(c.gross - c.socialTotal).toBe(zl(4_147.09)); // podstawa zdrowotnej z przykładu ZUS
  });

  it('6 300 zł dla osoby dorosłej: zaliczka 322 zł (12% − 300 zł z PIT-2); dla 22-latka PIT = 0 (ulga dla młodych)', () => {
    const adult = computePayroll({ ...base, gross: zl(6_300) });
    expect(adult).toMatchObject({ socialTotal: zl(863.73), health: zl(489.26), pitBase: zl(5_186), pitAdvance: zl(322), net: zl(4_625.01) });
    const young = computePayroll({ ...base, gross: zl(6_300), birthDate: '2003-06-15' });
    expect(young).toMatchObject({ exemptGross: zl(6_300), pitBase: 0, pitAdvance: 0, net: zl(4_947.01) });
    expect(typicalMonthlyNet(zl(6_300), '2003-06-15', '2026-01-01')).toBe(zl(4_947.01));
  });

  it('bez PIT-2 nie ma pomniejszenia o 300 zł', () => {
    expect(computePayroll({ ...base, gross: zl(6_300), pit2: false }).pitAdvance).toBe(zl(622)); // 12% × 5 186 = 622,32 → 622
  });

  it('limit 30-krotności: po przekroczeniu 282 600 zł składki emerytalna i rentowa nie rosną, chorobowa i zdrowotna tak', () => {
    const c = computePayroll({ ...base, gross: zl(10_000), ytdPensionBase: zl(280_000) });
    expect(c.pensionBase).toBe(zl(2_600));
    expect(c).toMatchObject({ emerytalna: mulBps(zl(2_600), 976), rentowa: mulBps(zl(2_600), 150), chorobowa: zl(245) });
    const over = computePayroll({ ...base, gross: zl(10_000), ytdPensionBase: zl(282_600) });
    expect(over).toMatchObject({ pensionBase: 0, emerytalna: 0, rentowa: 0, chorobowa: zl(245) });
    expect(over.health).toBe(mulBps(zl(10_000) - zl(245), 900)); // zdrowotna bez limitu
  });

  it('próg 120 000 zł (narastająco): ponad próg 32%, bez pomniejszenia o 300 zł; przekroczenie w miesiącu dzieli podstawę', () => {
    const above = computePayroll({ ...base, gross: zl(10_000), ytdPitBase: zl(120_000) });
    expect(above.pitBase).toBe(zl(8_379));
    expect(above.pitAdvance).toBe(roundZl(mulBps(zl(8_379), 3_200))); // 2 681 zł
    const crossing = computePayroll({ ...base, gross: zl(10_000), ytdPitBase: zl(118_000) });
    expect(crossing.pitAdvance).toBe(roundZl(mulBps(zl(2_000), 1_200) + mulBps(zl(6_379), 3_200)));
    expect(crossing.reductionApplied).toBe(0);
  });

  it('ulga dla młodych: limit 85 528 zł w roku, nadwyżka podlega skali; wygasa po 26. urodzinach (włącznie)', () => {
    const partial = computePayroll({ ...base, gross: zl(6_300), birthDate: '2003-06-15', ytdExempt: zl(85_000) });
    expect(partial.exemptGross).toBe(zl(528));
    expect(partial.pitAdvance).toBeGreaterThan(0);
    expect(partial.taxableSocial).toBe(roundDiv(partial.socialTotal * (zl(6_300) - zl(528)), zl(6_300))); // składki od zwolnionej części nie są odliczane
    const bday = youthReliefEnds('2003-06-15');
    expect(bday).toBe('2029-06-15');
    expect(computePayroll({ ...base, gross: zl(6_300), birthDate: '2003-06-15', payDate: bday }).exemptGross).toBe(zl(6_300));
    expect(computePayroll({ ...base, gross: zl(6_300), birthDate: '2003-06-15', payDate: addDays(bday, 1) }).exemptGross).toBe(0);
  });

  it('w grze: odcinek płacowy = zobowiązanie wynagrodzenia, przychód PIT w roku WYPŁATY (grudzień wypłacany w styczniu)', () => {
    const s = toDate(game('pay-1'), '2027-02-01');
    const first = s.payslips[0]!;
    expect(first).toMatchObject({ month: '2026-01', accrualDate: '2026-01-31', payDate: '2026-02-10', legacy: false, net: zl(4_625.01) });
    expect(s.obligations.find((o) => o.id === `obl:${first.id.slice(8)}`)!.amount).toBe(first.net);
    const dec = s.payslips.find((p) => p.month === '2026-12')!;
    expect(dec.payDate).toBe('2027-01-10');
    expect(etatYear(s, 2026).payslips).toBe(11); // styczeń–listopad wypłacone w 2026 r.
    expect(etatYear(s, 2027).payslips).toBe(2); // grudzień 2026 i styczeń 2027
    consistent(s);
  });
});

describe('2. zaokrąglenia', () => {
  it('podstawa i podatek do pełnych złotych (50 gr w górę); składki do grosza', () => {
    expect(roundZl(zl(100.49))).toBe(zl(100));
    expect(roundZl(zl(100.5))).toBe(zl(101));
    expect(roundZl(zl(0.49))).toBe(0);
    expect(scaleTax(zl(57_049), true)).toBe(zl(3_246)); // 6 845,88 − 3 600 = 3 245,88 → 3 246
    expect(scaleTax(zl(120_000), true)).toBe(zl(10_800));
    expect(scaleTax(zl(200_000), true)).toBe(zl(36_400));
    expect(socialContributions(zl(5_652), { sickness: false, fpFs: true }).emerytalna % 1).toBe(0); // grosze
  });
});

describe('3. roczny PIT: etat samodzielnie', () => {
  it('dorosły pracownik: nadpłata wynikająca z kwoty zmniejszającej 3 600 zł (a zaliczki 11 × 300 zł) — zwrot 14 czerwca, nie wcześniej', () => {
    let s = toDate(game('annual-1'), '2027-01-02');
    const r = returns(s, 2026);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ form: 'PIT-37', base: zl(57_049), tax: zl(3_246), advances: 11 * zl(322), balance: zl(3_246) - 11 * zl(322) });
    expect(r[0]!.balance).toBe(-zl(296));
    const refund = s.obligations.find((o) => o.id === r[0]!.obligationId)!;
    expect(refund).toMatchObject({ direction: 'receivable', amount: zl(296), dueDate: '2027-06-14', scope: 'personal', category: 'pit_zwrot' });
    const cashBefore = s.accounts[s.playerAccountId]!.balance;
    s = toDate(s, '2027-06-13');
    expect(s.obligations.find((o) => o.id === refund.id)!.status).toBe('open'); // zwrot dopiero po 45 dniach
    s = toDate(s, '2027-06-15');
    expect(s.obligations.find((o) => o.id === refund.id)!.status).toBe('settled');
    expect(s.accounts[s.playerAccountId]!.balance).toBeGreaterThan(cashBefore);
    consistent(s);
  });

  it('22-latek z ulgą dla młodych: roczny PIT = 0, brak zobowiązania', () => {
    const young = createNewGame({ firstName: 'Ala', lastName: 'Nowak', seed: 'young', lifeEvents: false });
    const s = toDate(young, '2027-01-02');
    expect(returns(s, 2026)[0]).toMatchObject({ form: 'PIT-37', base: 0, tax: 0, advances: 0, balance: 0, obligationId: null });
    expect(s.payslips.every((p) => p.pitAdvance === 0 && p.exemptGross === p.gross)).toBe(true);
    expect(s.payslips[0]!.net).toBe(zl(4_947.01));
  });

  it('nie ma podwójnego rozliczenia: powtórne przetworzenie 31 grudnia nic nie dodaje', () => {
    const s = toDate(game('annual-2'), '2027-01-02');
    const again = structuredClone(s);
    again.processed = Object.fromEntries(Object.entries(again.processed).filter(([k]) => k !== 'annual:2026')) as typeof again.processed;
    expect(returns(again, 2026)).toHaveLength(1);
    expect(s.obligations.filter((o) => o.category === 'pit_zwrot')).toHaveLength(1);
  });
});

describe('4. roczny PIT: etat + JDG', () => {
  const run = (form: RegisterInput['taxForm'], birth = '1990-05-05') => {
    let s = started({ taxForm: form, vatStatus: 'exempt' }, { birth });
    s = toDate(s, '2026-06-15');
    s = withDoc(s, 'sales', zl(30_000));
    s = withDoc(s, 'cost', zl(5_000));
    return toDate(s, '2027-01-03');
  };

  it('skala: dochody z etatu i JDG łączone w jednym zeznaniu (PIT-36), kwota zmniejszająca raz; podatek wyższy niż suma „osobna”', () => {
    const s = run('skala');
    const r = returns(s, 2026);
    expect(r.map((x) => x.form)).toEqual(['PIT-36']);
    const etat = etatYear(s, 2026);
    expect(etat.income).toBe(11 * (zl(6_300) - zl(863.73) - zl(250)));
    // dochód JDG 25 000 zł (30 000 − 5 000; składki społeczne pokrywa etat); wspólna podstawa 57 048,97 + 25 000
    expect(r[0]).toMatchObject({ base: roundZl(etat.income + zl(25_000)), tax: scaleTax(roundZl(etat.income + zl(25_000)), true) });
    expect(r[0]!.tax).toBe(zl(6_246));
    const separate = scaleTax(roundZl(etat.income), true) + scaleTax(zl(25_000), true); // 3 246 + 0 — tak byłoby bez łączenia
    expect(r[0]!.tax).toBeGreaterThan(separate);
    const jdgAdvances = s.taxPeriods.filter((p) => p.month.startsWith('2026-')).reduce((a, p) => a + p.advance, 0);
    expect(r[0]!.advances).toBe(11 * zl(322) + jdgAdvances);
    expect(r[0]!.balance).toBe(r[0]!.tax - r[0]!.advances);
    consistent(s);
  });

  it('liniowy i ryczałt NIE łączą się ze skalą: etat w PIT-37 osobno, JDG w PIT-36L / PIT-28 (z rachunku firmowego)', () => {
    const lin = run('liniowy');
    expect(returns(lin, 2026).map((x) => x.form).sort()).toEqual(['PIT-36L', 'PIT-37']);
    const pit37 = returns(lin, 2026).find((x) => x.form === 'PIT-37')!;
    expect(pit37.tax).toBe(zl(3_246)); // etat wyłącznie ze skalą
    expect(returns(lin, 2026).find((x) => x.form === 'PIT-36L')!.tax).toBeGreaterThan(0);
    const ryc = run('ryczalt');
    expect(returns(ryc, 2026).map((x) => x.form).sort()).toEqual(['PIT-28', 'PIT-37']);
    const biz = activeBusiness(ryc)!;
    const ob = ryc.obligations.find((o) => o.id === returns(ryc, 2026).find((x) => x.form === 'PIT-28')!.obligationId);
    if (ob) expect(ob.accountId).toBe(biz.accountId);
    consistent(lin);
    consistent(ryc);
  });

  it('22-latek: etat zwolniony, więc kwota zmniejszająca 3 600 zł przypada na JDG (zaliczki JDG wracają jako nadpłata)', () => {
    const s = run('skala', '2003-06-15');
    const r = returns(s, 2026)[0]!;
    expect(r.form).toBe('PIT-36');
    expect(r.tax).toBe(scaleTax(zl(25_000), true)); // 3 000 − 3 600 → 0
    expect(r.tax).toBe(0);
    expect(r.advances).toBeGreaterThan(0); // JDG wpłacała zaliczki bez pomniejszenia (pracodawca „miał” PIT-2)
    expect(r.balance).toBe(-r.advances); // nadpłata
    expect(s.obligations.find((o) => o.id === r.obligationId)).toMatchObject({ direction: 'receivable', category: 'pit_zwrot', scope: 'personal' });
  });
});

describe('5. straty podatkowe', () => {
  /** 2026: strata 20 000 zł (koszty > przychody); 2027–2029: dochód 40 000 zł rocznie. */
  function lossGame(form: RegisterInput['taxForm'] = 'liniowy', withLoss = true): GameState {
    let s = started({ taxForm: form }, { employmentGross: null });
    s = toDate(s, '2026-06-15');
    if (withLoss) { s = withDoc(s, 'sales', zl(10_000)); s = withDoc(s, 'cost', zl(30_000)); }
    for (const y of [2027, 2028, 2029]) {
      s = toDate(s, `${y}-06-15`);
      s = withDoc(s, 'sales', zl(40_000));
    }
    return toDate(s, '2030-01-03');
  }

  it('strata powstaje, gdy koszty przekraczają przychody — nie przy ujemnym przepływie gotówki', () => {
    const s = lossGame();
    expect(s.taxLosses).toHaveLength(1);
    expect(s.taxLosses[0]).toMatchObject({ year: 2026, form: 'liniowy', amount: zl(20_000) });
    expect(s.events.some((e) => e.type === 'tax.loss')).toBe(true);
    // ujemny przepływ gotówki bez straty podatkowej: sprzedaż 50 000 zł niezapłacona + koszty opłacone
    let c = started({ taxForm: 'liniowy' }, { employmentGross: null });
    c = toDate(c, '2026-06-15');
    c = withDoc(c, 'sales', zl(50_000), 90); // klient zapłaci dopiero za 90+ dni
    c = withDoc(c, 'cost', zl(20_000), 1);
    c = toDate(c, '2026-12-31');
    expect(c.taxLosses).toHaveLength(0);
    expect(businessSummaries(c).reduce((a, m) => a + m.income, 0)).toBe(zl(30_000)); // dochód podatkowy dodatni
  });

  it('odliczenie: do 50% straty rocznie przez kolejne lata, nie dłużej niż 5 lat i nie więcej niż strata', () => {
    const s = lossGame();
    const loss = s.taxLosses[0]!;
    expect(loss.usages).toEqual([{ year: 2027, amount: zl(10_000) }, { year: 2028, amount: zl(10_000) }]);
    expect(lossRemaining(loss)).toBe(0);
    expect(returns(s, 2027).find((r) => r.form === 'PIT-36L')!.lossDeducted).toBe(zl(10_000));
    expect(returns(s, 2029).find((r) => r.form === 'PIT-36L')!.lossDeducted).toBe(0);
    consistent(s);
  });

  it('A/B: strata obniża podatek liniowy o 19% × odliczonej kwoty', () => {
    const a = lossGame('liniowy', true);
    const b = lossGame('liniowy', false);
    const taxOf = (s: GameState, y: number) => returns(s, y).find((r) => r.form === 'PIT-36L')!.tax;
    expect(taxOf(b, 2027) - taxOf(a, 2027)).toBe(roundZl(mulBps(zl(10_000), 1_900)));
  });

  it('strata z liniowego odliczana od przychodu przy późniejszym ryczałcie; ryczałt sam strat nie generuje', () => {
    let s = started({ taxForm: 'liniowy' }, { employmentGross: null });
    s = toDate(s, '2026-06-15');
    s = withDoc(withDoc(s, 'sales', zl(10_000)), 'cost', zl(30_000));
    s = ok(commands.planTaxFormChange(toDate(s, '2026-12-01'), 'ryczalt'));
    s = toDate(s, '2027-06-15');
    s = withDoc(s, 'sales', zl(40_000));
    s = toDate(s, '2028-01-03');
    expect(formForYear(activeBusiness(s)!, 2027)).toBe('ryczalt');
    expect(returns(s, 2027).find((r) => r.form === 'PIT-28')).toMatchObject({ lossDeducted: zl(10_000) });
    // ryczałt: koszty nie obniżają podstawy i nie tworzą straty
    let r = started({ taxForm: 'ryczalt' }, { employmentGross: null });
    r = toDate(r, '2026-06-15');
    r = withDoc(withDoc(r, 'sales', zl(1_000)), 'cost', zl(50_000));
    r = toDate(r, '2027-01-02');
    expect(r.taxLosses).toHaveLength(0);
  });
});

describe('6. roczna składka zdrowotna JDG', () => {
  it('rok bez dochodu: minimalna podstawa roczna 12 × 4 806 zł (11 mies. = 52 866 zł) daje dokładnie sumę składek miesięcznych — brak dopłaty', () => {
    const s = toDate(started({}, { employmentGross: null }), '2027-01-02');
    const h = s.healthSettlements[0]!;
    expect(h).toMatchObject({ year: 2026, months: 11, annualBase: 11 * zl(4_806), status: 'none', diff: 0 });
    expect(h.annualContribution).toBe(mulBps(11 * zl(4_806), 900));
    expect(h.annualContribution).toBe(11 * zl(432.54)); // 4 757,94 zł
  });

  it('ryczałt: przychód 70 000 zł → dopłata (10 miesięcy po 498,35 zamiast 830,58 zł) płatna do 20 maja', () => {
    let s = started({ taxForm: 'ryczalt' }, { employmentGross: null });
    s = toDate(withDoc(toDate(s, '2026-12-05'), 'sales', zl(70_000)), '2027-01-02');
    const h = s.healthSettlements[0]!;
    expect(h).toMatchObject({ form: 'ryczalt', months: 11, annualContribution: 11 * zl(830.58), status: 'due', dueDate: '2027-05-20' });
    expect(h.diff).toBe(10 * (zl(830.58) - zl(498.35))); // 3 322,30 zł
    const ob = s.obligations.find((o) => o.id === h.obligationId)!;
    expect(ob).toMatchObject({ amount: h.diff, dueDate: '2027-05-20', scope: 'business', direction: 'payable' });
    consistent(s);
  });

  it('skala: wysoki dochód w jednym miesiącu → dopłata roczna 9% rocznego dochodu', () => {
    let s = started({ taxForm: 'skala' }, { employmentGross: null });
    s = toDate(withDoc(toDate(s, '2026-12-05'), 'sales', zl(60_000)), '2027-01-02');
    const h = s.healthSettlements[0]!;
    expect(h.status).toBe('due');
    expect(h.annualBase).toBeGreaterThan(zl(50_000));
    expect(h.annualContribution).toBe(mulBps(h.annualBase, 900));
    expect(h.diff).toBe(h.annualContribution - h.monthlyTotal);
  });

  it('nadpłata nie wraca automatycznie: bez wniosku wygasa 1 czerwca (brak gotówki); z wnioskiem — należność z terminem 30 lipca', () => {
    let s = started({ taxForm: 'skala' }, { employmentGross: null });
    s = toDate(s, '2026-02-15');
    s = withDoc(s, 'sales', zl(60_000)); // dochód lutego podwyższa składkę marcową
    s = toDate(s, '2026-03-15');
    s = withDoc(s, 'cost', zl(60_000)); // ...a roczny dochód wyniesie 0
    s = toDate(s, '2027-01-02');
    const h = s.healthSettlements[0]!;
    expect(h.status).toBe('refund_available');
    expect(h.diff).toBeLessThan(0);
    expect(h.claimDeadline).toBe('2027-05-31');
    expect(s.obligations.filter((o) => o.category === 'zus_zdrowotna_zwrot')).toHaveLength(0); // żadnej księgowej „gotówki”
    // bez wniosku
    const lost = toDate(s, '2027-06-02');
    expect(lost.healthSettlements[0]!.status).toBe('refund_expired');
    expect(lost.obligations.filter((o) => o.category === 'zus_zdrowotna_zwrot')).toHaveLength(0);
    expect(commands.claimHealthRefund(lost, h.id)).toMatchObject({ ok: false });
    // z wnioskiem
    let claimed = ok(commands.claimHealthRefund(toDate(s, '2027-05-10'), h.id));
    const refund = claimed.obligations.find((o) => o.category === 'zus_zdrowotna_zwrot')!;
    expect(refund).toMatchObject({ amount: -h.diff, dueDate: '2027-07-30', direction: 'receivable', scope: 'business' });
    const before = claimed.accounts[activeBusiness(claimed)!.accountId]!.balance;
    claimed = toDate(claimed, '2027-07-31');
    expect(claimed.obligations.find((o) => o.id === refund.id)!.status).toBe('settled');
    expect(claimed.accounts[activeBusiness(claimed)!.accountId]!.balance).toBeGreaterThan(before - zl(10_000));
    consistent(claimed);
  });
});

describe('7. zawieszenie i wznowienie JDG', () => {
  it('dyspozycja od 1. dnia następnego miesiąca; minimalnie 30 dni; w zawieszeniu brak składek, zaliczek i nowych zleceń; należności z przed zawieszenia płyną', () => {
    let s = started({ zusStart: 'ulga' }, { employmentGross: zl(3_000) }); // etat poniżej minimalnego — składki z JDG byłyby wymagane
    s = toDate(s, '2026-03-10');
    s = withDoc(s, 'sales', zl(8_000), 30);
    s = ok(commands.suspendBusiness(s));
    expect(activeBusiness(s)!.suspensions).toEqual([{ from: '2026-04-01', to: null }]);
    expect(businessState(activeBusiness(s)!, '2026-03-20')).toBe('active');
    expect(commands.suspendBusiness(s)).toMatchObject({ ok: false });
    s = toDate(s, '2026-04-10');
    expect(businessState(activeBusiness(s)!, s.clock.today)).toBe('suspended');
    expect(commands.acceptServiceOffer({ ...s, serviceOffers: [] }, 'x', 2)).toMatchObject({ ok: false });
    expect(allowedResumeDates(s)).toEqual(['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01']);
    s = ok(commands.resumeBusiness(s, '2026-07-01'));
    s = toDate(s, '2026-08-02');
    // kwiecień–czerwiec: zawieszenie bez składek i zaliczek
    for (const m of ['2026-04', '2026-05', '2026-06']) expect(period(s, m)).toMatchObject({ zusRegime: 'zawieszenie', social: 0, health: 0, advance: 0 });
    expect(s.obligations.filter((o) => o.scope === 'business' && ['2026-04-30', '2026-05-31', '2026-06-30'].includes(o.issueDate) && ['zus_zdrowotna', 'zus_spoleczne', 'pit_zaliczka'].includes(o.category))).toHaveLength(0);
    // sprzedaż sprzed zawieszenia została opłacona w trakcie zawieszenia (nie anuluje się długów ani należności)
    const sale = s.obligations.find((o) => o.category === 'przychod_dzialalnosci')!;
    expect(sale.status).toBe('settled');
    // bieg ulgi na start NIE zatrzymał się: luty–lipiec = 6 miesięcy ulgi, sierpień = 1. miesiąc preferencji
    expect(period(s, '2026-07')).toMatchObject({ zusRegime: 'ulga', social: 0 });
    consistent(s);
  });

  it('wznowienie: dozwolone dopiero po 30 dniach (wyjątek: zawieszenie na sam luty); zaplanowane zawieszenie można anulować', () => {
    let s = started({}, { employmentGross: zl(3_000) });
    s = toDate(s, '2026-02-20');
    s = ok(commands.suspendBusiness(s)); // od 1 marca
    expect(commands.resumeBusiness(toDate(s, '2026-03-05'), '2026-03-15')).toMatchObject({ ok: false });
    expect(commands.resumeBusiness(toDate(s, '2026-03-05'), '2026-04-01')).toMatchObject({ ok: true }); // 31 dni
    // anulowanie przed rozpoczęciem
    const planned = ok(commands.suspendBusiness(toDate(started(), '2026-02-20')));
    expect(ok(commands.resumeBusiness(planned, '2026-03-01')).businesses[0]!.suspensions).toEqual([]);
    // wyjątek lutowy: zawieszenie 1–28 lutego
    let feb = fund(game('feb'), zl(50_000));
    feb = ok(commands.registerBusiness(feb, { ...REG, startDate: '2026-02-01' }));
    feb = advanceDays(feb, diffDays('2026-02-01', feb.clock.today));
    // zawieszenie od marca, bo luty już trwa — sprawdzamy regułę w roku 2027
    feb = toDate(feb, '2027-01-10');
    feb = ok(commands.suspendBusiness(feb)); // od 1 lutego 2027
    expect(allowedResumeDates(toDate(feb, '2027-02-05'))[0]).toBe('2027-03-01'); // 28 dni = pełny luty
  });

  it('nie można zawiesić z trwającym zleceniem; zakończenie działalności w zawieszeniu; historia zachowana', () => {
    let s = started({}, { employmentGross: zl(3_000) });
    s = toDate(s, '2026-02-02');
    s.serviceOffers.push({ id: 'offer:t', templateId: 'it-strona', clientId: 'party:client:t', title: 'Test', description: 'x', netValue: zl(3_000), hoursTotal: 10, costNet: 0, paymentTermDays: 14, deadlineDays: 20, latePenaltyBps: 500, offeredOn: s.clock.today, expiresOn: addDays(s.clock.today, 14), status: 'open' });
    s.parties['party:client:t'] = { id: 'party:client:t', name: 'K', role: 'service' };
    const withOrder = ok(commands.acceptServiceOffer(s, 'offer:t', 2));
    expect(commands.suspendBusiness(withOrder)).toMatchObject({ ok: false, error: expect.stringContaining('zlecenia') });
    let susp = ok(commands.suspendBusiness(toDate(s, '2026-02-20')));
    susp = toDate(susp, '2026-04-02');
    const closed = toDate(ok(commands.closeBusiness(susp)), '2026-05-02');
    expect(closed.businesses[0]).toMatchObject({ status: 'closed', closeOn: '2026-04-30' });
    expect(closed.taxPeriods.map((p) => p.month)).toEqual(['2026-02', '2026-03', '2026-04']);
    consistent(closed);
  });

  it('rok z zawieszeniem: roczna składka zdrowotna liczy tylko miesiące działalności', () => {
    let s = started({}, { employmentGross: zl(3_000) });
    s = ok(commands.suspendBusiness(toDate(s, '2026-05-10'))); // od 1 czerwca
    s = ok(commands.resumeBusiness(toDate(s, '2026-06-05'), '2026-09-01'));
    s = toDate(s, '2027-01-02');
    expect(s.healthSettlements[0]!.months).toBe(8); // luty–maj + wrzesień–grudzień
  });
});

describe('8. zmiana formy opodatkowania', () => {
  it('zmiana tylko od 1 stycznia następnego roku; historia form i rozliczeń zachowana; można anulować', () => {
    let s = started({ taxForm: 'skala' }, { employmentGross: null });
    s = toDate(withDoc(toDate(s, '2026-05-10'), 'sales', zl(20_000)), '2026-09-02');
    const before = structuredClone(s.taxPeriods);
    s = ok(commands.planTaxFormChange(s, 'liniowy'));
    expect(s.businesses[0]!.taxFormPlan).toMatchObject({ form: 'liniowy', effectiveYear: 2027 });
    expect(s.businesses[0]!.taxForm).toBe('skala'); // bieżący rok bez zmian
    expect(commands.planTaxFormChange(s, 'skala')).toMatchObject({ ok: true }); // „z powrotem” = anulowanie planu
    expect(ok(commands.planTaxFormChange(s, 'skala')).businesses[0]!.taxFormPlan).toBeNull();
    expect(commands.planTaxFormChange(ok(commands.planTaxFormChange(s, 'skala')), 'skala')).toMatchObject({ ok: false }); // już obowiązuje
    s = toDate(s, '2027-02-02');
    const b = s.businesses[0]!;
    expect(b.taxForm).toBe('liniowy');
    expect(b.taxFormHistory).toEqual([{ form: 'skala', from: '2026-02-01' }, { form: 'liniowy', from: '2027-01-01' }]);
    expect(period(s, '2027-01').form).toBe('liniowy');
    expect(period(s, '2026-12').form).toBe('skala');
    expect(s.taxPeriods.slice(0, before.length)).toEqual(before); // wcześniejsze rozliczenia bez zmian
    expect(returns(s, 2026).map((r) => r.form)).toEqual(expect.arrayContaining(['PIT-36']));
    expect(s.events.some((e) => e.type === 'business.taxform')).toBe(true);
    consistent(s);
  });

  it('ryczałt niedostępny przy przychodzie z poprzedniego roku powyżej limitu 8 517 200 zł', () => {
    let s = started({ taxForm: 'liniowy', vatStatus: 'active' }, { employmentGross: null });
    s = withDoc(toDate(s, '2026-06-10'), 'sales', zl(9_000_000));
    s = toDate(s, '2026-11-02');
    const r = commands.planTaxFormChange(s, 'ryczalt');
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('limit') });
  });

  it('składka zdrowotna po zmianie formy liczy się według nowej formy (ryczałt: progi przychodu)', () => {
    let s = started({ taxForm: 'skala' }, { employmentGross: null });
    s = ok(commands.planTaxFormChange(toDate(s, '2026-11-02'), 'ryczalt'));
    s = toDate(s, '2027-02-02');
    expect(period(s, '2027-01')).toMatchObject({ form: 'ryczalt', health: zl(498.35) });
    expect(period(s, '2026-12')).toMatchObject({ form: 'skala', health: zl(432.54) });
  });
});

describe('9. Mały ZUS Plus', () => {
  /** Preferencje 24 mies. od 02.2026 → standard od 02.2028; przychód 2027 zadany; etat poniżej minimalnego (składki z JDG). */
  function mzp(revenue2027: number, o: Partial<RegisterInput> = {}): GameState {
    let s = started({ zusStart: 'preferencyjny', ...o }, { employmentGross: zl(3_000) });
    s = toDate(s, '2027-06-10');
    if (revenue2027 > 0) s = withDoc(s, 'sales', revenue2027);
    return toDate(s, '2028-02-10');
  }

  it('warunki spełnione: podstawa = dochód z poprzedniego roku / dni × 30 (w granicach), składki od tej podstawy od następnego miesiąca', () => {
    let s = mzp(zl(40_000));
    const st = malyZusStatus(s, activeBusiness(s)!, s.clock.today);
    expect(st).toMatchObject({ eligible: true, reasons: [], daysOperated: 365, priorRevenue: zl(40_000) });
    expect(st.base).toBe(roundDiv(zl(40_000) * 30, 365)); // 3 287,67 zł
    s = ok(commands.declareMalyZusPlus(s));
    expect(activeBusiness(s)!.zus.malyPlus).toMatchObject({ active: true, base: st.base, since: '2028-03-01' });
    s = toDate(s, '2028-04-02');
    expect(period(s, '2028-02').zusRegime).toBe('standard'); // luty jeszcze standardowe
    expect(period(s, '2028-03')).toMatchObject({ zusRegime: 'maly_plus', social: socialContributions(st.base!, { sickness: false, fpFs: false }).total });
    consistent(s);
  });

  it('niska podstawa podnoszona do minimum 1 441,80 zł; wysoka ograniczana do 5 652 zł; ryczałt: dochód = 50% przychodu', () => {
    const low = mzp(zl(5_000));
    expect(malyZusStatus(low, activeBusiness(low)!, low.clock.today).base).toBe(zl(1_441.8));
    const high = mzp(zl(118_000));
    expect(malyZusStatus(high, activeBusiness(high)!, high.clock.today).base).toBe(zl(5_652));
    const ryc = mzp(zl(60_000), { taxForm: 'ryczalt' });
    expect(malyZusStatus(ryc, activeBusiness(ryc)!, ryc.clock.today).base).toBe(roundDiv(zl(30_000) * 30, 365));
  });

  it('brak uprawnień (nie przyznawane automatycznie): przychód ponad limit 120 000 zł, pierwszy rok, trwające preferencje, za krótko, 36 miesięcy', () => {
    const over = mzp(zl(125_000));
    expect(malyZusStatus(over, activeBusiness(over)!, over.clock.today).reasons.join(' ')).toMatch(/przekroczył limit/);
    expect(commands.declareMalyZusPlus(over)).toMatchObject({ ok: false });
    // pierwszy rok i preferencje (luty 2027)
    const early = toDate(started({ zusStart: 'preferencyjny' }, { employmentGross: zl(3_000) }), '2027-02-10');
    const e = malyZusStatus(early, activeBusiness(early)!, early.clock.today);
    expect(e.eligible).toBe(false);
    expect(e.reasons.join(' ')).toMatch(/alternatywą/);
    const first = started({ zusStart: 'preferencyjny' }, { employmentGross: zl(3_000) });
    expect(malyZusStatus(first, activeBusiness(first)!, '2026-12-01').reasons.join(' ')).toMatch(/pierwszym roku/);
    // 36 miesięcy z ostatnich 60
    const used = structuredClone(mzp(zl(40_000)));
    for (let i = 0; i < 36; i++) used.taxPeriods.push({ ...used.taxPeriods[0]!, month: `2026-${String((i % 12) + 1).padStart(2, '0')}`, zusRegime: 'maly_plus' });
    expect(malyZusStatus(used, activeBusiness(used)!, used.clock.today).reasons.join(' ')).toMatch(/36/);
  });

  it('1 stycznia: gdy przychód przekroczy limit, prawo wygasa; rezygnacja kończy korzystanie; przejście do standardowych składek', () => {
    let s = ok(commands.declareMalyZusPlus(mzp(zl(40_000))));
    s = toDate(withDoc(toDate(s, '2028-06-10'), 'sales', zl(130_000)), '2029-02-03');
    expect(activeBusiness(s)!.zus.malyPlus.active).toBe(false);
    expect(s.events.some((e) => e.type === 'business.zus' && e.title.includes('Utrata'))).toBe(true);
    expect(period(s, '2029-01').zusRegime).toBe('standard');
    let t = ok(commands.declareMalyZusPlus(mzp(zl(40_000))));
    t = ok(commands.resignMalyZusPlus(t));
    expect(activeBusiness(t)!.zus.malyPlus.active).toBe(false);
    expect(commands.resignMalyZusPlus(t)).toMatchObject({ ok: false });
  });

  it('zbieg z etatem ≥ minimalnego wynagrodzenia nadal ma pierwszeństwo: brak składek społecznych mimo Małego ZUS Plus', () => {
    let s = mzp(zl(40_000));
    const emp = s.contracts.find((c) => c.type === 'employment')!;
    s = ok(commands.declareMalyZusPlus(s));
    if (emp.type === 'employment') (s.contracts.find((c) => c.id === emp.id) as typeof emp).grossMonthly = zl(6_300);
    s = toDate(s, '2028-04-02');
    expect(period(s, '2028-03')).toMatchObject({ zusRegime: 'etat', social: 0 });
  });
});

describe('10. planowanie finansowe (prognoza bez księgowania)', () => {
  const base = () => {
    let s = started({ taxForm: 'skala' }, { employmentGross: null });
    s = toDate(s, '2026-05-10');
    return s;
  };

  it('nie zmienia rzeczywistego stanu: ani zobowiązań, ani transakcji, ani zdarzeń, ani dokumentów', () => {
    const s = base();
    const snapshot = structuredClone(s);
    const results = runPlanning(s, DEFAULT_ASSUMPTIONS, standardScenarios(s));
    expect(results.length).toBeGreaterThanOrEqual(5);
    expect(s).toEqual(snapshot);
    expect(s.obligations.length).toBe(snapshot.obligations.length);
    expect(s.documents.length).toBe(snapshot.documents.length);
    consistent(s);
  });

  it('deterministyczna i oparta na silniku: ten sam stan i założenia → identyczny wynik; scenariusze różnią się sensownie', () => {
    const s = base();
    const a = runPlanning(s, DEFAULT_ASSUMPTIONS, standardScenarios(s));
    expect(runPlanning(s, DEFAULT_ASSUMPTIONS, standardScenarios(s))).toEqual(a);
    const by = Object.fromEntries(a.map((r) => [r.scenarioId, r]));
    expect(by['baseline']!.feasible).toBe(true);
    expect(by['baseline']!.businessRevenue).toBeGreaterThan(0);
    expect(by['no-job']!.salaryNet).toBeLessThan(by['baseline']!.salaryNet); // wypowiedzenie → mniej wynagrodzenia
    expect(by['no-job']!.freeHoursPerDay).toBeGreaterThan(by['baseline']!.freeHoursPerDay); // etat nie zabiera czasu
    expect(by['half-job']!.salaryNet).toBeLessThan(by['baseline']!.salaryNet);
    expect(by['more-revenue']!.businessRevenue).toBeGreaterThan(by['baseline']!.businessRevenue);
    expect(by['baseline']!.taxesAndZus).toBeGreaterThan(0);
    for (const r of a) expect(r.months).toBeGreaterThanOrEqual(12);
  });

  it('godziny dla firmy ograniczone wolnym czasem (etat, sen, obowiązki) i jawne ostrzeżenie', () => {
    const s = fund(game('plan-time'), zl(50_000));
    let t = ok(commands.registerBusiness(s, REG));
    t = toDate(t, '2026-03-02'); // etat 8 godz.: wolne 4 godz./dzień
    const [r] = runPlanning(t, { ...DEFAULT_ASSUMPTIONS, desiredHoursPerDay: 8 }, [{ id: 'baseline', label: 'x' }]);
    expect(r!.freeHoursPerDay).toBe(4);
    expect(r!.businessHoursPerDay).toBe(4);
    expect(r!.warnings.join(' ')).toMatch(/Wolny czas pozwala/);
  });

  it('niemożliwe scenariusze są oznaczone, a nie wykonywane: zmiana na tę samą formę, brak działalności', () => {
    const s = base();
    const [same] = runPlanning(s, DEFAULT_ASSUMPTIONS, [{ id: 'same', label: 's', taxFormNextYear: 'skala' }]);
    expect(same!.feasible).toBe(false);
    const noBiz = game('plan-nobiz');
    const [r] = runPlanning(noBiz, DEFAULT_ASSUMPTIONS, [{ id: 'f', label: 'f', taxFormNextYear: 'liniowy' }]);
    expect(r!.feasible).toBe(false);
    expect(r!.warnings[0]).toMatch(/wymaga prowadzonej działalności/);
    expect(noBiz.businesses).toHaveLength(0);
  });
});

describe('11. roczny raport JDG', () => {
  it('wynik firmy rozdzielony od przepływów właściciela: przelewy własne nie są przychodem; wpłaty od klientów, należności i majątek netto', () => {
    let s = started({}, { employmentGross: null, fundZl: 50_000 });
    s = toDate(s, '2026-04-10');
    s = withDoc(s, 'sales', zl(10_000), 30);
    s = toDate(s, '2026-05-02');
    s = withDoc(s, 'sales', zl(6_000), 30); // jeszcze niezapłacone w grudniu? (termin 30 dni + opóźnienie)
    s = ok(commands.transferFunds(s, activeBusiness(s)!.accountId, s.playerAccountId, zl(5_000))); // pobranie właściciela
    s = toDate(s, '2026-12-31');
    const r = yearReport(s, 2026);
    expect(r.revenue).toBe(zl(16_000));
    expect(r.ownerContributions).toBe(zl(50_000));
    expect(r.ownerWithdrawals).toBe(zl(5_000));
    expect(r.customerPayments).toBeLessThanOrEqual(zl(16_000));
    expect(r.customerPayments + r.receivables).toBe(zl(16_000)); // przychód = wpłaty + należności na koniec roku
    expect(r.businessCash).toBe(s.accounts[activeBusiness(s)!.accountId]!.balance);
    expect(r.income).toBe(r.revenue - r.costs);
    expect(r.result).toBe(r.income - r.zus - r.pit);
    expect(r.netWorthChange).toBe(r.netWorthEnd - r.netWorthStart);
    expect(r.complete).toBe(true);
    // wkład własny nie zwiększa wyniku: ten sam rok bez przelewów daje ten sam wynik firmy
    expect(r.revenue).not.toBe(r.revenue + r.ownerContributions);
    expect(yearReport(s, 2026).asOf).toBe('2026-12-31');
  });
});

describe('12. wieloletni scenariusz: etat + JDG, zmiana formy, zawieszenie, strata, Mały ZUS Plus', () => {
  function play(seed: string): GameState {
    let s = fund(game(seed, '1992-03-03'), zl(250_000));
    s = ok(commands.registerBusiness(s, { ...REG, zusStart: 'ulga', taxForm: 'skala', sickness: true }));
    s = advanceDays(s, diffDays('2026-02-01', s.clock.today));
    s = ok(commands.transferFunds(s, s.playerAccountId, activeBusiness(s)!.accountId, zl(120_000)));
    const emp = s.contracts.find((c) => c.type === 'employment')!;
    if (emp.type === 'employment') emp.grossMonthly = zl(4_000); // poniżej minimalnego: składki z JDG wymagane
    s.accounts[s.playerAccountId]!.balance += 0;
    const steps: [string, (x: GameState) => GameState][] = [
      ['2026-06-10', (x) => withDoc(withDoc(x, 'sales', zl(10_000)), 'cost', zl(25_000))], // 2026: strata podatkowa
      ['2026-11-03', (x) => ok(commands.planTaxFormChange(x, 'liniowy'))], // liniowy od 2027
      ['2027-04-02', (x) => withDoc(x, 'sales', zl(60_000))],
      ['2027-07-05', (x) => ok(commands.suspendBusiness(x))], // zawieszenie od sierpnia
      ['2027-10-05', (x) => ok(commands.resumeBusiness(x, '2027-11-01'))],
      ['2027-11-20', (x) => withDoc(x, 'sales', zl(25_000))],
      ['2028-09-05', (x) => ok(commands.declareMalyZusPlus(x))],
    ];
    for (const [d, fn] of steps) {
      if (s.clock.today < d) s = toDate(s, d);
      s = fn(s);
      expect(checkInvariants(s), `po kroku ${d}`).toEqual([]);
    }
    for (let m = 0; m < 14; m++) {
      s = advanceToNextMonth(s);
      expect(checkInvariants(s), `miesiąc ${s.clock.today}`).toEqual([]);
    }
    return s;
  }

  it('ponad 3 lata: spójne finanse, historia form i rozliczeń, zawieszenie, strata odliczona, Mały ZUS Plus, brak dubli', () => {
    const s = play('multi-year');
    const b = s.businesses[0]!;
    expect(b.taxFormHistory.map((h) => h.form)).toEqual(['skala', 'liniowy']);
    expect(b.suspensions).toEqual([{ from: '2027-08-01', to: '2027-10-31' }]);
    expect(s.taxPeriods.filter((p) => p.zusRegime === 'zawieszenie').map((p) => p.month)).toEqual(['2027-08', '2027-09', '2027-10']);
    expect(s.taxLosses[0]).toMatchObject({ year: 2026, form: 'skala', amount: zl(15_000) });
    expect(s.taxLosses[0]!.usages.length).toBeGreaterThan(0);
    expect(s.taxReturns.map((r) => `${r.year}:${r.form}`)).toEqual(expect.arrayContaining(['2026:PIT-36', '2027:PIT-36L', '2027:PIT-37']));
    expect(s.healthSettlements.map((h) => h.year)).toEqual([2026, 2027, 2028]);
    expect(s.healthSettlements.find((h) => h.year === 2027)!.months).toBe(9); // 12 − 3 miesiące zawieszenia
    expect(new Set(s.obligations.map((o) => o.id)).size).toBe(s.obligations.length);
    expect(new Set(s.ledger.map((t) => t.id)).size).toBe(s.ledger.length);
    expect(yearReport(s, 2027).revenue).toBe(zl(85_000));
    expect(s.payslips.length).toBeGreaterThan(36);
  }, 120_000);

  it('deterministyczność i brak podwójnych rozliczeń po zapisie/wczytaniu', () => {
    const a = play('multi-det');
    expect(play('multi-det')).toEqual(a);
    expect(netWorth(a)).toBe(netWorth(structuredClone(a)));
    const reloaded = structuredClone(a);
    const counts = [reloaded.taxPeriods.length, reloaded.taxReturns.length, reloaded.healthSettlements.length, reloaded.obligations.length, reloaded.payslips.length];
    for (let i = 0; i < 3; i++) {
      const next = advanceToNextMonth(reloaded);
      expect(next.taxPeriods.length - counts[0]!).toBeLessThanOrEqual(1);
      reloaded.clock = reloaded.clock;
    }
    expect([reloaded.taxPeriods.length, reloaded.taxReturns.length, reloaded.healthSettlements.length, reloaded.obligations.length, reloaded.payslips.length]).toEqual(counts);
  }, 240_000);
});
