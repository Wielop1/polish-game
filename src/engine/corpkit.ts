import { commands } from './commands.ts';
import type { DraftInput } from './company.ts';
import { zl } from './money.ts';
import { createNewGame } from './newGame.ts';
import { advanceDays } from './simulate.ts';
import type { Company, GameState } from './state.ts';
import { fail, fund, ok, toDate } from './testkit.ts';

/** Pomocniki testów v0.8: gra z kapitałem, szkic spółki, zawarcie umowy i rejestracja. */

export const DRAFT: DraftInput = { name: 'Remonty Olsztyn', cityId: 'olsztyn', profileId: 'remonty', specialization: 'malowanie', vatPlan: 'exempt', capital: zl(10_000), nominal: zl(50), representation: 'each_alone' };

export function richGame(seed = 'corp-1', cash = zl(200_000)): GameState {
  let s = createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed, lifeEvents: false });
  s.person.birthDate = '1990-05-05';
  s = fund(s, cash);
  return s;
}

/** Ustawia cechy postaci AI tak, by testy nie zależały od losowej puli. */
export function shapePartner(s: GameState, id: string, o: Partial<GameState['corp']['partners'][number]>): GameState {
  const c = structuredClone(s);
  Object.assign(c.corp.partners.find((p) => p.id === id)!, o);
  return c;
}

export const company = (s: GameState, id = 'co:1'): Company => s.corp.companies.find((c) => c.id === id)!;

/** Szkic → (zaproszenie wspólnika) → umowa spółki → rejestracja w KRS (dzień później). */
export function foundCompany(s0: GameState, o: { draft?: Partial<DraftInput>; partnerId?: string; partnerShares?: number; board?: 'player' | 'both' } = {}): GameState {
  let s = ok(commands.createCompanyDraft(s0, { ...DRAFT, ...o.draft }));
  const id = s.corp.companies.at(-1)!.id;
  const board = [{ personId: s.person.id, role: 'president' as const }];
  if (o.partnerId) {
    s = ok(commands.proposeDeal(s, { kind: 'found', companyId: id, partnerId: o.partnerId, terms: { shares: o.partnerShares ?? 40, amount: 0, percentBps: 0, role: 'board_member', dividendPolicy: 'none' } }));
    const neg = s.corp.negotiations.at(-1)!;
    if (neg.status === 'countered') s = ok(commands.acceptCounter(s, neg.id));
    if (s.corp.negotiations.at(-1)!.status !== 'agreed') throw new Error(`negocjacja nieuzgodniona: ${s.corp.negotiations.at(-1)!.reason}`);
    if (o.board === 'both') board.push({ personId: o.partnerId, role: 'member' as never });
  }
  s = ok(commands.signAgreement(s, { companyId: id, board, file: true }));
  return toDate(s, advanceDaysTo(s, 2));
}

const advanceDaysTo = (s: GameState, n: number) => {
  const d = new Date(`${s.clock.today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export { fail, ok, toDate, advanceDays };

/* ---------- Spółka z działalnością remontową ---------- */
import { addDays } from './date.ts';
import { defaultQuoteInput } from './renovation.ts';
import type { QuoteInput } from './renovation.ts';
import { operatorView, withOperator } from './operator.ts';
import { craftCandidate, craftEnquiry } from './testkit.ts';
import type { Employment, RenoEnquiry, RenoJob } from './state.ts';

/** Zarejestrowana spółka z uruchomioną działalnością (start 1. dnia następnego miesiąca), wybrana jako aktywny podmiot, z kompletem sprzętu do malowania. */
export function companyWithOps(o: { seed?: string; capital?: number; partnerId?: string; partnerShares?: number; vat?: 'exempt' | 'active'; equip?: string[]; board?: 'player' | 'both'; representation?: 'each_alone' | 'joint_two' | 'all_jointly'; cash?: number } = {}): GameState {
  let s = richGame(o.seed ?? 'corp-ops', o.cash ?? zl(400_000));
  if (o.partnerId) s = shapePartner(s, o.partnerId, { trust: 70, capital: zl(400_000), riskTolerance: 60, competence: 60, dividendPreference: 50, goal: 'growth' });
  s = foundCompany(s, { draft: { capital: o.capital ?? zl(150_000), vatPlan: o.vat ?? 'exempt', representation: o.representation ?? 'each_alone' }, partnerId: o.partnerId, partnerShares: o.partnerShares, board: o.board });
  s = ok(commands.startCompanyOperation(s, 'co:1', {}));
  s = toDate(s, company(s).operation!.startDate);
  s = ok(commands.selectOperator(s, 'co:1'));
  for (const e of o.equip ?? ['paint-basic', 'paint-basic']) s = ok(commands.buyEquipment(s, e));
  return s;
}

export function companyEnquiry(s0: GameState, o: Partial<RenoEnquiry> = {}): { s: GameState; enq: RenoEnquiry } {
  const s = structuredClone(s0);
  const enq = withOperator(s, 'co:1', () => craftEnquiry(s, o));
  return { s, enq };
}

export const companyView = (s: GameState): GameState => operatorView(s, 'co:1');

export function companyHire(s0: GameState, o: { level?: number; expected?: number; hours?: number } = {}): { s: GameState; emp: Employment } {
  let s = structuredClone(s0);
  const hours = o.hours ?? 160;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { cand, person } = withOperator(s, 'co:1', () => craftCandidate(s, { level: o.level, expected: (o.expected ?? zl(5_400)) + attempt * 10 }));
    const expectedPart = Math.round((person.expectedGross * hours) / 160 / 1_000) * 1_000;
    s = ok(commands.makeOffer(s, cand.id, { gross: Math.max(expectedPart, Math.round((person.expectedGross * hours) / 160)), hoursPerMonth: hours, startDate: addDays(s.clock.today, 1) }));
    const sl = company(s).slices.ops;
    if (sl.candidates.find((x) => x.id === cand.id)!.status === 'hired') return { s, emp: sl.employments.at(-1)! };
  }
  throw new Error('nie udało się zatrudnić pracownika');
}

export function companyContract(s0: GameState, o: { enquiry?: Partial<RenoEnquiry>; quote?: Partial<QuoteInput> } = {}): { s: GameState; job: RenoJob } {
  let { s, enq } = companyEnquiry(s0, o.enquiry);
  const view = companyView(s);
  const q = { ...defaultQuoteInput(view, enq), ...o.quote };
  s = ok(commands.sendQuote(s, enq.id, q));
  const quote = company(s).slices.reno.quotes.at(-1)!;
  quote.status = 'accepted';
  quote.acceptedOn = s.clock.today;
  quote.signBy = addDays(s.clock.today, 5);
  company(s).slices.reno.enquiries.find((e) => e.id === enq.id)!.status = 'won';
  s = ok(commands.signContract(s, quote.id));
  return { s, job: company(s).slices.reno.jobs.at(-1)! };
}

/* ---------- Polityka gracza prowadzącego spółkę przez N miesięcy (jak scenariusz 24 miesięcy dla JDG) ---------- */
import { diffDays } from './date.ts';
import { jobShortage, previewQuote } from './renovation.ts';
import { checkInvariants } from './invariants.ts';

export function playCompany(s0: GameState, months: number, o: { onMonthEnd?: (s: GameState) => GameState; marketing?: boolean; margin?: number } = {}): GameState {
  let s = s0;
  if (o.marketing !== false) {
    for (const [ch, amount] of [['search', zl(800)], ['portals', zl(600)], ['local_ads', zl(400)]] as const) s = ok(commands.setMarketingBudget(s, ch, amount));
  }
  const end = addDays(s.clock.today, months * 30);
  let day = 0;
  while (s.clock.today < end) {
    s = advanceDays(s, 1);
    day += 1;
    const sl = company(s).slices;
    if (day >= 5 && sl.ops.employments.length < 1 && !sl.ops.listings.some((l) => l.status === 'active')) {
      const r = commands.publishListing(s, { role: 'malarz', minLevel: 1, tier: 'premium' });
      if (r.ok) s = r.state;
    }
    for (const c of company(s).slices.ops.candidates.filter((x) => x.status === 'new' || x.status === 'countered')) {
      if (company(s).slices.ops.employments.length >= 1) break;
      const p = company(s).slices.ops.people.find((x) => x.id === c.personId)!;
      const r = commands.makeOffer(s, c.id, { gross: Math.max(c.counterGross ?? 0, p.expectedGross), hoursPerMonth: 160, startDate: addDays(s.clock.today, Math.max(1, diffDays(p.availableFrom, s.clock.today))) });
      if (r.ok) s = r.state;
    }
    for (const e of company(s).slices.ops.employments.filter((x) => x.status === 'active')) {
      if (company(s).slices.ops.teams.some((t) => t.members.some((m) => m.id === e.id))) continue;
      const r = commands.createTeam(s, 'Ekipa spółki', [{ kind: 'employee', id: e.id }]);
      if (r.ok) s = r.state;
    }
    const view = () => companyView(s);
    for (const e of company(s).slices.reno.enquiries.filter((x) => x.status === 'open').slice(0, 2)) {
      let q: QuoteInput = { ...defaultQuoteInput(view(), e), advanceBps: 1_500 };
      for (const tm of company(s).slices.ops.teams) {
        let cand = { ...q, teamId: tm.id, supervision: 'hands-off' as const, vehicleId: null };
        let pv = previewQuote(view(), cand);
        if (pv.errors.length) continue;
        cand = { ...cand, durationDays: Math.max(cand.durationDays, pv.minDays + 3) };
        pv = previewQuote(view(), cand);
        if (pv.errors.length || pv.warnings.some((w) => w.includes('przydzielony') || w.includes('Kolizja'))) continue;
        q = { ...cand, priceNet: Math.round((pv.planned.total * (o.margin ?? 1.3)) / 1_000) * 1_000 };
        break;
      }
      const r = commands.sendQuote(s, e.id, q);
      if (r.ok) s = r.state;
    }
    for (const q of company(s).slices.reno.quotes.filter((x) => x.status === 'counter')) { const r = commands.respondToCounter(s, q.id, 'accept'); if (r.ok) s = r.state; }
    for (const q of company(s).slices.reno.quotes.filter((x) => x.status === 'accepted')) { const r = commands.signContract(s, q.id); if (r.ok) s = r.state; }
    for (const j of company(s).slices.reno.jobs.filter((x) => x.stage !== 'done' && x.stage !== 'cancelled')) {
      if (diffDays(j.startDate, s.clock.today) <= 3 && Object.keys(jobShortage(view(), j)).length > 0) { const r = commands.buyMissingForJob(s, j.id); if (r.ok) s = r.state; }
    }
    for (const c of company(s).slices.reno.complaints.filter((x) => x.status === 'open')) { const r = commands.resolveComplaint(s, c.id, 'repair'); if (r.ok) s = r.state; }
    for (const it of company(s).slices.reno.equipment) if (it.conditionBps < 3_500) { const r = commands.maintainEquipment(s, it.id); if (r.ok) s = r.state; }
    if (s.clock.today.endsWith('-15')) {
      const errs = checkInvariants(s);
      if (errs.length) throw new Error(`niezmienniki ${s.clock.today}: ${errs.slice(0, 3).join(' | ')}`);
    }
    if (o.onMonthEnd && s.clock.today.endsWith('-28')) s = o.onMonthEnd(s);
  }
  return s;
}

/* ---------- Bezpośrednie dokumenty spółki (do testów podatkowych: przychód i koszt bez symulowania zleceń) ---------- */
import { issueDocument } from './business.ts';
import type { IsoDate } from './date.ts';
import { ensureParty } from './core.ts';

export function addSales(s0: GameState, netGr: number, o: { cost?: number } = {}): GameState {
  const s = structuredClone(s0);
  const op = company(s).operation!;
  ensureParty(s, { id: 'party:client-test', name: 'Klient testowy (fikcyjny)', role: 'service' });
  issueDocument(s, op, { kind: 'sales', issueDate: s.clock.today, counterpartyId: 'party:client-test', orderId: null, description: 'Sprzedaż testowa', net: netGr, termDays: 0, noDelay: true });
  if (o.cost) issueDocument(s, op, { kind: 'cost', issueDate: s.clock.today, counterpartyId: 'party:client-test', orderId: null, description: 'Koszt testowy', net: o.cost, termDays: 0 });
  return s;
}

/** Spółka, w której co miesiąc księgujemy sprzedaż i koszt (VAT wg planu), do podanej daty. */
export function runMonths(s0: GameState, until: IsoDate, monthly: { sales: number; cost: number }): GameState {
  let s = s0;
  while (s.clock.today < until) {
    s = advanceDays(s, 1);
    if (s.clock.today.endsWith('-10')) s = addSales(s, monthly.sales, { cost: monthly.cost });
  }
  return s;
}
