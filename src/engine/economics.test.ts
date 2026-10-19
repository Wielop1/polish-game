import { describe, expect, it } from 'vitest';
import { commands } from './commands.ts';
import { checkInvariants } from './invariants.ts';
import { zl } from './money.ts';
import { crewKey, defaultQuoteInput, jobFinancials, previewQuote } from './renovation.ts';
import { advanceDays } from './simulate.ts';
import { buyAll, contract, craftEnquiry, hireEmployee, ok, opsGame, runUntil } from './testkit.ts';
import { company, companyHire, companyView, companyWithOps } from './corpkit.ts';
import { withOperator } from './operator.ts';

/** v0.8.1 — rzeczywisty zarobek przedsiębiorcy: przychód, koszty rzeczywiste, kalkulacyjna praca właściciela, zysk ekonomiczny, gotówka. */
const solo = (price = zl(3_000), extra: Record<string, unknown> = {}) => {
  const s = opsGame({ seed: 'econ-1' });
  const enq = craftEnquiry(structuredClone(s), { units: 60 });
  const base = defaultQuoteInput(s, enq);
  return { s, input: { ...base, priceNet: price, hoursPerDay: 6, durationDays: 14, ...extra } };
};

describe('rozdzielenie przychodu, kosztów rzeczywistych i pracy właściciela', () => {
  it('praca solo: koszty rzeczywiste nie zawierają pracy właściciela; nadwyżka − kalkulacyjna praca = zysk ekonomiczny; stawka godzinowa z nadwyżki', () => {
    const { s, input } = solo();
    const p = previewQuote(s, input);
    const e = p.economics;
    expect(e.external.hiredLabor).toBe(0);
    expect(e.ownerLabor).toBe(p.planned.labor);
    expect(e.external.total).toBe(e.external.materials + e.external.transport + e.external.other + e.external.equipmentWear);
    expect(e.surplusBeforeOwner).toBe(input.priceNet - e.external.total);
    expect(e.economicProfit).toBe(e.surplusBeforeOwner - e.ownerLabor);
    expect(e.ownerCenti).toBe(p.plannedCenti);
    expect(e.ownerHourly).toBe(Math.round((e.surplusBeforeOwner * 100) / p.plannedCenti));
    // plan kosztów (`total`) nadal zawiera kalkulacyjną pracę — to wartość porównawcza, nie wydatek
    expect(p.planned.total).toBe(p.planned.materials + p.planned.labor + p.planned.transport + p.planned.other);
    expect(p.planned.ownerLabor).toBe(e.ownerLabor);
  });

  it('ekipa z pracownikiem i właścicielem na nadzorze 0 godz.: płace pracownika to koszt rzeczywisty, a praca właściciela = 0 (zarobek za godzinę nie dotyczy)', () => {
    let s = opsGame({ seed: 'econ-2' });
    s = hireEmployee(s, { expected: zl(5_400), start: '2026-03-01' }).s;
    const e = s.ops.employments.at(-1)!;
    s = ok(commands.createTeam(s, 'Ekipa', [{ kind: 'employee', id: e.id }]));
    const teamId = s.ops.teams.at(-1)!.id;
    s = advanceDays(s, 30);
    const enq = craftEnquiry(structuredClone(s), { units: 60 });
    const base = defaultQuoteInput(s, enq);
    const hands = previewQuote(s, { ...base, teamId, supervision: 'hands-off', priceNet: zl(5_000), durationDays: 20, hoursPerDay: 4 });
    expect(hands.economics.external.hiredLabor).toBeGreaterThan(0);
    expect(hands.economics.ownerLabor).toBe(0);
    expect(hands.economics.ownerHourly).toBeNull();
    expect(hands.economics.economicProfit).toBe(hands.economics.surplusBeforeOwner);
    const sup = previewQuote(s, { ...base, teamId, supervision: 'supervise', priceNet: zl(5_000), durationDays: 20, hoursPerDay: 4 });
    expect(sup.economics.ownerLabor).toBeGreaterThan(0); // nadzór 1 godz. dziennie to czas właściciela
    expect(sup.economics.ownerCenti).toBeGreaterThan(0);
    expect(sup.economics.external.hiredLabor).toBe(hands.economics.external.hiredLabor); // płace nie mieszają się z pracą właściciela
    // wspólna ekipa: właściciel + pracownik — płace pracownika zostają kosztem rzeczywistym, praca właściciela osobno
    const mixed = previewQuote(s, { ...base, teamId: crewKey([{ kind: 'owner', id: 'owner' }, { kind: 'employee', id: e.id }]), priceNet: zl(5_000), durationDays: 20, hoursPerDay: 4 });
    expect(mixed.economics.external.hiredLabor).toBeGreaterThan(0);
    expect(mixed.economics.ownerLabor).toBeGreaterThan(0);
    expect(mixed.planned.labor).toBe(mixed.economics.external.hiredLabor + mixed.economics.ownerLabor);
  });

  it('ostrzeżenia rozróżniają stratę gotówkową od ujemnego zysku ekonomicznego (to nie to samo)', () => {
    const { s, input } = solo();
    const e0 = previewQuote(s, input).economics;
    const justAbove = previewQuote(s, { ...input, priceNet: e0.external.total + 100 }); // firma nie dopłaca, ale praca „kosztuje” więcej
    expect(justAbove.economics.surplusBeforeOwner).toBeGreaterThan(0);
    expect(justAbove.economics.economicProfit).toBeLessThan(0);
    expect(justAbove.warnings.some((w) => /Firma nie dopłaca/.test(w))).toBe(true);
    expect(justAbove.warnings.some((w) => /Strata gotówkowa/.test(w))).toBe(false);
    const loss = previewQuote(s, { ...input, priceNet: Math.max(1, e0.external.total - 1_000) });
    expect(loss.economics.surplusBeforeOwner).toBeLessThan(0);
    expect(loss.warnings.some((w) => /Strata gotówkowa/.test(w))).toBe(true);
  });

  it('płynność: zaliczka, wydatki przed zapłatą i data zapłaty końcowej wynikają z warunków oferty', () => {
    const { s, input } = solo(zl(3_000));
    const a = previewQuote(s, { ...input, advanceBps: 2_000, paymentTermDays: 21 }).economics.liquidity;
    const b = previewQuote(s, { ...input, advanceBps: 0, paymentTermDays: 7 }).economics.liquidity;
    expect(a.advance).toBeGreaterThan(0);
    expect(b.advance).toBe(0);
    expect(a.finalPaymentDate > b.finalPaymentDate).toBe(true);
    expect(a.advance + a.finalPayment).toBe(b.finalPayment); // brutto: zaliczka + reszta = cała kwota
    expect(a.peakNeed).toBe(Math.max(0, a.cashOutBeforePayment - a.advance));
    expect(a.daysExposed).toBe(input.durationDays + 21);
  });
});

describe('praca właściciela nie jest wypłatą ani kosztem podatkowym', () => {
  it('kontrakt solo: gotówka firmy zmienia się o przychód − wydatki na materiały/transport/drobne; brak dokumentu kosztowego i przepływu za pracę własną', () => {
    const { s: s0, input } = solo(zl(3_000));
    const c = contract(s0, { enquiry: { units: 60 }, quote: { ...input, hoursPerDay: 3, durationDays: 25, advanceBps: 0, paymentTermDays: 7 } });
    let s = buyAll(c.s, c.job.id);
    s = runUntil(s, (x) => x.reno.jobs.find((j) => j.id === c.job.id)!.stage === 'done' && x.obligations.every((o) => o.status === 'settled' || o.direction === 'payable' && o.dueDate > x.clock.today), 160);
    s = advanceDays(s, 12);
    const job = s.reno.jobs.find((j) => j.id === c.job.id)!;
    expect(job.stage).toBe('done');
    const f = jobFinancials(job);
    // żaden dokument kosztowy kontraktu nie reprezentuje robocizny właściciela
    const costDocs = s.documents.filter((d) => d.orderId === job.orderId && d.kind === 'cost');
    expect(costDocs.some((d) => /robocizn|wynagrodzen|praca własna/i.test(d.description))).toBe(false);
    expect(s.ledger.some((t) => /praca_wlasna|wlasna_robocizna/.test(t.category))).toBe(false);
    // przepływy kontraktu: dokumenty sprzedaży = cena po karze, dokumenty kosztowe = tylko transport i drobne (materiały kupiono wcześniej do zapasu) — nic za pracę własną
    const sales = s.documents.filter((d) => d.orderId === job.orderId && d.kind === 'sales').reduce((a, d) => a + d.net, 0);
    const costs = s.documents.filter((d) => d.orderId === job.orderId && d.kind === 'cost').reduce((a, d) => a + d.net, 0);
    expect(sales).toBe(job.priceNet - job.penaltyNet);
    expect(costs).toBe(job.actual.transport + job.actual.other);
    expect(costs).toBeLessThan(f.actualLaborValue + costs); // wartość pracy właściciela nie weszła do kosztów dokumentowanych
    expect(f.actualLaborValue).toBeGreaterThan(0);
    expect(f.surplusBeforeOwner).toBe(f.revenueNet - f.externalCost);
    expect(f.economicProfit).toBe(f.surplusBeforeOwner - f.actualLaborValue);
    expect(f.economicResult).toBe(f.revenueNet - (f.externalCost - f.equipmentWear));
    expect(checkInvariants(s)).toEqual([]);
  }, 120_000);

  it('kontrakt: koszt podatkowy (dokumenty kosztowe) obejmuje wydatki zewnętrzne, a nie kalkulacyjną pracę; zysk ekonomiczny ≠ dochód podatkowy', () => {
    const { s: s0, input } = solo(zl(3_000));
    const c = contract(s0, { enquiry: { units: 60 }, quote: { ...input, hoursPerDay: 3, durationDays: 25, advanceBps: 0, paymentTermDays: 7 } });
    let s = buyAll(c.s, c.job.id);
    s = runUntil(s, (x) => x.reno.jobs.find((j) => j.id === c.job.id)!.stage === 'done', 160);
    const job = s.reno.jobs.find((j) => j.id === c.job.id)!;
    const docs = s.documents.filter((d) => d.orderId === job.orderId);
    const taxCost = docs.filter((d) => d.kind === 'cost').reduce((a, d) => a + d.taxAmount, 0);
    const taxRevenue = docs.filter((d) => d.kind === 'sales').reduce((a, d) => a + d.taxAmount, 0);
    const f = jobFinancials(job);
    // przychód podatkowy = cena kontraktu (po karze); koszty podatkowe kontraktu = transport + drobne (materiały księgowane przy zakupie w zapasie)
    expect(taxRevenue).toBe(job.priceNet - job.penaltyNet);
    expect(taxCost).toBeLessThan(f.actualLaborValue + f.externalCost);
    expect(taxCost).toBeLessThanOrEqual(job.actual.transport + job.actual.other);
  }, 120_000);
});

describe('spółka z o.o.: praca wspólnika nie jest wynagrodzeniem ani przepływem', () => {
  it('właściciel nie jest wykonawcą w spółce (brak umowy, art. 210 KSH): wycena samodzielna jest blokowana, a wycena z pracownikami nie ma kalkulacyjnej pracy właściciela', () => {
    let s = companyWithOps({ seed: 'econ-co', capital: zl(120_000), vat: 'exempt', equip: ['paint-basic', 'paint-basic'] });
    const { s: s1, emp } = companyHire(s);
    s = ok(commands.createTeam(s1, 'Ekipa spółki', [{ kind: 'employee', id: emp.id }]));
    const teamId = company(s).slices.ops.teams.at(-1)!.id;
    s = advanceDays(s, 5);
    const view = companyView(s);
    const enq = withOperator(structuredClone(s), 'co:1', () => craftEnquiry(structuredClone(view), { units: 60 }));
    const base = defaultQuoteInput(view, enq);
    const solo = previewQuote(view, { ...base, teamId: null, supervision: 'worker', priceNet: zl(4_000), durationDays: 20 });
    expect(solo.errors.some((e) => /nie ma właściciela-wykonawcy/.test(e))).toBe(true);
    const crew = previewQuote(view, { ...base, teamId, supervision: 'hands-off', priceNet: zl(4_000), durationDays: 25, hoursPerDay: 1 });
    expect(crew.economics.ownerLabor).toBe(0);
    expect(crew.economics.ownerHourly).toBeNull();
    expect(crew.economics.external.hiredLabor).toBeGreaterThan(0);
    // żadne przepływy z tytułu „pracy wspólnika” nie trafiają do gracza: konto prywatne nie dostaje wpłat od spółki poza kapitałem, dywidendą i transakcjami na udziałach
    const toPlayer = s.ledger.filter((t) => t.accountId === s.playerAccountId && t.amount > 0 && /wynagrodzenie|praca|zlecenie/i.test(t.category));
    expect(toPlayer.filter((t) => t.counterpartyId && String(t.counterpartyId).includes('co:'))).toEqual([]);
    expect(checkInvariants(s)).toEqual([]);
  }, 120_000);
});
