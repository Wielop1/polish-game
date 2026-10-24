import { CommandError, ensureParty, logEvent, nextCounter } from './core.ts';
import { addDays, diffDays, formatDatePL, weekdayIndex } from './date.ts';
import { firstFree } from './teams.ts';
import { liquidityForecast } from './profitability.ts';
import type { IsoDate } from './date.ts';
import { formatPLN, mulBps, roundDiv, zl } from './money.ts';
import type { Grosze } from './money.ts';
import { createRng } from './rng.ts';
import { ownerAvailable } from './operator.ts';
import { DISTRICTS, SERVICE_BY_ID, referencePrice, OWN_LABOR_RATE_DEFAULT } from './renovationCatalog.ts';
import {
  SOLE_SUB_PREFIX, crewKey, equipmentStatus, grossOfNet, isSpecialized, jobDifficulty, jobFinancials, normCenti, parseCrewKey, previewQuote, reputation, signContract, skillLevel,
  cancelProjectJob, vatRateNow, b2bPaymentDelay, jobShortage, materialPrice,
} from './renovation.ts';
import type { CrewMember, QuoteInput, QuotePreview } from './renovation.ts';
import { requireBusiness } from './opsCommon.ts';
import { activeEmployments, personById, personLevel } from './workforce.ts';
import { B2B_CLIENT_POOL, B2B_KINDS, B2B_LEGACY_POOL, B2B_RULES, PROJECT_TEMPLATES, STAGE_LABEL, TIER_REQUIREMENTS, tierOfValue } from './projectsCatalog.ts';
import type { ProjectTemplateId } from './projectsCatalog.ts';
import type { B2BClient, GameState, Operator, RenoEnquiry, RenoPackage, RenoProject, RenoQuote, RenovationState } from './state.ts';

/**
 * Większe projekty remontowe i klienci B2B (v0.8.1).
 *
 * Hierarchia: projekt → etapy (przygotowanie / roboty / wykończenie / prace końcowe) → pakiety robót → zadania. Pakiet robót to ZWYKŁY kontrakt silnika
 * (`RenoJob`) z zależnościami: ma kosztorys, materiały, zasoby, termin, postęp, jakość i odbiór z istniejącego modułu; projekt dokłada tylko to, czego
 * brak pojedynczemu kontraktowi — klienta B2B, wymagania i referencje, harmonogram zależności, wspólne warunki płatności i karę za zwłokę. Zadania pakietu
 * są dziś wyprowadzane z jego cyklu życia (zakup materiałów → wykonanie → odbiór); struktura pozwala je później zastąpić zadaniami budowlanymi.
 *
 * Parametry (ceny B2B, wymagania, częstość zapytań) są KALIBRACYJNE (`projectsCatalog.ts`). Forma prawna nie odblokowuje dużych projektów — liczą się referencje i zdolność realizacyjna.
 */

const reno = (s: GameState): RenovationState => s.reno;
const OPEN_STATES: readonly RenoProject['status'][] = ['enquiry', 'quoted', 'counter', 'accepted'];

export const PROJECT_STATUS_LABEL: Record<RenoProject['status'], string> = {
  enquiry: 'zapytanie', quoted: 'oferta wysłana', counter: 'kontroferta klienta', accepted: 'zaakceptowana — podpisz umowę', signed: 'w realizacji', done: 'zakończony',
  rejected: 'odrzucona przez klienta', declined: 'odrzucone przez Ciebie', expired: 'wygasło', cancelled: 'przerwany',
};

/* ---------- Pula klientów B2B ---------- */

export function ensureB2BPool(s: GameState): B2BClient[] {
  const st = reno(s);
  // pula rośnie z wersji na wersję: brakujących klientów dopisujemy na końcu, istniejących (z ich relacją i historią) nie ruszamy
  if (st.b2bClients.length < B2B_CLIENT_POOL.length) {
    const sequential = createRng(s.seed, 'b2b:pool');
    for (let i = st.b2bClients.length; i < B2B_CLIENT_POOL.length; i++) {
      const c = B2B_CLIENT_POOL[i]!;
      const k = B2B_KINDS[c.kind];
      const rng = i < B2B_LEGACY_POOL ? sequential : createRng(s.seed, `b2b:pool:${i}`);
      st.b2bClients.push({ id: `b2b:${i + 1}`, name: c.name, kind: c.kind, size: c.size, termDays: rng.int(k.termDays[0], k.termDays[1]), reliability: rng.int(k.reliability[0], k.reliability[1]), relationship: 40, projectsDone: 0, lastEnquiryOn: null });
    }
  }
  for (const c of st.b2bClients) ensureParty(s, { id: `party:${c.id}`, name: c.name, role: 'service' });
  return st.b2bClients;
}

export const projectById = (s: GameState, id: string): RenoProject | undefined => reno(s).projects.find((p) => p.id === id);
const jobOfPackage = (s: GameState, pkg: RenoPackage) => (pkg.jobId ? reno(s).jobs.find((j) => j.id === pkg.jobId) : undefined);

/* ---------- Referencje i poziom dostępu ---------- */

export interface CompanyReferences {
  completedJobs: number;
  completedValueNet: Grosze;
  /** Średnia ocena (0–50) z ostatnich 12 ukończonych kontraktów; null bez opinii. */
  avgRating10: number | null;
  onTimePct: number | null;
  workedHours: number;
  /** Ukończone projekty wg poziomu (indeks 0 = poziom 1). */
  projectsDone: [number, number, number];
  largestProjectNet: Grosze;
  /** Wykonawcy: właściciel (jeśli może pracować) + aktywni pracownicy + podwykonawcy z zakończoną współpracą (najwyżej 2). */
  workers: number;
  /** Skład `workers`: właściciel (0/1), aktywni pracownicy i podwykonawcy z zakończoną współpracą (liczeni najwyżej po 2). */
  workersBreakdown: { owner: number; employees: number; subcontractors: number };
  tier: 0 | 1 | 2 | 3;
}

export function companyReferences(s: GameState): CompanyReferences {
  const st = reno(s);
  const done = st.jobs.filter((j) => j.stage === 'done');
  const value = done.reduce((a, j) => a + j.priceNet - j.penaltyNet, 0);
  const recent = [...done].sort((a, b) => (b.settledOn ?? '').localeCompare(a.settledOn ?? '')).slice(0, 12);
  const ratings = recent.map((j) => st.reviews.find((r) => r.jobId === j.id)?.rating10).filter((x): x is number => x !== undefined);
  const projectsDone: [number, number, number] = [0, 0, 0];
  let largest = 0;
  for (const p of st.projects) if (p.status === 'done') { projectsDone[p.tier - 1]! += 1; largest = Math.max(largest, p.outcome?.revenueNet ?? 0); }
  const subsWithHistory = new Set(s.ops.subcontracts.filter((c) => c.status === 'settled' || c.status === 'delivered').map((c) => c.subId)).size;
  const refs: CompanyReferences = {
    completedJobs: done.length, completedValueNet: value, avgRating10: ratings.length ? Math.round(ratings.reduce((a, x) => a + x, 0) / ratings.length) : null,
    onTimePct: done.length ? Math.round((done.filter((j) => j.lateDays === 0).length * 100) / done.length) : null,
    workedHours: Math.round(done.reduce((a, j) => a + j.workedDays * j.hoursPerDay, 0)), projectsDone, largestProjectNet: largest,
    workers: 0, workersBreakdown: { owner: ownerAvailable(s) ? 1 : 0, employees: activeEmployments(s).length, subcontractors: Math.min(2, subsWithHistory) }, tier: 0,
  };
  refs.workers = refs.workersBreakdown.owner + refs.workersBreakdown.employees + refs.workersBreakdown.subcontractors;
  refs.tier = ([3, 2, 1] as const).find((t) => unmetRequirements(refs, TIER_REQUIREMENTS[t]).length === 0) ?? 0;
  return refs;
}

export interface RequirementCheck { label: string; need: string; have: string; ok: boolean }

export function requirementChecks(refs: CompanyReferences, req: RenoProject['requirements']): RequirementCheck[] {
  const stars = (x: number) => `${(x / 10).toFixed(1).replace('.', ',')}★`;
  const checks: RequirementCheck[] = [
    { label: 'Ukończone kontrakty', need: `${req.minCompleted}`, have: `${refs.completedJobs}`, ok: refs.completedJobs >= req.minCompleted },
    { label: 'Wartość ukończonych kontraktów (netto)', need: formatPLN(req.minValueNet, { round: true }), have: formatPLN(refs.completedValueNet, { round: true }), ok: refs.completedValueNet >= req.minValueNet },
    { label: 'Średnia ocena klientów', need: stars(req.minRating10), have: refs.avgRating10 === null ? 'brak opinii' : stars(refs.avgRating10), ok: req.minRating10 <= 0 || (refs.avgRating10 !== null && refs.avgRating10 >= req.minRating10) },
  ];
  if (req.minProjectTier > 0) {
    const n = refs.projectsDone.slice(req.minProjectTier - 1).reduce((a, x) => a + x, 0);
    checks.push({ label: `Ukończony projekt poziomu ${req.minProjectTier}+`, need: '1', have: `${n}`, ok: n >= 1 });
  }
  if (req.minWorkers > 1) checks.push({ label: 'Zdolność realizacyjna (liczba wykonawców)', need: `${req.minWorkers}`, have: `${refs.workers}`, ok: refs.workers >= req.minWorkers });
  return checks;
}

const unmetRequirements = (refs: CompanyReferences, req: RenoProject['requirements']): string[] => requirementChecks(refs, req).filter((c) => !c.ok).map((c) => `${c.label}: potrzeba ${c.need}, masz ${c.have}`);

/* ---------- Generowanie zapytań B2B ---------- */

export function projectValueNet(templateId: ProjectTemplateId, area: number, flats: number): Grosze {
  return PROJECT_TEMPLATES[templateId].spec(area, flats).reduce((a, p) => a + referencePrice(p.serviceId, p.units, 'standard', 2), 0);
}

export function buildProject(s: GameState, b: Operator, client: B2BClient, templateId: ProjectTemplateId, wantedTier: number, date: IsoDate): RenoProject | null {
  const rng = createRng(s.seed, `b2b:project:${b.id}:${date}`);
  const tpl = PROJECT_TEMPLATES[templateId];
  const kind = B2B_KINDS[client.kind];
  let area = 0;
  let flats = 1;
  let tier = 0;
  for (let tries = 0; tries < 12; tries++) {
    area = rng.int(tpl.areaRange[0], tpl.areaRange[1]);
    flats = rng.int(tpl.flatsRange[0], tpl.flatsRange[1]);
    tier = tierOfValue(Math.round((projectValueNet(templateId, area, flats) * kind.priceFactorBps) / 10_000));
    if (tier === wantedTier) break;
  }
  if (tier !== wantedTier) return null;
  const n = nextCounter(s, 'reno:project');
  const id = `proj:${n}`;
  const specs = tpl.spec(area, flats);
  const idOf = (key: string) => `${id}:${key}`;
  const packages: RenoPackage[] = specs.map((sp) => {
    const complexity = (sp.serviceId === 'gladzie' || sp.serviceId === 'malowanie') && rng.int(0, 99) < 15 ? ('trudne' as const) : ('standard' as const);
    const qualityReq = rng.int(kind.qualityReq[0], kind.qualityReq[1]);
    return {
      id: idOf(sp.key), label: sp.label, stage: sp.stage, serviceId: sp.serviceId, units: sp.units, complexity, qualityReq, dependsOn: sp.deps.map(idOf),
      refPriceNet: referencePrice(sp.serviceId, sp.units, complexity, qualityReq), priceNet: 0, crewKey: null, startDate: null, durationDays: 0, hoursPerDay: 6, jobId: null,
    };
  });
  const refTotal = packages.reduce((a, p) => a + p.refPriceNet, 0);
  const roundTen = (x: Grosze) => Math.max(zl(10), roundDiv(x, zl(10)) * zl(10));
  const budgetNet = roundTen(roundDiv(mulBps(refTotal, kind.priceFactorBps) * rng.int(95, 110), 100));
  const walkAwayNet = roundTen(roundDiv(budgetNet * rng.int(104, 114), 100));
  // okno klienta: ścieżka krytyczna przy ekipie założonej przez klienta (poziom 1 — jeden wykonawca, 2 — dwóch, 3 — trzech; 8 godz. dziennie) z realną wydajnością ekipy (dni robocze, koordynacja, tempo), w dniach kalendarzowych z zapasem
  const dayOf = (p: RenoPackage) => Math.ceil(normCenti(p.serviceId, p.units, p.complexity) / mulBps(800 * tier, B2B_RULES.windowCapacityBps[tier as 1 | 2 | 3])) + 1;
  const chain = packages.reduce((a, p) => a + dayOf(p), 0);
  const maxDays = Math.ceil(chain * 1.5) + 7;
  return {
    id, businessId: b.id, b2bId: client.id, clientId: `party:${client.id}`, clientName: client.name, templateId, title: tpl.title ? tpl.title(area, flats) : `${tpl.label}: ${area} m²${flats > 1 ? ` × ${flats} lokali` : ''}`,
    location: DISTRICTS[rng.int(0, DISTRICTS.length - 1)]!, tier: tier as 1 | 2 | 3, areaM2: area, flats, status: 'enquiry', receivedOn: date,
    respondBy: addDays(date, rng.int(B2B_RULES.respondDays[0], B2B_RULES.respondDays[1])), desiredStart: addDays(date, rng.int(10, 28)), maxDays, budgetNet, walkAwayNet,
    paymentTermDays: client.termDays, maxTermDays: Math.min(90, client.termDays + 15), advanceMaxBps: kind.advanceMaxBps, penaltyBpsPerWeek: kind.penaltyBpsPerWeek,
    requirements: { ...TIER_REQUIREMENTS[tier as 1 | 2 | 3] }, packages, quote: null, signBy: null, signedOn: null, finishedOn: null, outcome: null, note: '',
  };
}

/** Cotygodniowe losowanie zapytania B2B (poniedziałek): rzadkie, ograniczone limitami i zależne od referencji — bez nieograniczonej liczby kontraktów. */
function rollB2BEnquiry(s: GameState, b: Operator, date: IsoDate): void {
  if (weekdayIndex(date) !== 0) return;
  const st = reno(s);
  const clients = ensureB2BPool(s);
  const open = st.projects.filter((p) => OPEN_STATES.includes(p.status));
  const active = st.projects.filter((p) => p.status === 'signed');
  if (open.length >= B2B_RULES.maxOpen || active.length >= B2B_RULES.maxActive) return;
  const refs = companyReferences(s);
  const rep = reputation(s);
  const partnerships = s.market.marketing.budgets['partnerships'] ?? 0;
  let p = B2B_RULES.weeklyBaseBps + (rep.stars >= 4 ? 500 : 0) + (partnerships > 0 ? 400 : 0) + Math.min(800, refs.projectsDone.reduce((a, x) => a + x, 0) * 250);
  if (refs.tier === 0) p = Math.round(p / 2); // firma bez referencji widzi tylko rzadkie zapytania „na wyrost”
  p = Math.min(B2B_RULES.weeklyMaxBps, p);
  const rng = createRng(s.seed, `b2b:roll:${b.id}:${date}`);
  if (rng.int(0, 9_999) >= p) return;
  const stretch = refs.tier === 0 || (refs.tier < 3 && rng.int(0, 9_999) < B2B_RULES.stretchChanceBps);
  if (stretch && open.some((x) => x.tier > refs.tier)) return; // najwyżej jedno zapytanie „na wyrost” naraz
  // poziom zapytania: „na wyrost” (o jeden wyżej), w sam raz albo niższy — firma z dużymi referencjami dostaje też drobniejsze kontrakty
  const lower = !stretch && refs.tier >= 2 && rng.int(0, 9_999) < B2B_RULES.lowerTierChanceBps;
  const wanted = Math.min(3, Math.max(1, stretch ? refs.tier + 1 : lower ? refs.tier - 1 : refs.tier));
  // klient: ważony zaufaniem (relacja); gdy jego szablony nie dają projektu żądanego poziomu, losujemy kolejnego klienta
  const pool = clients.filter((c) => (!c.lastEnquiryOn || diffDays(date, c.lastEnquiryOn) >= B2B_RULES.clientCooldownDays) && !open.some((x) => x.b2bId === c.id));
  let project: RenoProject | null = null;
  let client: B2BClient | null = null;
  while (!project && pool.length) {
    const weights = pool.map((c) => 20 + c.relationship);
    let roll = rng.int(0, weights.reduce((a, x) => a + x, 0) - 1);
    let idx = 0;
    for (let i = 0; i < pool.length; i++) { if (roll < weights[i]!) { idx = i; break; } roll -= weights[i]!; }
    const candidate = pool.splice(idx, 1)[0]!;
    const templates = [...B2B_KINDS[candidate.kind].templates];
    while (!project && templates.length) {
      const tpl = templates.splice(rng.int(0, templates.length - 1), 1)[0]!;
      project = buildProject(s, b, candidate, tpl, wanted, date);
    }
    if (project) client = candidate;
  }
  if (!project || !client) return;
  client.lastEnquiryOn = date;
  st.projects.push(project);
  logEvent(s, {
    id: `reno.project:${project.id}:enquiry`, date, type: 'reno.project', tone: refs.tier >= project.tier ? 'positive' : 'neutral', title: `Zapytanie B2B: ${project.title}`,
    detail: `${client.name} · budżet ok. ${formatPLN(project.budgetNet, { round: true })} netto · płatność ${project.paymentTermDays} dni · ${refs.tier >= project.tier ? 'możesz złożyć ofertę' : 'wymaga referencji, których jeszcze nie masz'}`.slice(0, 290), amount: null, category: null,
  });
}

/* ---------- Plan projektu: wykonawcy, harmonogram, ekonomia, wymagania ---------- */

export interface ProjectPlanInput {
  startDate: IsoDate;
  paymentTermDays: number;
  advanceBps: number;
  /** Wykonawcy per pakiet: null/pominięty = właściciel samodzielnie; w przeciwnym razie klucz ekipy (`crew:…` / `sub:…` / id ekipy). */
  crews?: Record<string, string | null>;
  /** Cena całego projektu (netto) rozdzielana proporcjonalnie do cen referencyjnych albo ceny per pakiet. */
  totalPriceNet?: Grosze;
  prices?: Record<string, Grosze>;
  hoursPerDay?: number;
  laborRate?: Grosze;
}

export interface PackagePlan {
  pkg: RenoPackage;
  hoursPerDay: number;
  crewKey: string | null;
  priceNet: Grosze;
  startDate: IsoDate;
  durationDays: number;
  endDate: IsoDate;
  preview: QuotePreview;
}

export interface ProjectPlan {
  packages: PackagePlan[];
  startDate: IsoDate;
  endDate: IsoDate;
  chainDays: number;
  totalPriceNet: Grosze;
  economics: { revenueNet: Grosze; externalCost: Grosze; ownerLabor: Grosze; surplus: Grosze; economicProfit: Grosze; ownerCenti: number; ownerHourly: Grosze | null; surplusMarginBps: number };
  cash: { available: Grosze; peakNeed: Grosze; shortfall: Grosze };
  checks: RequirementCheck[];
  blockers: string[];
  risks: string[];
}

const defaultTotal = (p: RenoProject): Grosze => Math.max(zl(10), roundDiv(mulBps(p.budgetNet, 9_700), zl(10)) * zl(10));

/** Domyślni wykonawcy pakietów: właściciel (jeśli ma umiejętność i sprzęt), kwalifikowani pracownicy (przy dużych pakietach do 3), w ostateczności najtańszy podwykonawca. */
export function suggestCrews(s: GameState, p: RenoProject): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const emps = activeEmployments(s);
  for (const pkg of p.packages) {
    const def = SERVICE_BY_ID.get(pkg.serviceId)!;
    const difficulty = jobDifficulty(def, pkg.complexity);
    const eq = equipmentStatus(s, def);
    const ownerOk = ownerAvailable(s) && isSpecialized(s, pkg.serviceId) && skillLevel(s, pkg.serviceId) >= difficulty && eq.missing.length === 0 && eq.broken.length === 0;
    const qualified = emps.filter((e) => { const person = personById(s, e.personId); return !!person && personLevel(person, pkg.serviceId) >= difficulty; });
    const big = normCenti(pkg.serviceId, pkg.units, pkg.complexity) > 6_000;
    // zatrudnieni wykonują pakiety, a właściciel zostaje wolny do własnych zleceń; właściciel pracuje przy pakiecie tylko, gdy nie ma kwalifikowanego pracownika
    const members: CrewMember[] = [];
    for (const e of qualified.slice(0, big ? 3 : 2)) members.push({ kind: 'employee', id: e.id });
    if (members.length === 0 && ownerOk) members.push({ kind: 'owner', id: 'owner' });
    if (members.length === 0) {
      const sub = [...s.ops.subcontractors].filter((x) => x.services.includes(pkg.serviceId)).sort((a, c) => a.priceBps - c.priceBps)[0];
      out[pkg.id] = sub ? `${SOLE_SUB_PREFIX}${sub.id}` : null;
    } else out[pkg.id] = members.length === 1 && members[0]!.kind === 'owner' ? null : crewKey(members);
  }
  return out;
}

export function defaultPlanInput(s: GameState, p: RenoProject): ProjectPlanInput {
  return { startDate: addDays(s.clock.today, Math.max(2, Math.min(21, diffDays(p.desiredStart, s.clock.today)))), paymentTermDays: p.paymentTermDays, advanceBps: p.advanceMaxBps, crews: suggestCrews(s, p), totalPriceNet: defaultTotal(p) };
}

/** Dobór godzin właściciela i czasu trwania pakietu: dzień pracy skracany do wolnego czasu doby, plan wydłużany odpowiednio do wydajności ekipy. */
function fitPackage(s: GameState, pkg: RenoPackage, key: string | null, start: IsoDate, hpdMax: number, price: Grosze, terms: { advanceBps: number; paymentTermDays: number; laborRate: Grosze }, minDur = 1): { h: number; dur: number; preview: QuotePreview; conflict: boolean } {
  const base: QuoteInput = {
    serviceId: pkg.serviceId, units: pkg.units, complexity: pkg.complexity, standard: pkg.qualityReq >= 3 ? 'premium' : pkg.qualityReq === 1 ? 'eko' : 'std', priceNet: Math.max(1, price), startDate: start, durationDays: 365,
    hoursPerDay: hpdMax, advanceBps: terms.advanceBps, paymentTermDays: terms.paymentTermDays, laborRate: terms.laborRate, teamId: key, supervision: 'hands-off', vehicleId: null,
  };
  const ownerIn = key === null || (parseCrewKey(key) ?? []).some((m) => m.kind === 'owner') || !!s.ops.teams.find((t) => t.id === key)?.members.some((m) => m.kind === 'owner');
  let last: { h: number; dur: number; preview: QuotePreview; conflict: boolean } | null = null;
  for (const h of ownerIn ? [...new Set([hpdMax, 7, 6, 5, 4, 3, 2, 1].filter((x) => x <= hpdMax))] : [hpdMax]) {
    const probe = previewQuote(s, { ...base, hoursPerDay: h }, { project: true });
    const dur = Math.max(minDur, Math.ceil(probe.minDays * (ownerIn ? B2B_RULES.slackOwner : B2B_RULES.slackCrew)) + 1);
    const preview = previewQuote(s, { ...base, hoursPerDay: h, durationDays: dur }, { project: true });
    last = { h, dur, preview, conflict: !!preview.timeConflict };
    if (!preview.timeConflict) return last;
  }
  return last!;
}

export function planProject(s: GameState, p: RenoProject, input: ProjectPlanInput): ProjectPlan {
  const b = requireBusiness(s);
  const today = s.clock.today;
  const hpd = input.hoursPerDay ?? 6;
  const rate = input.laborRate ?? OWN_LABOR_RATE_DEFAULT;
  const total = input.totalPriceNet ?? defaultTotal(p);
  const refTotal = p.packages.reduce((a, x) => a + x.refPriceNet, 0);
  const blockers: string[] = [];
  const risks: string[] = [];
  const refs = companyReferences(s);
  const checks = requirementChecks(refs, p.requirements);
  for (const c of checks) if (!c.ok) blockers.push(`Wymagania klienta — ${c.label.toLowerCase()}: potrzeba ${c.need}, masz ${c.have}.`);
  if (input.startDate <= today) blockers.push('Start prac najwcześniej jutro.');
  if (input.paymentTermDays > p.maxTermDays) blockers.push(`Klient akceptuje termin płatności najwyżej ${p.maxTermDays} dni.`);
  if (input.advanceBps > p.advanceMaxBps) blockers.push(`Klient akceptuje zaliczkę najwyżej ${p.advanceMaxBps / 100}%.`);
  const crews = input.crews ?? suggestCrews(s, p);
  const plans: PackagePlan[] = [];
  const endOf = new Map<string, IsoDate>();
  let priceLeft = total;
  p.packages.forEach((pkg, idx) => {
    const price = input.prices?.[pkg.id] ?? (idx === p.packages.length - 1 ? priceLeft : Math.max(zl(10), roundDiv(roundDiv(total * pkg.refPriceNet, refTotal), zl(10)) * zl(10)));
    priceLeft -= price;
    const key = crews[pkg.id] ?? null;
    const start = pkg.dependsOn.reduce((a, d) => { const e = endOf.get(d); return e && addDays(e, 1) > a ? addDays(e, 1) : a; }, input.startDate);
    const fit = fitPackage(s, pkg, key, start, hpd, Math.max(1, price), { advanceBps: input.advanceBps, paymentTermDays: input.paymentTermDays, laborRate: rate });
    if (fit.conflict) blockers.push(`${pkg.label}: Brak wolnych godzin właściciela — ${formatDatePL(fit.preview.timeConflict!.date)} brakuje ${fit.preview.timeConflict!.missing} godz. nawet przy skróconym dniu pracy; wskaż pracownika lub podwykonawcę.`);
    const { h: usedHpd, dur, preview } = fit;
    const end = addDays(start, dur - 1);
    endOf.set(pkg.id, end);
    plans.push({ pkg, hoursPerDay: usedHpd, crewKey: key, priceNet: price, startDate: start, durationDays: dur, endDate: end, preview });
    for (const e of preview.errors) if (!/najwcześniej jutro/.test(e)) blockers.push(`${pkg.label}: ${e}`);
  });
  const endDate = plans.reduce((a, x) => (x.endDate > a ? x.endDate : a), input.startDate);
  const chainDays = diffDays(endDate, input.startDate) + 1;
  const longest = plans.length ? plans.reduce((a, x) => (x.durationDays > a.durationDays ? x : a)) : null;
  const longestHint = longest && chainDays > p.maxDays ? ` Najdłuższy pakiet: „${longest.pkg.label}” (${longest.durationDays} dni) — przydziel mu więcej osób albo kilku podwykonawców.` : '';
  if (chainDays > p.maxDays * 1.5) blockers.push(`Harmonogram (${chainDays} dni) jest nierealny wobec okna klienta (${p.maxDays} dni) — wzmocnij ekipy.${longestHint}`);
  else if (chainDays > p.maxDays) risks.push(`Harmonogram (${chainDays} dni) przekracza okno klienta (${p.maxDays} dni): ryzyko kar umownych i niższej oceny.${longestHint}`);
  const sum = (f: (x: PackagePlan) => number) => plans.reduce((a, x) => a + f(x), 0);
  const revenue = sum((x) => x.priceNet);
  const external = sum((x) => x.preview.economics.external.total);
  const ownerLabor = sum((x) => x.preview.economics.ownerLabor);
  const ownerCenti = sum((x) => x.preview.economics.ownerCenti);
  const surplus = revenue - external;
  // przepływy: zaliczki w dniu podpisania, wydatki na starcie pakietu, zapłata po zakończeniu pakietu + termin
  const ev: { date: IsoDate; amount: Grosze }[] = [];
  for (const x of plans) {
    const e = x.preview.economics;
    ev.push({ date: today, amount: e.liquidity.advance });
    ev.push({ date: x.startDate, amount: -e.liquidity.cashOutBeforePayment });
    ev.push({ date: addDays(x.endDate, 1 + input.paymentTermDays), amount: e.liquidity.finalPayment });
  }
  ev.sort((a, c) => a.date.localeCompare(c.date));
  let bal = 0;
  let low = 0;
  for (const e of ev) { bal += e.amount; low = Math.min(low, bal); }
  // środki do dyspozycji = najniższe prognozowane saldo na 60 dni (uwzględnia należności, zobowiązania i miesięczne obciążenia), nie samo dzisiejsze saldo
  // pomniejszone o materiały, których nie kupiono jeszcze do trwających kontraktów (zamrożone zobowiązanie gotówkowe)
  const pendingMaterials = reno(s).jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled').reduce((a, j) => a + Object.entries(jobShortage(s, j)).reduce((x, [k, n]) => x + n * materialPrice(s, k, today), 0), 0);
  const available = Math.max(0, Math.min(s.accounts[b.accountId]?.balance ?? 0, liquidityForecast(s, 60, 15).min) - pendingMaterials);
  const peakNeed = -low;
  const first = plans[0]?.preview.economics.liquidity.cashOutBeforePayment ?? 0;
  if (available < first) blockers.push(`Brakuje gotówki na start: pierwszy pakiet wymaga ok. ${formatPLN(first, { round: true })}, a firma ma ${formatPLN(available, { round: true })}.`);
  // bez kredytu (v0.9) firma nie sfinansuje projektu, którego zapotrzebowanie na gotówkę przekracza jej środki — B2B z długimi terminami płatności topi małe firmy
  if (peakNeed > available) blockers.push(`Zapotrzebowanie na gotówkę (ok. ${formatPLN(peakNeed, { round: true })}: materiały, podwykonawcy i transport przed zapłatą klienta po ${input.paymentTermDays} dniach od odbioru pakietu) przekracza środki firmy (${formatPLN(available, { round: true })}) — zwiększ zaliczkę, skróć termin płatności albo poczekaj na gotówkę.`);
  const client = reno(s).b2bClients.find((c) => c.id === p.b2bId);
  if (client && client.reliability < 65) risks.push(`Płatnik o niskiej rzetelności (${client.reliability}/100) — spodziewaj się zwłoki w płatnościach nawet do ${Math.round((100 - client.reliability) * B2B_RULES.delayPerReliabilityPt)} dni.`);
  if (revenue > p.walkAwayNet) risks.push('Cena przekracza granicę akceptowalną dla klienta — oferta zostanie najpewniej odrzucona.');
  else if (revenue > p.budgetNet) risks.push('Cena jest powyżej budżetu klienta — kontroferta lub odrzucenie są prawdopodobne.');
  if (surplus < 0) risks.push('Strata gotówkowa: cena nie pokrywa kosztów zewnętrznych projektu.');
  else if (surplus - ownerLabor < 0) risks.push('Zysk ekonomiczny jest ujemny (po wartości Twojej pracy) — projekt zarabia mniej niż przyjęta stawka.');
  risks.push(`Kara za zwłokę: ${p.penaltyBpsPerWeek / 100}% ceny pakietu za każdy rozpoczęty tydzień.`);
  return {
    packages: plans, startDate: input.startDate, endDate, chainDays, totalPriceNet: revenue,
    economics: { revenueNet: revenue, externalCost: external, ownerLabor, surplus, economicProfit: surplus - ownerLabor, ownerCenti, ownerHourly: ownerCenti > 0 ? roundDiv(surplus * 100, ownerCenti) : null, surplusMarginBps: revenue > 0 ? roundDiv(surplus * 10_000, revenue) : 0 },
    cash: { available, peakNeed, shortfall: Math.max(0, peakNeed - available) }, checks, blockers: [...new Set(blockers)], risks,
  };
}

/* ---------- Oferta, decyzja klienta, podpisanie ---------- */

export function sendProjectQuote(s: GameState, projectId: string, input: ProjectPlanInput): string {
  requireBusiness(s);
  const p = projectById(s, projectId);
  if (!p || p.status !== 'enquiry') throw new CommandError('To zapytanie nie jest już otwarte.');
  if (s.clock.today > p.respondBy) throw new CommandError('Termin odpowiedzi na to zapytanie minął.');
  const plan = planProject(s, p, input);
  if (plan.blockers.length) throw new CommandError(plan.blockers.slice(0, 3).join(' '));
  const today = s.clock.today;
  for (const x of plan.packages) { x.pkg.priceNet = x.priceNet; x.pkg.crewKey = x.crewKey; x.pkg.startDate = x.startDate; x.pkg.durationDays = x.durationDays; x.pkg.hoursPerDay = x.hoursPerDay; }
  const decideOn = addDays(today, createRng(s.seed, `b2b:decide:${p.id}`).int(B2B_RULES.decideDays[0], B2B_RULES.decideDays[1]));
  p.quote = { sentOn: today, decideOn, startDate: input.startDate, priceNet: plan.totalPriceNet, paymentTermDays: input.paymentTermDays, advanceBps: input.advanceBps, counter: null, held: false };
  p.status = 'quoted';
  logEvent(s, { id: `reno.project:${p.id}:quoted`, date: today, type: 'reno.project', tone: 'neutral', title: `Wysłano ofertę B2B: ${p.title}`, detail: `${formatPLN(plan.totalPriceNet, { round: true })} netto · ${plan.packages.length} pakietów · koniec ok. ${formatDatePL(plan.endDate)} · odpowiedź do ${formatDatePL(decideOn)}`.slice(0, 290), amount: null, category: null });
  return `Oferta wysłana. ${p.clientName.split(' (')[0]} odpowie do ${formatDatePL(decideOn)}.`;
}

export function declineProject(s: GameState, projectId: string): string {
  const p = projectById(s, projectId);
  if (!p || p.status !== 'enquiry') throw new CommandError('Można odrzucić tylko otwarte zapytanie.');
  p.status = 'declined';
  return 'Zapytanie odrzucone.';
}

/** Prawdopodobieństwo akceptacji oferty (pkt bazowe) i składniki — czytelne dla gracza. */
export function projectAcceptance(s: GameState, p: RenoProject): { pAccept: number; notes: string[] } {
  const q = p.quote!;
  const client = reno(s).b2bClients.find((c) => c.id === p.b2bId)!;
  const refs = companyReferences(s);
  const ratio = (q.priceNet * 10_000) / p.budgetNet;
  const notes: string[] = [];
  let base: number;
  if (ratio <= 9_000) base = 9_000;
  else if (ratio <= 10_000) base = 9_000 - Math.round(((ratio - 9_000) * 1_500) / 1_000);
  else if (q.priceNet <= p.walkAwayNet) base = 7_500 - Math.round(((q.priceNet - p.budgetNet) * 6_500) / Math.max(1, p.walkAwayNet - p.budgetNet));
  else { base = 300; notes.push('cena powyżej granicy klienta'); }
  const relation = Math.round((client.relationship - 40) * 15);
  const rating = refs.avgRating10 === null ? -500 : (refs.avgRating10 - 38) * 100;
  const scale = Math.min(1_600, refs.projectsDone.slice(p.tier - 1).reduce((a, x) => a + x, 0) * 800);
  const term = q.paymentTermDays < client.termDays ? -(client.termDays - q.paymentTermDays) * 25 : Math.min(300, (q.paymentTermDays - client.termDays) * 20);
  const end = q.startDate && p.packages.reduce((a, x) => (x.startDate && x.durationDays && addDays(x.startDate, x.durationDays - 1) > a ? addDays(x.startDate, x.durationDays - 1) : a), q.startDate);
  const chain = diffDays(end, q.startDate) + 1;
  const late = chain > p.maxDays ? -Math.min(3_500, (chain - p.maxDays) * 120) : 0;
  const competition = -createRng(s.seed, `b2b:rival:${p.id}`).int(0, 2_200);
  if (relation !== 0) notes.push(relation > 0 ? 'dobra współpraca z klientem' : 'klient jeszcze Ci nie ufa');
  if (late < 0) notes.push('termin dłuższy niż oczekuje klient');
  if (scale > 0) notes.push('masz referencje podobnej skali');
  return { pAccept: Math.max(0, Math.min(9_500, base + relation + rating + scale + term + late + competition)), notes };
}

function decideProject(s: GameState, p: RenoProject, date: IsoDate): void {
  const q = p.quote!;
  const { pAccept, notes } = projectAcceptance(s, p);
  const roll = createRng(s.seed, `b2b:outcome:${p.id}`).int(0, 9_999);
  const client = reno(s).b2bClients.find((c) => c.id === p.b2bId)!;
  const name = p.clientName.split(' (')[0];
  if (roll < pAccept) {
    p.status = 'accepted'; p.signBy = addDays(date, B2B_RULES.signDays);
    logEvent(s, { id: `reno.project:${p.id}:accepted`, date, type: 'reno.project', tone: 'positive', title: `${name} zaakceptował ofertę: ${p.title}`, detail: `Podpisz umowę do ${formatDatePL(p.signBy)}.`, amount: null, category: null });
  } else if (roll < pAccept + 3_000 && q.priceNet <= p.walkAwayNet * 1.04) {
    const discountBps = Math.max(300, Math.min(1_500, Math.round(((q.priceNet - p.budgetNet * 0.97) * 10_000) / q.priceNet)));
    p.status = 'counter'; p.signBy = addDays(date, B2B_RULES.signDays);
    q.counter = { discountBps, termDays: Math.min(p.maxTermDays, Math.max(q.paymentTermDays, client.termDays)) };
    logEvent(s, { id: `reno.project:${p.id}:counter`, date, type: 'reno.project', tone: 'warning', title: `${name} proponuje zmianę warunków: ${p.title}`, detail: `Rabat ${discountBps / 100}% i płatność ${q.counter.termDays} dni. Odpowiedz do ${formatDatePL(p.signBy)}.`, amount: null, category: null });
  } else {
    p.status = 'rejected'; p.note = (notes[0] ?? 'wybrał inną ofertę').slice(0, 280);
    client.relationship = Math.max(0, client.relationship - 2);
    logEvent(s, { id: `reno.project:${p.id}:rejected`, date, type: 'reno.project', tone: 'negative', title: `${name} odrzucił ofertę: ${p.title}`, detail: p.note, amount: null, category: null });
  }
}

export function respondProjectCounter(s: GameState, projectId: string, action: 'accept' | 'decline' | 'hold'): string {
  const p = projectById(s, projectId);
  if (!p || p.status !== 'counter' || !p.quote?.counter) throw new CommandError('Ta oferta nie czeka na Twoją odpowiedź.');
  const today = s.clock.today;
  const q = p.quote;
  if (action === 'decline') { p.status = 'declined'; return 'Odrzucono propozycję klienta.'; }
  if (action === 'hold') {
    if (q.held) throw new CommandError('Podtrzymałeś już swoje warunki.');
    q.held = true;
    const pAccept = Math.round(projectAcceptance(s, p).pAccept * 0.6);
    const win = createRng(s.seed, `b2b:hold:${p.id}`).int(0, 9_999) < pAccept;
    q.counter = null;
    if (win) { p.status = 'accepted'; p.signBy = addDays(today, B2B_RULES.signDays); return 'Klient przyjął Twoje pierwotne warunki. Podpisz umowę.'; }
    p.status = 'rejected'; p.note = 'klient nie zgodził się na podtrzymane warunki';
    return 'Klient nie zgodził się i zrezygnował.';
  }
  const c = q.counter!;
  let left = q.priceNet - mulBps(q.priceNet, c.discountBps);
  for (const [i, pkg] of p.packages.entries()) {
    const part = i === p.packages.length - 1 ? left : Math.max(1, roundDiv(pkg.priceNet * (10_000 - c.discountBps), 10_000));
    pkg.priceNet = part;
    left -= i === p.packages.length - 1 ? 0 : part;
  }
  q.priceNet = p.packages.reduce((a, x) => a + x.priceNet, 0);
  q.paymentTermDays = c.termDays;
  q.counter = null;
  p.status = 'accepted'; p.signBy = addDays(today, B2B_RULES.signDays);
  return `Zaakceptowano warunki klienta (cena ${formatPLN(q.priceNet, { round: true })} netto, płatność ${q.paymentTermDays} dni). Podpisz umowę.`;
}

/**
 * Aktywacja pakietu: pakiet staje się kontraktem silnika (jak „Podpisz umowę”) dopiero, gdy poprzednicy są odebrani — z nowym oknem czasu, zaliczką
 * etapu i wspólnymi warunkami projektu (termin płatności, kara klienta B2B). Dzięki temu opóźnienie poprzednika nie „postarza” terminów następnych
 * pakietów, a zasoby (ludzie, sprzęt, godziny właściciela) są rezerwowane tylko wtedy, gdy są potrzebne.
 */
function activatePackage(s: GameState, b: Operator, p: RenoProject, pkg: RenoPackage): void {
  const today = s.clock.today;
  const q = p.quote!;
  const st = reno(s);
  const members = parseCrewKey(pkg.crewKey);
  const crew: CrewMember[] = pkg.crewKey === null ? [{ kind: 'owner', id: 'owner' }] : members ?? [];
  if (crew.length === 0) throw new CommandError(`Pakiet „${pkg.label}”: wskaż wykonawcę.`);
  // najwcześniejszy termin, w którym wykonawcy (pracownicy, podwykonawcy) są wolni na cały czas pakietu, a właściciel ma wolne godziny — rezerwacja na przyszłość
  // chroni projekt przed „zagłodzeniem” przez kolejne drobne zlecenia, które zajmowałyby tych samych ludzi bez przerwy
  let start = pkg.startDate && pkg.startDate > today ? pkg.startDate : addDays(today, 1);
  // skład dopasowany do bieżącej dostępności: gdy ktoś z zaplanowanej ekipy zwolni się dopiero za tydzień i dłużej, zaczynamy mniejszym składem (pakiet potrwa dłużej,
  // ale projekt nie stoi tygodniami); właściciel i co najmniej jeden wykonawca zostają
  const crewKeyOf = (ms: CrewMember[]): string | null => (ms.length === 1 && ms[0]!.kind === 'owner' ? null : ms.length === 1 && ms[0]!.kind === 'sub' ? `${SOLE_SUB_PREFIX}${ms[0]!.id}` : crewKey(ms));
  let live = [...crew];
  while (live.filter((m) => m.kind !== 'owner').length > 1) {
    const latest = live.filter((m) => m.kind !== 'owner').map((m) => ({ m, f: firstFree(s, m.kind === 'employee' ? 'employee' : 'sub', m.id, start, Math.max(1, pkg.durationDays)) })).sort((a, c) => c.f.localeCompare(a.f))[0]!;
    if (diffDays(latest.f, start) <= 7) break;
    live = live.filter((m) => m !== latest.m);
  }
  if (live.length !== crew.length) { pkg.crewKey = crewKeyOf(live); crew.splice(0, crew.length, ...live); }
  let fit = fitPackage(s, pkg, pkg.crewKey, start, pkg.hoursPerDay, pkg.priceNet, { advanceBps: q.advanceBps, paymentTermDays: q.paymentTermDays, laborRate: OWN_LABOR_RATE_DEFAULT }, pkg.durationDays);
  for (let i = 0; i < 80; i++) {
    let free = start;
    for (const m of crew) {
      if (m.kind === 'owner') continue;
      const f = firstFree(s, m.kind === 'employee' ? 'employee' : 'sub', m.id, start, fit.dur);
      if (f > free) free = f;
    }
    if (free > start) { start = free; fit = fitPackage(s, pkg, pkg.crewKey, start, pkg.hoursPerDay, pkg.priceNet, { advanceBps: q.advanceBps, paymentTermDays: q.paymentTermDays, laborRate: OWN_LABOR_RATE_DEFAULT }, pkg.durationDays); continue; }
    if (fit.conflict) { start = addDays(start, 1); fit = fitPackage(s, pkg, pkg.crewKey, start, pkg.hoursPerDay, pkg.priceNet, { advanceBps: q.advanceBps, paymentTermDays: q.paymentTermDays, laborRate: OWN_LABOR_RATE_DEFAULT }, pkg.durationDays); continue; }
    break;
  }
  if (diffDays(start, today) > 90) throw new CommandError(`Pakiet „${pkg.label}”: wykonawcy są zajęci przez ponad 90 dni — wskaż innych wykonawców albo poczekaj.`);
  if (fit.preview.errors.length) throw new CommandError(`Pakiet „${pkg.label}”: ${fit.preview.errors[0]}`);
  if (fit.conflict) throw new CommandError(`Pakiet „${pkg.label}”: brak wolnych godzin właściciela od ${formatDatePL(start)} — wskaż pracownika lub podwykonawcę.`);
  const standard = pkg.qualityReq >= 3 ? 'premium' : pkg.qualityReq === 1 ? 'eko' : 'std';
  const nEnq = nextCounter(s, 'reno:enquiry');
  const enq: RenoEnquiry = {
    id: `enq:${nEnq}`, businessId: b.id, clientId: p.clientId, clientName: p.clientName, location: p.location, serviceId: pkg.serviceId, units: pkg.units, complexity: pkg.complexity, qualityReq: pkg.qualityReq,
    desiredStart: start, maxDays: Math.max(1, fit.dur), budgetGross: grossOfNet(Math.max(1, pkg.priceNet), vatRateNow(b)), walkAwayGross: grossOfNet(Math.max(1, pkg.priceNet), vatRateNow(b)), haggler: false, flexDays: 0,
    receivedOn: p.receivedOn, respondBy: today, status: 'won', segment: 'standard', source: null, rivals: 0, rivalId: null, rivalUtility: 0, rivalAwarded: false, projectId: p.id,
  };
  const nQ = nextCounter(s, 'reno:quote');
  const quote: RenoQuote = {
    id: `quote:${nQ}`, enquiryId: enq.id, businessId: b.id, serviceId: pkg.serviceId, units: pkg.units, complexity: pkg.complexity, standard, priceNet: pkg.priceNet, vatRateBps: vatRateNow(b),
    advanceBps: q.advanceBps, paymentTermDays: q.paymentTermDays, startDate: start, durationDays: fit.dur, hoursPerDay: fit.h, laborRate: OWN_LABOR_RATE_DEFAULT, planned: fit.preview.planned, plannedCenti: fit.preview.plannedCenti,
    sentOn: today, decideOn: today, status: 'accepted', counter: null, held: false, note: '', acceptedOn: today, signBy: today, replyDays: 0, teamId: null, supervision: 'hands-off', vehicleId: null, projectId: p.id,
  };
  st.enquiries.push(enq);
  st.quotes.push(quote);
  const preds = pkg.dependsOn.map((d) => p.packages.find((x) => x.id === d)?.jobId).filter((x): x is string => !!x);
  signContract(s, quote.id, crew, { projectId: p.id, packageId: pkg.id, dependsOn: preds, penaltyBpsPerWeek: p.penaltyBpsPerWeek });
  const job = st.jobs.find((j) => j.quoteId === quote.id)!;
  pkg.jobId = job.id;
}

/** Podpisanie umowy projektu: pierwsze pakiety (bez poprzedników) od razu stają się kontraktami; kolejne — po odbiorze poprzedników. */
export function signProject(s: GameState, projectId: string): string {
  const b = requireBusiness(s);
  const p = projectById(s, projectId);
  if (!p || p.status !== 'accepted' || !p.quote) throw new CommandError('Ta oferta nie czeka na podpisanie umowy.');
  const today = s.clock.today;
  if (p.signBy && today > p.signBy) throw new CommandError('Termin podpisania umowy minął.');
  for (const pkg of p.packages) if (pkg.dependsOn.length === 0) activatePackage(s, b, p, pkg);
  p.status = 'signed'; p.signedOn = today;
  logEvent(s, { id: `reno.project:${p.id}:signed`, date: today, type: 'reno.project', tone: 'positive', title: `Podpisano umowę projektu: ${p.title}`, detail: `${p.clientName.split(' (')[0]} · ${formatPLN(p.quote.priceNet, { round: true })} netto · ${p.packages.length} pakietów · płatność ${p.quote.paymentTermDays} dni`.slice(0, 290), amount: null, category: null });
  return `Umowa projektu podpisana. Pakiet „${p.packages[0]!.label}” jest już kontraktem; kolejne pakiety ruszają po odbiorze poprzednich (zaliczka etapu i materiały — wtedy). Kup materiały przed startem pakietu.`;
}

/* ---------- Dzień: terminy, zakończenie projektów, nowe zapytania ---------- */

function finishProject(s: GameState, p: RenoProject, date: IsoDate): void {
  const st = reno(s);
  const jobs = p.packages.map((pkg) => jobOfPackage(s, pkg)!).filter(Boolean);
  const fin = jobs.map((j) => jobFinancials(j));
  const ratings = jobs.map((j) => st.reviews.find((r) => r.jobId === j.id)?.rating10).filter((x): x is number => x !== undefined);
  const lateDays = Math.max(0, ...jobs.map((j) => j.lateDays));
  p.status = 'done'; p.finishedOn = date;
  p.outcome = {
    revenueNet: fin.reduce((a, f) => a + f.revenueNet, 0), surplusNet: fin.reduce((a, f) => a + f.surplusBeforeOwner, 0), penaltiesNet: jobs.reduce((a, j) => a + j.penaltyNet, 0),
    avgRating10: ratings.length ? Math.round(ratings.reduce((a, x) => a + x, 0) / ratings.length) : 0, lateDays, paymentDelayDays: Math.max(0, ...jobs.map((j) => j.paymentDelayDays)),
    workedHours: Math.round(fin.reduce((a, f) => a + f.workedHours, 0)),
  };
  const client = st.b2bClients.find((c) => c.id === p.b2bId);
  if (client) {
    client.projectsDone += 1;
    client.relationship = Math.max(0, Math.min(100, client.relationship + (lateDays === 0 && p.outcome.avgRating10 >= 38 ? 8 : lateDays <= 7 ? 3 : -4)));
  }
  logEvent(s, {
    id: `reno.project:${p.id}:done`, date, type: 'reno.project', tone: lateDays === 0 ? 'positive' : 'warning', title: `Projekt zakończony: ${p.title}`,
    detail: `Przychód ${formatPLN(p.outcome.revenueNet, { round: true })} netto · nadwyżka ${formatPLN(p.outcome.surplusNet, { round: true })} · opóźnienie ${lateDays} dni · kary ${formatPLN(p.outcome.penaltiesNet, { round: true })}`.slice(0, 290), amount: null, category: null,
  });
}

export function processProjects(s: GameState, b: Operator, date: IsoDate): void {
  const key = `b2b:day:${b.id}:${date}`;
  if (s.processed[key]) return;
  s.processed[key] = true;
  const st = reno(s);
  ensureB2BPool(s);
  if (st.projects.length === 0 && st.jobs.filter((j) => j.stage === 'done').length === 0) { rollB2BEnquiry(s, b, date); return; }
  for (const p of st.projects) {
    if (p.status === 'enquiry' && date > p.respondBy) { p.status = 'expired'; p.note = 'Termin odpowiedzi minął'; }
    else if (p.status === 'quoted' && p.quote && date >= p.quote.decideOn) decideProject(s, p, date);
    else if ((p.status === 'accepted' || p.status === 'counter') && p.signBy && date > p.signBy) { p.status = 'expired'; p.note = 'Klient wycofał ofertę (termin odpowiedzi minął)'; }
    else if (p.status === 'signed') {
      const jobs = p.packages.map((pkg) => jobOfPackage(s, pkg));
      const started = jobs.filter((j): j is NonNullable<typeof j> => !!j);
      if (started.some((j) => j.stage === 'cancelled')) {
        for (const j of jobs) if (j && j.stage !== 'done' && j.stage !== 'cancelled') cancelProjectJob(s, b, j, date, 'Projekt przerwany: inny pakiet został anulowany przez klienta');
        p.status = 'cancelled'; p.finishedOn = date;
        const client = st.b2bClients.find((c) => c.id === p.b2bId);
        if (client) client.relationship = Math.max(0, client.relationship - 10);
        logEvent(s, { id: `reno.project:${p.id}:cancelled`, date, type: 'reno.project', tone: 'negative', title: `Projekt przerwany: ${p.title}`, detail: 'Klient odstąpił od umowy po zbyt dużym opóźnieniu.', amount: null, category: null });
      } else if (jobs.every((j) => j?.stage === 'done')) finishProject(s, p, date);
      else {
        // pakiety, których poprzednicy zostali odebrani, stają się kontraktami (jeden dzień po odbiorze); brak wykonawców/godzin = ponowna próba następnego dnia
        for (const pkg of p.packages) {
          if (pkg.jobId || !pkg.dependsOn.every((d) => jobOfPackage(s, p.packages.find((x) => x.id === d)!)?.stage === 'done')) continue;
          // klient nie czeka bez końca: pakiet, który nie może ruszyć przez 45 dni od odbioru poprzednika, kończy projekt
          const readySince = pkg.dependsOn.map((d) => jobOfPackage(s, p.packages.find((x) => x.id === d)!)?.settledOn ?? date).sort().at(-1) ?? date;
          if (diffDays(date, readySince) > 45) {
            p.status = 'cancelled'; p.finishedOn = date; p.note = `Klient odstąpił od umowy: pakiet „${pkg.label}” nie ruszył w 45 dni od odbioru poprzedniego.`;
            const client = st.b2bClients.find((c) => c.id === p.b2bId);
            if (client) client.relationship = Math.max(0, client.relationship - 10);
            logEvent(s, { id: `reno.project:${p.id}:cancelled`, date, type: 'reno.project', tone: 'negative', title: `Projekt przerwany: ${p.title}`, detail: p.note.slice(0, 290), amount: null, category: null });
            break;
          }
          try {
            // próba na kopii: nieudana aktywacja (brak godzin, zajęty wykonawca) nie może zostawić po sobie częściowych zapisów (zlecenie, dokument zaliczki, rezerwacje)
            const trial = structuredClone(s);
            const tp = trial.reno.projects.find((x) => x.id === p.id)!;
            activatePackage(trial, b, tp, tp.packages.find((x) => x.id === pkg.id)!);
            activatePackage(s, b, p, pkg); p.note = ''; logEvent(s, { id: `reno.project:${p.id}:pkg:${pkg.id}`, date, type: 'reno.project', tone: 'neutral', title: `Rusza kolejny pakiet: ${pkg.label} (${p.title.split(':')[0]})`, detail: 'Zaliczka etapu i materiały — w kontraktach.', amount: null, category: null }); }
          catch (e) { if (!(e instanceof CommandError)) throw e; if (p.note !== e.message.slice(0, 280)) { p.note = e.message.slice(0, 280); logEvent(s, { id: `reno.project:${p.id}:wait:${pkg.id}:${date}`, date, type: 'reno.project', tone: 'warning', title: `Pakiet czeka na wykonawców: ${pkg.label}`, detail: p.note.slice(0, 290), amount: null, category: null }); } }
        }
      }
    }
  }
  rollB2BEnquiry(s, b, date);
}

/* ---------- Porównanie segmentów (małe zlecenia prywatne / większe remonty / B2B / model mieszany) ---------- */

export type SegmentKey = 'private' | 'bigger' | 'b2b' | 'mixed';
export interface SegmentStats {
  key: SegmentKey;
  label: string;
  contracts: number;
  avgValueNet: Grosze;
  revenueNet: Grosze;
  externalCost: Grosze;
  surplusNet: Grosze;
  surplusMarginBps: number;
  economicProfit: Grosze;
  hours: number;
  surplusPerHour: Grosze | null;
  openReceivables: Grosze;
  avgPaymentDelay: number;
  lateContracts: number;
}

export const SEGMENT_LABEL: Record<SegmentKey, string> = { private: 'Mali klienci prywatni', bigger: 'Większe remonty (inwestorzy, zarządcy)', b2b: 'Kontrakty B2B (firmy budowlane, generalni, deweloperzy)', mixed: 'Model mieszany (razem)' };

export function segmentOfJob(s: GameState, projectId: string | null | undefined): SegmentKey {
  if (!projectId) return 'private';
  const p = projectById(s, projectId);
  const kind = p ? reno(s).b2bClients.find((c) => c.id === p.b2bId)?.kind : undefined;
  return kind === 'private_investor' || kind === 'property_manager' ? 'bigger' : 'b2b';
}

export function segmentComparison(s: GameState): SegmentStats[] {
  const keys: SegmentKey[] = ['private', 'bigger', 'b2b', 'mixed'];
  const done = reno(s).jobs.filter((j) => j.stage === 'done');
  return keys.map((key) => {
    const jobs = done.filter((j) => key === 'mixed' || segmentOfJob(s, j.projectId) === key);
    const fin = jobs.map((j) => jobFinancials(j));
    const sum = (f: (x: ReturnType<typeof jobFinancials>) => number) => fin.reduce((a, x) => a + f(x), 0);
    const revenue = sum((f) => f.revenueNet);
    const surplus = sum((f) => f.surplusBeforeOwner);
    const hours = sum((f) => f.workedHours);
    const receivables = jobs.reduce((a, j) => a + (j.finalDocId ? s.obligations.filter((o) => o.status === 'open' && o.direction === 'receivable' && o.occurrenceId.startsWith(`${j.finalDocId}:`)).reduce((x, o) => x + o.amount, 0) : 0), 0);
    const delays = jobs.map((j) => j.paymentDelayDays);
    return {
      key, label: SEGMENT_LABEL[key], contracts: jobs.length, avgValueNet: jobs.length ? roundDiv(revenue, jobs.length) : 0, revenueNet: revenue, externalCost: sum((f) => f.externalCost), surplusNet: surplus,
      surplusMarginBps: revenue > 0 ? roundDiv(surplus * 10_000, revenue) : 0, economicProfit: sum((f) => f.economicProfit), hours, surplusPerHour: hours > 0 ? roundDiv(surplus, Math.round(hours)) : null,
      openReceivables: receivables, avgPaymentDelay: delays.length ? Math.round(delays.reduce((a, x) => a + x, 0) / delays.length) : 0, lateContracts: jobs.filter((j) => j.lateDays > 0).length,
    };
  });
}

export const STAGE_TITLE = STAGE_LABEL;
export { tierOfValue, b2bPaymentDelay };
