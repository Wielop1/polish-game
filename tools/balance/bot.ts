import { activeBusiness } from '../../src/engine/business.ts';
import { CommandError, recordHistory } from '../../src/engine/core.ts';
import { declineEnquiry, sendQuote } from '../../src/engine/renovation.ts';
import { commands } from '../../src/engine/commands.ts';
import type { CommandResult } from '../../src/engine/commands.ts';
import { addDays, diffDays } from '../../src/engine/date.ts';
import { checkInvariants } from '../../src/engine/invariants.ts';
import { zl } from '../../src/engine/money.ts';
import { createNewGame } from '../../src/engine/newGame.ts';
import { crewKey, defaultQuoteInput, jobFinancials, jobShortage, previewQuote, quoteSchedule } from '../../src/engine/renovation.ts';
import type { QuoteInput } from '../../src/engine/renovation.ts';
import { advanceDays, advanceDaysInPlace } from '../../src/engine/simulate.ts';
import { netWorth } from '../../src/engine/selectors.ts';
import { fixedCosts, teamLoad } from '../../src/engine/profitability.ts';
import { subcontractsOfJob } from '../../src/engine/subcontractors.ts';
import { firstFree, resourceBusy } from '../../src/engine/teams.ts';
import { personLevel } from '../../src/engine/workforce.ts';
import { defaultPlanInput, planProject, segmentOfJob, suggestCrews } from '../../src/engine/projects.ts';
import { parseCrewKey, SOLE_SUB_PREFIX } from '../../src/engine/renovation.ts';
import type { GameState, RenoEnquiry } from '../../src/engine/state.ts';
import { REG, fund } from '../../src/engine/testkit.ts';
import { applyMarketing } from './port.ts';
import type { MarketingPreset, PositioningChoice } from './port.ts';

/**
 * Bot gracza do symulatora balansu. Gra WYŁĄCZNIE przez `commands.*` (ten sam silnik co aplikacja) i podejmuje decyzje
 * na podstawie tego, co widzi gracz w UI: zapytania (z budżetem klienta), podgląd wyceny, kalendarz, stan kont.
 * Polityka jest celowo prosta i jednakowa dla wszystkich strategii — różni je tylko struktura firmy.
 */

export interface Policy {
  id: string;
  label: string;
  /** Docelowa liczba pracowników (każdy w osobnej, jednoosobowej ekipie); przy `adaptive` — maksymalna. */
  employees: number;
  /** Zatrudnia kolejnych dopiero, gdy obecni są obłożeni (≥ 75% dni w najbliższych 14) i firma ma bufor gotówki — „rosnąca” firma zamiast pełnej obsady od startu. */
  adaptive?: boolean;
  /** `none` — bez podwykonawców, `mix` — gdy brak własnej mocy, `only` — wyłącznie podwykonawcy (właściciel nadzoruje). */
  subs: 'none' | 'mix' | 'only';
  /** Czy właściciel sam wykonuje prace. */
  ownerWorks: boolean;
  marketing: MarketingPreset;
  positioning: PositioningChoice;
  specializations: string[];
  /** Pojazd firmowy (zwykle potrzebny przy kilku ekipach). */
  vehicle: boolean;
}

export const POLICIES: Policy[] = [
  { id: 'solo', label: 'Samozatrudnienie (sam właściciel)', employees: 0, subs: 'none', ownerWorks: true, marketing: 'basic', positioning: 'balanced', specializations: ['malowanie', 'gladzie'], vehicle: false },
  { id: 'owner+1', label: 'Właściciel + 1 pracownik', employees: 1, subs: 'none', ownerWorks: true, marketing: 'basic', positioning: 'balanced', specializations: ['malowanie', 'gladzie'], vehicle: false },
  { id: 'team3', label: 'Firma z 3 pracownikami', employees: 3, subs: 'none', ownerWorks: true, marketing: 'active', positioning: 'balanced', specializations: ['malowanie', 'gladzie', 'panele'], vehicle: true },
  { id: 'team5', label: 'Firma z 5 pracownikami', employees: 5, subs: 'none', ownerWorks: true, marketing: 'active', positioning: 'balanced', specializations: ['malowanie', 'gladzie', 'panele'], vehicle: true },
  { id: 'subs-only', label: 'Tylko podwykonawcy', employees: 0, subs: 'only', ownerWorks: false, marketing: 'active', positioning: 'balanced', specializations: ['malowanie', 'gladzie', 'panele'], vehicle: false },
  { id: 'grow', label: 'Rosnąca firma (do 5 pracowników, gdy obłożona)', employees: 5, adaptive: true, subs: 'none', ownerWorks: true, marketing: 'active', positioning: 'balanced', specializations: ['malowanie', 'gladzie', 'panele'], vehicle: true },
  { id: 'mixed', label: 'Pracownicy (2) + podwykonawcy', employees: 2, subs: 'mix', ownerWorks: true, marketing: 'active', positioning: 'balanced', specializations: ['malowanie', 'gladzie', 'panele'], vehicle: true },
];

/** Domyślny kapitał początkowy (zł): 1/3 trafia na rachunek firmowy, reszta zostaje na rachunku osobistym jako rezerwa właściciela. */
export const DEFAULT_CAPITAL = zl(90_000);
const REGISTER_DATE = '2026-02-01';

export interface RunMetrics {
  seed: string;
  policy: string;
  years: number;
  days: number;
  inquiries: number;
  quotesSent: number;
  contracts: number;
  contractsDone: number;
  /** Zapytania, na które nie odpowiedziano w terminie (wygasły) albo które odrzucono. */
  unanswered: number;
  declined: number;
  revenueNet: number;
  economicResult: number;
  /** Godziny efektywnej pracy przy zakończonych kontraktach (norma + dodatkowa praca). */
  workHours: number;
  ownerHours: number;
  payrollTotal: number;
  payrollIdle: number;
  fixedCostsTotal: number;
  marketingSpend: number;
  minBusinessCash: number;
  insolvent: boolean;
  insolvencyDay: number | null;
  netWorthStart: number;
  capital: number;
  netWorthEnd: number;
  ownerInjections: number;
  ownerDraws: number;
  avgEmployees: number;
  avgOpenBacklog: number;
  /** Moc własna: (właściciel pracujący + średnia liczba pracowników) × 2000 godz. rocznie. */
  capacityHours: number;
  /** Rynek (v0.7): zapytania utracone z braku mocy, oferty przegrane z konkurencją, udział w zleceniach rynku, stan konkurencji. */
  lostCapacity: number;
  lostToRivals: number;
  marketShare: number | null;
  competitorsEnd: number;
  competitorExits: number;
  competitorEntries: number;
  /** Średnie obłożenie konkurentów w całym przebiegu (średnia z miesięcy). */
  avgCompetitorUtil: number | null;
  invariantErrors: string[];
  /** Powody odrzucenia kandydatów na ofertę (diagnostyka bota). */
  declineReasons: Record<string, number>;
  /** v0.8.1: projekty B2B (zapytania, wycenione, podpisane, zakończone, przerwane), przychód i nadwyżka z projektów oraz z małych zleceń prywatnych, zysk ekonomiczny po wartości pracy właściciela. */
  projectEnquiries: number;
  projectsQuoted: number;
  projectsSigned: number;
  projectsDone: number;
  projectsCancelled: number;
  projectRevenueNet: number;
  projectSurplusNet: number;
  privateRevenueNet: number;
  privateSurplusNet: number;
  ownerEconomicProfit: number;
  avgPaymentDelay: number;
  /** Roczne migawki majątku netto i gotówki firmy (do debugowania). */
  yearly: { year: number; netWorth: number; businessCash: number; contractsDone: number }[];
}

interface Ctx {
  s: GameState;
  policy: Policy;
  injections: number;
  draws: number;
  minCash: number;
  insolventDay: number | null;
  empDays: number;
  backlogSum: number;
  trace: string[] | null;
  day: number;
  /** Ostatnia próba (dzień) dla poleceń, które mogą się nie udać — nie ponawiamy ich codziennie (każda próba kopiuje stan). */
  retryAt: Map<string, number>;
  /** Czy komendy bezpośrednie zmieniły stan od ostatniej migawki historii dnia. */
  dirty: boolean;
  lastHireDay: number;
  escalated: boolean;
  capital: number;
  /** Powody, dla których kandydat na ofertę został odrzucony (diagnostyka bota). */
  why: Map<string, number>;
  /** Czy bot obsługuje większe projekty B2B (wersja „tylko małe zlecenia prywatne” je ignoruje). */
  projects: boolean;
}

/**
 * Komenda wykonana bezpośrednio na stanie bota (bez kopii). Tylko dla poleceń, które walidują PRZED mutacją
 * (odrzucenie zapytania, wysłanie oferty) — błąd walidacji nie zostawia zmian. Kopiowanie stanu przy każdej komendzie
 * dominowało czas przebiegu. Pozostałe komendy idą przez `commands.*` (z kopią).
 */
function inPlace(ctx: Ctx, what: string, fn: () => string): boolean {
  try {
    const msg = fn();
    ctx.dirty = true;
    if (ctx.trace) ctx.trace.push(`${ctx.s.clock.today} ${what}: ${msg}`);
    return true;
  } catch (e) {
    if (!(e instanceof CommandError)) throw e;
    if (ctx.trace) ctx.trace.push(`${ctx.s.clock.today} ${what} ODRZUCONE: ${e.message}`);
    return false;
  }
}

/** Liczniki wywołań komend (diagnostyka wydajności symulatora). */
export const CMD_COUNT = new Map<string, number>();

function exec(ctx: Ctx, r: CommandResult | null, what: string): boolean {
  CMD_COUNT.set(what.split(' ')[0]!, (CMD_COUNT.get(what.split(' ')[0]!) ?? 0) + 1);
  if (!r) return false;
  if (r.ok) {
    ctx.s = r.state;
    if (ctx.trace) ctx.trace.push(`${ctx.s.clock.today} ${what}: ${r.message}`);
    return true;
  }
  if (ctx.trace && !/^materiały|^konserwacja/.test(what)) ctx.trace.push(`${ctx.s.clock.today} ${what} ODRZUCONE: ${r.error}`);
  return false;
}

const bizCash = (s: GameState): number => {
  const b = activeBusiness(s);
  return b ? s.accounts[b.accountId]!.balance : 0;
};

export function newScenario(seed: string, policy0: Policy, trace: string[] | null = null, capital: number = DEFAULT_CAPITAL, projects = false): Ctx {
  // wariant z projektami B2B: szablony projektów wymagają też drobnych prac i paneli — bot dokupuje te specjalizacje (koszt szkolenia i sprzętu liczy się w wyniku)
  const policy: Policy = projects ? { ...policy0, specializations: [...new Set([...policy0.specializations, 'drobne', 'panele'])] } : policy0;
  const businessCash = Math.round(capital / 3 / 1_000) * 1_000;
  let s = createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed, lifeEvents: false });
  s.person.birthDate = '1990-05-05';
  s = fund(s, capital);
  const ctx: Ctx = { s, policy, injections: 0, draws: 0, minCash: Infinity, insolventDay: null, empDays: 0, backlogSum: 0, trace, day: 0, retryAt: new Map(), dirty: false, lastHireDay: -999, escalated: false, capital, why: new Map(), projects };
  // rezygnacja z etatu (wypowiedzenie), rejestracja JDG od 1.02.2026
  exec(ctx, commands.resignFromJob(ctx.s), 'rezygnacja z etatu');
  exec(ctx, commands.registerBusiness(ctx.s, { ...REG, startDate: REGISTER_DATE, specialization: policy.specializations[0]! }), 'rejestracja JDG');
  const toStart = diffDays(REGISTER_DATE, ctx.s.clock.today);
  if (toStart > 0) ctx.s = advanceDays(ctx.s, toStart);
  const b = activeBusiness(ctx.s)!;
  exec(ctx, commands.transferFunds(ctx.s, ctx.s.playerAccountId, b.accountId, businessCash - zl(12_000)), 'kapitał do firmy');
  for (const id of policy.specializations.slice(1)) exec(ctx, commands.addSpecialization(ctx.s, id), `specjalizacja ${id}`);
  exec(ctx, commands.hireAccountingOffice(ctx.s, 'standard'), 'biuro rachunkowe');
  const mk = applyMarketing(ctx.s, policy.adaptive ? 'basic' : policy.marketing, policy.positioning);
  ctx.s = mk.state;
  if (ctx.trace) for (const r of mk.results) ctx.trace.push(`${ctx.s.clock.today} marketing: ${r.ok ? r.message : `ODRZUCONE: ${r.error}`}`);
  buyEquipmentSets(ctx, policy.employees + (policy.ownerWorks ? 1 : 0));
  return ctx;
}

const SET_FOR_SERVICE: Record<string, string> = { malowanie: 'paint-basic', gladzie: 'trowel-set', panele: 'panel-kit', drobne: 'hand-tools' };

function buyEquipmentSets(ctx: Ctx, workers: number): void {
  if (workers <= 0) return;
  for (const svc of ctx.policy.specializations) {
    const id = SET_FOR_SERVICE[svc];
    if (!id) continue;
    const have = ctx.s.reno.equipment.filter((e) => e.catalogId === id && e.conditionBps > 0).length;
    for (let i = have; i < Math.min(4, workers + 1); i++) exec(ctx, commands.buyEquipment(ctx.s, id), `sprzęt ${id}`);
  }
}

/* ---------- Decyzje dzienne ---------- */

const ROLE_FOR_SERVICE: Record<string, string> = { malowanie: 'malarz', gladzie: 'gipsiarz', panele: 'monter-podlog', drobne: 'wykonczeniowiec' };

/** Umiejętności pracowników są przypisane do stanowiska (malarz ≠ gipsiarz), więc kolejni pracownicy pokrywają kolejne specjalizacje firmy. */
function nextRole(ctx: Ctx, hired: number): string {
  const roles = ctx.policy.specializations.map((x) => ROLE_FOR_SERVICE[x]).filter((x): x is string => !!x);
  return roles[hired % roles.length] ?? 'malarz';
}

function staffing(ctx: Ctx): void {
  const { s, policy } = ctx;
  const active = s.ops.employments.filter((e) => e.status === 'active').length;
  let wantMore = active < policy.employees && ctx.day >= 20;
  if (policy.adaptive && wantMore) {
    const teams = s.ops.teams.filter((t) => t.members.some((m) => m.kind === 'employee'));
    const load = teams.length ? teams.reduce((a, t) => a + teamLoad(s, t.id).pct, 0) / teams.length : 100;
    wantMore = ctx.day >= 60 && load >= 75 && bizCash(s) >= zl(15_000) * (active + 2) && ctx.day - ctx.lastHireDay >= 120;
  }
  if (wantMore) {
    if (!s.ops.listings.some((l) => l.status === 'active') && ctx.day - (ctx.retryAt.get('listing') ?? -99) >= 5 && (ctx.retryAt.set('listing', ctx.day), true)) exec(ctx, commands.publishListing(s, { role: nextRole(ctx, active), minLevel: 2, tier: 'basic' }), 'ogłoszenie');
    // dobry pracodawca nie bierze pierwszego kandydata: czeka na kilku (lub do 12. dnia ogłoszenia) i zatrudnia najwyżej wykwalifikowanego, a przy równych — tańszego
    const listing = ctx.s.ops.listings.find((l) => l.status === 'active');
    const wantedSkill = Object.entries(ROLE_FOR_SERVICE).find(([, role]) => role === nextRole(ctx, active))?.[0] ?? 'malowanie';
    // bierzemy tylko kandydatów o potrzebnej umiejętności (stanowisko: malarz, gipsiarz, monter…), nie dowolnego z wcześniejszego ogłoszenia
    const cands = ctx.s.ops.candidates.filter((x) => (x.status === 'new' || x.status === 'countered') && (ctx.s.ops.people.find((p) => p.id === x.personId)?.xp[wantedSkill] ?? 0) > 0);
    const ready = cands.length >= 3 || (listing !== undefined && diffDays(ctx.s.clock.today, listing.postedOn) >= 12) || (listing === undefined && cands.length > 0);
    if (ready && ctx.s.ops.employments.filter((e) => e.status === 'active').length < policy.employees) {
      const ranked = cands.map((c) => ({ c, p: ctx.s.ops.people.find((x) => x.id === c.personId)! })).map((x) => ({ ...x, level: personLevel(x.p, wantedSkill) }))
        .sort((a, b) => b.level - a.level || a.p.expectedGross - b.p.expectedGross);
      const best = ranked[0];
      if (best && exec(ctx, commands.makeOffer(ctx.s, best.c.id, { gross: Math.max(best.c.counterGross ?? 0, best.p.expectedGross), hoursPerMonth: 160, startDate: addDays(ctx.s.clock.today, Math.max(1, diffDays(best.p.availableFrom, ctx.s.clock.today))) }), 'oferta pracy')) {
        buyEquipmentSets(ctx, policy.employees + (policy.ownerWorks ? 1 : 0));
        ctx.lastHireDay = ctx.day;
      }
    }
  }
  for (const e of ctx.s.ops.employments.filter((x) => x.status === 'active')) {
    if (ctx.s.ops.teams.some((t) => t.members.some((m) => m.id === e.id))) continue;
    exec(ctx, commands.createTeam(ctx.s, `Ekipa ${e.id}`, [{ kind: 'employee', id: e.id }]), 'ekipa');
  }
  if (policy.vehicle && ctx.s.ops.vehicles.length === 0 && ctx.day >= 60 && bizCash(ctx.s) > zl(90_000) && ctx.day - (ctx.retryAt.get('vehicle') ?? -99) >= 30 && (ctx.retryAt.set('vehicle', ctx.day), true)) exec(ctx, commands.buyVehicle(ctx.s, 'van-small'), 'pojazd');
}

/** Zapas terminu ponad minimum (dni kalendarzowe). Pomiar na grow/bal-1: +3 → 17 spóźnień na 202 zlecenia, ale tylko 202 wykonane (rezerwacja ekipy blokuje kalendarz); +2 → 50/323 spóźnionych, kary 1% przychodu; +1 → 99/274 spóźnionych i kary ok. 4% przychodu. */
const SCHEDULE_BUFFER_DAYS = 2;

interface Candidate { q: QuoteInput; start: string; kind: 'team' | 'owner' | 'sub' }

function candidateQuote(ctx: Ctx, e: RenoEnquiry, crew: { kind: 'owner' } | { kind: 'team'; empId: string; teamId: string } | { kind: 'sub'; subId: string }): Candidate | null {
  const { s } = ctx;
  const base = defaultQuoteInput(s, e);
  let q: QuoteInput;
  if (crew.kind === 'owner') q = { ...base, teamId: null, supervision: 'worker', vehicleId: null };
  else if (crew.kind === 'team') q = { ...base, teamId: crew.teamId, supervision: 'hands-off', vehicleId: null };
  else q = { ...base, teamId: crewKey([{ kind: 'sub', id: crew.subId }]), supervision: 'hands-off', vehicleId: null };
  const wish = e.desiredStart > addDays(s.clock.today, 2) ? e.desiredStart : addDays(s.clock.today, 2);
  q = { ...q, startDate: wish, durationDays: 60, hoursPerDay: 8 };
  const no = (why: string): null => { const k = `${crew.kind}:${why}`; ctx.why.set(k, (ctx.why.get(k) ?? 0) + 1); return null; };
  const p0 = previewQuote(s, q);
  if (p0.errors.length) return no(`błąd: ${p0.errors[0]!.slice(0, 40)}`);
  let dur = Math.max(2, p0.minDays + SCHEDULE_BUFFER_DAYS);
  q = { ...q, durationDays: dur };
  // najbliższy termin, w którym wszyscy wskazani wykonawcy są wolni
  const sch = quoteSchedule(s, q);
  if (sch.suggestedStart === null) return no('brak wolnego terminu');
  let start = sch.suggestedStart > wish ? sch.suggestedStart : wish;
  if (crew.kind === 'team') start = firstFree(s, 'employee', crew.empId, start, dur);
  // nie obiecuj tego samego terminu dwóm klientom: oferty bez umowy nie rezerwują zasobów w silniku, ale dobry gracz je uwzględnia
  const resource = crew.kind === 'team' ? crew.teamId : crew.kind === 'owner' ? 'owner' : q.teamId;
  for (let i = 0; i < 12; i++) {
    const end = addDays(start, dur - 1);
    const clash = s.reno.quotes.find((x) => (x.status === 'sent' || x.status === 'counter' || x.status === 'accepted') && (x.teamId ?? 'owner') === resource && x.startDate <= end && start <= addDays(x.startDate, x.durationDays - 1));
    if (!clash) break;
    start = addDays(clash.startDate, clash.durationDays);
  }
  // pojazd tylko, gdy w tym terminie nie jest zajęty przez inny kontrakt
  const vehicle = crew.kind === 'team' ? s.ops.vehicles.find((v) => !resourceBusy(s, 'vehicle', v.id, start, addDays(start, dur - 1))) : undefined;
  // termin dużo późniejszy niż życzenie klienta (z jego elastycznością) to oferta bez szans — lepiej jej nie wysyłać i nie blokować kolejki zasobu
  if (start > addDays(e.desiredStart, e.flexDays + 10)) return no('termin zbyt późny');
  q = { ...q, startDate: start, vehicleId: vehicle?.id ?? null };
  const p1 = previewQuote(s, q);
  if (p1.errors.length) return no(`błąd2: ${p1.errors[0]!.slice(0, 40)}`);
  dur = Math.max(dur, p1.minDays + SCHEDULE_BUFFER_DAYS);
  q = { ...q, durationDays: dur };
  const pv = previewQuote(s, q);
  if (pv.errors.length) return no(`błąd3: ${pv.errors[0]!.slice(0, 40)}`);
  const clashW = pv.warnings.find((w) => /przydzielony|Kolizja czasu|zajęty/.test(w));
  if (clashW) return no(`konflikt: ${clashW.slice(0, 30)}`);
  // cena: 88–98% budżetu klienta zależnie od obłożenia (budżet widać na karcie zapytania), nie mniej niż dolna granica i nie więcej niż koszt + 50%;
  // budżet klienta jest brutto, więc przy czynnym VAT cena netto musi być odpowiednio niższa (utrata zwolnienia z VAT po przekroczeniu limitu obniża marżę);
  // jeśli dolna granica przekracza budżet klienta — odrzucamy
  const vatMul = 10_000 + pv.vatRateBps;
  const slots = 1 + s.ops.employments.filter((x) => x.status === 'active').length;
  const inProgress = s.reno.jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled').length + s.reno.quotes.filter((x) => x.status === 'accepted').length;
  const fraction = inProgress === 0 ? 0.88 : inProgress >= slots ? 0.98 : 0.92; // zarządzanie przychodem: obłożona firma wyżej, stojąca niżej
  // dolna granica ceny: koszt + 12%, ale praca własna i płace nie są kosztem krańcowym w pełnej wysokości:
  //  · pracownik jest opłacany niezależnie od zleceń (koszt stały) — liczy się 35% jego kosztu,
  //  · własna praca właściciela jest wyceniana po stawce 60 zł/godz., a wolny czas ma dla niego wartość ok. 60% tej stawki (płaca z utraconego etatu),
  // więc zlecenie, które pokrywa materiały, dojazdy i część robocizny, poprawia wynik firmy i wypełnia wolny czas
  const labor = pv.planned.labor;
  const laborShare = crew.kind === 'team' ? 0.35 : crew.kind === 'owner' ? 0.6 : 1;
  const floor = Math.ceil(((pv.planned.total - labor + laborShare * labor) * 1.12) / 1_000) * 1_000;
  const target = Math.round((e.budgetGross * fraction * 10_000) / vatMul / 1_000) * 1_000;
  const price = Math.max(floor, Math.min(Math.round((pv.planned.total * 1.5) / 1_000) * 1_000, target));
  if ((price * vatMul) / 10_000 > e.budgetGross * 0.99) return no('koszt powyżej budżetu klienta');
  return { q: { ...q, priceNet: price, advanceBps: 1_000 }, start, kind: crew.kind };
}

function handleEnquiries(ctx: Ctx): void {
  const { policy } = ctx;
  // dyscyplina: nie przyjmujemy kolejnych zleceń, gdy w toku jest ich więcej niż 4 na wykonawcę (materiały i czas nie wystarczą, a gotówka utknie w zapasach)
  const workers = (policy.ownerWorks ? 1 : 0) + ctx.s.ops.employments.filter((x) => x.status === 'active').length + (policy.subs === 'only' ? 6 : policy.subs === 'mix' ? 2 : 0);
  const wip = ctx.s.reno.jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled').length + ctx.s.reno.quotes.filter((x) => x.status === 'accepted' || x.status === 'sent').length;
  if (wip >= Math.max(4, 4 * workers)) return;
  for (const e of ctx.s.reno.enquiries.filter((x) => x.status === 'open')) {
    const cands: Candidate[] = [];
    for (const t of ctx.s.ops.teams) {
      const m = t.members[0];
      if (m && m.kind === 'employee' && ctx.s.ops.employments.find((x) => x.id === m.id)?.status === 'active') {
        const c = candidateQuote(ctx, e, { kind: 'team', empId: m.id, teamId: t.id });
        if (c) cands.push(c);
      }
    }
    // właściciel: terminy (także oferty bez umowy) sprawdza `candidateQuote` — nie ma osobnego limitu liczby prac
    if (policy.ownerWorks) { const c = candidateQuote(ctx, e, { kind: 'owner' }); if (c) cands.push(c); }
    if (policy.subs !== 'none' && (policy.subs === 'only' || cands.length === 0)) {
      const subs = ctx.s.ops.subcontractors.filter((x) => x.services.includes(e.serviceId) && x.reliabilityBps >= 8_000).sort((a, b) => b.quality - a.quality);
      for (const sub of subs) { const c = candidateQuote(ctx, e, { kind: 'sub', subId: sub.id }); if (c) { cands.push(c); break; } }
    }
    if (cands.length === 0) { inPlace(ctx, `odrzucenie ${e.id}`, () => declineEnquiry(ctx.s, e.id)); continue; }
    // preferuj termin zgodny z życzeniem klienta, potem własne moce (ekipa → właściciel → podwykonawca)
    const order = { team: 0, owner: 1, sub: 2 } as const;
    cands.sort((a, b) => Number(a.start > addDays(e.desiredStart, e.flexDays)) - Number(b.start > addDays(e.desiredStart, e.flexDays)) || order[a.kind] - order[b.kind] || a.start.localeCompare(b.start));
    inPlace(ctx, `oferta ${e.id}`, () => sendQuote(ctx.s, e.id, cands[0]!.q));
  }
}

/**
 * Projekty B2B (v0.8.1): bot wycenia projekt tylko wtedy, gdy plan nie ma blokad (referencje, umiejętności, godziny, gotówka, termin), a nadwyżka pokrywa
 * 60% wartości pracy właściciela (jak przy małych zleceniach) i co najmniej 8% przychodu. Wykonawcy pakietów wynikają ze struktury firmy (właściciel pracuje /
 * pracownicy / podwykonawcy zależnie od strategii). Projekty podpisuje po akceptacji klienta; kontrofertę przyjmuje, jeśli nadal spełnia ten warunek.
 */
function botCrews(ctx: Ctx, p: GameState['reno']['projects'][number]): Record<string, string | null> {
  const base = suggestCrews(ctx.s, p);
  const out: Record<string, string | null> = {};
  for (const pkg of p.packages) {
    const key = base[pkg.id] ?? null;
    const members = key === null ? [{ kind: 'owner' as const, id: 'owner' }] : parseCrewKey(key) ?? [];
    const allowed = members.filter((m) => (m.kind === 'owner' ? ctx.policy.ownerWorks : m.kind === 'sub' ? ctx.policy.subs !== 'none' : true));
    const subOnly = ctx.policy.subs === 'only';
    const final = subOnly ? members.filter((m) => m.kind === 'sub') : allowed;
    if (final.length === 0) {
      const sub = ctx.policy.subs === 'none' ? undefined : ctx.s.ops.subcontractors.filter((x) => x.services.includes(pkg.serviceId) && x.reliabilityBps >= 8_000).sort((a, c) => a.priceBps - c.priceBps)[0];
      out[pkg.id] = sub ? `${SOLE_SUB_PREFIX}${sub.id}` : 'none';
    } else out[pkg.id] = final.length === 1 && final[0]!.kind === 'owner' ? null : crewKey(final);
  }
  return out;
}

function handleProjects(ctx: Ctx): void {
  if (!ctx.projects) return;
  const s = ctx.s;
  // projekty są dla firm z mocą ponad właściciela (≥ 2 zatrudnionych albo podwykonawcy zamiast właściciela); właściciel przy projekcie przeciąża swoje drobne zlecenia
  const emps = s.ops.employments.filter((x) => x.status === 'active').length;
  const capable = emps >= 2 || ctx.policy.subs === 'only';
  for (const p of s.reno.projects) {
    if (p.status === 'enquiry') {
      if (!capable) continue;
      if (ctx.day - (ctx.retryAt.get(p.id) ?? -99) < 4) continue;
      ctx.retryAt.set(p.id, ctx.day);
      const crews = botCrews(ctx, p);
      if (Object.values(crews).includes('none')) { ctx.why.set('projekt:brak wykonawcy', (ctx.why.get('projekt:brak wykonawcy') ?? 0) + 1); exec(ctx, commands.declineProject(s, p.id), `odrzucenie projektu ${p.id}`); continue; }
      const input = { ...defaultPlanInput(s, p), crews };
      const plan = planProject(s, p, input);
      if (plan.blockers.length) { const k = `projekt:${plan.blockers[0]!.slice(0, 40)}`; ctx.why.set(k, (ctx.why.get(k) ?? 0) + 1); if (p.respondBy <= addDays(s.clock.today, 4)) exec(ctx, commands.declineProject(s, p.id), `odrzucenie projektu ${p.id}`); continue; }
      const e = plan.economics;
      if (e.surplus < Math.round(e.ownerLabor * 0.6) + Math.round(e.revenueNet * 0.08)) { ctx.why.set('projekt:za niska nadwyżka', (ctx.why.get('projekt:za niska nadwyżka') ?? 0) + 1); exec(ctx, commands.declineProject(s, p.id), `odrzucenie projektu ${p.id}`); continue; }
      exec(ctx, commands.sendProjectQuote(s, p.id, input), `oferta projektu ${p.id}`);
    } else if (p.status === 'counter') exec(ctx, commands.respondProjectCounter(s, p.id, 'accept'), `kontroferta projektu ${p.id}`);
    else if (p.status === 'accepted') {
      if (ctx.day - (ctx.retryAt.get(`sign:${p.id}`) ?? -99) < 2) continue;
      ctx.retryAt.set(`sign:${p.id}`, ctx.day);
      exec(ctx, commands.signProject(s, p.id), `umowa projektu ${p.id}`);
    }
  }
}

function handleContracts(ctx: Ctx): void {
  for (const q of ctx.s.reno.quotes.filter((x) => x.status === 'counter')) exec(ctx, commands.respondToCounter(ctx.s, q.id, 'accept'), `kontroferta ${q.id}`);
  for (const q of ctx.s.reno.quotes.filter((x) => x.status === 'accepted')) {
    if (ctx.day - (ctx.retryAt.get(q.id) ?? -99) < 3) continue;
    ctx.retryAt.set(q.id, ctx.day);
    if (!exec(ctx, commands.signContract(ctx.s, q.id), `umowa ${q.id}`) && ctx.policy.subs !== 'none') {
      const enq = ctx.s.reno.enquiries.find((e) => e.id === q.enquiryId);
      const sub = ctx.s.ops.subcontractors.find((x) => x.services.includes(q.serviceId) && x.reliabilityBps >= 8_000);
      if (enq && sub) exec(ctx, commands.signContract(ctx.s, q.id, [{ kind: 'sub', id: sub.id }]), `umowa z podwykonawcą ${q.id}`);
    }
  }
  for (const c of ctx.s.ops.subcontracts.filter((x) => x.status === 'offered')) exec(ctx, commands.acceptSubOffer(ctx.s, c.id), `oferta podwykonawcy ${c.id}`);
  for (const c of ctx.s.ops.subcontracts.filter((x) => x.status === 'delivered')) exec(ctx, commands.acceptSubWork(ctx.s, c.id), `odbiór ${c.id}`);
  for (const j of ctx.s.reno.jobs.filter((x) => x.stage !== 'done' && x.stage !== 'cancelled')) {
    if (diffDays(j.startDate, ctx.s.clock.today) <= 3 && bizCash(ctx.s) > zl(1_500) && ctx.day - (ctx.retryAt.get(`mat:${j.id}`) ?? -99) >= 3 && Object.keys(jobShortage(ctx.s, j)).length > 0 && (ctx.retryAt.set(`mat:${j.id}`, ctx.day), true)) exec(ctx, commands.buyMissingForJob(ctx.s, j.id), `materiały ${j.id}`);
  }
  for (const c of ctx.s.reno.complaints.filter((x) => x.status === 'open')) {
    if (ctx.day - (ctx.retryAt.get(c.id) ?? -99) < 4) continue; // brak godzin/gotówki nie ustępuje z dnia na dzień
    ctx.retryAt.set(c.id, ctx.day);
    exec(ctx, commands.resolveComplaint(ctx.s, c.id, 'repair'), `reklamacja ${c.id}`);
  }
  for (const it of ctx.s.reno.equipment) {
    if (it.conditionBps >= 3_500 || ctx.day - (ctx.retryAt.get(it.id) ?? -99) < 10) continue;
    ctx.retryAt.set(it.id, ctx.day);
    exec(ctx, commands.maintainEquipment(ctx.s, it.id), `konserwacja ${it.id}`);
  }
}

function money(ctx: Ctx): void {
  const b = activeBusiness(ctx.s);
  if (!b) return;
  // firma „rosnąca” zwiększa marketing dopiero, gdy ma bufor gotówki
  if (ctx.policy.adaptive && !ctx.escalated && ctx.day >= 120 && bizCash(ctx.s) >= zl(25_000)) {
    const mk = applyMarketing(ctx.s, ctx.policy.marketing, ctx.policy.positioning);
    ctx.s = mk.state;
    ctx.escalated = true;
    if (ctx.trace) for (const r of mk.results) ctx.trace.push(`${ctx.s.clock.today} marketing (eskalacja): ${r.ok ? r.message : `ODRZUCONE: ${r.error}`}`);
  }
  const cash = bizCash(ctx.s);
  const personal = ctx.s.accounts[ctx.s.playerAccountId]!.balance;
  // dopłata właściciela, gdy firmie brakuje gotówki
  if (cash < zl(6_000) && personal > zl(15_000)) {
    const amount = Math.min(zl(15_000), personal - zl(8_000));
    if (exec(ctx, commands.transferFunds(ctx.s, ctx.s.playerAccountId, b.accountId, amount), 'dopłata właściciela')) ctx.injections += amount;
  }
  // wypłata właściciela na życie 10. dnia miesiąca, gdy firma ma bufor
  if (ctx.s.clock.today.endsWith('-10') && cash > zl(20_000) && personal < zl(9_000)) {
    const amount = Math.min(zl(7_000), cash - zl(15_000));
    if (amount > 0 && exec(ctx, commands.transferFunds(ctx.s, b.accountId, ctx.s.playerAccountId, amount), 'wypłata właściciela')) ctx.draws += amount;
  }
}

function track(ctx: Ctx): void {
  const { s } = ctx;
  const cash = bizCash(s);
  ctx.minCash = Math.min(ctx.minCash, cash);
  ctx.empDays += s.ops.employments.filter((e) => e.status === 'active').length;
  ctx.backlogSum += s.reno.jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled').length;
  if (ctx.insolventDay === null && ctx.day % 7 === 0) {
    const stale = s.obligations.some((o) => o.status === 'open' && o.overdueSince !== null && diffDays(s.clock.today, o.overdueSince) >= 30);
    if (stale || netWorth(s) < 0) ctx.insolventDay = ctx.day;
  }
}

export function stepDay(ctx: Ctx): void {
  advanceDaysInPlace(ctx.s, 1);
  ctx.day += 1;
  staffing(ctx);
  handleEnquiries(ctx);
  handleProjects(ctx);
  if (ctx.dirty) { recordHistory(ctx.s, ctx.s.clock.today); ctx.dirty = false; }
  handleContracts(ctx);
  money(ctx);
  track(ctx);
}

export function collect(ctx: Ctx, seed: string, years: number): RunMetrics {
  const { s } = ctx;
  const done = s.reno.jobs.filter((j) => j.stage === 'done');
  let revenue = 0, result = 0, hours = 0, ownerHours = 0;
  for (const j of done) {
    const f = jobFinancials(j, subcontractsOfJob(s, j.id));
    revenue += f.revenueNet;
    result += f.economicResult;
    hours += (j.progressCenti) / 100;
    const team = j.crew.teamId ? s.ops.teams.find((t) => t.id === j.crew.teamId) : null;
    if (!team || team.members.some((m) => m.kind === 'owner')) ownerHours += j.workedDays * j.hoursPerDay;
  }
  let payrollTotal = 0, payrollIdle = 0, fixedTotal = 0, marketing = 0;
  const months = new Set(s.documents.map((d) => d.issueDate.slice(0, 7)));
  for (const m of [...months].sort()) {
    const fc = fixedCosts(s, m);
    payrollTotal += fc.payrollTotal;
    payrollIdle += fc.payrollIdle;
    fixedTotal += fc.total;
    marketing += fc.advertising;
  }
  const yearly: RunMetrics['yearly'] = [];
  const startYear = 2026;
  for (let y = 0; y < years; y++) {
    const h = s.history.find((x) => x.date === `${startYear + y}-12-31`);
    if (h) yearly.push({ year: startYear + y, netWorth: h.netWorth, businessCash: 0, contractsDone: done.filter((j) => j.finishedOn && j.finishedOn <= `${startYear + y}-12-31`).length });
  }
  const jobsAll = s.reno.jobs.filter((j) => j.stage !== 'cancelled' || j.workedDays > 0);
  let privRev = 0, privSur = 0, projRev = 0, projSur = 0, ownerProfit = 0;
  for (const j of done) {
    const f = jobFinancials(j, subcontractsOfJob(s, j.id));
    ownerProfit += f.economicProfit;
    if (segmentOfJob(s, j.projectId) === 'private') { privRev += f.revenueNet; privSur += f.surplusBeforeOwner; } else { projRev += f.revenueNet; projSur += f.surplusBeforeOwner; }
  }
  const pjobs = done.filter((j) => j.projectId);
  const prj = s.reno.projects;
  return {
    seed, policy: ctx.policy.id, years, days: ctx.day,
    inquiries: s.reno.enquiries.length,
    quotesSent: s.reno.quotes.length,
    contracts: jobsAll.length,
    contractsDone: done.length,
    unanswered: s.reno.enquiries.filter((e) => e.status === 'expired').length,
    declined: s.reno.enquiries.filter((e) => e.status === 'declined').length,
    revenueNet: revenue, economicResult: result, workHours: hours, ownerHours,
    payrollTotal, payrollIdle, fixedCostsTotal: fixedTotal, marketingSpend: marketing,
    minBusinessCash: Number.isFinite(ctx.minCash) ? ctx.minCash : 0,
    insolvent: ctx.insolventDay !== null, insolvencyDay: ctx.insolventDay,
    netWorthStart: ctx.capital, capital: ctx.capital, netWorthEnd: netWorth(s),
    ownerInjections: ctx.injections, ownerDraws: ctx.draws,
    avgEmployees: ctx.day > 0 ? ctx.empDays / ctx.day : 0,
    avgOpenBacklog: ctx.day > 0 ? ctx.backlogSum / ctx.day : 0,
    capacityHours: ((ctx.policy.ownerWorks ? 1 : 0) + (ctx.day > 0 ? ctx.empDays / ctx.day : 0)) * 2_000 * (ctx.day / 365),
    lostCapacity: s.market.months.reduce((a, m) => a + m.playerLostCapacity, 0),
    lostToRivals: s.reno.quotes.filter((q) => q.status === 'rejected' && q.note.startsWith('klient wybrał ofertę konkurencji')).length,
    marketShare: (() => { const pw = s.market.months.reduce((a, m) => a + m.playerWon, 0); const rw = s.market.months.reduce((a, m) => a + m.rivalWon, 0); return pw + rw > 0 ? pw / (pw + rw) : null; })(),
    competitorsEnd: s.market.competitors.filter((c) => c.status === 'active').length,
    competitorExits: s.market.competitors.filter((c) => c.status === 'exited').length,
    competitorEntries: s.market.competitors.filter((c) => c.enteredOn > s.market.initializedOn!).length,
    avgCompetitorUtil: s.market.months.length ? s.market.months.reduce((a, m) => a + m.competitorUtilBps, 0) / s.market.months.length / 10_000 : null,
    projectEnquiries: prj.length, projectsQuoted: prj.filter((p) => p.quote !== null).length, projectsSigned: prj.filter((p) => p.signedOn !== null).length,
    projectsDone: prj.filter((p) => p.status === 'done').length, projectsCancelled: prj.filter((p) => p.status === 'cancelled').length,
    projectRevenueNet: projRev, projectSurplusNet: projSur, privateRevenueNet: privRev, privateSurplusNet: privSur, ownerEconomicProfit: ownerProfit,
    avgPaymentDelay: pjobs.length ? pjobs.reduce((a, j) => a + j.paymentDelayDays, 0) / pjobs.length : 0,
    declineReasons: Object.fromEntries([...ctx.why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    invariantErrors: checkInvariants(s).slice(0, 5),
    yearly,
  };
}

export interface RunOptions { seed: string; years: number; policy: Policy; trace?: boolean; capital?: number; projects?: boolean }

export function runScenario(o: RunOptions): { metrics: RunMetrics; trace: string[] | null; final: GameState } {
  const trace = o.trace ? [] : null;
  const ctx = newScenario(o.seed, o.policy, trace, o.capital, o.projects ?? false);
  const days = Math.round(o.years * 365);
  for (let i = 0; i < days; i++) stepDay(ctx);
  return { metrics: collect(ctx, o.seed, o.years), trace, final: ctx.s };
}
