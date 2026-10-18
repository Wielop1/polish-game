import { describe, expect, it } from 'vitest';
import { activeBusiness, issueDocument, paymentDelayDays } from './business.ts';
import type { RegisterInput } from './business.ts';
import { commands } from './commands.ts';
import type { CommandResult } from './commands.ts';
import { recordHistory } from './core.ts';
import { addDays, diffDays } from './date.ts';
import { checkInvariants } from './invariants.ts';
import { LEGAL_RULES } from './legal.ts';
import { mulBps, roundDiv, zl } from './money.ts';
import { createNewGame } from './newGame.ts';
import { businessBalance, businessSummaries, monthlySummaries, netWorth } from './selectors.ts';
import { advanceDays, advanceToNextMonth, processDay } from './simulate.ts';
import type { GameState, ServiceOffer } from './state.ts';
import { healthFromIncome, healthRyczalt, pitCumulative, roundZl, socialContributions, socialForRegime, vatExemptionLimit, zusRegimeFor } from './tax.ts';
import { budgetFor } from './time.ts';

const game = (seed = 'biz', lifeEvents = false) => createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed, lifeEvents });
const ok = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(`komenda odrzucona: ${r.error}`);
  return r.state;
};
const consistent = (s: GameState) => expect(checkInvariants(s)).toEqual([]);
const REG: RegisterInput = { name: 'Jan Kowalski Usługi IT', profileId: 'it-programowanie', taxForm: 'ryczalt', vatStatus: 'exempt', startDate: '2026-02-01', zusStart: 'standard', sickness: false };
const reg = (s: GameState, o: Partial<RegisterInput> = {}) => ok(commands.registerBusiness(s, { ...REG, ...o }));
/** Wstrzykuje kapitał prywatny (wpłata kapitałowa) tak, by niezmienniki pozostały spełnione — tylko do testów. */
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
/** Gra z działalnością po starcie (1 lutego 2026) i zasilonym rachunkiem firmowym. */
function started(o: Partial<RegisterInput> = {}, fundZl = 6_000, seed = 'biz'): GameState {
  let s = fund(reg(game(seed), o), zl(30_000));
  s = advanceDays(s, diffDays('2026-02-01', s.clock.today));
  const bid = activeBusiness(s)!.accountId;
  return ok(commands.transferFunds(s, s.playerAccountId, bid, zl(fundZl)));
}
function withDoc(state: GameState, kind: 'sales' | 'cost', net: number, termDays = 14): GameState {
  const s = structuredClone(state);
  const b = activeBusiness(s)!;
  s.parties['party:test'] ??= { id: 'party:test', name: 'Kontrahent testowy', role: 'service' };
  issueDocument(s, b, { kind, issueDate: s.clock.today, counterpartyId: 'party:test', orderId: null, description: 'Test', net, termDays });
  recordHistory(s, s.clock.today);
  return s;
}
const obs = (s: GameState, category: string) => s.obligations.filter((o) => o.category === category);
const period = (s: GameState, month: string) => s.taxPeriods.find((p) => p.month === month)!;

describe('JDG: rejestracja, własność i statusy', () => {
  it('rejestracja tworzy działalność osoby fizycznej z rachunkiem firmowym (nie osobę prawną)', () => {
    const s = reg(game());
    const b = activeBusiness(s)!;
    expect(b).toMatchObject({ status: 'active', startDate: '2026-02-01', taxForm: 'ryczalt', pkd: '62.10.B', ownerId: s.person.id });
    const acc = s.accounts[b.accountId]!;
    expect(acc).toMatchObject({ type: 'business', ownerId: s.person.id, balance: 0 });
    expect(s.events.some((e) => e.type === 'business.registered')).toBe(true);
    consistent(s);
  });

  it('walidacje: jedna aktywna JDG, start tylko 1. dnia miesiąca ≥ luty 2026, nazwa, profil', () => {
    const s0 = game();
    expect(commands.registerBusiness(s0, { ...REG, startDate: '2026-01-01' })).toMatchObject({ ok: false }); // nie w przeszłości/dziś
    expect(commands.registerBusiness(s0, { ...REG, startDate: '2026-02-15' })).toMatchObject({ ok: false });
    expect(commands.registerBusiness(s0, { ...REG, startDate: '2026-09-01' })).toMatchObject({ ok: false }); // za daleko
    expect(commands.registerBusiness(s0, { ...REG, name: 'X' })).toMatchObject({ ok: false });
    expect(commands.registerBusiness(s0, { ...REG, profileId: 'nie-ma' })).toMatchObject({ ok: false });
    const s1 = reg(s0);
    expect(commands.registerBusiness(s1, REG)).toMatchObject({ ok: false, error: expect.stringContaining('jedną JDG') });
    expect(s0.businesses).toHaveLength(0); // stan wejściowy nietknięty
  });

  it('zakończenie: wymaga braku trwających zleceń, kończy się ostatniego dnia miesiąca, ulgi ZUS po zamknięciu niedostępne przez 60 miesięcy', () => {
    let s = started();
    s = advanceDays(s, 10); // 11 lutego
    s = ok(commands.closeBusiness(s));
    expect(activeBusiness(s)!.closeOn).toBe('2026-02-28');
    expect(commands.closeBusiness(s)).toMatchObject({ ok: false });
    s = advanceDays(s, 20); // 3 marca
    expect(s.businesses[0]!.status).toBe('closed');
    expect(activeBusiness(s)).toBeNull();
    expect(s.taxPeriods.map((p) => p.month)).toEqual(['2026-02']);
    // ponowna rejestracja: ulga i preferencje zablokowane, standardowy ZUS dozwolony
    const r1 = commands.registerBusiness(s, { ...REG, startDate: '2026-04-01', zusStart: 'ulga' });
    expect(r1).toMatchObject({ ok: false, error: expect.stringContaining('60 miesiącach') });
    expect(commands.registerBusiness(s, { ...REG, startDate: '2026-04-01', zusStart: 'preferencyjny' })).toMatchObject({ ok: false });
    expect(commands.registerBusiness(s, { ...REG, startDate: '2026-04-01', zusStart: 'standard' })).toMatchObject({ ok: true });
    consistent(s);
  });

  it('nie można zamknąć działalności ze zleceniem w toku', () => {
    const s = withOffer(started(), 'it-strona');
    const accepted = ok(commands.acceptServiceOffer(s, 'offer:test', 3));
    expect(commands.closeBusiness(accepted)).toMatchObject({ ok: false, error: expect.stringContaining('zlecenia') });
  });
});

describe('JDG: przepływy prywatne ↔ firma', () => {
  it('wkład własny i pobranie to przelewy: majątek netto bez zmian, poza przepływami miesięcznymi; sald firmy nie widać w prywatnych podsumowaniach', () => {
    let s = fund(reg(game()), zl(10_000));
    s = advanceDays(s, 45);
    const bid = activeBusiness(s)!.accountId;
    const nw = netWorth(s);
    const funded = ok(commands.transferFunds(s, s.playerAccountId, bid, zl(2_000)));
    expect(netWorth(funded)).toBe(nw);
    expect(businessBalance(funded)).toBe(zl(2_000));
    expect(ok(commands.transferFunds(funded, bid, s.playerAccountId, zl(500))).accounts[bid]!.balance).toBe(zl(1_500));
    const personal = monthlySummaries(funded).find((m) => m.month === '2026-02')!;
    const before = monthlySummaries(s).find((m) => m.month === '2026-02')!;
    expect(personal.cashOut).toBe(before.cashOut);
    consistent(funded);
  });

  it('zobowiązania firmy mają ewidencję „business” i rozliczają się z rachunku firmowego, a nie prywatnego', () => {
    let s = withDoc(started(), 'sales', zl(5_000));
    s = advanceDays(s, 28); // do 1 marca: koniec lutego zamknięty
    const health = obs(s, 'zus_zdrowotna');
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({ scope: 'business', accountId: activeBusiness(s)!.accountId, direction: 'payable' });
    const personalBefore = s.accounts[s.playerAccountId]!.balance;
    const paid = advanceDays(s, 20); // 21 marca — składka zapłacona 20.03 z rachunku firmowego
    expect(obs(paid, 'zus_zdrowotna')[0]!.status).toBe('settled');
    expect(paid.ledger.find((t) => t.obligationId === health[0]!.id)!.accountId).toBe(activeBusiness(paid)!.accountId);
    expect(paid.accounts[paid.playerAccountId]!.balance).toBeGreaterThanOrEqual(personalBefore - zl(5_000)); // prywatne wydatki bez składki firmowej
    expect(businessSummaries(paid).find((m) => m.month === '2026-02')!.zus).toBe(zl(498.35));
    consistent(paid);
  });
});

describe('ZUS i składka zdrowotna: zweryfikowane przykłady 2026', () => {
  it('składki społeczne od podstawy 5 652 zł: 1 103,27 / 452,16 / 138,47 / 94,39 / 138,47 = 1 926,76 zł (z chorobową)', () => {
    const c = socialContributions(zl(5_652), { sickness: true, fpFs: true });
    expect(c).toMatchObject({ emerytalna: zl(1_103.27), rentowa: zl(452.16), chorobowa: zl(138.47), wypadkowa: zl(94.39), fpFs: zl(138.47), total: zl(1_926.76) });
    expect(socialContributions(zl(5_652), { sickness: false, fpFs: true }).total).toBe(zl(1_788.29));
  });

  it('składki preferencyjne od podstawy 1 441,80 zł: 281,44 / 115,34 / 35,32 / 24,08 = 456,18 zł; bez FP/FS', () => {
    const c = socialForRegime('preferencyjny', true);
    expect(c).toMatchObject({ emerytalna: zl(281.44), rentowa: zl(115.34), chorobowa: zl(35.32), wypadkowa: zl(24.08), fpFs: 0, total: zl(456.18) });
    expect(socialForRegime('preferencyjny', false).total).toBe(zl(420.86));
    expect(socialForRegime('ulga', true).total).toBe(0);
  });

  it('oś czasu: ulga 6 mies. → 24 mies. preferencji → standard; bez ulgi 24 mies. preferencji', () => {
    const seq = (start: 'ulga' | 'preferencyjny' | 'standard') => [0, 5, 6, 29, 30, 60].map((i) => zusRegimeFor(start, i));
    expect(seq('ulga')).toEqual(['ulga', 'ulga', 'preferencyjny', 'preferencyjny', 'standard', 'standard']);
    expect(seq('preferencyjny')).toEqual(['preferencyjny', 'preferencyjny', 'preferencyjny', 'standard', 'standard', 'standard']); // indeks 29 = 30. miesiąc > 24
    expect(seq('standard').every((r) => r === 'standard')).toBe(true);
  });

  it('składka zdrowotna: skala 9% / liniowy 4,9% dochodu z minimum 432,54 zł', () => {
    expect(healthFromIncome('skala', zl(20_000))).toBe(zl(1_800));
    expect(healthFromIncome('liniowy', zl(20_000))).toBe(zl(980));
    expect(healthFromIncome('skala', zl(4_000))).toBe(zl(432.54));
    expect(healthFromIncome('liniowy', 0)).toBe(zl(432.54));
    expect(healthFromIncome('skala', -zl(5_000))).toBe(zl(432.54)); // strata → minimum
  });

  it('ryczałt: 498,35 / 830,58 / 1 495,04 zł wg przychodu narastająco (granice 60 i 300 tys. zł)', () => {
    expect(healthRyczalt(zl(60_000))).toBe(zl(498.35));
    expect(healthRyczalt(zl(60_000.01))).toBe(zl(830.58));
    expect(healthRyczalt(zl(300_000))).toBe(zl(830.58));
    expect(healthRyczalt(zl(300_000.01))).toBe(zl(1_495.04));
    expect(healthRyczalt(0)).toBe(zl(498.35));
  });

  it('zbieg z etatem ≥ minimalnego wynagrodzenia: brak składek społecznych z JDG, składka zdrowotna nadal płatna', () => {
    let s = started({ zusStart: 'standard' });
    s = advanceDays(s, 28); // koniec lutego zamknięty
    const p = period(s, '2026-02');
    expect(p).toMatchObject({ zusRegime: 'etat', social: 0, health: zl(498.35) }); // etat 6 300 zł brutto ≥ 4 806 zł
    expect(obs(s, 'zus_spoleczne')).toHaveLength(0);
    expect(p.ruleIds).toContain('ZUS-ZBIEG-ETAT');
    consistent(s);
  });

  it('etat poniżej minimalnego wynagrodzenia (np. 1/2 etatu): składki społeczne z JDG są wymagane', () => {
    let s0 = structuredClone(started({ zusStart: 'standard', sickness: true }));
    const emp = s0.contracts.find((c) => c.type === 'employment')!;
    if (emp.type === 'employment') emp.grossMonthly = zl(3_300);
    const s = advanceDays(s0, 28);
    const p = period(s, '2026-02');
    expect(p).toMatchObject({ zusRegime: 'standard', social: zl(1_926.76) });
    expect(obs(s, 'zus_spoleczne')[0]).toMatchObject({ amount: zl(1_926.76), dueDate: '2026-03-20', scope: 'business' });
  });

  it('ulga na start: 6 miesięcy bez składek społecznych (składka zdrowotna płatna), potem preferencyjne 24 mies.', () => {
    const s0 = structuredClone(started({ zusStart: 'ulga' }));
    const emp = s0.contracts.find((c) => c.type === 'employment')!;
    if (emp.type === 'employment') emp.grossMonthly = zl(3_000); // brak zbiegu — składki z JDG
    let s = advanceDays(s0, diffDays('2026-09-01', s0.clock.today)); // luty–sierpień zamknięte
    expect(s.taxPeriods.slice(0, 6).map((p) => [p.zusRegime, p.social])).toEqual(Array(6).fill(['ulga', 0]));
    expect(s.taxPeriods.slice(0, 6).every((p) => p.health >= zl(432.54))).toBe(true);
    expect(s.taxPeriods[6]).toMatchObject({ month: '2026-08', zusRegime: 'preferencyjny', social: zl(420.86) });
    expect(obs(s, 'zus_spoleczne').map((o) => o.issueDate)).toEqual(['2026-08-31']);
    consistent(s);
  });
});

describe('PIT: zweryfikowane przykłady 2026', () => {
  const inp = { revenue: zl(100_000), costs: 0, socialPaid: 0, healthPaid: 0, ryczaltRateBps: 1_200 };
  it('skala: 12% do 120 000 zł minus 3 600 zł; powyżej 10 800 zł + 32% nadwyżki', () => {
    expect(pitCumulative({ ...inp, form: 'skala', applyReduction: true }).tax).toBe(zl(8_400));
    expect(pitCumulative({ ...inp, form: 'skala', revenue: zl(200_000), applyReduction: true }).tax).toBe(zl(36_400));
    expect(pitCumulative({ ...inp, form: 'skala', revenue: zl(120_000), applyReduction: true }).tax).toBe(zl(10_800));
    expect(pitCumulative({ ...inp, form: 'skala', revenue: zl(3_000), applyReduction: true }).tax).toBe(0); // poniżej kwoty zmniejszającej
  });
  it('skala przy równoległym etacie: brak kwoty zmniejszającej (uproszczenie PIT-SKALA-WITH-EMPLOYMENT)', () => {
    expect(pitCumulative({ ...inp, form: 'skala', applyReduction: false }).tax).toBe(zl(12_000));
  });
  it('skala: składki społeczne obniżają dochód; składka zdrowotna nie', () => {
    const a = pitCumulative({ ...inp, form: 'skala', applyReduction: true, socialPaid: zl(10_000), healthPaid: zl(6_000) });
    expect(a.base).toBe(zl(90_000));
    expect(a.tax).toBe(zl(7_200));
  });
  it('liniowy 19%: odliczenie składki zdrowotnej do limitu 14 100 zł', () => {
    const l = pitCumulative({ ...inp, form: 'liniowy', applyReduction: false, costs: zl(20_000), socialPaid: zl(5_000), healthPaid: zl(20_000) });
    expect(l.base).toBe(zl(100_000 - 20_000 - 5_000 - 14_100));
    expect(l.tax).toBe(mulBps(zl(60_900), 1_900));
    expect(pitCumulative({ ...inp, form: 'liniowy', applyReduction: false, healthPaid: zl(6_000) }).base).toBe(zl(94_000));
  });
  it('ryczałt: podstawa = przychód − składki społeczne − 50% składek zdrowotnych (bez kosztów), stawka 12%', () => {
    const r = pitCumulative({ ...inp, form: 'ryczalt', applyReduction: false, costs: zl(30_000), socialPaid: zl(10_000), healthPaid: zl(6_000) });
    expect(r.base).toBe(zl(87_000));
    expect(r.tax).toBe(zl(10_440));
  });
  it('limit zwolnienia z VAT: 240 000 zł, w roku startu proporcjonalnie do pełnych miesięcy', () => {
    expect(vatExemptionLimit('2026-02-01', 2026)).toBe(zl(220_000));
    expect(vatExemptionLimit('2026-03-01', 2026)).toBe(zl(200_000));
    expect(vatExemptionLimit('2025-05-01', 2026)).toBe(zl(240_000));
  });
});

describe('zaliczki PIT i składki w symulacji (ryczałt 12%, zwolnienie z VAT)', () => {
  it('luty: sprzedaż 20 000 zł → zaliczka 2 400 zł i składka 498,35 zł do 20 marca; w marcu zaliczki nie ma (metoda narastająca, odliczono zapłaconą składkę)', () => {
    let s = withDoc(started(), 'sales', zl(20_000));
    s = advanceDays(s, 28); // 1 marca
    expect(period(s, '2026-02')).toMatchObject({ revenue: zl(20_000), taxBase: zl(20_000), taxCumulative: zl(2_400), advance: zl(2_400) });
    expect(obs(s, 'pit_zaliczka')[0]).toMatchObject({ amount: zl(2_400), dueDate: '2026-03-20', counterpartyId: 'party:us' });
    expect(obs(s, 'zus_zdrowotna')[0]).toMatchObject({ amount: zl(498.35), dueDate: '2026-03-20' });
    s = advanceDays(s, 31); // 1 kwietnia: marzec zamknięty
    const base = roundZl(zl(20_000) - roundDiv(zl(498.35) * 5_000, 10_000)); // podstawa do pełnych złotych (PIT-ROUNDING)
    expect(period(s, '2026-03')).toMatchObject({ taxBase: base, taxCumulative: roundZl(roundDiv(base * 1_200, 10_000)), advance: 0, advanceSkipped: false });
    expect(obs(s, 'pit_zaliczka')).toHaveLength(1);
    consistent(s);
  });

  it('zaliczka ≤ 1 000 zł nie jest wpłacana i kumuluje się w następnej', () => {
    let s = withDoc(started(), 'sales', zl(5_000)); // podatek 600 zł
    s = advanceDays(s, 28);
    expect(period(s, '2026-02')).toMatchObject({ taxCumulative: zl(600), advance: 0, advanceSkipped: true });
    expect(obs(s, 'pit_zaliczka')).toHaveLength(0);
    s = advanceDays(s, 2); // 3 marca
    s = withDoc(s, 'sales', zl(5_000));
    s = advanceDays(s, diffDays('2026-04-01', s.clock.today));
    const mar = period(s, '2026-03');
    expect(mar.advanceSkipped).toBe(false);
    expect(mar.advance).toBe(mar.taxCumulative); // wcześniej niewpłacone 600 zł wchodzi do zaliczki
    expect(mar.advance).toBeGreaterThan(zl(1_000));
  });

  it('rozliczenie roczne: niewpłacona reszta ≤ 1 000 zł płatna do 30 kwietnia następnego roku; brak podwójnego naliczenia', () => {
    let s = started({}, 6_000);
    s = advanceDays(s, diffDays('2026-12-03', s.clock.today));
    s = withDoc(s, 'sales', zl(5_000));
    s = advanceDays(s, diffDays('2027-01-01', s.clock.today));
    const annual = obs(s, 'pit_roczny');
    expect(period(s, '2026-12').advanceSkipped).toBe(true);
    expect(annual).toHaveLength(1);
    expect(annual[0]).toMatchObject({ dueDate: '2027-04-30', scope: 'business' });
    expect(annual[0]!.amount).toBe(period(s, '2026-12').taxCumulative); // 600 zł − odliczenia zapłaconych składek = pełna kwota roczna
    const again = structuredClone(s);
    processDay(again, '2026-12-31'); // powtórne przetworzenie dnia z zamknięciem miesiąca
    expect(obs(again, 'pit_roczny')).toHaveLength(1);
    expect(again.taxPeriods).toHaveLength(s.taxPeriods.length);
  });

  it('skala przy równoległym etacie: ostrzeżenie w podglądzie, brak kwoty zmniejszającej w obliczeniu', () => {
    const s = game();
    const prev = commands.registerBusiness(s, { ...REG, taxForm: 'skala' });
    expect(prev.ok).toBe(true);
    let t = withDoc(started({ taxForm: 'skala' }), 'sales', zl(20_000));
    t = advanceDays(t, 28);
    expect(period(t, '2026-02').ruleIds).toContain('PIT-SKALA-WITH-EMPLOYMENT');
    expect(period(t, '2026-02').taxCumulative).toBe(mulBps(zl(20_000), 1_200)); // bez odjęcia 3 600 zł
  });
});

describe('VAT', () => {
  it('zwolnienie podmiotowe: dokument bez VAT (netto = brutto), brak zobowiązań VAT', () => {
    const s = withDoc(started(), 'sales', zl(5_000));
    const d = s.documents[0]!;
    expect(d).toMatchObject({ vatTreatment: 'exempt', vat: 0, net: zl(5_000), gross: zl(5_000), number: 'FS/2026/02/001' });
    expect(d.obligationIds).toHaveLength(1);
    expect(s.obligations.some((o) => o.category === 'vat_nalezny')).toBe(false);
    consistent(s);
  });

  it('czynny podatnik: VAT 23% — należność od klienta + osobne zobowiązanie VAT należny do 25. następnego miesiąca; koszt z VAT naliczonym', () => {
    let s = withDoc(started({ vatStatus: 'active' }), 'sales', zl(10_000));
    s = withDoc(s, 'cost', zl(1_000));
    const sale = s.documents.find((d) => d.kind === 'sales')!;
    const cost = s.documents.find((d) => d.kind === 'cost')!;
    expect(sale).toMatchObject({ vatTreatment: 'taxed', vat: zl(2_300), gross: zl(12_300), vatRateBps: 2_300 });
    expect(cost).toMatchObject({ vat: zl(230), gross: zl(1_230), taxAmount: zl(1_000) }); // koszt podatkowy netto
    expect(obs(s, 'vat_od_klienta')[0]!.amount).toBe(zl(2_300));
    expect(obs(s, 'vat_nalezny')[0]).toMatchObject({ amount: zl(2_300), dueDate: '2026-03-25', counterpartyId: 'party:us' });
    expect(obs(s, 'vat_naliczony')[0]).toMatchObject({ direction: 'receivable', amount: zl(230), dueDate: '2026-03-25' });
    consistent(s);
  });

  it('przychód podatkowy to kwota netto także przy czynnym VAT (VAT nie jest przychodem)', () => {
    let s = withDoc(started({ vatStatus: 'active' }), 'sales', zl(10_000));
    s = advanceDays(s, 28);
    expect(period(s, '2026-02').revenue).toBe(zl(10_000));
    expect(businessSummaries(s).find((m) => m.month === '2026-02')!.revenue).toBe(zl(10_000)); // bez VAT w podsumowaniu firmy
  });

  it('podatnik zwolniony nie odlicza VAT z kosztów — koszt brutto jest kosztem podatkowym', () => {
    const s = withDoc(started(), 'cost', zl(1_000));
    expect(s.documents[0]).toMatchObject({ vatTreatment: 'exempt', vat: 0, gross: zl(1_000), taxAmount: zl(1_000) });
  });

  it('przekroczenie limitu: zwolnienie traci moc od czynności przekraczającej limit (220 000 zł przy starcie 1 lutego)', () => {
    let s = started({}, 6_000);
    s = withDoc(s, 'sales', zl(200_000));
    expect(activeBusiness(s)!.vat.status).toBe('exempt');
    s = withDoc(s, 'sales', zl(30_000)); // 230 000 > 220 000
    const last = s.documents.at(-1)!;
    expect(activeBusiness(s)!.vat).toMatchObject({ status: 'active', limitExceededOn: '2026-02-01' });
    expect(s.documents[0]!.vatTreatment).toBe('exempt'); // wcześniejsza sprzedaż pozostaje zwolniona
    expect(last).toMatchObject({ vatTreatment: 'taxed', vat: zl(6_900), net: zl(30_000) });
    expect(s.events.some((e) => e.type === 'business.vat')).toBe(true);
    const next = withDoc(s, 'sales', zl(1_000));
    expect(next.documents.at(-1)!.vatTreatment).toBe('taxed');
    consistent(next);
  });
});

/** Wstrzykuje ofertę zlecenia (deterministyczny test zamiast losowego rynku). */
function withOffer(state: GameState, templateKey: 'it-strona' | 'sp-biuro' = 'it-strona'): GameState {
  const s = structuredClone(state);
  s.parties['party:client:test'] ??= { id: 'party:client:test', name: 'Klient testowy', role: 'service' };
  s.parties['party:supplier'] ??= { id: 'party:supplier', name: 'Dostawcy', role: 'service' };
  const offer: ServiceOffer = templateKey === 'it-strona'
    ? { id: 'offer:test', templateId: 'it-strona', clientId: 'party:client:test', title: 'Strona internetowa', description: 'x', netValue: zl(6_000), hoursTotal: 40, costNet: zl(200), paymentTermDays: 14, deadlineDays: 30, latePenaltyBps: 1_000, offeredOn: s.clock.today, expiresOn: addDays(s.clock.today, 14), status: 'open' }
    : { id: 'offer:test', templateId: 'sp-biuro', clientId: 'party:client:test', title: 'Sprzątanie', description: 'x', netValue: zl(2_000), hoursTotal: 20, costNet: 0, paymentTermDays: 14, deadlineDays: 14, latePenaltyBps: 1_000, offeredOn: s.clock.today, expiresOn: addDays(s.clock.today, 14), status: 'open' };
  s.serviceOffers.push(offer);
  return s;
}

describe('zlecenia usługowe, budżet czasu i płatności', () => {
  it('oferty pojawiają się deterministycznie 1. i 16. dnia miesiąca, max 3 otwarte, wygasają po 14 dniach', () => {
    const a = advanceDays(started(), 120);
    const b = advanceDays(started(), 120);
    expect(a.serviceOffers).toEqual(b.serviceOffers);
    expect(a.serviceOffers.length).toBeGreaterThan(0);
    expect(a.serviceOffers.every((o) => ['01', '16'].includes(o.offeredOn.slice(8)))).toBe(true);
    expect(a.serviceOffers.filter((o) => o.status === 'open').length).toBeLessThanOrEqual(3);
    const old = a.serviceOffers.filter((o) => o.expiresOn < a.clock.today);
    expect(old.every((o) => o.status !== 'open')).toBe(true);
    expect(new Set(a.serviceOffers.map((o) => o.id)).size).toBe(a.serviceOffers.length);
  });

  it('realizacja korzysta ze wspólnego budżetu czasu: nie mieści się w godzinach etatu, snu i obowiązków', () => {
    const s = withOffer(started());
    expect(budgetFor(s, '2026-02-03').free).toBe(4); // dzień roboczy: 24 − 8 praca − 8 sen − 4 obowiązki
    const tooMuch = commands.acceptServiceOffer(s, 'offer:test', 5);
    expect(tooMuch).toMatchObject({ ok: false, error: expect.stringContaining('Brak wolnych godzin') });
    const fits = ok(commands.acceptServiceOffer(s, 'offer:test', 4));
    expect(budgetFor(fits, '2026-02-03').free).toBe(0); // te same godziny nie mogą służyć dwóm czynnościom
    expect(budgetFor(fits, '2026-02-03').work).toBe(8); // godziny etatowe nietknięte
    expect(commands.setTimePlan(fits, { sleepHours: 9, businessHours: 0 })).toMatchObject({ ok: false }); // plan nie zmieści się z zleceniem
  });

  it('zbyt mała liczba godzin dziennie względem terminu jest odrzucana', () => {
    const s = withOffer(started());
    expect(commands.acceptServiceOffer(s, 'offer:test', 1)).toMatchObject({ ok: false, error: expect.stringContaining('zbyt długo') });
    expect(commands.acceptServiceOffer(s, 'offer:test', 9)).toMatchObject({ ok: false });
  });

  it('nie można świadczyć usług dla własnego pracodawcy', () => {
    const s = withOffer(started());
    s.serviceOffers.find((o) => o.id === 'offer:test')!.clientId = 'party:employer';
    expect(commands.acceptServiceOffer(s, 'offer:test', 4)).toMatchObject({ ok: false, error: expect.stringContaining('pracodawc') });
  });

  it('przychód, należność i zapłata są odrębnymi zdarzeniami: dokument w dniu wykonania, wpływ dopiero w terminie (z opóźnieniem klienta)', () => {
    let s = ok(commands.acceptServiceOffer(withOffer(started()), 'offer:test', 4));
    expect(s.documents.filter((d) => d.kind === 'cost')).toHaveLength(1); // koszt realizacji naliczony przy przyjęciu
    for (let i = 0; i < 40 && s.serviceOrders[0]!.status === 'in_progress'; i++) s = advanceDays(s, 1); // 4 godz./dzień męczą — wydajność spada, więc trwa dłużej niż nominalne 10 dni
    const order = s.serviceOrders[0]!;
    expect(order.status).toBe('completed');
    const doc = s.documents.find((d) => d.id === order.salesDocumentId)!;
    expect(doc.issueDate).toBe(order.completedOn);
    expect(doc.termDate).toBe(addDays(doc.issueDate, 14));
    const rec = s.obligations.find((o) => o.id === doc.obligationIds[0])!;
    const delay = paymentDelayDays(s.seed, doc.id);
    expect(rec.dueDate).toBe(addDays(doc.termDate, delay)); // zapłata po terminie umownym o `delay` dni
    expect(s.ledger.some((t) => t.obligationId === rec.id)).toBe(false); // przychód już jest, gotówki jeszcze nie
    const paid = advanceDays(s, diffDays(rec.dueDate, s.clock.today) + 1);
    expect(paid.obligations.find((o) => o.id === rec.id)!.status).toBe('settled');
    expect(paid.ledger.find((t) => t.obligationId === rec.id)!.accountId).toBe(activeBusiness(paid)!.accountId);
    consistent(paid);
  });

  it('opóźnienie płatności jest deterministyczne i zróżnicowane (0 do 35 dni)', () => {
    const delays = Array.from({ length: 200 }, (_, i) => paymentDelayDays('seed', `doc-${i}`));
    expect(delays).toEqual(Array.from({ length: 200 }, (_, i) => paymentDelayDays('seed', `doc-${i}`)));
    expect(Math.min(...delays)).toBe(0);
    expect(Math.max(...delays)).toBeLessThanOrEqual(35);
    expect(delays.filter((d) => d > 0).length).toBeGreaterThan(40);
  });

  it('wyczerpanie obniża wydajność: zlecenie kończy się po terminie, kara umowna zmniejsza fakturę', () => {
    const s0 = structuredClone(withOffer(started({}, 6_000), 'sp-biuro'));
    s0.life.fatigue = 100;
    let s = ok(commands.setTimePlan(s0, { sleepHours: 6, businessHours: 0 }));
    s = ok(commands.acceptServiceOffer(s, 'offer:test', 2)); // 20 godz.: nominalnie 10 dni, termin 14
    s = advanceDays(s, 30);
    const o = s.serviceOrders[0]!;
    expect(o).toMatchObject({ status: 'completed', late: true });
    expect(o.completedOn! > o.deadline).toBe(true);
    expect(s.documents.find((d) => d.id === o.salesDocumentId)!.net).toBe(zl(2_000) - mulBps(zl(2_000), 1_000)); // −10%
    consistent(s);
  });

  it('wypoczęty wykonawca kończy w terminie bez kary', () => {
    let s = ok(commands.acceptServiceOffer(withOffer(started({}, 6_000), 'sp-biuro'), 'offer:test', 2));
    s = advanceDays(s, 14);
    expect(s.serviceOrders[0]).toMatchObject({ status: 'completed', late: false });
    expect(s.documents.find((d) => d.kind === 'sales')!.net).toBe(zl(2_000));
  });
});

describe('dokumenty i terminy obowiązków', () => {
  it('numeracja sekwencyjna w miesiącu, unikalne identyfikatory, powiązanie ze zleceniem', () => {
    let s = withDoc(started(), 'sales', zl(1_000));
    s = withDoc(s, 'sales', zl(2_000));
    s = withDoc(s, 'cost', zl(100));
    expect(s.documents.map((d) => d.number)).toEqual(['FS/2026/02/001', 'FS/2026/02/002', 'FK/2026/02/001']);
    expect(new Set(s.documents.map((d) => d.id)).size).toBe(3);
    const order = ok(commands.acceptServiceOffer(withOffer(started()), 'offer:test', 4));
    expect(order.documents[0]).toMatchObject({ kind: 'cost', orderId: order.serviceOrders[0]!.id });
  });

  it('terminy: ZUS i PIT do 20., VAT do 25. następnego miesiąca; styczeń → 20 stycznia', () => {
    let s = withDoc(started({ vatStatus: 'active' }), 'sales', zl(10_000));
    s = advanceDays(s, diffDays('2027-01-01', s.clock.today)); // przez cały 2026
    const dec = (cat: string) => obs(s, cat).find((o) => o.issueDate === '2026-12-31');
    expect(dec('zus_zdrowotna')!.dueDate).toBe('2027-01-20');
    expect(obs(s, 'vat_nalezny')[0]!.dueDate).toBe('2026-03-25');
    expect(obs(s, 'pit_zaliczka')[0]!.dueDate).toBe('2026-03-20');
  });

  it('niezapłacone składki (brak środków na rachunku firmowym) stają się zaległością — firma wymaga finansowania właściciela', () => {
    let s = started({}, 0 + 1); // prawie puste konto firmy
    s = advanceDays(s, 60);
    expect(s.obligations.some((o) => o.scope === 'business' && o.overdueSince !== null)).toBe(true);
    // wkład własny pozwala je zapłacić
    const fixed = advanceDays(ok(commands.transferFunds(s, s.playerAccountId, activeBusiness(s)!.accountId, zl(2_000))), 3);
    expect(fixed.obligations.filter((o) => o.scope === 'business' && o.status === 'open' && o.overdueSince !== null)).toHaveLength(0);
  });
});

describe('rejestr reguł prawnych', () => {
  it('każda reguła ma źródło urzędowe, datę weryfikacji i status; tylko VERIFIED/SIMPLIFIED/DEFERRED', () => {
    expect(LEGAL_RULES.length).toBeGreaterThan(30);
    for (const r of LEGAL_RULES) {
      expect(r.source).toMatch(/^https:\/\/(www\.)?(podatki|biznes|zus)\.gov\.pl|^https:\/\/(www\.)?zus\.pl|^https:\/\/(podatki-arch|eureka)\.mf\.gov\.pl|^https:\/\/api\.sejm\.gov\.pl/); // urzędowe: MF (archiwum serwisu, interpretacje), Sejm (ISAP)
      expect(r.verifiedOn).toBe('2026-10-18');
      expect(['VERIFIED', 'SIMPLIFIED', 'DEFERRED']).toContain(r.status);
      expect(r.note.length).toBeGreaterThan(5);
    }
    expect(new Set(LEGAL_RULES.map((r) => r.id)).size).toBe(LEGAL_RULES.length);
    for (const id of ['VAT-KSEF-ADVANCED', 'PIT-RELIEFS', 'PIT-LOSS-ONETIME', 'ZUS-VACATION']) expect(LEGAL_RULES.find((r) => r.id === id)!.status).toBe('DEFERRED');
  });

  it('wszystkie reguły użyte w rozliczeniach istnieją w rejestrze', () => {
    let s = withDoc(started(), 'sales', zl(20_000));
    s = advanceDays(s, 60);
    const known = new Set(LEGAL_RULES.map((r) => r.id));
    for (const p of s.taxPeriods) for (const id of p.ruleIds) expect(known.has(id), id).toBe(true);
  });
});

describe('gra przez 24 miesiące z JDG równolegle z etatem', () => {
  function play(seed: string, events: boolean): GameState {
    let s = fund(reg(game(seed, events), { taxForm: 'ryczalt', zusStart: 'ulga', sickness: false }), zl(10_000));
    s = advanceDays(s, diffDays('2026-02-01', s.clock.today));
    const bid = activeBusiness(s)!.accountId;
    s = ok(commands.transferFunds(s, s.playerAccountId, bid, zl(3_000)));
    for (let m = 0; m < 24; m++) {
      for (let h = 1; h <= 4; h++) {
        const offer = s.serviceOffers.find((o) => o.status === 'open');
        if (!offer) break;
        const r = commands.acceptServiceOffer(s, offer.id, h);
        if (r.ok) { s = r.state; break; }
      }
      s = advanceToNextMonth(s);
      const spare = s.accounts[bid]!.balance - zl(2_500);
      if (spare > zl(500)) s = ok(commands.transferFunds(s, bid, s.playerAccountId, Math.floor(spare / 100) * 100)); // pobranie właściciela
      else if (s.accounts[s.playerAccountId]!.balance > zl(2_500) && s.accounts[bid]!.balance < zl(1_500)) s = ok(commands.transferFunds(s, s.playerAccountId, bid, zl(1_000))); // wkład
      expect(checkInvariants(s), `po miesiącu ${m + 1} (${s.clock.today})`).toEqual([]);
    }
    return s;
  }

  it('24 miesiące: spójne finanse, ciągłe rozliczenia miesięczne, dokumenty i płatności bez dubli', () => {
    const s = play('jdg-24', false);
    expect(s.clock.today).toBe('2028-02-01');
    expect(s.taxPeriods.map((p) => p.month)).toHaveLength(24); // luty 2026 – styczeń 2028
    expect(s.taxPeriods[0]!.month).toBe('2026-02');
    expect(s.taxPeriods.at(-1)!.month).toBe('2028-01');
    expect(s.taxPeriods.every((p) => p.zusRegime === 'etat')).toBe(true); // etat ≥ minimalnego wynagrodzenia
    expect(s.taxPeriods.slice(12).every((p) => p.carriedForward)).toBe(true); // 2027+ : reguły z 2026 przeniesione (oznaczone)
    expect(s.documents.filter((d) => d.kind === 'sales').length).toBeGreaterThan(5);
    expect(s.obligations.filter((o) => o.category === 'zus_zdrowotna' && o.description.startsWith('Składka zdrowotna'))).toHaveLength(24); // + dopłaty roczne za 2026 i 2027 jako osobne zobowiązania
    expect(new Set(s.ledger.map((t) => t.id)).size).toBe(s.ledger.length);
    expect(s.obligations.filter((o) => o.category === 'pit_roczny').length).toBeLessThanOrEqual(2);
    const bySales = s.documents.filter((d) => d.kind === 'sales').map((d) => d.number);
    expect(new Set(bySales).size).toBe(bySales.length);
  }, 30_000);

  it('deterministyczność: ten sam seed daje identyczny stan; wydarzenia życiowe nie psują spójności', () => {
    const a = play('jdg-det', false);
    expect(play('jdg-det', false)).toEqual(a);
    const withEvents = play('jdg-events', true);
    expect(checkInvariants(withEvents)).toEqual([]);
  }, 60_000);
});
