import { activeBusiness } from './business.ts';
import type { RegisterInput } from './business.ts';
import { commands } from './commands.ts';
import type { CommandResult } from './commands.ts';
import { recordHistory } from './core.ts';
import { addDays, diffDays } from './date.ts';
import { checkInvariants } from './invariants.ts';
import { zl } from './money.ts';
import { createNewGame } from './newGame.ts';
import { defaultQuoteInput } from './renovation.ts';
import type { QuoteInput } from './renovation.ts';
import { advanceDays } from './simulate.ts';
import type { Candidate, Employment, GameState, RenoEnquiry, RenoJob, WorkerPerson } from './state.ts';

/** Wspólne pomocniki testów v0.6 (gra remontowa, kontrakty „na skróty” przez prawdziwe komendy, kandydaci i pracownicy). */

export const ok = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(`komenda odrzucona: ${r.error}`);
  return r.state;
};
export const fail = (r: CommandResult): string => {
  if (r.ok) throw new Error('komenda powinna zostać odrzucona');
  return r.error;
};
export const toDate = (s: GameState, date: string): GameState => (diffDays(date, s.clock.today) <= 0 ? s : advanceDays(s, diffDays(date, s.clock.today)));
export const bizBalance = (s: GameState) => s.accounts[activeBusiness(s)!.accountId]!.balance;
export const consistentErrors = (s: GameState) => checkInvariants(s);

export const REG: RegisterInput = { name: 'Remonty Test', profileId: 'remonty', taxForm: 'skala', vatStatus: 'exempt', startDate: '2026-02-01', zusStart: 'ulga', sickness: false, specialization: 'malowanie' };

export function fund(state: GameState, amount: number): GameState {
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

/** Firma remontowa po starcie (1 lutego 2026) z dużym kapitałem na rachunku firmowym i kompletem sprzętu do malowania (2 zestawy). */
export function opsGame(o: { seed?: string; reg?: Partial<RegisterInput>; business?: number; equip?: string[]; birth?: string } = {}): GameState {
  let s = createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed: o.seed ?? 'ops-1', lifeEvents: false });
  s.person.birthDate = o.birth ?? '1990-05-05';
  s = fund(s, zl(300_000));
  s = ok(commands.registerBusiness(s, { ...REG, ...o.reg }));
  s = toDate(s, '2026-02-01');
  s = ok(commands.transferFunds(s, s.playerAccountId, activeBusiness(s)!.accountId, o.business ?? zl(150_000)));
  for (const e of o.equip ?? ['paint-basic', 'paint-basic']) s = ok(commands.buyEquipment(s, e));
  return s;
}

export function craftEnquiry(s: GameState, o: Partial<RenoEnquiry> = {}): RenoEnquiry {
  const n = (s.counters['reno:enquiry'] ?? 0) + 1;
  s.counters['reno:enquiry'] = n;
  const id = `enq:${n}`;
  const clientId = `party:client:${id}`;
  s.parties[clientId] = { id: clientId, name: 'Klient testowy (fikcyjny)', role: 'service' };
  const enq: RenoEnquiry = {
    id, businessId: activeBusiness(s)!.id, clientId, clientName: 'Klient testowy (fikcyjny)', location: 'Jaroty', serviceId: 'malowanie', units: 60, complexity: 'standard', qualityReq: 2,
    desiredStart: addDays(s.clock.today, 5), maxDays: 40, budgetGross: zl(6_000), walkAwayGross: zl(6_800), haggler: false, flexDays: 3, receivedOn: s.clock.today, respondBy: addDays(s.clock.today, 7), status: 'open', ...o,
  };
  s.reno.enquiries.push(enq);
  return enq;
}

export interface ContractOpts { enquiry?: Partial<RenoEnquiry>; quote?: Partial<QuoteInput>; sign?: boolean }
export function contract(s0: GameState, o: ContractOpts = {}): { s: GameState; job: RenoJob; enq: RenoEnquiry } {
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
export const jobOf = (s: GameState, id: string) => s.reno.jobs.find((j) => j.id === id)!;
export const docsFor = (s: GameState, orderId: string) => s.documents.filter((d) => d.orderId === orderId);
export function runUntil(s: GameState, pred: (x: GameState) => boolean, max = 200): GameState {
  let cur = s;
  for (let i = 0; i < max && !pred(cur); i++) cur = advanceDays(cur, 1);
  return cur;
}
export function buyAll(s0: GameState, jobId: string): GameState {
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

/** Wstawia kandydata (osobę + zgłoszenie) bez losowania — do testów negocjacji wynagrodzenia. */
export function craftCandidate(s: GameState, o: { expected?: number; level?: number; availableFrom?: string; skillId?: string; birth?: string } = {}): { cand: Candidate; person: WorkerPerson } {
  const lid = s.ops.listings.at(-1)?.id ?? `listing:${(s.counters['hr:listing'] ?? 0) + 1}`;
  if (!s.ops.listings.some((l) => l.id === lid)) s.ops.listings.push({ id: lid, businessId: activeBusiness(s)!.id, role: 'malarz', skillId: 'malowanie', minLevel: 1, tier: 'basic', postedOn: s.clock.today, endsOn: addDays(s.clock.today, 21), status: 'active', costDocId: null, commitmentId: null });
  const pn = (s.counters['hr:person'] ?? 0) + 1;
  s.counters['hr:person'] = pn;
  const person: WorkerPerson = {
    id: `person:${pn}`, firstName: 'Adam', lastName: `Testowy${pn}`, birthDate: o.birth ?? '1990-03-03', xp: { [o.skillId ?? 'malowanie']: [0, 0, 4_000, 20_000, 50_000, 110_000][o.level ?? 2]! },
    expectedGross: o.expected ?? zl(5_400), availableFrom: o.availableFrom ?? s.clock.today, diligence: 70, loyalty: 60, morale: 60, fatigue: 10, status: 'candidate', lastWorkedOn: null,
  };
  s.ops.people.push(person);
  const cn = (s.counters['hr:candidate'] ?? 0) + 1;
  s.counters['hr:candidate'] = cn;
  const cand: Candidate = { id: `cand:${cn}`, listingId: lid, personId: person.id, appliedOn: s.clock.today, expiresOn: addDays(s.clock.today, 14), status: 'new', rounds: 0, lastOffer: null, counterGross: null, note: '', employmentId: null };
  s.ops.candidates.push(cand);
  return { cand, person };
}

/** Zatrudnia pracownika „na skróty”, ale przez prawdziwą komendę oferty (oferta ≥ oczekiwań; ponawiana do skutku). */
export function hireEmployee(s0: GameState, o: { level?: number; expected?: number; hours?: number; start?: string } = {}): { s: GameState; emp: Employment } {
  let s = structuredClone(s0);
  const hours = o.hours ?? 160;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { cand, person } = craftCandidate(s, { level: o.level, expected: (o.expected ?? zl(5_400)) + attempt * 10 });
    const expectedPart = Math.round((person.expectedGross * hours) / 160 / 1_000) * 1_000;
    const start = o.start ?? addDays(s.clock.today, 1);
    s = ok(commands.makeOffer(s, cand.id, { gross: Math.max(expectedPart, Math.round((person.expectedGross * hours) / 160)), hoursPerMonth: hours, startDate: start }));
    if (s.ops.candidates.find((x) => x.id === cand.id)!.status === 'hired') return { s, emp: s.ops.employments.at(-1)! };
  }
  throw new Error('nie udało się zatrudnić pracownika w 6 próbach');
}
