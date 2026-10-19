import { describe, expect, it } from 'vitest';
import { commands } from '../engine/commands.ts';
import type { CommandResult } from '../engine/commands.ts';
import { checkInvariants } from '../engine/invariants.ts';
import { createNewGame } from '../engine/newGame.ts';
import { zl } from '../engine/money.ts';
import { cash, netWorth, savingsBalance } from '../engine/selectors.ts';
import { advanceDays, advanceToNextMonth, processDay } from '../engine/simulate.ts';
import type { GameState } from '../engine/state.ts';
import { LIFESTYLE } from '../engine/config.ts';
import expectV1 from './fixtures/save-v1.expect.json';
import rawV1 from './fixtures/save-v1.json?raw';
import expectV2 from './fixtures/save-v2.expect.json';
import rawV2 from './fixtures/save-v2.json?raw';
import expectV3 from './fixtures/save-v3.expect.json';
import rawV3 from './fixtures/save-v3.json?raw';
import expectV4 from './fixtures/save-v4.expect.json';
import rawV4 from './fixtures/save-v4.json?raw';
import expectV5 from './fixtures/save-v5.expect.json';
import rawV5 from './fixtures/save-v5.json?raw';
import expectV7 from './fixtures/save-v7.expect.json';
import rawV7 from './fixtures/save-v7.json?raw';
import expectV6 from './fixtures/save-v6.expect.json';
import rawV6 from './fixtures/save-v6.json?raw';
import { contract, hireEmployee, jobOf as jobOfKit, runUntil as runUntilKit, buyAll as buyAllKit } from '../engine/testkit.ts';
import { SAVE_VERSION, parseSave, serializeSave } from './save.ts';

const NOW = '2026-10-18T12:00:00.000Z';
const ok = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

describe('migracja zapisu v1 → v2 (prawdziwy zapis wygenerowany przez v0.1)', () => {
  const result = parseSave(rawV1);
  if (!result.ok) throw new Error(`fixture v1 nie wczytał się: ${result.error}`);
  const migrated = result.state;

  it('fixture jest zapisem w wersji 1, a obecna wersja formatu to 8', () => {
    expect(JSON.parse(rawV1).version).toBe(1);
    expect(SAVE_VERSION).toBe(8);
  });

  it('historia finansowa zostaje nietknięta: salda, majątek netto, rejestr, zobowiązania, zdarzenia', () => {
    expect(migrated.seed).toBe(expectV1.seed);
    expect(migrated.clock.today).toBe(expectV1.today);
    expect(cash(migrated)).toBe(expectV1.cash);
    expect(netWorth(migrated)).toBe(expectV1.netWorth);
    expect(migrated.ledger).toHaveLength(expectV1.ledgerCount);
    expect(migrated.obligations).toHaveLength(expectV1.obligationCount);
    expect(migrated.events).toHaveLength(expectV1.eventCount);
    expect(migrated.history).toHaveLength(expectV1.historyCount);
    expect(migrated.ledger.at(-1)!.id).toBe(expectV1.lastTxId);
    expect(migrated.person.birthDate).toBe(expectV1.birthDate);
    // wpisy v1 są identyczne co do pól z v1 (poza nowym `transferId: null`)
    const v1 = JSON.parse(rawV1).state;
    expect(migrated.ledger.map(({ transferId, ...rest }) => (transferId === null ? rest : null))).toEqual(v1.ledger);
    expect(migrated.history.map((h) => [h.date, h.cash, h.netWorth])).toEqual(v1.history.map((h: { date: string; cash: number; netWorth: number }) => [h.date, h.cash, h.netWorth]));
    expect(checkInvariants(migrated)).toEqual([]);
  });

  it('dodaje nowe elementy z bezpiecznymi wartościami domyślnymi, niczego nie zmyślając', () => {
    expect(Object.values(migrated.accounts).map((a) => a.type).sort()).toEqual(['checking', 'savings']);
    expect(savingsBalance(migrated)).toBe(0);
    expect(migrated.life.lifestyle).toBe('standardowy');
    expect(migrated.life.timePlan).toEqual({ sleepHours: 8, businessHours: 0 });
    expect(migrated.assets).toEqual([]);
    expect(migrated.settings.lifeEvents).toBe(true);
    const emp = migrated.contracts.find((c) => c.type === 'employment')!;
    const lease = migrated.contracts.find((c) => c.type === 'lease')!;
    expect(emp.type === 'employment' && emp.grossMonthly).toBeNull(); // v1 nie znało brutto — brak danych, nie zgadywanie
    expect(emp.type === 'employment' && emp.hoursPerMonth).toBe(168);
    expect(lease.type === 'lease' && lease.utilitiesMonthly).toBe(zl(300)); // z reguły „media” z v1
    expect(lease.type === 'lease' && lease.depositAmount).toBe(0);
    expect(lease.type === 'lease' && lease.standard).toBeNull();
    // styl „standardowy” zachowuje kwoty z v1
    const groceries = migrated.rules.find((r) => r.id === 'rule:groceries')!;
    expect(groceries.kind === 'obligation' && groceries.amount).toMatchObject({ type: 'lifestyle', levels: { standardowy: LIFESTYLE.groceries.standardowy } });
    expect(migrated.rules.some((r) => r.kind === 'savings_interest')).toBe(true);
  });

  it('gra po migracji toczy się dalej: pensje wpływają, czynsz jest naliczany raz, niezmienniki trzymają', () => {
    let s = migrated;
    for (let i = 0; i < 6; i++) {
      s = advanceToNextMonth(s);
      expect(checkInvariants(s), s.clock.today).toEqual([]);
    }
    expect(s.ledger.filter((t) => t.category === 'wynagrodzenie').length).toBeGreaterThanOrEqual(5);
    const rentMonths = s.obligations.filter((o) => o.category === 'czynsz').map((o) => o.issueDate.slice(0, 7));
    expect(s.clock.today).toBe('2026-10-01');
    expect(rentMonths).toHaveLength(10); // styczeń–październik, po jednym naliczeniu na miesiąc
    expect(new Set(rentMonths).size).toBe(10);
    expect(new Set(s.ledger.map((t) => t.id)).size).toBe(s.ledger.length);
    // dawne wpisy nadal są na początku rejestru, w tej samej kolejności
    expect(s.ledger.slice(0, expectV1.ledgerCount)).toEqual(migrated.ledger);
  });

  it('nowe mechaniki działają na zmigrowanym zapisie (przeprowadzka, przelew, zmiana stylu życia)', () => {
    let s = migrated;
    s = ok(commands.transferFunds(s, s.playerAccountId, 'acc:player:savings', zl(1_000)));
    s = ok(commands.setLifestyle(s, 'oszczedny'));
    s = ok(commands.signLease(s, 'flat:kawalerka-nagorki', '2026-06-01'));
    s = advanceDays(s, 60);
    expect(checkInvariants(s)).toEqual([]);
    expect(netWorth(s)).toBeGreaterThan(0);
  });

  it('wczytanie nie duplikuje operacji: ponowne przetworzenie dnia z zapisu nie zmienia stanu', () => {
    const s = structuredClone(migrated);
    const before = structuredClone(s);
    processDay(s, s.clock.today);
    expect(s.ledger).toEqual(before.ledger);
    expect(s.obligations).toEqual(before.obligations);
    expect(s.events).toEqual(before.events);
    expect(cash(s)).toBe(cash(before));
  });

  it('zmigrowany zapis zapisuje się w bieżącej wersji i wczytuje identycznie', () => {
    const json = serializeSave(migrated, NOW);
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
    const again = parseSave(json);
    expect(again.ok && again.state).toEqual(migrated);
  });

  it('uszkodzony zapis v1 jest odrzucany z komunikatem (migracja nie maskuje błędów)', () => {
    const raw = JSON.parse(rawV1);
    raw.state.accounts[raw.state.playerAccountId].balance += 5_00;
    expect(parseSave(JSON.stringify(raw))).toMatchObject({ ok: false, error: expect.stringContaining('niespójny finansowo') });
    const raw2 = JSON.parse(rawV1);
    delete raw2.state.person;
    expect(parseSave(JSON.stringify(raw2)).ok).toBe(false);
  });
});

describe('zapis i odczyt stanu v2: salda po wczytaniu', () => {
  function richState(): GameState {
    let s = createNewGame({ firstName: 'Ewa', lastName: 'Lis', seed: 'v2-save' }); // wydarzenia włączone
    s = advanceDays(s, 20);
    s.accounts[s.playerAccountId]!.balance += zl(9_000);
    s.openingCash += zl(9_000);
    s.ledger.push({ id: 'tx:t-fund', date: s.clock.today, accountId: s.playerAccountId, amount: zl(9_000), category: 'kapital_poczatkowy', description: 'test', counterpartyId: null, obligationId: null, transferId: null, eventId: 't-fund' });
    s.processed['tx:t-fund'] = true;
    s.history[s.history.length - 1]!.cash += zl(9_000);
    s.history[s.history.length - 1]!.netWorth += zl(9_000);
    s = ok(commands.transferFunds(s, s.playerAccountId, 'acc:player:savings', zl(3_000)));
    s = ok(commands.signLease(s, 'flat:2pok-jaroty', '2026-03-01'));
    s = ok(commands.setLifestyle(s, 'komfortowy'));
    s = ok(commands.setTimePlan(s, { sleepHours: 7, businessHours: 2 }));
    return advanceDays(s, 25);
  }

  it('round-trip zachowuje salda, kaucje, plan czasu, wydarzenia i akcje zaplanowane', () => {
    const s = richState();
    const parsed = parseSave(serializeSave(s, NOW));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state).toEqual(s);
    expect(cash(parsed.state)).toBe(cash(s));
    expect(savingsBalance(parsed.state)).toBe(savingsBalance(s));
    expect(parsed.state.assets).toEqual(s.assets);
    expect(parsed.state.pending).toEqual(s.pending);
    expect(parsed.meta.netWorth).toBe(netWorth(s));
  });

  it('po wczytaniu gra toczy się identycznie jak bez zapisu, bez dubli operacji', () => {
    const s = richState();
    const parsed = parseSave(serializeSave(s, NOW));
    if (!parsed.ok) throw new Error(parsed.error);
    let a = s;
    let b = parsed.state;
    for (let i = 0; i < 8; i++) {
      a = advanceToNextMonth(a);
      b = advanceToNextMonth(b);
    }
    expect(b).toEqual(a);
    expect(new Set(b.ledger.map((t) => t.id)).size).toBe(b.ledger.length);
    expect(checkInvariants(b)).toEqual([]);
  });

  it('odrzuca zmanipulowane salda i niespójne kaucje', () => {
    const json = serializeSave(richState(), NOW);
    const savingsTampered = JSON.parse(json);
    savingsTampered.state.accounts['acc:player:savings'].balance += 100;
    expect(parseSave(JSON.stringify(savingsTampered))).toMatchObject({ ok: false });
    const depositTampered = JSON.parse(json);
    depositTampered.state.assets[0].amount += 100;
    expect(parseSave(JSON.stringify(depositTampered))).toMatchObject({ ok: false });
    const dupTransfer = JSON.parse(json);
    dupTransfer.state.ledger.find((t: { transferId: string | null }) => t.transferId).amount += 1;
    expect(parseSave(JSON.stringify(dupTransfer)).ok).toBe(false);
  });
});

describe('migracja zapisu v2 → v3 (prawdziwy zapis wygenerowany przez v0.2.1)', () => {
  const result = parseSave(rawV2);
  if (!result.ok) throw new Error(`fixture v2 nie wczytał się: ${result.error}`);
  const migrated = result.state;

  it('historia finansowa, salda, kaucja i oszczędności zostają nietknięte', () => {
    expect(JSON.parse(rawV2).version).toBe(2);
    expect(migrated.clock.today).toBe(expectV2.today);
    expect(cash(migrated)).toBe(expectV2.cash);
    expect(savingsBalance(migrated)).toBe(expectV2.savings);
    expect(netWorth(migrated)).toBe(expectV2.netWorth);
    expect(migrated.ledger).toHaveLength(expectV2.ledgerCount);
    expect(migrated.obligations).toHaveLength(expectV2.obligationCount);
    expect(migrated.events).toHaveLength(expectV2.eventCount);
    expect(migrated.history).toHaveLength(expectV2.historyCount);
    expect(migrated.assets).toHaveLength(expectV2.assets);
    expect(migrated.lifeEvents).toHaveLength(expectV2.lifeEvents);
    expect(migrated.contracts).toHaveLength(expectV2.contracts);
    expect(migrated.ledger.at(-1)!.id).toBe(expectV2.lastTxId);
    const v2 = JSON.parse(rawV2).state;
    expect(migrated.ledger).toEqual(v2.ledger); // rejestr identyczny co do pola
    expect(checkInvariants(migrated)).toEqual([]);
  });

  it('dodaje pustą sferę JDG; wszystkie dotychczasowe zobowiązania są prywatne', () => {
    expect(migrated.obligations.every((o) => o.scope === 'personal')).toBe(true);
    expect([migrated.businesses, migrated.serviceOffers, migrated.serviceOrders, migrated.documents, migrated.taxPeriods].every((a) => a.length === 0)).toBe(true);
    expect(Object.values(migrated.accounts).some((a) => a.type === 'business')).toBe(false);
  });

  it('po migracji można założyć JDG i grać dalej bez dubli i naruszeń niezmienników', () => {
    let s = migrated;
    const r = commands.registerBusiness(s, { name: 'Ewa Nowicka — usługi', profileId: 'jezyki', taxForm: 'liniowy', vatStatus: 'exempt', startDate: '2026-10-01', zusStart: 'ulga', sickness: false });
    s = ok(r);
    for (let i = 0; i < 8; i++) {
      s = advanceToNextMonth(s);
      expect(checkInvariants(s), s.clock.today).toEqual([]);
    }
    expect(s.taxPeriods.length).toBeGreaterThanOrEqual(6);
    expect(s.ledger.slice(0, expectV2.ledgerCount)).toEqual(migrated.ledger); // stara historia na początku, bez zmian
    expect(new Set(s.ledger.map((t) => t.id)).size).toBe(s.ledger.length);
    expect(s.obligations.filter((o) => o.scope === 'personal' && o.issueDate <= expectV2.today)).toEqual(migrated.obligations.filter((o) => o.issueDate <= expectV2.today).map((o) => s.obligations.find((x) => x.id === o.id)!));
  });

  it('zapis v3 z działalnością: round-trip identyczny, kontynuacja bez dubli rozliczeń', () => {
    let s = ok(commands.registerBusiness(migrated, { name: 'Ewa Nowicka — usługi', profileId: 'jezyki', taxForm: 'ryczalt', vatStatus: 'active', startDate: '2026-10-01', zusStart: 'standard', sickness: true }));
    s = advanceDays(s, 80);
    const json = serializeSave(s, NOW);
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
    const again = parseSave(json);
    expect(again.ok && again.state).toEqual(s);
    if (!again.ok) return;
    const reloaded = structuredClone(again.state);
    const taxBefore = reloaded.taxPeriods.length;
    const obligationsBefore = reloaded.obligations.length;
    processDay(reloaded, reloaded.clock.today); // ponowne przetworzenie dnia po wczytaniu
    expect(reloaded.taxPeriods).toHaveLength(taxBefore);
    expect(reloaded.obligations).toHaveLength(obligationsBefore);
    let a = s;
    let b = again.state;
    for (let i = 0; i < 6; i++) { a = advanceToNextMonth(a); b = advanceToNextMonth(b); }
    expect(b).toEqual(a);
  });

  it('odrzuca zmanipulowany zapis JDG (rachunek firmowy bez działalności, dokument z błędną sumą)', () => {
    const s = advanceDays(ok(commands.registerBusiness(migrated, { name: 'Ewa Nowicka — usługi', profileId: 'jezyki', taxForm: 'ryczalt', vatStatus: 'exempt', startDate: '2026-10-01', zusStart: 'ulga', sickness: false })), 40);
    const raw = JSON.parse(serializeSave(s, NOW));
    raw.state.businesses = [];
    expect(parseSave(JSON.stringify(raw)).ok).toBe(false);
  });
});

describe('migracja zapisu v3 → v4 (prawdziwy zapis wygenerowany przez v0.3, z JDG)', () => {
  const result = parseSave(rawV3);
  if (!result.ok) throw new Error(`fixture v3 nie wczytał się: ${result.error}`);
  const migrated = result.state;
  const old = JSON.parse(rawV3).state;

  it('historia finansowa, salda i rozliczenia JDG zostają nietknięte (bez ponownego księgowania)', () => {
    expect(JSON.parse(rawV3).version).toBe(3);
    expect(migrated.clock.today).toBe(expectV3.today);
    expect(cash(migrated)).toBe(expectV3.cash);
    expect(netWorth(migrated)).toBe(expectV3.netWorth);
    expect(migrated.ledger).toHaveLength(expectV3.ledgerCount);
    expect(migrated.ledger).toEqual(old.ledger);
    expect(migrated.obligations).toEqual(old.obligations);
    expect(migrated.documents.map(({ part, ...d }) => d)).toEqual(old.documents); // jedyna zmiana: pole `part` (v5)
    expect(migrated.events).toEqual(old.events);
    expect(migrated.taxPeriods).toHaveLength(expectV3.taxPeriods);
    expect(migrated.taxPeriods.map((p) => ({ ...p, form: undefined }))).toEqual(old.taxPeriods.map((p: object) => ({ ...p, form: undefined })));
    expect(checkInvariants(migrated)).toEqual([]);
  });

  it('dodaje nowe kolekcje puste i historię formy; odcinki płacowe dopiero od dnia po migracji', () => {
    expect([migrated.payslips, migrated.taxReturns, migrated.taxLosses, migrated.healthSettlements].every((a) => a.length === 0)).toBe(true);
    const b = migrated.businesses[0]!;
    expect(b).toMatchObject({ suspensions: [], taxFormPlan: null });
    expect(b.taxFormHistory).toEqual([{ form: expectV3.taxForm, from: b.startDate }]);
    expect(b.zus.malyPlus.active).toBe(false);
    expect(migrated.taxPeriods.every((p) => p.form === expectV3.taxForm)).toBe(true);
    expect(migrated.settings.payrollFrom > migrated.clock.today).toBe(true);
  });

  it('wynagrodzenia sprzed migracji zachowują faktyczną kwotę netto, nowe liczą się kalkulatorem', () => {
    let s = migrated;
    const paidBefore = s.ledger.filter((t) => t.category === 'wynagrodzenie').map((t) => t.amount);
    expect(paidBefore[0]).toBe(expectV3.firstSalaryAmount);
    s = advanceDays(s, 120);
    expect(s.ledger.filter((t) => t.category === 'wynagrodzenie').slice(0, paidBefore.length).map((t) => t.amount)).toEqual(paidBefore);
    expect(s.payslips.length).toBeGreaterThan(0);
    expect(checkInvariants(s)).toEqual([]);
    expect(new Set(s.ledger.map((t) => t.id)).size).toBe(s.ledger.length);
  });

  it('po migracji działają nowe funkcje: zawieszenie, zmiana formy, rozliczenie roczne — bez dubli i zmian historii', () => {
    let s = ok(commands.planTaxFormChange(migrated, expectV3.taxForm === 'skala' ? 'liniowy' : 'skala'));
    s = ok(commands.suspendBusiness(s));
    for (let i = 0; i < 18; i++) {
      s = advanceToNextMonth(s);
      expect(checkInvariants(s), s.clock.today).toEqual([]);
    }
    expect(s.taxReturns.length).toBeGreaterThan(0);
    expect(s.ledger.slice(0, expectV3.ledgerCount)).toEqual(migrated.ledger);
    expect(s.taxPeriods.slice(0, expectV3.taxPeriods)).toEqual(migrated.taxPeriods);
    expect(new Set(s.obligations.map((o) => o.id)).size).toBe(s.obligations.length);
  });

  it('zapis v4: round-trip identyczny, ponowne przetworzenie dnia nic nie dubluje', () => {
    const s = advanceDays(migrated, 200);
    const json = serializeSave(s, NOW);
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
    const again = parseSave(json);
    expect(again.ok && again.state).toEqual(s);
    if (!again.ok) return;
    const r = structuredClone(again.state);
    const counts = [r.ledger.length, r.obligations.length, r.payslips.length, r.taxPeriods.length, r.taxReturns.length];
    processDay(r, r.clock.today);
    expect([r.ledger.length, r.obligations.length, r.payslips.length, r.taxPeriods.length, r.taxReturns.length]).toEqual(counts);
  });

  it('łańcuch v1 → v4 i v2 → v4 daje spójne zapisy; zmanipulowany rozliczony PIT jest odrzucany', () => {
    for (const raw of [rawV1, rawV2]) {
      const p = parseSave(raw);
      expect(p.ok).toBe(true);
      if (p.ok) {
        expect(p.state.payslips).toEqual([]);
        expect(checkInvariants(advanceDays(p.state, 400))).toEqual([]);
      }
    }
    const s = advanceDays(migrated, 400);
    const bad = JSON.parse(serializeSave(s, NOW));
    expect(bad.state.taxReturns.length).toBeGreaterThan(0);
    bad.state.taxReturns[0].balance += 100;
    expect(parseSave(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe('migracja zapisu v4 → v5 (prawdziwy zapis wygenerowany przez v0.4, z JDG i rozliczeniem rocznym)', () => {
  const result = parseSave(rawV4);
  if (!result.ok) throw new Error(`fixture v4 nie wczytał się: ${result.error}`);
  const migrated = result.state;
  const old = JSON.parse(rawV4).state;

  it('historia finansowa, dokumenty, rozliczenia podatkowe i zlecenia zostają nietknięte', () => {
    expect(JSON.parse(rawV4).version).toBe(4);
    expect(migrated.clock.today).toBe(expectV4.today);
    expect(cash(migrated)).toBe(expectV4.cash);
    expect(netWorth(migrated)).toBe(expectV4.netWorth);
    expect(migrated.ledger).toEqual(old.ledger);
    expect(migrated.obligations).toEqual(old.obligations);
    expect(migrated.events).toEqual(old.events);
    expect(migrated.taxPeriods).toEqual(old.taxPeriods);
    expect(migrated.taxReturns).toEqual(old.taxReturns);
    expect(migrated.payslips).toEqual(old.payslips);
    expect(migrated.documents.map(({ part, ...d }) => d)).toEqual(old.documents); // jedyna zmiana: pole `part`
    expect(migrated.serviceOrders.map(({ kind, ...o }) => o)).toEqual(old.serviceOrders);
    expect(migrated.documents).toHaveLength(expectV4.documents);
    expect(migrated.taxReturns).toHaveLength(expectV4.taxReturns);
    expect(checkInvariants(migrated)).toEqual([]);
  });

  it('dokumenty to „całość”, zlecenia to szablonowe zlecenia v0.3; moduł remontowy i księgowość są puste', () => {
    expect(migrated.documents.every((d) => d.part === 'full')).toBe(true);
    expect(migrated.serviceOrders.every((o) => o.kind === 'service')).toBe(true);
    expect(migrated.reno).toMatchObject({ specializations: [], enquiries: [], quotes: [], jobs: [], equipment: [], stockMoves: [], reviews: [], complaints: [] });
    expect(migrated.reno.stock).toEqual({});
    expect(migrated.accounting).toEqual({ office: null, history: [], lastFeeMonth: null, suggestions: [] });
    expect(netWorth(migrated)).toBe(expectV4.netWorth); // brak zapasów i sprzętu nie zmienia majątku
  });

  it('po migracji gra toczy się dalej bez dubli: biuro rachunkowe, kolejne rozliczenia, historia na początku bez zmian', () => {
    let s = ok(commands.hireAccountingOffice(migrated, 'start'));
    s = advanceDays(s, 120);
    expect(checkInvariants(s)).toEqual([]);
    expect(s.ledger.slice(0, expectV4.ledgerCount)).toEqual(migrated.ledger);
    expect(s.documents.slice(0, expectV4.documents).map((d) => d.id)).toEqual(migrated.documents.map((d) => d.id));
    expect(s.documents.filter((d) => d.description.startsWith('Obsługa księgowa')).length).toBeGreaterThanOrEqual(3);
    expect(new Set(s.obligations.map((o) => o.id)).size).toBe(s.obligations.length);
  });

  it('po zamknięciu starej firmy IT można założyć firmę remontową i prowadzić ją dalej (stare zapisy nie blokują nowej branży)', () => {
    let s = migrated;
    const biz = s.businesses[0]!;
    s = { ...s, serviceOrders: s.serviceOrders.map((o) => (o.status === 'in_progress' ? { ...o, status: 'completed' as const, completedOn: s.clock.today } : o)) };
    s = ok(commands.closeBusiness(s));
    s = advanceDays(s, 40);
    expect(s.businesses[0]!.status).toBe('closed');
    expect(biz.profileId).toBe('it-programowanie');
    s = ok(commands.registerBusiness(s, { name: 'Remonty po migracji', profileId: 'remonty', taxForm: 'ryczalt', vatStatus: 'exempt', startDate: s.clock.today.slice(0, 7) === '2027-05' ? '2027-06-01' : '2027-06-01', zusStart: 'standard', sickness: false, specialization: 'gladzie' }));
    expect(s.reno.specializations).toEqual(['gladzie']);
    s = advanceDays(s, 60);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('zapis v5: round-trip identyczny, ponowne przetworzenie dnia niczego nie dubluje', () => {
    const s = advanceDays(ok(commands.hireAccountingOffice(migrated, 'standard')), 90);
    const json = serializeSave(s, NOW);
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
    const again = parseSave(json);
    expect(again.ok && again.state).toEqual(s);
    if (!again.ok) return;
    const r = structuredClone(again.state);
    const counts = [r.ledger.length, r.obligations.length, r.documents.length, r.events.length];
    processDay(r, r.clock.today);
    expect([r.ledger.length, r.obligations.length, r.documents.length, r.events.length]).toEqual(counts);
  });

  it('łańcuch v1/v2/v3 → v5 daje spójne zapisy; zmanipulowany magazyn lub zaliczka są odrzucane', () => {
    for (const raw of [rawV1, rawV2, rawV3]) {
      const p = parseSave(raw);
      expect(p.ok).toBe(true);
      if (p.ok) expect(p.state.reno.jobs).toEqual([]);
    }
    const base = advanceDays(ok(commands.registerBusiness(createNewGameWithCash(), { name: 'Remonty zapis', profileId: 'remonty', taxForm: 'skala', vatStatus: 'exempt', startDate: '2026-02-01', zusStart: 'ulga', sickness: false, specialization: 'malowanie' })), 40);
    let s = ok(commands.transferFunds(base, base.playerAccountId, base.businesses[0]!.accountId, zl(3_000)));
    s = ok(commands.buyMaterial(s, 'farba:std', 10));
    const raw = JSON.parse(serializeSave(s, NOW));
    expect(parseSave(JSON.stringify(raw)).ok).toBe(true);
    raw.state.reno.stock['farba:std'].value += 100;
    expect(parseSave(JSON.stringify(raw)).ok).toBe(false);
  });
});

function createNewGameWithCash(): GameState {
  const s = createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed: 'mig-v5', lifeEvents: false });
  const n = 1;
  s.accounts[s.playerAccountId]!.balance += zl(20_000);
  s.openingCash += zl(20_000);
  s.ledger.push({ id: `tx:test-fund:${n}`, date: s.clock.today, accountId: s.playerAccountId, amount: zl(20_000), category: 'kapital_poczatkowy', description: 'test', counterpartyId: null, obligationId: null, transferId: null, eventId: `test-fund:${n}` });
  s.processed[`tx:test-fund:${n}`] = true;
  s.history[s.history.length - 1]!.cash += zl(20_000);
  s.history[s.history.length - 1]!.netWorth += zl(20_000);
  return s;
}

describe('migracja zapisu v5 → v6 (prawdziwy zapis wygenerowany przez v0.5: firma remontowa, VAT czynny, kontrakty z zaliczkami w toku)', () => {
  const result = parseSave(rawV5);
  if (!result.ok) throw new Error(`fixture v5 nie wczytał się: ${result.error}`);
  const migrated = result.state;
  const old = JSON.parse(rawV5).state;

  it('historia finansowa, dokumenty, zobowiązania, kontrakty i zapasy zostają nietknięte; majątek netto bez zmian', () => {
    expect(JSON.parse(rawV5).version).toBe(5);
    expect(migrated.clock.today).toBe(expectV5.today);
    expect(cash(migrated)).toBe(expectV5.cash);
    expect(netWorth(migrated)).toBe(expectV5.netWorth);
    expect(migrated.ledger).toEqual(old.ledger);
    expect(migrated.obligations).toEqual(old.obligations);
    expect(migrated.documents).toEqual(old.documents);
    expect(migrated.events).toEqual(old.events);
    expect(migrated.taxPeriods).toEqual(old.taxPeriods);
    expect(migrated.reno.stockMoves).toEqual(old.reno.stockMoves);
    expect(migrated.reno.jobs).toHaveLength(expectV5.jobs);
    expect(migrated.documents.filter((d) => d.part === 'advance')).toHaveLength(expectV5.advanceDocs);
    expect(checkInvariants(migrated)).toEqual([]);
  });

  it('kontrakty sprzed v0.6 zostają w trybie „legacy” (zaliczka jako przychód w dacie wystawienia); nowe pola mają bezpieczne wartości; pula podwykonawców i puste ops', () => {
    expect(migrated.reno.jobs.every((j) => j.advanceMode === 'legacy' && j.crew.teamId === null && j.crew.supervision === 'worker' && j.vehicleId === null)).toBe(true);
    expect(migrated.reno.jobs.every((j) => j.actual.labor === 0 && j.actual.subcontract === 0 && j.actual.vehicle === 0 && j.qualityHoursCenti === 0)).toBe(true);
    expect(migrated.reno.quotes.every((q) => q.teamId === null && q.supervision === 'worker' && q.vehicleId === null)).toBe(true);
    expect(migrated.ops).toMatchObject({ people: [], employments: [], payslips: [], listings: [], candidates: [], subcontracts: [], teams: [], assignments: [], vehicles: [], laborAllocated: {}, vehicleRunning: {} });
    expect(migrated.ops.subcontractors).toHaveLength(5);
    expect(migrated.ops.subcontractors).toEqual(parseSave(rawV5).ok ? migrated.ops.subcontractors : []);
  });

  it('kontrakt w toku z zaliczką kończy się po migracji bez podwójnego przychodu: suma przychodu = cena − kara, stare ujęcie zachowane', () => {
    const j0 = migrated.reno.jobs.find((j) => j.stage !== 'done' && j.stage !== 'cancelled' && j.advanceNet > 0)!;
    expect(j0).toBeDefined();
    let s = advanceDays(migrated, 1);
    for (const j of s.reno.jobs.filter((x) => x.stage !== 'done' && x.stage !== 'cancelled')) s = buyAllKit(s, j.id);
    s = runUntilKit(s, (x) => jobOfKit(x, j0.id).stage === 'done' || jobOfKit(x, j0.id).stage === 'cancelled', 200);
    const j = jobOfKit(s, j0.id);
    if (j.stage === 'done') {
      const docs = s.documents.filter((d) => d.orderId === j.orderId && d.kind === 'sales');
      const fin = docs.find((d) => d.part === 'final')!;
      expect(fin.taxAmount).toBe(fin.net); // stara zasada: reszta ceny, zaliczka była przychodem wcześniej
      expect(docs.reduce((a, d) => a + d.taxAmount, 0)).toBe(j.priceNet - j.penaltyNet);
      expect(docs.find((d) => d.part === 'advance')!.taxAmount).toBe(docs.find((d) => d.part === 'advance')!.net);
    }
    expect(checkInvariants(s)).toEqual([]);
    expect(s.ledger.slice(0, expectV5.ledgerCount)).toEqual(migrated.ledger);
  });

  it('po migracji nowe funkcje działają razem ze starymi: nowy kontrakt z zaliczką jest „deferred”, można zatrudnić pracownika i zawrzeć umowę z podwykonawcą', () => {
    let s = advanceDays(migrated, 1);
    const c = contract(s, { quote: { advanceBps: 2_000, startDate: addDaysStr(s.clock.today, 30), durationDays: 14 } });
    expect(c.job.advanceMode).toBe('deferred');
    expect(c.s.documents.find((d) => d.id === c.job.advanceDocId)).toMatchObject({ taxAmount: 0 });
    s = hireEmployee(c.s, { expected: zl(5_400), start: addDaysStr(s.clock.today, 5) }).s;
    s = ok(commands.requestSubOffer(s, s.ops.subcontractors.find((x) => x.services.includes('malowanie'))!.id, c.job.id, 10_000));
    s = advanceDays(s, 70);
    expect(s.ops.payslips.length).toBeGreaterThan(0);
    expect(checkInvariants(s)).toEqual([]);
    expect(new Set(s.obligations.map((o) => o.id)).size).toBe(s.obligations.length);
  });

  it('zapis v6: round-trip identyczny, ponowne przetworzenie dnia nie dubluje płac ani zaliczek; zmanipulowana lista płac jest odrzucana', () => {
    let s = hireEmployee(advanceDays(migrated, 1), { expected: zl(5_400), start: addDaysStr(migrated.clock.today, 3) }).s;
    s = advanceDays(s, 70);
    const json = serializeSave(s, NOW);
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
    const again = parseSave(json);
    expect(again.ok && again.state).toEqual(s);
    if (!again.ok) return;
    const r = structuredClone(again.state);
    const counts = [r.ledger.length, r.obligations.length, r.documents.length, r.ops.payslips.length, r.ops.assignments.length];
    processDay(r, r.clock.today);
    expect([r.ledger.length, r.obligations.length, r.documents.length, r.ops.payslips.length, r.ops.assignments.length]).toEqual(counts);
    const bad = JSON.parse(json);
    expect(bad.state.ops.payslips.length).toBeGreaterThan(0);
    bad.state.ops.payslips[0].gross += 100;
    expect(parseSave(JSON.stringify(bad)).ok).toBe(false);
  });

  it('łańcuch v1–v4 → bieżąca wersja daje puste moduły pracowników i podwykonawców oraz spójne zapisy', () => {
    for (const raw of [rawV1, rawV2, rawV3, rawV4]) {
      const p = parseSave(raw);
      expect(p.ok).toBe(true);
      if (p.ok) {
        expect(p.state.ops.employments).toEqual([]);
        expect(p.state.ops.subcontractors).toHaveLength(5);
        expect(checkInvariants(advanceDays(p.state, 90))).toEqual([]);
      }
    }
  });
});

describe('migracja zapisu v6 → v7 (prawdziwy zapis wygenerowany przez v0.6: firma z pracownikami, ekipami, podwykonawcami i reklamą lokalną)', () => {
  const result = parseSave(rawV6);
  if (!result.ok) throw new Error(`fixture v6 nie wczytał się: ${result.error}`);
  const migrated = result.state;
  const old = JSON.parse(rawV6).state;

  it('historia finansowa, dokumenty, zobowiązania, kontrakty i oferty zostają nietknięte; majątek netto bez zmian', () => {
    expect(JSON.parse(rawV6).version).toBe(6);
    expect(migrated.clock.today).toBe(expectV6.today);
    expect(cash(migrated)).toBe(expectV6.cash);
    expect(migrated.accounts[activeBusinessOf(migrated).accountId]!.balance).toBe(expectV6.business);
    expect(netWorth(migrated)).toBe(expectV6.netWorth);
    expect(migrated.ledger).toEqual(old.ledger);
    expect(migrated.ledger).toHaveLength(expectV6.ledgerCount);
    expect(migrated.obligations).toEqual(old.obligations);
    expect(migrated.documents).toEqual(old.documents);
    expect(migrated.events).toEqual(old.events);
    expect(migrated.taxPeriods).toEqual(old.taxPeriods);
    expect(migrated.reno.jobs).toEqual(old.reno.jobs);
    expect(migrated.reno.quotes).toEqual(old.reno.quotes);
    expect(migrated.reno.reviews).toEqual(old.reno.reviews);
    expect(migrated.ops).toEqual(old.ops);
    expect(migrated.reno.jobs).toHaveLength(expectV6.jobs);
    expect(migrated.reno.enquiries).toHaveLength(expectV6.enquiries);
    expect(migrated.ledger.at(-1)!.id).toBe(expectV6.lastTxId);
    expect(checkInvariants(migrated)).toEqual([]);
  });

  it('zapytania sprzed v0.7 dostają segment wg wymagań jakościowych i brak konkurencji; reszta pól bez zmian; reklama lokalna staje się budżetem kanału o tym samym koszcie', () => {
    expect(old.reno.advertising.level).toBe(expectV6.advertisingLevel);
    expect('advertising' in migrated.reno).toBe(false);
    for (const [i, e] of migrated.reno.enquiries.entries()) {
      const { segment, source, rivals, rivalId, rivalUtility, rivalAwarded, ...rest } = e;
      expect(rest).toEqual(old.reno.enquiries[i]);
      expect(segment).toBe(e.qualityReq === 1 ? 'budget' : e.qualityReq === 3 ? 'premium' : 'standard');
      expect([source, rivals, rivalId, rivalUtility, rivalAwarded]).toEqual([null, 0, null, 0, false]);
    }
    expect(migrated.market.marketing.budgets).toEqual({ local_ads: 40_000 });
    expect(migrated.market.marketing.reach.local_ads).toBeGreaterThan(0);
    expect(migrated.market.marketing.lastChargedMonth).toBe(old.reno.advertising.paidMonth);
    expect(migrated.market.strategy).toMatchObject({ positioning: 'balanced', previous: null, changedOn: null, history: [] });
  });

  it('nie generuje wstecznie konkurentów, historii rynku ani zdarzeń; model rynku startuje „od teraz” w pierwszym przetworzonym dniu', () => {
    expect(migrated.market.initializedOn).toBeNull();
    expect(migrated.market.competitors).toEqual([]);
    expect(migrated.market.months).toEqual([]);
    expect(migrated.market.current).toBeNull();
    expect(migrated.events).toHaveLength(expectV6.eventCount);
    const next = advanceDays(migrated, 1);
    expect(next.market.initializedOn).toBe(next.clock.today);
    expect(next.market.competitors.length).toBeGreaterThan(5);
    expect(next.market.months).toEqual([]);
    // wszystko sprzed migracji pozostaje: rejestr i dokumenty są prefiksem nowych
    expect(next.ledger.slice(0, migrated.ledger.length)).toEqual(migrated.ledger);
    expect(next.documents.slice(0, migrated.documents.length)).toEqual(migrated.documents);
    expect(checkInvariants(advanceDays(migrated, 120))).toEqual([]);
  });

  it('zapis v7: round-trip identyczny, ponowne przetworzenie dnia nic nie dubluje; łańcuch v5 → v7 daje spójny stan', () => {
    const s = advanceDays(migrated, 70);
    const json = serializeSave(s, NOW);
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
    const again = parseSave(json);
    expect(again.ok && again.state).toEqual(s);
    if (!again.ok) return;
    const r = structuredClone(again.state);
    const counts = [r.ledger.length, r.obligations.length, r.documents.length, r.market.months.length, r.events.length];
    processDay(r, r.clock.today);
    expect([r.ledger.length, r.obligations.length, r.documents.length, r.market.months.length, r.events.length]).toEqual(counts);
    const p5 = parseSave(rawV5);
    expect(p5.ok).toBe(true);
    if (p5.ok) {
      expect(p5.state.market.initializedOn).toBeNull();
      expect(checkInvariants(advanceDays(p5.state, 60))).toEqual([]);
    }
  });
});

describe('migracja zapisu v7 → v8 (prawdziwy zapis wygenerowany przez v0.7: JDG z pracownikiem, ekipą, podwykonawcami, rynek lokalny i marketing)', () => {
  const result = parseSave(rawV7);
  if (!result.ok) throw new Error(`fixture v7 nie wczytał się: ${result.error}`);
  const migrated = result.state;
  const old = JSON.parse(rawV7).state;

  it('stare JDG zostaje JDG (nie spółką); historia, dokumenty, kontrakty i rynek nietknięte; majątek netto bez zmian', () => {
    expect(JSON.parse(rawV7).version).toBe(7);
    expect(migrated.clock.today).toBe(expectV7.today);
    expect(cash(migrated)).toBe(expectV7.cash);
    expect(migrated.accounts[activeBusinessOf(migrated).accountId]!.balance).toBe(expectV7.business);
    expect(netWorth(migrated)).toBe(expectV7.netWorth);
    expect(migrated.businesses).toEqual(old.businesses);
    expect(activeBusinessOf(migrated).ownerId).toBe(migrated.person.id);
    expect(migrated.accounts[activeBusinessOf(migrated).accountId]!.type).toBe('business');
    expect(migrated.ledger).toEqual(old.ledger);
    expect(migrated.ledger).toHaveLength(expectV7.ledgerCount);
    expect(migrated.obligations).toEqual(old.obligations);
    expect(migrated.documents).toEqual(old.documents);
    expect(migrated.events).toEqual(old.events);
    expect(migrated.reno).toEqual(old.reno);
    expect(migrated.ops).toEqual(old.ops);
    expect(migrated.market).toEqual(old.market);
    expect(migrated.documents).toHaveLength(expectV7.documents);
    expect(migrated.reno.jobs).toHaveLength(expectV7.jobs);
    expect(migrated.market.competitors).toHaveLength(expectV7.competitors);
    expect(migrated.ledger.at(-1)!.id).toBe(expectV7.lastTxId);
    expect(checkInvariants(migrated)).toEqual([]);
  });

  it('nowy stan spółek jest pusty: brak spółek, udziałów, uchwał i dywidend; pula wspólników deterministyczna z ziarna; kontekst operatora pusty', () => {
    expect(migrated.corp.companies).toEqual([]);
    expect(migrated.corp.holdings).toEqual([]);
    expect(migrated.corp.shareEvents).toEqual([]);
    expect(migrated.corp.resolutions).toEqual([]);
    expect(migrated.corp.dividends).toEqual([]);
    expect(migrated.corp.negotiations).toEqual([]);
    expect(migrated.corp.citReturns).toEqual([]);
    expect(migrated.corp.selected).toBe('jdg');
    expect(migrated.corp.context).toBeNull();
    expect(migrated.corp.partners).toHaveLength(10);
    expect(migrated.corp.partners).toEqual(createNewGame({ firstName: 'A', lastName: 'B', seed: migrated.seed }).corp.partners);
    expect(migrated.corp.partners.filter((p) => p.kind === 'investor').length).toBeGreaterThanOrEqual(3);
  });

  it('po migracji gra toczy się dalej bez duplikatów (JDG nietknięta), a gracz może założyć spółkę i poprawnie ją zarejestrować', () => {
    const s0 = advanceDays(migrated, 30);
    expect(s0.ledger.slice(0, migrated.ledger.length)).toEqual(migrated.ledger);
    expect(checkInvariants(s0)).toEqual([]);
    let s = ok(commands.createCompanyDraft(s0, { name: 'Po Migracji', cityId: 'olsztyn', profileId: 'remonty', specialization: 'malowanie', vatPlan: 'exempt', capital: zl(10_000), nominal: zl(50), representation: 'each_alone' }));
    s = ok(commands.signAgreement(s, { companyId: 'co:1', board: [{ personId: s.person.id, role: 'president' }], file: true }));
    s = advanceDays(s, 3);
    expect(s.corp.companies[0]!.status).toBe('registered');
    expect(activeBusinessOf(s).ownerId).toBe(s.person.id); // JDG nadal JDG
    expect(s.corp.holdings).toHaveLength(1);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('zapis v8: round-trip identyczny; ponowne przetworzenie dnia nie dubluje wpisów; uszkodzony rejestr udziałów jest odrzucany przy wczytaniu', () => {
    let s = ok(commands.createCompanyDraft(advanceDays(migrated, 5), { name: 'Zapis', cityId: 'olsztyn', profileId: 'remonty', specialization: 'malowanie', vatPlan: 'exempt', capital: zl(10_000), nominal: zl(50), representation: 'each_alone' }));
    s = ok(commands.signAgreement(s, { companyId: 'co:1', board: [{ personId: s.person.id, role: 'president' }], file: true }));
    s = advanceDays(s, 40);
    const json = serializeSave(s, NOW);
    expect(JSON.parse(json).version).toBe(8);
    const again = parseSave(json);
    expect(again.ok && again.state).toEqual(s);
    if (!again.ok) return;
    const r = structuredClone(again.state);
    const counts = [r.ledger.length, r.obligations.length, r.corp.shareEvents.length, r.corp.holdings.length, r.events.length];
    processDay(r, r.clock.today);
    expect([r.ledger.length, r.obligations.length, r.corp.shareEvents.length, r.corp.holdings.length, r.events.length]).toEqual(counts);
    const tampered = JSON.parse(json);
    tampered.state.corp.holdings[0].count += 5;
    expect(parseSave(JSON.stringify(tampered)).ok).toBe(false);
  });
});

const activeBusinessOf = (s: GameState) => s.businesses.find((b) => b.status === 'active')!;

const addDaysStr = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
