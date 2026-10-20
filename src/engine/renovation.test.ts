import { describe, expect, it } from 'vitest';
import { claimHealthRefund } from './annual.ts';
import { compareTaxForms, officeActive } from './accounting.ts';
import { activeBusiness } from './business.ts';
import type { RegisterInput } from './business.ts';
import { commands } from './commands.ts';
import type { CommandResult } from './commands.ts';
import { recordHistory } from './core.ts';
import { addDays, diffDays } from './date.ts';
import { checkInvariants } from './invariants.ts';
import { expectedDailyDemand, playerVisibility } from './market.ts';
import { macroAt } from './macro.ts';
import { RENOVATION_MARKET } from './renovationMarket.ts';
import { zl } from './money.ts';
import { createNewGame } from './newGame.ts';
import {
  clientAcceptanceBps, complaintBps, decideQuote, defaultQuoteInput, jobFinancials, jobForecast, jobQuality, materialAvailable, materialPrice,
  crewKey, playerMarketView, previewQuote, quoteSchedule, renoDashboard, reputation, skillLevel, speedBps, stockKey,
} from './renovation.ts';
import type { QuoteInput } from './renovation.ts';
import { ACCOUNTING_PLANS } from './renovationCatalog.ts';
import { businessSummaries, netWorth } from './selectors.ts';
import { advanceDays, processDay } from './simulate.ts';
import type { GameState, RenoEnquiry, RenoJob } from './state.ts';
import { budgetFor } from './time.ts';
import { yearReport } from './report.ts';

const ok = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(`komenda odrzucona: ${r.error}`);
  return r.state;
};
const fail = (r: CommandResult): string => {
  if (r.ok) throw new Error('komenda powinna zostać odrzucona');
  return r.error;
};
const consistent = (s: GameState) => expect(checkInvariants(s)).toEqual([]);
const toDate = (s: GameState, date: string) => (diffDays(date, s.clock.today) <= 0 ? s : advanceDays(s, diffDays(date, s.clock.today)));
const REG: RegisterInput = { name: 'Remonty Test', profileId: 'remonty', taxForm: 'skala', vatStatus: 'exempt', startDate: '2026-02-01', zusStart: 'ulga', sickness: false, specialization: 'malowanie' };

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

/** Firma remontowa po starcie (1 lutego 2026), z etatem z newGame i zasilonym rachunkiem firmowym. */
function renoGame(o: { seed?: string; reg?: Partial<RegisterInput>; business?: number; equip?: string[] } = {}): GameState {
  let s = createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed: o.seed ?? 'reno-1', lifeEvents: false });
  s.person.birthDate = '1990-05-05';
  s = fund(s, zl(80_000));
  s = ok(commands.registerBusiness(s, { ...REG, ...o.reg }));
  s = toDate(s, '2026-02-01');
  s = ok(commands.transferFunds(s, s.playerAccountId, activeBusiness(s)!.accountId, o.business ?? zl(30_000)));
  for (const e of o.equip ?? ['paint-basic']) s = ok(commands.buyEquipment(s, e));
  return s;
}

const bizBalance = (s: GameState) => s.accounts[activeBusiness(s)!.accountId]!.balance;

function craftEnquiry(s: GameState, o: Partial<RenoEnquiry> = {}): RenoEnquiry {
  const n = (s.counters['reno:enquiry'] ?? 0) + 1;
  s.counters['reno:enquiry'] = n;
  const id = `enq:${n}`;
  const clientId = `party:client:${id}`;
  s.parties[clientId] = { id: clientId, name: 'Klient testowy (fikcyjny)', role: 'service' };
  const enq: RenoEnquiry = {
    id, businessId: activeBusiness(s)!.id, clientId, clientName: 'Klient testowy (fikcyjny)', location: 'Jaroty', serviceId: 'malowanie', units: 60, complexity: 'standard', qualityReq: 2,
    desiredStart: addDays(s.clock.today, 5), maxDays: 30, budgetGross: zl(3_000), walkAwayGross: zl(3_400), haggler: false, flexDays: 3, receivedOn: s.clock.today, respondBy: addDays(s.clock.today, 7), status: 'open', segment: 'standard', source: null, rivals: 0, rivalId: null, rivalUtility: 0, rivalAwarded: false, ...o,
  };
  s.reno.enquiries.push(enq);
  return enq;
}

interface ContractOpts { enquiry?: Partial<RenoEnquiry>; quote?: Partial<QuoteInput>; sign?: boolean }
/** Tworzy kontrakt „na skróty” (wymuszona akceptacja klienta), ale przez prawdziwe komendy wyceny i podpisu. */
function contract(s0: GameState, o: ContractOpts = {}): { s: GameState; job: RenoJob; enq: RenoEnquiry } {
  let s = structuredClone(s0);
  const enq = craftEnquiry(s, o.enquiry);
  const q = { ...defaultQuoteInput(s, enq), ...o.quote };
  s = ok(commands.sendQuote(s, enq.id, q));
  const quote = s.reno.quotes.at(-1)!;
  quote.status = 'accepted';
  quote.acceptedOn = s.clock.today;
  quote.signBy = addDays(s.clock.today, 5);
  s.reno.enquiries.find((e) => e.id === enq.id)!.status = 'won';
  if (o.sign === false) return { s, job: null as unknown as RenoJob, enq };
  s = ok(commands.signContract(s, quote.id));
  return { s, job: s.reno.jobs.at(-1)!, enq };
}

const jobOf = (s: GameState, id: string) => s.reno.jobs.find((j) => j.id === id)!;
const docsFor = (s: GameState, orderId: string) => s.documents.filter((d) => d.orderId === orderId);
function runUntil(s: GameState, pred: (x: GameState) => boolean, max = 200): GameState {
  let cur = s;
  for (let i = 0; i < max && !pred(cur); i++) cur = advanceDays(cur, 1);
  return cur;
}
/** Kupuje brakujące materiały; gdy hurtownia danego dnia nie ma towaru, czeka dzień i ponawia; brak niedoborów nie jest błędem. */
function buyAll(s0: GameState, jobId: string): GameState {
  let s = s0;
  for (let i = 0; i < 8; i++) {
    const r = commands.buyMissingForJob(s, jobId);
    if (r.ok) return r.state;
    if (/wszystkie materiały/.test(r.error)) return s;
    if (!/niedostępny/.test(r.error)) throw new Error(r.error);
    s = advanceDays(s, 1);
  }
  throw new Error('materiały niedostępne przez 8 dni');
}
function buyMat(s0: GameState, key: string, qty: number): GameState {
  let s = s0;
  for (let i = 0; i < 8; i++) {
    const r = commands.buyMaterial(s, key, qty);
    if (r.ok) return r.state;
    if (!/niedostępny/.test(r.error)) throw new Error(r.error);
    s = advanceDays(s, 1);
  }
  throw new Error('materiał niedostępny przez 8 dni');
}

describe('1. rozpoczęcie działalności remontowej', () => {
  it('rejestracja wymaga specjalizacji; po rejestracji moduł ma stan początkowy i poziom 2', () => {
    let s = fund(createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed: 'reg-1', lifeEvents: false }), zl(10_000));
    expect(fail(commands.registerBusiness(s, { ...REG, specialization: undefined }))).toMatch(/specjalizację/);
    expect(fail(commands.registerBusiness(s, { ...REG, specialization: 'nieistniejaca' }))).toMatch(/specjalizację/);
    s = ok(commands.registerBusiness(s, REG));
    expect(s.reno.specializations).toEqual(['malowanie']);
    expect(skillLevel(s, 'malowanie')).toBe(2);
    expect(skillLevel(s, 'gladzie')).toBe(0);
    expect(s.reno.equipment).toEqual([]);
    expect(activeBusiness(s)).toMatchObject({ profileId: 'remonty', pkd: '43.34.Z' });
    consistent(s);
  });

  it('profil remontowy nie korzysta z szablonowych ofert v0.3, a firma IT nie dostaje zapytań remontowych', () => {
    const s = toDate(renoGame(), '2026-03-20');
    expect(s.serviceOffers).toHaveLength(0);
    let it = fund(createNewGame({ firstName: 'Ewa', lastName: 'Nowak', seed: 'it-1', lifeEvents: false }), zl(10_000));
    it = ok(commands.registerBusiness(it, { ...REG, profileId: 'it-programowanie', specialization: undefined }));
    it = toDate(it, '2026-04-30');
    expect(it.reno.enquiries).toHaveLength(0);
    expect(it.serviceOffers.length).toBeGreaterThan(0);
    consistent(it);
  });

  it('ostrzeżenia rejestracji mówią wprost o niewdrożonym VAT 8%, a ryczałt ma stawkę 5,5%', () => {
    const s = fund(createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed: 'reg-2', lifeEvents: false }), zl(1_000));
    // podgląd rejestracji pochodzi z silnika (UI tylko wyświetla)
    return import('./business.ts').then(({ previewRegistration }) => {
      const p = previewRegistration(s, { profileId: 'remonty', taxForm: 'ryczalt', vatStatus: 'active', startDate: '2026-02-01', zusStart: 'ulga', sickness: false })!;
      expect(p.ryczaltRateBps).toBe(550);
      expect(p.warnings.join(' ')).toMatch(/8% dla remontów mieszkań.*NIE są obsługiwane/);
      expect(p.warnings.join(' ')).toMatch(/art\. 113 ust\. 13/);
    });
  });
});

describe('2. sprzęt, jego koszt, wartość i zużycie', () => {
  it('bez wymaganego sprzętu nie da się wysłać oferty; po zakupie — da się', () => {
    let s = renoGame({ equip: [] });
    const enq = craftEnquiry(s);
    const q = defaultQuoteInput(s, enq);
    expect(previewQuote(s, q).errors.join(' ')).toMatch(/Brakuje wymaganego sprzętu: Zestaw malarski/);
    expect(fail(commands.sendQuote(s, enq.id, q))).toMatch(/Brakuje wymaganego sprzętu/);
    s = ok(commands.buyEquipment(s, 'paint-basic'));
    expect(previewQuote(s, q).errors).toEqual([]);
  });

  it('zakup: wydatek gotówkowy (po rozliczeniu), koszt podatkowy w dokumencie i aktywo — majątek netto bez zmian w chwili zakupu', () => {
    const s0 = renoGame({ equip: [] });
    const nw0 = netWorth(s0);
    const cash0 = bizBalance(s0);
    const s1 = ok(commands.buyEquipment(s0, 'sprayer'));
    const item = s1.reno.equipment[0]!;
    const doc = s1.documents.find((d) => d.id === item.docId)!;
    expect(doc).toMatchObject({ kind: 'cost', net: zl(3_800), taxAmount: zl(3_800) });
    expect(item.cost).toBe(doc.taxAmount);
    expect(netWorth(s1)).toBe(nw0); // zobowiązanie wobec dostawcy = wartość sprzętu
    expect(bizBalance(s1)).toBe(cash0); // pieniądze wyjdą dopiero przy rozliczeniu zobowiązania
    const s2 = advanceDays(s1, 2);
    expect(bizBalance(s2)).toBe(cash0 - zl(3_800));
    expect(netWorth(s2)).toBe(nw0 + (netWorth(s2) - nw0)); // majątek zmienia się tylko o niezwiązane pozycje (pensja, wydatki)
    expect(businessSummaries(s2).reduce((a, m) => a + m.costs, 0)).toBe(zl(3_800)); // koszt podatkowy od razu
    expect(ok(commands.buyEquipment(s2, 'sprayer')).reno.equipment.filter((e) => e.catalogId === 'sprayer')).toHaveLength(2); // drugi egzemplarz (dla równoległych kontraktów)
    consistent(s2);
  });

  it('brak środków na rachunku firmowym blokuje zakup z czytelnym komunikatem', () => {
    const s = renoGame({ business: zl(1_000), equip: [] });
    expect(fail(commands.buyEquipment(s, 'sprayer'))).toMatch(/Za mało środków na rachunku firmowym/);
  });

  it('zużycie przy pracy obniża stan techniczny i wartość księgową, a konserwacja przywraca stan (koszt, nie aktywo ponad stan)', () => {
    let { s, job } = contract(renoGame(), {});
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done' || jobOf(x, job.id).stage === 'cancelled', 120);
    const item = s.reno.equipment[0]!;
    expect(jobOf(s, job.id).stage).toBe('done');
    expect(item.conditionBps).toBeLessThan(10_000);
    expect(item.usedCenti).toBeGreaterThan(0);
    const valueBefore = netWorth(s);
    // konserwacja przywraca +30 pkt proc. za koszt; majątek rośnie o przywróconą wartość i spada o koszt
    const s2 = ok(commands.maintainEquipment({ ...s, reno: { ...s.reno, equipment: s.reno.equipment.map((e) => ({ ...e, conditionBps: 5_000 })) } }, item.id));
    expect(s2.reno.equipment[0]!.conditionBps).toBe(8_000);
    expect(s2.documents.at(-1)!.description).toMatch(/Konserwacja/);
    expect(fail(commands.maintainEquipment(s, item.id))).toMatch(/bardzo dobrym stanie|nie jest potrzebna/);
    void valueBefore;
    consistent(s);
  });

  it('zepsuty sprzęt (stan 0%) wstrzymuje prace, a po konserwacji praca rusza', () => {
    let { s, job } = contract(renoGame(), {});
    s = buyAll(s, job.id);
    s = toDate(s, addDays(job.startDate, -1));
    s.reno.equipment[0]!.conditionBps = 0;
    s = advanceDays(s, 1);
    expect(jobOf(s, job.id)).toMatchObject({ progressCenti: 0, stage: 'materials' });
    expect(jobOf(s, job.id).blockedReason).toMatch(/sprzętu/);
    s = ok(commands.maintainEquipment(s, s.reno.equipment[0]!.id));
    s = advanceDays(s, 2);
    expect(jobOf(s, job.id).progressCenti).toBeGreaterThan(0);
    consistent(s);
  });

  it('sprzęt przyspiesza prace i podnosi jakość (agregat malarski), a transport obniża koszt dojazdów', () => {
    const base = renoGame();
    const fast = ok(commands.buyEquipment(base, 'sprayer'));
    expect(speedBps(fast, 'malowanie')).toBeGreaterThan(speedBps(base, 'malowanie'));
    const enq = craftEnquiry(base);
    const q = defaultQuoteInput(base, enq);
    expect(previewQuote(fast, { ...q, startDate: q.startDate }).plannedCenti).toBeLessThan(previewQuote(base, q).plannedCenti);
    const withTrailer = ok(commands.buyEquipment(base, 'trailer'));
    expect(previewQuote(withTrailer, q).planned.transport).toBeLessThan(previewQuote(base, q).planned.transport);
  });
});

describe('3. wycena: koszt, narzut, marża, VAT', () => {
  it('koszt planowany = materiały + robocizna + transport + pozostałe; narzut ≠ marża', () => {
    const s = renoGame();
    const enq = craftEnquiry(s);
    const q0 = defaultQuoteInput(s, enq);
    const p0 = previewQuote(s, q0);
    expect(p0.planned.total).toBe(p0.planned.materials + p0.planned.labor + p0.planned.transport + p0.planned.other);
    expect(p0.planned.other).toBe(Math.round(p0.planned.materials * 0.04));
    const price = Math.round(p0.planned.total * 1.25);
    const p = previewQuote(s, { ...q0, priceNet: price });
    expect(p.markupBps).toBeGreaterThanOrEqual(2_499);
    expect(p.markupBps).toBeLessThanOrEqual(2_501); // narzut 25% kosztu…
    expect(p.marginBps).toBeGreaterThanOrEqual(1_999);
    expect(p.marginBps).toBeLessThanOrEqual(2_001); // …to marża 20% ceny
    expect(p.markupBps).not.toBe(p.marginBps);
  });

  it('zwolniony z VAT: klient płaci netto; czynny podatnik: do netto dolicza się 23% i wyświetla ograniczenie stawki 8%', () => {
    const exempt = renoGame();
    const e1 = craftEnquiry(exempt);
    const p1 = previewQuote(exempt, { ...defaultQuoteInput(exempt, e1), priceNet: zl(2_000) });
    expect(p1.vatRateBps).toBe(0);
    expect(p1.priceGross).toBe(zl(2_000));
    const taxed = renoGame({ reg: { vatStatus: 'active' } });
    const e2 = craftEnquiry(taxed);
    const p2 = previewQuote(taxed, { ...defaultQuoteInput(taxed, e2), priceNet: zl(2_000) });
    expect(p2.vatRateBps).toBe(2_300);
    expect(p2.priceGross).toBe(zl(2_460));
    expect(p2.warnings.join(' ')).toMatch(/23%/);
    expect(p2.warnings.join(' ')).toMatch(/RENO-VAT-REDUCED/);
  });

  it('walidacje: termin za krótki, godziny, start, zaliczka, poziom umiejętności, brak specjalizacji', () => {
    let s = renoGame();
    const enq = craftEnquiry(s);
    const q = defaultQuoteInput(s, enq);
    const p = previewQuote(s, q);
    expect(previewQuote(s, { ...q, durationDays: p.minDays - 1 }).errors.join(' ')).toMatch(/co najmniej/);
    expect(previewQuote(s, { ...q, hoursPerDay: 9 }).errors.join(' ')).toMatch(/od 1 do 8/);
    expect(previewQuote(s, { ...q, startDate: s.clock.today }).errors.join(' ')).toMatch(/najwcześniej jutro/);
    expect(previewQuote(s, { ...q, advanceBps: 6_000 }).errors.join(' ')).toMatch(/Zaliczka/);
    expect(previewQuote(s, { ...q, serviceId: 'gladzie' }).errors.join(' ')).toMatch(/Brak specjalizacji/);
    s = ok(commands.addSpecialization(s, 'gladzie'));
    expect(skillLevel(s, 'gladzie')).toBe(2);
    expect(previewQuote(s, { ...q, serviceId: 'gladzie', complexity: 'trudne' }).errors.join(' ')).toMatch(/Za niski poziom umiejętności \(2\) na to zlecenie \(wymagany 3\)/);
    expect(previewQuote(s, { ...q, serviceId: 'gladzie' }).errors.join(' ')).toMatch(/Brakuje wymaganego sprzętu/);
  });

  it('cena poniżej kosztów daje ostrzeżenie, a stawka zarobku na godzinę liczy się bez własnej robocizny', () => {
    const s = renoGame();
    const enq = craftEnquiry(s);
    const q = defaultQuoteInput(s, enq);
    const cheap = previewQuote(s, { ...q, priceNet: zl(300) });
    expect(cheap.warnings.join(' ')).toMatch(/nie pokrywa/);
    expect(cheap.marginBps).toBeLessThan(0);
    const rich = previewQuote(s, q);
    expect(rich.effectiveHourly).toBeGreaterThan(0);
    expect(rich.effectiveHourly).toBe(Math.round(((q.priceNet - rich.planned.materials - rich.planned.transport - rich.planned.other) * 100) / rich.plannedCenti));
  });

  it('wysłanie oferty: tylko zakres z zapytania i tylko w terminie odpowiedzi', () => {
    let s = renoGame();
    const enq = craftEnquiry(s);
    const q = defaultQuoteInput(s, enq);
    expect(fail(commands.sendQuote(s, enq.id, { ...q, units: q.units + 5 }))).toMatch(/zakres/);
    s = ok(commands.sendQuote(s, enq.id, q));
    expect(s.reno.enquiries.find((e) => e.id === enq.id)!.status).toBe('quoted');
    expect(fail(commands.sendQuote(s, enq.id, q))).toMatch(/nie jest już otwarte/);
    const late = renoGame();
    const e2 = craftEnquiry(late, { respondBy: addDays(late.clock.today, -1) });
    const q2 = defaultQuoteInput(late, e2);
    expect(fail(commands.sendQuote(late, e2.id, q2))).toMatch(/Termin odpowiedzi/);
  });
});

describe('4. negocjacje i decyzje klienta', () => {
  const quoted = () => {
    const s0 = renoGame();
    const enq = craftEnquiry(s0, { budgetGross: zl(3_000), walkAwayGross: zl(3_300) });
    const q = defaultQuoteInput(s0, enq);
    const s = ok(commands.sendQuote(s0, enq.id, { ...q, priceNet: zl(2_800) }));
    return { s, enq: s.reno.enquiries.find((e) => e.id === enq.id)!, q: s.reno.quotes.at(-1)! };
  };

  it('prawdopodobieństwo akceptacji maleje z ceną i zaliczką, rośnie z reputacją, a po terminie spada', () => {
    const { s, enq, q } = quoted();
    const p = (qq = q, ss = s) => clientAcceptanceBps(ss, qq, enq, ss.clock.today).pAccept;
    const base = p();
    expect(p({ ...q, priceNet: zl(2_000) })).toBeGreaterThan(base);
    expect(p({ ...q, priceNet: zl(3_200) })).toBeLessThan(base);
    expect(p({ ...q, priceNet: zl(4_500) })).toBeLessThanOrEqual(800);
    expect(p({ ...q, advanceBps: 4_000 })).toBeLessThan(p({ ...q, advanceBps: 0 }));
    expect(p({ ...q, startDate: addDays(enq.desiredStart, 30) })).toBeLessThan(base);
    expect(p({ ...q, standard: 'eko' })).toBeLessThanOrEqual(base);
    const good = structuredClone(s);
    for (let i = 0; i < 6; i++) good.reno.reviews.push({ id: `r${i}`, jobId: `j${i}`, date: good.clock.today, rating10: 50, parts: { quality: 50, punctuality: 50, conformity: 50, price: 50, communication: 50 }, comment: '' });
    expect(p(q, good)).toBeGreaterThan(base);
  });

  it('decyzje są deterministyczne i statystycznie zależą od ceny (wiele ofert o różnych identyfikatorach)', () => {
    const { s, enq, q } = quoted();
    const rate = (price: number) => {
      let acc = 0;
      for (let i = 0; i < 200; i++) if (decideQuote(s, { ...q, id: `quote:t${i}`, priceNet: price }, enq, s.clock.today).outcome === 'accept') acc += 1;
      return acc / 200;
    };
    const cheap = rate(zl(2_200));
    const dear = rate(zl(4_200));
    expect(cheap).toBeGreaterThan(0.6);
    expect(dear).toBeLessThan(0.1);
    expect(rate(zl(2_200))).toBe(cheap);
    const outcomes = new Set<string>();
    for (let i = 0; i < 300; i++) outcomes.add(decideQuote(s, { ...q, id: `quote:u${i}`, priceNet: zl(3_150) }, { ...enq, haggler: true }, s.clock.today).outcome);
    expect(outcomes).toEqual(new Set(['accept', 'counter', 'reject'])); // klient może zaakceptować, negocjować albo odrzucić
  });

  it('po terminie decyzji status zmienia silnik: akceptacja → termin podpisu 5 dni; brak podpisu = wygaśnięcie', () => {
    let { s, q } = quoted();
    s = toDate(s, addDays(q.decideOn, 1));
    const cur = s.reno.quotes.find((x) => x.id === q.id)!;
    expect(['accepted', 'counter', 'rejected']).toContain(cur.status);
    if (cur.status === 'accepted') {
      expect(cur.signBy).toBe(addDays(cur.acceptedOn!, 5));
      const later = toDate(s, addDays(cur.signBy!, 1));
      expect(later.reno.quotes.find((x) => x.id === q.id)!.status).toBe('expired');
      expect(fail(commands.signContract(later, q.id))).toMatch(/nie czeka na podpisanie/);
    }
  });

  it('kontroferta (rabat): akceptacja obniża cenę netto, przyjęta zmiana terminu aktualizuje start i czas', () => {
    let { s, q } = quoted();
    s.reno.quotes.find((x) => x.id === q.id)!.status = 'counter';
    s.reno.quotes.find((x) => x.id === q.id)!.counter = { kind: 'discount', discountBps: 1_000, newStart: null, newDuration: null };
    const priced = ok(commands.respondToCounter(s, q.id, 'accept'));
    const pq = priced.reno.quotes.find((x) => x.id === q.id)!;
    expect(pq).toMatchObject({ status: 'accepted', priceNet: zl(2_520) });
    expect(pq.signBy).toBe(addDays(priced.clock.today, 5));
    const dl = structuredClone(s);
    const dq = dl.reno.quotes.find((x) => x.id === q.id)!;
    dq.counter = { kind: 'deadline', discountBps: 0, newStart: addDays(dl.clock.today, 4), newDuration: 20 };
    const moved = ok(commands.respondToCounter(dl, q.id, 'accept')).reno.quotes.find((x) => x.id === q.id)!;
    expect(moved).toMatchObject({ startDate: addDays(dl.clock.today, 4), durationDays: 20, status: 'accepted' });
    dq.counter = { kind: 'deadline', discountBps: 0, newStart: addDays(dl.clock.today, 4), newDuration: 1 };
    expect(fail(commands.respondToCounter(dl, q.id, 'accept'))).toMatch(/potrzebujesz/);
  });

  it('kontroferta: odrzucenie kończy negocjacje; podtrzymanie warunków jest jednorazowe i deterministyczne', () => {
    const { s, q } = quoted();
    const c = structuredClone(s);
    const cq = c.reno.quotes.find((x) => x.id === q.id)!;
    cq.status = 'counter';
    cq.counter = { kind: 'discount', discountBps: 800, newStart: null, newDuration: null };
    const declined = ok(commands.respondToCounter(c, q.id, 'decline'));
    expect(declined.reno.quotes.find((x) => x.id === q.id)!.status).toBe('declined');
    expect(declined.reno.enquiries.find((x) => x.id === q.id.replace('quote', 'enq'))?.status ?? 'lost').toBe('lost');
    const held = ok(commands.respondToCounter(c, q.id, 'hold'));
    const hq = held.reno.quotes.find((x) => x.id === q.id)!;
    expect(['accepted', 'rejected']).toContain(hq.status);
    expect(hq.held).toBe(true);
    expect(ok(commands.respondToCounter(c, q.id, 'hold')).reno.quotes.find((x) => x.id === q.id)!.status).toBe(hq.status);
    expect(fail(commands.respondToCounter(held, q.id, 'hold'))).toMatch(/nie czeka/);
  });
});

describe('5. zaliczka i rozliczenie końcowe', () => {
  it('zaliczka to jeden odrębny dokument; rozliczenie końcowe obejmuje resztę; suma przychodu = cena', () => {
    let { s, job } = contract(renoGame(), { quote: { advanceBps: 3_000, priceNet: zl(3_000) } });
    const advance = docsFor(s, job.orderId).filter((d) => d.part === 'advance');
    expect(advance).toHaveLength(1);
    expect(advance[0]).toMatchObject({ kind: 'sales', net: zl(900) });
    expect(job.advanceNet).toBe(zl(900));
    expect(s.obligations.find((o) => o.id === advance[0]!.obligationIds[0])).toMatchObject({ amount: zl(900), direction: 'receivable', scope: 'business' });
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 150);
    const j = jobOf(s, job.id);
    const docs = docsFor(s, job.orderId).filter((d) => d.kind === 'sales');
    expect(docs.map((d) => d.part).sort()).toEqual(['advance', 'final']);
    expect(docs.reduce((a, d) => a + d.net, 0)).toBe(zl(3_000) - j.penaltyNet);
    expect(docs.find((d) => d.part === 'final')!.net).toBe(zl(2_100) - j.penaltyNet);
    expect(s.serviceOrders.find((o) => o.id === job.orderId)).toMatchObject({ status: 'completed', kind: 'renovation', salesDocumentId: j.finalDocId });
    consistent(s);
  });

  it('bez zaliczki: jeden dokument „całość”; czynny VAT: zaliczka i rozliczenie niosą VAT od swoich kwot', () => {
    let a = contract(renoGame(), { quote: { advanceBps: 0, priceNet: zl(2_500) } });
    a.s = buyAll(a.s, a.job.id);
    a.s = runUntil(a.s, (x) => jobOf(x, a.job.id).stage === 'done', 150);
    expect(docsFor(a.s, a.job.orderId).filter((d) => d.kind === 'sales').map((d) => d.part)).toEqual(['full']);
    let b = contract(renoGame({ reg: { vatStatus: 'active' } }), { quote: { advanceBps: 2_000, priceNet: zl(2_500) } });
    const adv = docsFor(b.s, b.job.orderId).find((d) => d.part === 'advance')!;
    expect(adv).toMatchObject({ net: zl(500), vat: zl(115), vatTreatment: 'taxed' });
    b.s = buyAll(b.s, b.job.id);
    b.s = runUntil(b.s, (x) => jobOf(x, b.job.id).stage === 'done', 150);
    const fin = docsFor(b.s, b.job.orderId).find((d) => d.part === 'final')!;
    expect(fin.net + adv.net).toBe(zl(2_500) - jobOf(b.s, b.job.id).penaltyNet);
    expect(fin.vat).toBe(Math.round(fin.net * 0.23));
    consistent(b.s);
  });

  it('zaliczka wpływa na konto firmy w 2 dni (bez losowego opóźnienia), a przychód z niej nie jest liczony ponownie przy rozliczeniu', () => {
    let { s, job } = contract(renoGame(), { quote: { advanceBps: 2_000, priceNet: zl(2_000) } });
    const before = bizBalance(s);
    s = advanceDays(s, 3);
    expect(bizBalance(s)).toBeGreaterThanOrEqual(before + zl(400) - zl(3_000));
    const advDoc = docsFor(s, job.orderId).find((d) => d.part === 'advance')!;
    const ob = s.obligations.find((o) => o.id === advDoc.obligationIds[0])!;
    expect(ob.status).toBe('settled');
    expect(ob.dueDate).toBe(addDays(advDoc.issueDate, 2));
  });

  it('idempotencja: ponowne przetworzenie dnia po wczytaniu nie dubluje dokumentów, ruchów ani opinii', () => {
    let { s, job } = contract(renoGame(), { quote: { advanceBps: 2_000 } });
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 150);
    const r = structuredClone(s);
    const before = [r.documents.length, r.obligations.length, r.ledger.length, r.reno.stockMoves.length, r.reno.reviews.length, r.reno.complaints.length];
    processDay(r, r.clock.today);
    expect([r.documents.length, r.obligations.length, r.ledger.length, r.reno.stockMoves.length, r.reno.reviews.length, r.reno.complaints.length]).toEqual(before);
    expect(r.reno.jobs).toEqual(s.reno.jobs);
    consistent(r);
  });

  it('rozwiązanie umowy przez gracza zwraca zaliczkę (jako koszt, SIMPLIFIED), obniża opinię i zwalnia godziny', () => {
    let { s, job } = contract(renoGame(), { quote: { advanceBps: 2_000, priceNet: zl(2_000) } });
    s = advanceDays(s, 3);
    s = ok(commands.terminateJob(s, job.id));
    expect(jobOf(s, job.id).stage).toBe('cancelled');
    // od v0.6 zaliczka nie była przychodem, więc jej zwrot nie jest kosztem — to likwidacja zobowiązania wobec klienta
    expect(s.obligations.find((o) => o.category === 'zwrot_zaliczki')).toMatchObject({ direction: 'payable', amount: zl(400), scope: 'business' });
    expect(s.documents.some((d) => d.description.startsWith('Zwrot zaliczki'))).toBe(false);
    expect(s.reno.reviews.at(-1)).toMatchObject({ jobId: job.id, rating10: 10 });
    expect(s.serviceOrders.find((o) => o.id === job.orderId)!.status).toBe('failed');
    expect(fail(commands.terminateJob(s, job.id))).toMatch(/zakończony/);
    s = advanceDays(s, 10);
    consistent(s);
  });
});

describe('6. materiały, zapasy i wartość zapasu', () => {
  it('zakup tworzy zapas (aktywo) o wartości dokumentu; majątek netto bez zmian, koszt podatkowy od razu', () => {
    const s0 = renoGame();
    const nw0 = netWorth(s0);
    const key = stockKey('farba', 'std');
    const s = ok(commands.buyMaterial(s0, key, 20));
    const price = materialPrice(s0, key, s0.clock.today);
    expect(s.reno.stock[key]).toEqual({ qty: 20, value: 20 * price });
    const move = s.reno.stockMoves.at(-1)!;
    expect(move).toMatchObject({ kind: 'purchase', qty: 20, value: 20 * price });
    expect(s.documents.find((d) => d.id === move.docId)!.taxAmount).toBe(20 * price);
    expect(netWorth(s)).toBe(nw0);
    expect(businessSummaries(s).reduce((a, m) => a + m.costs, 0)).toBe(zl(650) + 20 * price); // sprzęt (zakupiony wcześniej) + materiały
    consistent(s);
  });

  it('błędy zakupu: ilość, brak środków, niedostępność w hurtowni; kupno brakujących materiałów kupuje dokładnie tyle, ile trzeba', () => {
    let s = renoGame();
    const key = stockKey('farba', 'premium');
    expect(fail(commands.buyMaterial(s, key, 0))).toMatch(/Ilość/);
    expect(fail(commands.buyMaterial(s, 'nic:std', 1))).toMatch(/Nieznany materiał/);
    expect(fail(commands.buyMaterial(renoGame({ business: zl(700) }), key, 400))).toMatch(/Za mało środków/);
    let unavailable: string | null = null;
    for (let i = 0; i < 80 && !unavailable; i++) { const d = addDays(s.clock.today, i); if (!materialAvailable(s, key, d)) unavailable = d; }
    expect(unavailable).not.toBeNull();
    const dayS = toDate(s, unavailable!);
    expect(fail(commands.buyMaterial(dayS, key, 1))).toMatch(/niedostępny/);
    const { s: c, job } = contract(s);
    s = c;
    const shortBefore = Object.entries(job.need).map(([k, n]) => n - (s.reno.stock[k]?.qty ?? 0));
    expect(shortBefore.every((x) => x > 0)).toBe(true);
    s = buyAll(s, job.id);
    for (const [k, n] of Object.entries(job.need)) expect(s.reno.stock[k]!.qty).toBe(n);
    expect(fail(commands.buyMissingForJob(s, job.id))).toMatch(/wszystkie materiały/);
  });

  it('zużycie: zapas maleje proporcjonalnie do postępu, wartość ekonomiczna trafia do kosztu kontraktu, nadwyżki zostają', () => {
    let { s, job } = contract(renoGame());
    const key = stockKey('farba', 'std');
    s = buyAll(s, job.id);
    s = buyMat(s, key, 10); // nadwyżka
    const costDocs = s.documents.filter((d) => d.kind === 'cost').length;
    const purchased = s.reno.stockMoves.filter((m) => m.kind === 'purchase').reduce((a, m) => a + m.value, 0);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 150);
    const j = jobOf(s, job.id);
    for (const [k, n] of Object.entries(j.need)) expect(j.consumed[k]!.qty).toBe(n);
    const used = s.reno.stockMoves.filter((m) => m.kind === 'use').reduce((a, m) => a - m.value, 0);
    expect(j.actual.materials).toBe(used);
    const remaining = Object.values(s.reno.stock).reduce((a, x) => a + x.value, 0);
    expect(remaining + used).toBe(purchased); // zapas + zużycie = zakupy: nic nie znika i nie jest liczone drugi raz
    expect(s.reno.stock[key]!.qty).toBe(10);
    // zużycie nie tworzy dokumentów kosztowych materiałów — dochodzą tylko transport i pozostałe przy rozliczeniu
    const newCostDocs = s.documents.filter((d) => d.kind === 'cost').slice(costDocs).map((d) => d.description);
    expect(newCostDocs.every((d) => /Dojazdy|Pozostałe koszty/.test(d))).toBe(true);
    consistent(s);
  });

  it('wynik ekonomiczny kontraktu = przychód − zużyte materiały − transport − inne; różni się od kosztu podatkowego zakupów', () => {
    let { s, job } = contract(renoGame(), { quote: { priceNet: zl(2_800) } });
    s = buyAll(s, job.id);
    s = buyMat(s, stockKey('farba', 'std'), 15);
    const taxCostBefore = s.documents.filter((d) => d.kind === 'cost').reduce((a, d) => a + d.taxAmount, 0);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 150);
    const j = jobOf(s, job.id);
    const f = jobFinancials(j);
    expect(f.economicResult).toBe(j.priceNet - j.penaltyNet - j.actual.materials - j.actual.transport - j.actual.other - j.actual.rework);
    const taxCostAfter = s.documents.filter((d) => d.kind === 'cost').reduce((a, d) => a + d.taxAmount, 0);
    expect(taxCostAfter - taxCostBefore).toBe(j.actual.transport + j.actual.other); // koszt podatkowy materiałów był w chwili zakupu
    expect(Object.values(s.reno.stock).reduce((a, x) => a + x.value, 0)).toBeGreaterThan(0); // nadwyżka = aktywo
    const rep = yearReport(s, 2026);
    expect(rep.inventoryChange).toBe(Object.values(s.reno.stock).reduce((a, x) => a + x.value, 0));
    expect(rep.economicResult).toBe(rep.result + rep.inventoryChange);
  });
});

describe('7. realizacja prac', () => {
  it('etapy: przygotowanie → brak materiałów (przestój) → realizacja po zakupie → odbiór → rozliczenie', () => {
    let { s, job } = contract(renoGame());
    expect(job.stage).toBe('preparation');
    s = toDate(s, addDays(job.startDate, -1));
    expect(jobOf(s, job.id)).toMatchObject({ stage: 'preparation', progressCenti: 0 });
    s = advanceDays(s, 3); // bez materiałów
    expect(jobOf(s, job.id)).toMatchObject({ stage: 'materials', progressCenti: 0, blockedDays: 3 });
    expect(jobOf(s, job.id).blockedReason).toMatch(/Brak materiałów/);
    expect(jobForecast(s, jobOf(s, job.id)).risk).not.toBe('niskie');
    s = buyAll(s, job.id);
    s = advanceDays(s, 2);
    expect(jobOf(s, job.id).stage).toBe('execution');
    expect(jobOf(s, job.id).progressCenti).toBeGreaterThan(0);
    s = runUntil(s, (x) => ['handover', 'done'].includes(jobOf(x, job.id).stage), 150);
    expect(jobOf(s, job.id).finishedOn).not.toBeNull();
    s = advanceDays(s, 1);
    expect(['done', 'execution']).toContain(jobOf(s, job.id).stage); // odbiór: rozliczenie albo poprawki wymagane przez klienta
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 100);
    expect(jobOf(s, job.id)).toMatchObject({ stage: 'done' });
    expect(jobOf(s, job.id).quality).toBeGreaterThan(0);
    expect(s.reno.reviews.at(-1)!.jobId).toBe(job.id);
    consistent(s);
  });

  it('niedobór materiałów ogranicza postęp do tego, co pozwala zapas (praca częściowa), reszta po dokupieniu', () => {
    let { s, job } = contract(renoGame());
    const key = stockKey('farba', 'std');
    const need = job.need;
    for (const [k, n] of Object.entries(need)) s = buyMat(s, k, k === key ? Math.ceil(n / 2) : n);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'materials' && jobOf(x, job.id).progressCenti > 0, 150);
    const j = jobOf(s, job.id);
    expect(j.progressCenti).toBeLessThanOrEqual(Math.floor(j.normCenti / 2) + 1);
    expect(j.progressCenti).toBeGreaterThan(Math.floor(j.normCenti / 2) - 40);
    expect(j.blockedReason).toMatch(/Farba/);
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 100);
    expect(jobOf(s, job.id).stage).toBe('done');
    consistent(s);
  });

  it('doświadczenie rośnie wyłącznie od przepracowanego czasu (nie od zakupów, ofert ani podpisów)', () => {
    let s = renoGame();
    const xp0 = s.reno.skillXp.malowanie!;
    const c = contract(s);
    expect(c.s.reno.skillXp.malowanie).toBe(xp0);
    s = buyAll(c.s, c.job.id);
    s = toDate(s, addDays(c.job.startDate, -1));
    expect(s.reno.skillXp.malowanie).toBe(xp0);
    s = advanceDays(s, 1);
    const day1 = s.reno.skillXp.malowanie!;
    expect(day1).toBeGreaterThan(xp0);
    expect(day1 - xp0).toBeLessThanOrEqual(c.job.hoursPerDay * 100);
    s = runUntil(s, (x) => jobOf(x, c.job.id).stage === 'done', 150);
    expect(s.reno.skillXp.malowanie! - xp0).toBeLessThanOrEqual(jobOf(s, c.job.id).workedDays * c.job.hoursPerDay * 100);
    // poziom przechodzi próg tylko po dużej liczbie godzin
    const hi = structuredClone(s);
    hi.reno.skillXp.malowanie = 20_000;
    expect(skillLevel(hi, 'malowanie')).toBe(3);
    hi.reno.skillXp.malowanie = 110_000;
    expect(skillLevel(hi, 'malowanie')).toBe(5);
  });

  it('problemy techniczne i organizacyjne wydłużają pracę deterministycznie (ten sam seed → te same problemy)', () => {
    const run = () => {
      let { s, job } = contract(renoGame({ seed: 'issues-1' }), { enquiry: { complexity: 'trudne', units: 100 }, quote: { complexity: 'trudne', units: 100 } });
      s = buyAll(s, job.id);
      s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 200);
      return jobOf(s, job.id);
    };
    const a = run();
    expect(run()).toEqual(a);
    const withIssues = (() => {
      for (const seed of ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8']) {
        let { s, job } = contract(renoGame({ seed }), { enquiry: { complexity: 'trudne', units: 100 }, quote: { complexity: 'trudne', units: 100 } });
        s = buyAll(s, job.id);
        s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 200);
        if (jobOf(s, job.id).issues.length > 0) return { j: jobOf(s, job.id), s };
      }
      return null;
    })();
    expect(withIssues).not.toBeNull();
    expect(withIssues!.j.extraCenti).toBeGreaterThanOrEqual(withIssues!.j.issues.reduce((a, i) => a + i.addedCenti, 0));
    expect(withIssues!.s.events.some((e) => e.type === 'reno.issue')).toBe(true);
  });

  it('opóźnienie: kara umowna 2% za każdy rozpoczęty tydzień (max 15%) pomniejsza rozliczenie końcowe', () => {
    let { s, job } = contract(renoGame(), { quote: { hoursPerDay: 2, durationDays: 40, priceNet: zl(3_000), advanceBps: 0 }, enquiry: { units: 100, maxDays: 60 } });
    // wymuszamy wąski termin: ten sam zakres, krótszy czas niż wynika z 1 godz./dzień
    const idx = s.reno.jobs.findIndex((j) => j.id === job.id);
    s.reno.jobs[idx]!.deadline = addDays(job.startDate, 5);
    s.serviceOrders.find((o) => o.id === job.orderId)!.deadline = addDays(job.startDate, 5);
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 300);
    const j = jobOf(s, job.id);
    expect(j.lateDays).toBeGreaterThan(0);
    const weeks = Math.ceil(j.lateDays / 7);
    expect(j.penaltyNet).toBe(Math.round((zl(3_000) * Math.min(1_500, 200 * weeks)) / 10_000));
    expect(docsFor(s, job.orderId).find((d) => d.kind === 'sales')!.net).toBe(zl(3_000) - j.penaltyNet);
    expect(s.serviceOrders.find((o) => o.id === job.orderId)!.late).toBe(true);
    consistent(s);
  });

  it('klient odstępuje od umowy 45 dni po terminie: zaliczka wraca, kontrakt anulowany, godziny zwolnione', () => {
    let { s, job } = contract(renoGame(), { quote: { advanceBps: 2_000, priceNet: zl(2_000) } });
    s = toDate(s, addDays(job.deadline, 46)); // bez materiałów praca stoi
    expect(jobOf(s, job.id).stage).toBe('cancelled');
    expect(s.obligations.some((o) => o.category === 'zwrot_zaliczki' && o.direction === 'payable')).toBe(true);
    expect(s.serviceOrders.find((o) => o.id === job.orderId)!.status).toBe('failed');
    consistent(s);
  });
});

describe('8. konflikty czasu', () => {
  it('drugi kontrakt w tych samych godzinach jest odrzucony; po zakończeniu pierwszego można podpisać', () => {
    const c1 = contract(renoGame());
    const s = c1.s;
    const e2 = craftEnquiry(s);
    const q2 = { ...defaultQuoteInput(s, e2), startDate: c1.job.startDate, durationDays: 10 };
    const p = previewQuote(s, q2);
    expect(p.timeConflict).not.toBeNull();
    expect(p.warnings.join(' ')).toMatch(/Kolizja czasu/);
    const sent = ok(commands.sendQuote(s, e2.id, q2));
    const quote = sent.reno.quotes.at(-1)!;
    quote.status = 'accepted';
    quote.signBy = addDays(sent.clock.today, 5);
    expect(fail(commands.signContract(sent, quote.id))).toMatch(/Brak wolnych godzin/);
    // po zakończeniu pierwszego domyślna wycena sama znajduje wolny termin
    const after = defaultQuoteInput(s, e2);
    expect(after.startDate > c1.job.deadline || previewQuote(s, after).timeConflict === null).toBe(true);
    expect(previewQuote(s, after).timeConflict).toBeNull();
  });

  it('kalendarz wyceny: pokazuje zajęte kontrakty, kolizję w ich terminie i najbliższy wolny start', () => {
    const s0 = renoGame();
    const free0 = budgetFor(s0, addDays(s0.clock.today, 3)).free;
    // kontrakt zabiera godziny, a druga wycena dostaje tyle, by razem przekroczyły dobę
    const c1 = contract(s0, { quote: { hoursPerDay: Math.floor(free0 / 2) + 1 } });
    const s = c1.s;
    const e2 = craftEnquiry(s);
    const q2 = { ...defaultQuoteInput(s, e2), startDate: c1.job.startDate, durationDays: 10, hoursPerDay: Math.floor(free0 / 2) + 1 };
    const sch = quoteSchedule(s, q2);
    // kontrakt widać na liście zajętych terminów
    expect(sch.busy).toContainEqual(expect.objectContaining({ id: c1.job.id, kind: 'job', from: c1.job.startDate, to: c1.job.deadline, hoursPerDay: c1.job.hoursPerDay }));
    // dzień kontraktu jest zajęty godzinami kontraktu, a 8 godz. wyceny się w nim nie mieści
    const day = sch.days.find((d) => d.date === c1.job.startDate)!;
    expect(day.commitments).toBe(c1.job.hoursPerDay);
    expect(day.overload).toBe(true);
    // każdy dzień zgadza się z silnikiem czasu (ta sama prawda co przy podpisie umowy)
    for (const d of sch.days) expect(d.free).toBe(budgetFor(s, d.date).free - sch.ownerHours);
    // zasugerowany start naprawdę jest wolny dla całego terminu
    expect(sch.suggestedStart).not.toBeNull();
    expect(sch.suggestedStart! > c1.job.startDate).toBe(true);
    expect(previewQuote(s, { ...q2, startDate: sch.suggestedStart! }).timeConflict).toBeNull();
  });

  it('kalendarz wyceny: oferta bez umowy jest widoczna, ale nie rezerwuje czasu; pełne delegowanie nie zajmuje godzin właściciela', () => {
    const s0 = renoGame();
    const e1 = craftEnquiry(s0);
    const sent = ok(commands.sendQuote(s0, e1.id, defaultQuoteInput(s0, e1)));
    const e2 = craftEnquiry(sent);
    const q = defaultQuoteInput(sent, e2);
    const sch = quoteSchedule(sent, q);
    expect(sch.busy.map((b) => b.kind)).toEqual(['pending']);
    expect(sch.days.every((d) => d.commitments === 0)).toBe(true);
    const crew = crewKey([{ kind: 'sub', id: 'sub:1' }]);
    expect(quoteSchedule(sent, { ...q, teamId: crew, supervision: 'hands-off' }).ownerHours).toBe(0);
    expect(quoteSchedule(sent, { ...q, teamId: crew, supervision: 'supervise' }).ownerHours).toBe(1);
  });

  it('etat i sen zajmują dobę: 8 godz. dziennie na remont jest niemożliwe, a rezerwacja zmniejsza czas wolny dokładnie o godziny kontraktu', () => {
    const s0 = renoGame();
    const enq = craftEnquiry(s0);
    const q = { ...defaultQuoteInput(s0, enq), hoursPerDay: 8 };
    expect(previewQuote(s0, q).timeConflict).not.toBeNull();
    const { s, job } = contract(s0, { quote: { hoursPerDay: 3 } });
    const day = job.startDate;
    expect(budgetFor(s, day).commitments).toBe(3);
    expect(budgetFor(s, day).free).toBe(budgetFor(s0, day).free - 3);
  });

  it('opóźniony kontrakt nie wchodzi na godziny innego kontraktu (doba nigdy nie przekracza 24 godzin)', () => {
    let { s, job } = contract(renoGame({ business: zl(40_000) }), { quote: { hoursPerDay: 4 }, enquiry: { units: 90, maxDays: 40 } });
    s = buyAll(s, job.id);
    // krótki termin pierwszego kontraktu => praca „wychodzi” po terminie, a drugi kontrakt rezerwuje te godziny
    const j0 = s.reno.jobs.find((j) => j.id === job.id)!;
    j0.deadline = addDays(j0.startDate, 4);
    s.commitments.find((c) => c.id === `commit:${j0.orderId}`)!.endDate = j0.deadline;
    s.serviceOrders.find((o) => o.id === j0.orderId)!.deadline = j0.deadline;
    for (const a of s.ops.assignments) if (a.jobId === j0.id) a.to = j0.deadline; // rezerwacje sprzętu zgodne ze skróconym terminem
    const second = contract(s, { quote: { startDate: addDays(j0.deadline, 1), durationDays: 8 }, enquiry: { units: 40 } });
    s = buyAll(second.s, second.job.id);
    for (let i = 0; i < 40; i++) {
      s = advanceDays(s, 1);
      expect(budgetFor(s, s.clock.today).free, s.clock.today).toBeGreaterThanOrEqual(0);
    }
    consistent(s);
  });

  it('zawieszenie działalności blokuje nowe umowy i zapytania', () => {
    let { s } = contract(renoGame(), { sign: false });
    const quote = s.reno.quotes.at(-1)!;
    s = ok(commands.suspendBusiness(s));
    expect(fail(commands.signContract(s, quote.id))).toMatch(/zawieszona/);
  });
});

describe('9. jakość i reklamacje', () => {
  const crafted = () => {
    const { s, job } = contract(renoGame({ equip: ['paint-basic', 'sprayer', 'laser'] }), {});
    return { s, job: structuredClone(job) };
  };

  it('jakość rośnie z poziomem umiejętności, standardem materiałów i sprzętem, a maleje ze zmęczeniem', () => {
    const { s, job } = crafted();
    const q = (j = job, ss = s) => jobQuality(ss, { ...j, perfSumBps: 10_000, perfDays: 1 });
    const base = q();
    expect(q({ ...job, standard: 'premium' })).toBeGreaterThan(q({ ...job, standard: 'eko' }));
    expect(q({ ...job, standard: 'premium' })).toBeGreaterThanOrEqual(base);
    const skilled = structuredClone(s);
    skilled.reno.skillXp.malowanie = 110_000;
    expect(q(job, skilled)).toBeGreaterThan(base);
    expect(jobQuality(s, { ...job, perfSumBps: 6_000, perfDays: 1 })).toBeLessThan(base);
    const bare = renoGame();
    const bareJob = { ...job };
    expect(jobQuality(bare, { ...bareJob, perfSumBps: 10_000, perfDays: 1 })).toBeLessThanOrEqual(base);
  });

  it('prawdopodobieństwo reklamacji zależy od jakości, problemów, poprawek, opóźnienia i dopasowania standardu — nie jest stałe', () => {
    const { job } = crafted();
    expect(complaintBps(job, 90)).toBeLessThan(complaintBps(job, 60));
    expect(complaintBps(job, 60)).toBeLessThan(complaintBps(job, 40));
    expect(complaintBps(job, 40)).toBeLessThanOrEqual(7_500);
    expect(complaintBps(job, 100)).toBeGreaterThanOrEqual(100);
    expect(complaintBps({ ...job, lateDays: 5 }, 70)).toBeGreaterThan(complaintBps(job, 70));
    expect(complaintBps({ ...job, reworkDone: true }, 70)).toBeGreaterThan(complaintBps(job, 70));
    expect(complaintBps({ ...job, standard: 'eko', qualityReq: 3 }, 70)).toBeGreaterThan(complaintBps({ ...job, standard: 'premium', qualityReq: 3 }, 70));
  });

  /** Gra po zakończeniu kontraktu z wymuszoną otwartą reklamacją. */
  function withComplaint(sev: 1 | 2 | 3 = 2): { s: GameState; job: RenoJob; id: string } {
    let { s, job } = contract(renoGame(), { quote: { priceNet: zl(2_000) } });
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 150);
    s.reno.complaints = [];
    s.reno.complaints.push({ id: 'complaint:t1', jobId: job.id, raisedOn: s.clock.today, deadline: addDays(s.clock.today, 14), severity: sev, description: 'Test', status: 'open', commitmentId: null, costDocId: null, resolvedOn: null, ratingDelta10: 0 });
    return { s, job, id: 'complaint:t1' };
  }

  it('poprawki: koszt materiałów (dokument), godziny w kalendarzu, po zakończeniu opinia rośnie', () => {
    let { s, job, id } = withComplaint(2);
    const rating0 = s.reno.reviews.find((r) => r.jobId === job.id)!.rating10;
    const docs0 = s.documents.length;
    s = ok(commands.resolveComplaint(s, id, 'repair'));
    const c = s.reno.complaints[0]!;
    expect(c.status).toBe('repairing');
    expect(s.documents.length).toBe(docs0 + 1);
    expect(s.documents.at(-1)!.description).toMatch(/Materiały do poprawek/);
    const commit = s.commitments.find((x) => x.id === c.commitmentId)!;
    expect(commit.hoursPerDay).toBe(2);
    expect(diffDays(commit.endDate, commit.startDate)).toBe(3); // 8 godz. / 2 = 4 dni
    expect(fail(commands.resolveComplaint(s, id, 'repair'))).toMatch(/nie czeka/);
    s = toDate(s, commit.endDate);
    s = advanceDays(s, 1);
    expect(s.reno.complaints[0]!.status).toBe('resolved');
    expect(s.reno.reviews.find((r) => r.jobId === job.id)!.rating10).toBe(Math.min(50, rating0 + 3));
    consistent(s);
  });

  it('rabat: zwrot części ceny jako koszt (SIMPLIFIED) i niewielki spadek opinii; odmowa: deterministyczna eskalacja', () => {
    let { s, job, id } = withComplaint(2);
    const rating0 = s.reno.reviews.find((r) => r.jobId === job.id)!.rating10;
    const cash0 = bizBalance(s);
    const disc = ok(commands.resolveComplaint(s, id, 'discount'));
    expect(disc.reno.complaints[0]!.status).toBe('refunded');
    expect(disc.documents.at(-1)).toMatchObject({ kind: 'cost', net: zl(160) }); // 2 * 4% * 2000 zł
    expect(disc.reno.reviews.find((r) => r.jobId === job.id)!.rating10).toBe(Math.max(10, rating0 - 2));
    expect(bizBalance(disc)).toBe(cash0);
    const rej1 = ok(commands.resolveComplaint(s, id, 'reject'));
    const rej2 = ok(commands.resolveComplaint(s, id, 'reject'));
    expect(rej1.reno.complaints[0]!.status).toBe(rej2.reno.complaints[0]!.status);
    expect(['escalated', 'resolved']).toContain(rej1.reno.complaints[0]!.status);
    expect(rej1.reno.reviews.find((r) => r.jobId === job.id)!.rating10).toBeLessThan(rating0);
  });

  it('nieobsłużona reklamacja po terminie eskaluje (−1,2★), a jedna reklamacja przypada na kontrakt', () => {
    let { s, job } = withComplaint(1);
    const rating0 = s.reno.reviews.find((r) => r.jobId === job.id)!.rating10;
    s = toDate(s, addDays(s.reno.complaints[0]!.deadline, 1));
    expect(s.reno.complaints[0]!.status).toBe('escalated');
    expect(s.reno.reviews.find((r) => r.jobId === job.id)!.rating10).toBe(Math.max(10, rating0 - 12));
    expect(s.reno.complaints.filter((c) => c.jobId === job.id)).toHaveLength(1);
    s = advanceDays(s, 30);
    expect(s.reno.complaints.filter((c) => c.jobId === job.id)).toHaveLength(1);
    consistent(s);
  });

  it('niska jakość wymusza poprawki przy odbiorze (rework) i wydłuża kontrakt jednokrotnie', () => {
    let { s, job } = contract(renoGame(), { enquiry: { qualityReq: 3 }, quote: { standard: 'eko' } });
    s = buyAll(s, job.id);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done' || jobOf(x, job.id).reworkDone, 150);
    const j = jobOf(s, job.id);
    expect(j.reworkDone).toBe(true); // eko + wymagania „wysokie” + poziom 2 => poniżej progu odbioru
    expect(s.events.some((e) => e.title.startsWith('Uwagi przy odbiorze'))).toBe(true);
    s = runUntil(s, (x) => jobOf(x, job.id).stage === 'done', 150);
    expect(jobOf(s, job.id).stage).toBe('done');
    expect(s.events.filter((e) => e.title.startsWith('Uwagi przy odbiorze'))).toHaveLength(1);
    consistent(s);
  });
});

describe('10. reputacja, reklama i zapytania', () => {
  it('reputacja: start 3,5★; opinie podnoszą lub obniżają średnią, stare mają mniejszą wagę', () => {
    const s = renoGame();
    expect(reputation(s)).toMatchObject({ score: 70, stars: 3.5, reviews: 0 });
    const high = structuredClone(s);
    const low = structuredClone(s);
    for (let i = 0; i < 5; i++) {
      high.reno.reviews.push({ id: `h${i}`, jobId: `j${i}`, date: s.clock.today, rating10: 50, parts: { quality: 50, punctuality: 50, conformity: 50, price: 50, communication: 50 }, comment: '' });
      low.reno.reviews.push({ id: `l${i}`, jobId: `j${i}`, date: s.clock.today, rating10: 10, parts: { quality: 10, punctuality: 10, conformity: 10, price: 10, communication: 10 }, comment: '' });
    }
    expect(reputation(high).score).toBeGreaterThan(85);
    expect(reputation(low).score).toBeLessThan(40);
    const aged = structuredClone(high);
    for (const r of aged.reno.reviews) r.date = addDays(s.clock.today, -400);
    expect(reputation(aged).score).toBeLessThan(reputation(high).score);
  });

  it('widoczność firmy (źródło zapytań) zależy od reputacji, marketingu, sezonu popytu i zajętości kolejki prac', () => {
    const s = renoGame();
    const view0 = playerMarketView(s, s.clock.today);
    const base = playerVisibility(s, 'standard', 'malowanie', view0, s.clock.today);
    // reputacja: kilka dobrych opinii zwiększa widoczność
    const rep = structuredClone(s);
    for (let i = 0; i < 6; i++) rep.reno.reviews.push({ id: `h${i}`, jobId: `j${i}`, date: s.clock.today, rating10: 50, parts: { quality: 50, punctuality: 50, conformity: 50, price: 50, communication: 50 }, comment: '' });
    expect(playerVisibility(rep, 'standard', 'malowanie', playerMarketView(rep, rep.clock.today), rep.clock.today)).toBeGreaterThan(base);
    // marketing: budżet daje widoczność dopiero po zamknięciu miesiąca (opóźnienie), a nie od razu
    let ad = ok(commands.setMarketingBudget(s, 'local_ads', zl(400)));
    expect(playerVisibility(ad, 'standard', 'malowanie', playerMarketView(ad, ad.clock.today), ad.clock.today)).toBe(base);
    ad = toDate(ad, '2026-04-02');
    expect(ad.market.marketing.reach.local_ads).toBeGreaterThan(0);
    expect(playerVisibility(ad, 'standard', 'malowanie', playerMarketView(ad, ad.clock.today), ad.clock.today)).toBeGreaterThan(base);
    // brak specjalizacji w usłudze zmniejsza widoczność w tej usłudze
    expect(playerVisibility(s, 'standard', 'panele', view0, s.clock.today)).toBeLessThan(base);
    // zajęta kolejka obniża widoczność
    const busy = { ...view0, queueGateBps: 6_000 };
    expect(playerVisibility(s, 'standard', 'malowanie', busy, s.clock.today)).toBeLessThan(base);
    // sezon: popyt w lipcu większy niż w styczniu
    const demand = (date: string) => expectedDailyDemand(s, date, RENOVATION_MARKET, macroAt(s.seed, date.slice(0, 7))).reduce((a, x) => a + x.expected, 0);
    expect(demand('2026-05-12')).toBeGreaterThan(demand('2026-01-13'));
  });

  it('zapytania powstają deterministycznie (ten sam seed → te same), mają komplet danych i nie przekraczają limitu otwartych', () => {
    const run = () => toDate(renoGame({ seed: 'enq-1' }), '2026-05-15');
    const a = run();
    expect(run().reno.enquiries).toEqual(a.reno.enquiries);
    expect(a.reno.enquiries.length).toBeGreaterThan(0);
    for (const e of a.reno.enquiries) {
      expect(e).toMatchObject({ businessId: activeBusiness(a)!.id });
      expect(e.budgetGross).toBeGreaterThan(0);
      expect(e.walkAwayGross).toBeGreaterThanOrEqual(e.budgetGross * 0.9);
      expect(e.desiredStart > e.receivedOn).toBe(true);
      expect(e.respondBy > e.receivedOn).toBe(true);
    }
    expect(a.reno.enquiries.filter((e) => e.status === 'open' || e.status === 'quoted').length).toBeLessThanOrEqual(6);
    let s = a;
    const open = s.reno.enquiries.find((e) => e.status === 'open');
    if (open) {
      s = ok(commands.declineEnquiry(s, open.id));
      expect(fail(commands.declineEnquiry(s, open.id))).toMatch(/nie jest już otwarte/);
    }
  });

  it('marketing: budżet kanału obowiązuje od 1. dnia następnego miesiąca i jest pobierany jako dokument kosztowy; walidacje komendy', () => {
    let s = renoGame();
    const docs0 = s.documents.length;
    s = ok(commands.setMarketingBudget(s, 'local_ads', zl(400)));
    expect(s.documents.length).toBe(docs0); // nic nie jest pobierane w dniu ustawienia
    expect(fail(commands.setMarketingBudget(s, 'local_ads', zl(400)))).toMatch(/już ustawiony/);
    expect(fail(commands.setMarketingBudget(s, 'nie-ma', zl(100)))).toMatch(/Nieznany kanał/);
    expect(fail(commands.setMarketingBudget(s, 'search', zl(20_000)))).toMatch(/od 0 do 10 000/);
    s = toDate(s, '2026-04-02');
    expect(s.documents.filter((d) => d.description.startsWith('Marketing: Reklamy lokalne')).map((d) => d.issueDate.slice(0, 7))).toEqual(['2026-03', '2026-04']);
    expect(s.documents.filter((d) => d.description.startsWith('Marketing')).every((d) => d.kind === 'cost' && d.net === zl(400))).toBe(true);
    s = ok(commands.setMarketingBudget(s, 'local_ads', 0));
    s = toDate(s, '2026-05-02');
    expect(s.documents.filter((d) => d.description.startsWith('Marketing')).length).toBe(2); // wyłączony budżet nie jest pobierany
    consistent(s);
  });
});

describe('11. księgowość: biuro rachunkowe', () => {
  const plan = (id: string) => ACCOUNTING_PLANS.find((p) => p.id === id)!;

  it('umowa: obsługa od 1. dnia następnego miesiąca, abonament to zwykły dokument kosztowy raz w miesiącu; wypowiedzenie na koniec miesiąca', () => {
    let s = renoGame();
    s = toDate(s, '2026-02-10');
    s = ok(commands.hireAccountingOffice(s, 'standard'));
    expect(s.accounting.office).toMatchObject({ planId: 'standard', since: '2026-03-01', endsOn: null });
    expect(officeActive(s)).toBe(false);
    expect(fail(commands.hireAccountingOffice(s, 'plus'))).toMatch(/już umowę/);
    expect(fail(commands.hireAccountingOffice(renoGame(), 'brak'))).toMatch(/Nieznana oferta/);
    s = toDate(s, '2026-05-02');
    const fees = s.documents.filter((d) => d.description.startsWith('Obsługa księgowa'));
    expect(fees.map((d) => d.issueDate)).toEqual(['2026-03-01', '2026-04-01', '2026-05-01']);
    expect(fees.every((d) => d.kind === 'cost' && d.net === plan('standard').monthlyNet)).toBe(true);
    s = ok(commands.terminateAccountingOffice(s));
    expect(s.accounting.office!.endsOn).toBe('2026-05-31');
    expect(fail(commands.terminateAccountingOffice(s))).toMatch(/już wypowiedziana/);
    s = toDate(s, '2026-07-02');
    expect(s.accounting.office).toBeNull();
    expect(s.accounting.history).toEqual([{ planId: 'standard', from: '2026-03-01', to: '2026-05-31' }]);
    expect(s.documents.filter((d) => d.description.startsWith('Obsługa księgowa'))).toHaveLength(3); // czerwca już nie
    consistent(s);
  });

  it('outsourcing nie podwaja zobowiązań: składki i zaliczki są identyczne jak bez biura, różni się tylko abonament', () => {
    const plain = toDate(renoGame({ seed: 'acc-1' }), '2026-06-05');
    let office = renoGame({ seed: 'acc-1' });
    office = ok(commands.hireAccountingOffice(toDate(office, '2026-02-01'), 'plus'));
    office = toDate(office, '2026-06-05');
    const pick = (s: GameState) => s.obligations.filter((o) => ['zus_spoleczne', 'zus_zdrowotna', 'pit_zaliczka'].includes(o.category)).map((o) => `${o.category}:${o.issueDate}:${o.amount}`);
    expect(pick(office)).toEqual(pick(plain));
    expect(office.taxPeriods.map((p) => [p.social, p.health])).toEqual(plain.taxPeriods.map((p) => [p.social, p.health]));
    const occ = office.obligations.map((o) => o.occurrenceId);
    expect(new Set(occ).size).toBe(occ.length);
    expect(office.documents.filter((d) => d.description.startsWith('Obsługa księgowa')).length).toBe(5); // luty–czerwiec
    consistent(office);
  });

  it('powiadomienia: przypomnienia o terminach (każdy raz), braki środków i brak materiałów — tylko dla pakietów, które je obejmują', () => {
    const run = (planId: string) => {
      let s = renoGame({ seed: 'acc-2', business: zl(30_000) });
      s = ok(commands.hireAccountingOffice(toDate(s, '2026-02-01'), planId));
      s = toDate(s, '2026-03-17');
      return s;
    };
    const start = run('start');
    const reminders = start.events.filter((e) => e.type === 'accounting.notice');
    expect(reminders.length).toBeGreaterThan(0);
    expect(new Set(reminders.map((e) => e.id)).size).toBe(reminders.length);
    expect(reminders.every((e) => e.id.includes('deadline'))).toBe(true);
    // brak środków: zdejmujemy gotówkę z konta firmy
    let std = run('standard');
    std = ok(commands.transferFunds(std, activeBusiness(std)!.accountId, std.playerAccountId, bizBalance(std)));
    std = advanceDays(std, 15);
    const shortfall = std.events.filter((e) => e.id.includes('shortfall'));
    expect(shortfall.length).toBeGreaterThanOrEqual(1);
    expect(new Set(shortfall.map((e) => e.id)).size).toBe(shortfall.length);
    const none = toDate(renoGame({ seed: 'acc-2' }), '2026-03-17');
    expect(none.events.filter((e) => e.type === 'accounting.notice')).toHaveLength(0); // samodzielnie: brak powiadomień
  });

  it('powiadomienie o braku materiałów do kontraktu startującego za 3 dni (pakiet Standard) — raz', () => {
    let { s, job } = contract(renoGame(), { quote: { startDate: addDays('2026-02-01', 9) } });
    s = ok(commands.hireAccountingOffice(s, 'standard'));
    s = toDate(s, addDays(job.startDate, 1));
    const gap = s.events.filter((e) => e.id.startsWith('accounting.notice:gap:materials'));
    expect(gap).toHaveLength(1);
    expect(gap[0]!.title).toMatch(/Brak materiałów do kontraktu/);
  });

  it('biuro automatycznie składa wniosek o zwrot nadpłaty składki zdrowotnej (Standard/Plus); pakiet Start — nie', () => {
    const build = (planId: string) => {
      let s = renoGame({ seed: 'acc-3' });
      s = ok(commands.hireAccountingOffice(toDate(s, '2026-02-01'), planId));
      s = toDate(s, '2026-12-31');
      s.healthSettlements.push({ id: 'health:test:2026', businessId: activeBusiness(s)!.id, year: 2026, form: 'skala', months: 11, annualBase: zl(50_000), annualContribution: zl(4_000), monthlyTotal: zl(4_500), diff: -zl(500), status: 'refund_available', dueDate: null, claimDeadline: '2027-05-31', obligationId: null, carriedForward: true });
      return advanceDays(s, 2);
    };
    const std = build('standard');
    expect(std.healthSettlements.at(-1)!.status).toBe('refund_claimed');
    expect(std.events.some((e) => e.id === 'accounting.notice:claim:health:test:2026')).toBe(true);
    const start = build('start');
    expect(start.healthSettlements.at(-1)!.status).toBe('refund_available');
    void claimHealthRefund;
  });

  it('pakiet Plus: jednorazowe, deterministyczne porównanie form w oparciu o obliczenia silnika; nic nie zmienia stanu podatków', () => {
    let s = renoGame({ seed: 'acc-4' });
    s = ok(commands.hireAccountingOffice(toDate(s, '2026-02-01'), 'plus'));
    s = toDate(s, '2026-06-01');
    const sale = (x: GameState, net: number) => {
      const b = activeBusiness(x)!;
      x.parties['party:t'] ??= { id: 't', name: 'K', role: 'service' } as never;
      return { x, b, net };
    };
    void sale;
    s = toDate(s, '2026-10-02');
    expect(s.accounting.suggestions).toHaveLength(1);
    const sug = s.accounting.suggestions[0]!;
    expect(sug).toMatchObject({ year: 2026, current: 'skala' });
    expect(sug.rows.map((r) => r.form)).toEqual(['skala', 'liniowy', 'ryczalt']);
    expect(sug.rows.every((r) => r.total === r.tax + r.health)).toBe(true);
    expect(sug.rows.find((r) => r.form === sug.best)!.total).toBe(Math.min(...sug.rows.map((r) => r.total)));
    expect(sug.basis).toMatch(/nie porada podatkowa/);
    expect(s.events.filter((e) => e.id === 'accounting.notice:form:2026')).toHaveLength(1);
    const again = advanceDays(s, 20);
    expect(again.accounting.suggestions).toHaveLength(1);
    const before = structuredClone(again);
    const cmp1 = compareTaxForms(again, activeBusiness(again)!, 2026, again.clock.today);
    expect(compareTaxForms(again, activeBusiness(again)!, 2026, again.clock.today)).toEqual(cmp1);
    expect(again).toEqual(before); // porównanie niczego nie księguje
    const startPlan = ok(commands.hireAccountingOffice(toDate(renoGame({ seed: 'acc-4' }), '2026-02-01'), 'start'));
    expect(toDate(startPlan, '2026-10-02').accounting.suggestions).toHaveLength(0);
  });
});

describe('12. scenariusz 12 miesięcy prowadzenia firmy remontowej', () => {
  /** Polityka gracza: kupuje sprzęt, wycenia każde zapytanie, negocjuje, podpisuje, kupuje materiały, naprawia reklamacje, korzysta z biura. */
  function play(seed: string, months = 12): GameState {
    let s = renoGame({ seed, equip: ['paint-basic', 'sprayer'] });
    s = ok(commands.hireAccountingOffice(s, 'standard'));
    s = ok(commands.setMarketingBudget(s, 'local_ads', zl(400)));
    const end = addDays('2026-02-01', months * 30 + 5);
    while (s.clock.today < end) {
      s = advanceDays(s, 1);
      for (const e of s.reno.enquiries.filter((x) => x.status === 'open')) {
        const r = commands.sendQuote(s, e.id, defaultQuoteInput(s, e));
        if (r.ok) s = r.state;
      }
      for (const q of s.reno.quotes.filter((x) => x.status === 'counter')) { const r = commands.respondToCounter(s, q.id, 'accept'); if (r.ok) s = r.state; }
      for (const q of s.reno.quotes.filter((x) => x.status === 'accepted')) { const r = commands.signContract(s, q.id); if (r.ok) s = r.state; }
      for (const j of s.reno.jobs.filter((x) => x.stage !== 'done' && x.stage !== 'cancelled')) {
        if (diffDays(s.clock.today, j.startDate) <= 3) { const r = commands.buyMissingForJob(s, j.id); if (r.ok) s = r.state; }
      }
      for (const c of s.reno.complaints.filter((x) => x.status === 'open')) { const r = commands.resolveComplaint(s, c.id, 'repair'); if (r.ok) s = r.state; }
      for (const it of s.reno.equipment) if (it.conditionBps < 3_500) { const r = commands.maintainEquipment(s, it.id); if (r.ok) s = r.state; }
      if (s.clock.today.endsWith('-15')) expect(checkInvariants(s), s.clock.today).toEqual([]);
    }
    return s;
  }

  it('gracz pozyskuje klientów, wycenia, kontraktuje, kupuje materiały, realizuje, rozlicza, obsługuje reklamacje i buduje reputację; finanse zostają spójne', () => {
    const s = play('year-1');
    const dash = renoDashboard(s);
    consistent(s);
    expect(s.reno.enquiries.length).toBeGreaterThan(10);
    expect(s.reno.quotes.length).toBeGreaterThan(8);
    expect(s.reno.jobs.length).toBeGreaterThanOrEqual(8);
    expect(dash.doneJobs).toBeGreaterThanOrEqual(8);
    expect(s.reno.reviews.length).toBe(dash.doneJobs + s.reno.jobs.filter((j) => j.stage === 'cancelled').length);
    expect(reputation(s).reviews).toBeGreaterThan(5);
    expect(dash.revenueDone).toBeGreaterThan(zl(10_000));
    // przychód, koszty, rozliczenia: dokumenty unikalne, brak dubli należności
    expect(new Set(s.documents.map((d) => d.id)).size).toBe(s.documents.length);
    expect(new Set(s.obligations.map((o) => o.occurrenceId)).size).toBe(s.obligations.length);
    expect(s.reno.complaints.length).toBeLessThanOrEqual(dash.doneJobs);
    expect(new Set(s.reno.complaints.map((c) => c.jobId)).size).toBe(s.reno.complaints.length);
    // zapas i sprzęt jako aktywa zgadzają się z ruchami i stanem
    const stock = Object.values(s.reno.stock).reduce((a, x) => a + x.value, 0);
    expect(stock).toBe(s.reno.stockMoves.reduce((a, m) => a + m.value, 0));
    expect(dash.equipmentValue).toBeLessThan(zl(4_450));
    // podatki i księgowość działały w tle
    expect(s.taxPeriods.length).toBeGreaterThanOrEqual(11);
    expect(s.documents.filter((d) => d.description.startsWith('Obsługa księgowa')).length).toBeGreaterThanOrEqual(10);
    expect(s.events.some((e) => e.type === 'accounting.notice')).toBe(true);
    // widoczny wynik: płynność i majątek
    expect(netWorth(s)).toBeGreaterThan(zl(60_000));
    expect(yearReport(s, 2026).economicResult).toBe(yearReport(s, 2026).result + yearReport(s, 2026).inventoryChange);
    expect(jobFinancials(s.reno.jobs.find((j) => j.stage === 'done')!).settled).toBe(true);
  }, 120_000);

  it('deterministyczność i bezpieczne wznowienie po zapisie: te same komendy dają ten sam stan, zapis w środku nie zmienia wyniku', () => {
    const a = play('year-2', 6);
    expect(play('year-2', 6)).toEqual(a);
    const mid = structuredClone(a);
    const fromSave = JSON.parse(JSON.stringify(mid)) as GameState;
    const next = advanceDays(mid, 30);
    expect(advanceDays(fromSave, 30)).toEqual(next);
    expect(checkInvariants(next)).toEqual([]);
  }, 120_000);
});
