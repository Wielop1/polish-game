import { CommandError, logEvent, nextCounter } from './core.ts';
import { addDays, daysInMonth, diffDays, formatDatePL, monthKey, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { macroAt } from './macro.ts';
import type { Macro } from './macro.ts';
import {
  CHANNELS, CHANNEL_IDS, COMPETITORS, MARKET_CITIES, DEMAND, MARKET_PARAMS_STATUS, POSITIONING, POSITIONINGS, SEGMENTS, SEGMENT_IDS, SEGMENT_SHIFT, STRATEGY, UTILITY, VISIBILITY,
} from './marketConfig.ts';
import type { ChannelId, CompetitorSize, MarketIndustry, Positioning, ProjectSpec, SegmentId } from './marketConfig.ts';
import { formatPLN, mulBps, roundDiv, zl } from './money.ts';
import type { Grosze } from './money.ts';
import { RENOVATION_MARKET } from './renovationMarket.ts';
import { createRng } from './rng.ts';
import type { Competitor, GameState, MarketMonth, MarketState } from './state.ts';

/**
 * Wspólna warstwa rynku (v0.7): popyt lokalny, konkurenci, marketing, segmentacja klientów, strategia firmy i koniunktura.
 * Branża przekazuje swoje parametry (`MarketIndustry`) i punkty zaczepienia (`MarketHooks`); ta warstwa nie zna usług
 * ani kontraktów — liczy popyt, rozdziela klientów między firmy i zwraca graczowi wyłącznie jego zapytania.
 *
 * Zasady:
 *  - deterministycznie: losowania z (seed, dzień/miesiąc, identyfikator) — bez stanu generatora w zapisie;
 *  - konkurenci znają tylko wskaźniki rynkowe (koniunktura, własne wyniki) — nigdy gotówki, kosztów, kalendarza ani ofert gracza;
 *  - nie każde zapytanie kończy się sprzedażą: klient porównuje oferty kilku firm, a gracz konkuruje ceną, jakością, opiniami i terminem;
 *  - wszystkie parametry są kalibracyjne (marketConfig.ts).
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const industryOf = (s: GameState): MarketIndustry => {
  if (s.market.industryId !== RENOVATION_MARKET.id) throw new Error(`Nieznana branża rynku: ${s.market.industryId}`);
  return RENOVATION_MARKET;
};

/* ---------- Stan początkowy ---------- */

export function initialMarketState(): MarketState {
  return {
    cityId: 'olsztyn',
    industryId: RENOVATION_MARKET.id,
    initializedOn: null,
    competitors: [],
    marketing: { budgets: {}, reach: {}, lastChargedMonth: null, spend: [] },
    strategy: { positioning: 'balanced', previous: null, changedOn: null, lastChargedMonth: null, history: [] },
    months: [],
    current: null,
    lastEntryMonth: null,
  };
}

/* ---------- Dane widoczne dla rynku o graczu (przekazuje branża) ---------- */

export interface PlayerView {
  /** Czy gracz prowadzi działającą firmę w tej branży (inaczej rynek toczy się bez niego). */
  active: boolean;
  specializations: readonly string[];
  /** Reputacja 0–100 (opinie klientów) i jakość wykonania 0–100 (średnia z ostatnich zakończonych prac; publicznie widoczna w portfolio). */
  reputation: number;
  quality: number;
  /** Zakończone prace z ostatnich 12 miesięcy — źródło spontanicznych poleceń. */
  completed12m: number;
  /** Czy firma jest „zajęta” (kolejka prac) — mnożnik widoczności (10 000 = bez wpływu). */
  queueGateBps: number;
  openEnquiries: number;
}

export interface PlayerInquiry {
  spec: ProjectSpec;
  segment: SegmentId;
  source: ChannelId | null;
  rivals: number;
  rivalId: string | null;
  rivalUtility: number;
}

export interface MarketHooks {
  industry: MarketIndustry;
  view: PlayerView;
  /** Tworzy zapytanie w branży; zwraca false, gdy firma nie może go przyjąć. */
  createEnquiry(inq: PlayerInquiry): boolean;
  /** Księguje koszt marketingu/pozycjonowania jako koszt działalności. */
  charge(description: string, net: Grosze): void;
}

/* ---------- Pozycjonowanie ---------- */

export interface PositioningBlend { bias: Record<SegmentId, number>; fit: Record<SegmentId, number>; progress: number; label: string }

/** Pozycjonowanie obowiązujące w danym dniu — po zmianie efekt narasta liniowo przez `STRATEGY.transitionDays` dni. */
export function positioningBlend(s: GameState, date: IsoDate): PositioningBlend {
  const st = s.market.strategy;
  const cur = POSITIONING[st.positioning];
  if (!st.previous || !st.changedOn) return { bias: cur.segmentBias, fit: cur.fit, progress: 1, label: cur.label };
  const p = clamp(diffDays(date, st.changedOn) / STRATEGY.transitionDays, 0, 1);
  const prev = POSITIONING[st.previous];
  const mix = (a: number, b: number) => Math.round(a + (b - a) * p);
  const bias = {} as Record<SegmentId, number>;
  const fit = {} as Record<SegmentId, number>;
  for (const g of SEGMENT_IDS) { bias[g] = mix(prev.segmentBias[g], cur.segmentBias[g]); fit[g] = mix(prev.fit[g], cur.fit[g]); }
  return { bias, fit, progress: p, label: cur.label };
}

/* ---------- Segmenty i sezonowość ---------- */

export function segmentShares(macro: Macro): Record<SegmentId, number> {
  const shift = clamp(Math.round(macro.index * SEGMENT_SHIFT.perPoint), SEGMENT_SHIFT.min, SEGMENT_SHIFT.max);
  const fromStd = Math.round((shift * SEGMENT_SHIFT.fromStandardPct) / 100);
  return {
    budget: SEGMENTS.budget.shareBps + shift,
    standard: SEGMENTS.standard.shareBps - fromStd,
    premium: SEGMENTS.premium.shareBps - (shift - fromStd),
  };
}

export function seasonalityFor(ind: MarketIndustry, serviceId: string, month: number): number {
  const general = ind.seasonalityBps[month] ?? 10_000;
  const svc = ind.serviceSeasonalityBps[serviceId]?.[month] ?? 10_000;
  return Math.round((general * svc) / 10_000);
}

/** Oczekiwana liczba projektów (całkowity popyt) w mieście danego dnia, per usługa. */
export function expectedDailyDemand(s: GameState, date: IsoDate, ind: MarketIndustry, macro: Macro): { serviceId: string; expected: number }[] {
  const { year, month } = parseIso(date);
  const city = MARKET_CITIES[s.market.cityId]!;
  const base = (city.population / 100_000) * DEMAND.projectsPer100kPerMonth * (city.demandScaleBps / 10_000);
  const noise = createRng(s.seed, `market:noise:${monthKey(date)}`).int(-DEMAND.monthlyNoiseBps, DEMAND.monthlyNoiseBps);
  const wd = (((diffDays(date, '2026-01-05') % 7) + 7) % 7); // 2026-01-05 = poniedziałek
  const avgWeekday = DEMAND.weekdayBps.reduce((a, b) => a + b, 0) / 7;
  const dim = daysInMonth(year, month);
  return ind.services.map((svc) => {
    const monthly = (base * svc.shareBps / 10_000) * (seasonalityFor(ind, svc.id, month) / 10_000) * (macro.demandBps / 10_000) * ((10_000 + noise) / 10_000);
    return { serviceId: svc.id, expected: (monthly / dim) * (DEMAND.weekdayBps[wd]! / avgWeekday) };
  });
}

/* ---------- Ocena oferty przez klienta ---------- */

export interface OfferTerms {
  /** Cena oferty brutto względem budżetu klienta (1,0 = dokładnie budżet). */
  valueIdx: number;
  quality: number;
  reputation: number;
  /** Opóźnienie startu (dni) ponad oczekiwany termin i elastyczność klienta. */
  lateDays: number;
  /** Dopasowanie pozycjonowania do segmentu (punkty ×100). */
  fit: number;
}

export interface UtilityParts { price: number; quality: number; reputation: number; time: number; fit: number; total: number }

/** Ocena oferty (punkty): im wyżej, tym chętniej klient ją wybierze. Segment decyduje o wagach. */
export function utilityParts(seg: SegmentId, t: OfferTerms): UtilityParts {
  const g = SEGMENTS[seg];
  const price = -g.priceSensitivity * ((t.valueIdx - UTILITY.priceCenter) / 0.1) * UTILITY.pricePerTenPct;
  const quality = (g.qualityWeight * (t.quality - g.expectedQuality)) / 20 * UTILITY.qualityPer20;
  const reputation = (g.reputationWeight * (t.reputation - UTILITY.reputationCenter)) / 20 * UTILITY.reputationPer20;
  const time = -(g.timeWeight * t.lateDays) / 14 * UTILITY.timePer14Days;
  const fit = t.fit / 100;
  return { price, quality, reputation, time, fit, total: price + quality + reputation + time + fit };
}

const noiseOf = (rng: { int(lo: number, hi: number): number }): number => ((rng.int(-100, 100) + rng.int(-100, 100) + rng.int(-100, 100)) / 300) * UTILITY.noise * 3;

/** Prawdopodobieństwo (pkt bazowe), że oferta o ocenie wyższej o `diff` punktów wygrywa z najlepszą rywalką — tablica logistyczna z interpolacją. */
export function winProbabilityBps(diff: number): number {
  const t = UTILITY.logistic;
  const x = clamp(diff, -4, 4) + 4;
  const i = Math.min(7, Math.floor(x));
  return Math.round(t[i]! + (t[i + 1]! - t[i]!) * (x - i));
}

/* ---------- Konkurenci ---------- */

const NAME_PREFIX = ['Remont', 'Mistrz', 'Eko', 'Dom', 'Lux', 'Warmia', 'Mazury', 'Złota Rączka', 'Master', 'Perfekt', 'Kolor', 'Gładź', 'Profil', 'Styl', 'Optima', 'Jaroty', 'Kortowo', 'Nova', 'Fachowiec', 'Solid'] as const;
const NAME_SUFFIX = ['Serwis', 'Wykończenia', 'Studio', 'Ekipa', 'Pro', 'Usługi Remontowe', 'Bud', 'Malarz', 'Partner', 'Expres'] as const;

function sizeOfWorkers(w: number): CompetitorSize { return w >= 5 ? 'medium' : w >= 2 ? 'small' : 'solo'; }

export function competitorAdReach(monthly: Grosze): number {
  return monthly <= 0 ? 0 : roundDiv(COMPETITORS.marketingMaxReach * monthly, monthly + COMPETITORS.marketingSaturation);
}

function newCompetitor(s: GameState, size: CompetitorSize, date: IsoDate, entering: boolean): Competitor {
  const n = nextCounter(s, 'market:competitor');
  const id = `comp:${n}`;
  const rng = createRng(s.seed, `market:competitor:${id}`);
  const ind = industryOf(s);
  const pr = rng.int(0, 99);
  const positioning: Positioning = size === 'medium' ? (pr < 15 ? 'low' : pr < 65 ? 'balanced' : 'premium') : (pr < 32 ? 'low' : pr < 82 ? 'balanced' : 'premium');
  const def = POSITIONING[positioning];
  const quality = clamp(def.typicalQuality + rng.int(-6, 6), 35, 95);
  const priceBps = clamp(def.typicalPriceBps + rng.int(-400, 400), 6_500, 16_000);
  const reputation = clamp(Math.round(48 + (quality - 55) * 0.8) + rng.int(-8, 8), 25, 92);
  const wanted = size === 'solo' ? rng.int(1, 2) : size === 'small' ? rng.int(2, 3) : ind.services.length;
  const pool = [...ind.services];
  const services: string[] = [];
  while (services.length < Math.min(wanted, pool.length)) {
    const total = pool.reduce((a, x) => a + x.shareBps, 0);
    let r = rng.int(0, total - 1);
    for (let i = 0; i < pool.length; i++) { r -= pool[i]!.shareBps; if (r < 0) { services.push(pool[i]!.id); pool.splice(i, 1); break; } }
  }
  const workers = COMPETITORS.sizes[size].workers + (size === 'small' ? rng.int(-1, 0) : size === 'medium' ? rng.int(-1, 0) : 0);
  const mk = size === 'solo' ? rng.int(0, 10) * 50 : size === 'small' ? 400 + rng.int(0, 16) * 50 : 1_000 + rng.int(0, 30) * 50;
  const marketingMonthly = entering && size === 'solo' ? zl(rng.int(0, 4) * 50) : zl(mk);
  let name = '';
  for (let tries = 0; tries < 40; tries++) {
    name = `${NAME_PREFIX[rng.int(0, NAME_PREFIX.length - 1)]} ${NAME_SUFFIX[rng.int(0, NAME_SUFFIX.length - 1)]}${tries > 20 ? ` ${rng.int(2, 9)}` : ''} (fikcyjna)`;
    if (!s.market.competitors.some((c) => c.name === name)) break;
  }
  return {
    id, name, status: 'active', enteredOn: date, exitedOn: null, size: sizeOfWorkers(workers), workers: Math.max(1, workers), services, positioning, priceBps, quality, reputation,
    marketingMonthly, marketingReach: competitorAdReach(marketingMonthly), backlogHours: 0, backlogValue: 0,
    cash: Math.max(1, workers) * COMPETITORS.costPerWorker * (entering ? 3 : 2), monthsInLoss: 0, highUtilMonths: 0, lowUtilMonths: 0,
    month: { won: 0, hours: 0, revenue: 0 }, last: null,
  };
}

const compCapacityHoursPerDay = (c: Competitor): number => c.workers * COMPETITORS.hoursPerWorkerDay;
const compBacklogDays = (c: Competitor): number => c.backlogHours / compCapacityHoursPerDay(c);

/** Widoczność konkurenta dla klienta z danego segmentu szukającego danej usługi (waga ×10 000). */
export function competitorVisibility(c: Competitor, seg: SegmentId, serviceId: string): number {
  if (c.status !== 'active') return 0;
  const size = COMPETITORS.sizes[c.size];
  const bias = POSITIONING[c.positioning].segmentBias[seg] / 10_000;
  const rep = (VISIBILITY.reputationBaseBps + VISIBILITY.reputationSlopeBps * c.reputation) / 10_000;
  const svc = c.services.includes(serviceId) ? 1 : VISIBILITY.nonSpecializedBps / 10_000;
  const gate = Math.max(0.15, 1 - Math.max(0, compBacklogDays(c) - 5) / 15);
  return Math.round((size.visibility + c.marketingReach) * bias * rep * svc * gate);
}

/* ---------- Widoczność gracza (marketing, polecenia, reputacja) ---------- */

export function marketingTargetReach(s: GameState, channel: ChannelId, budget: Grosze, macro: Macro): number {
  const def = CHANNELS[channel];
  if (budget <= 0) return 0;
  const base = roundDiv(def.maxReach * budget, budget + def.saturation);
  const macroFactor = 10_000 + Math.round((def.macroSensitivityBps * macro.index) / 10);
  const active = s.market.competitors.filter((c) => c.status === 'active');
  const avgComp = active.length ? active.reduce((a, c) => a + c.marketingReach, 0) / active.length / 10_000 : 0;
  const crowd = 10_000 / (10_000 + def.crowdingBps * avgComp);
  return Math.max(0, Math.round((base * macroFactor * crowd) / 10_000));
}

/** Spontaniczne polecenia zadowolonych klientów: rosną z liczbą zakończonych prac, malejąco, i z reputacją. */
export function organicReferralReach(view: PlayerView): number {
  const sat = view.completed12m / (view.completed12m + VISIBILITY.referralOrganicScale);
  return Math.round(VISIBILITY.referralOrganicMax * sat * (view.reputation / 100));
}

export interface VisibilityParts { channel: ChannelId | null; weight: number }

/** Składniki widoczności gracza w segmencie: kanały (z wagami segmentów), organiczne polecenia i bazowa widoczność (channel=null). */
export function playerVisibilityParts(s: GameState, seg: SegmentId, view: PlayerView, date: IsoDate): VisibilityParts[] {
  const out: VisibilityParts[] = [{ channel: null, weight: VISIBILITY.organicBase }];
  for (const ch of CHANNEL_IDS) {
    let reach = s.market.marketing.reach[ch] ?? 0;
    if (ch === 'referrals') reach += organicReferralReach(view);
    if (reach > 0) out.push({ channel: ch, weight: Math.round((reach * CHANNELS[ch].segmentBias[seg]) / 10_000) });
  }
  const blend = positioningBlend(s, date);
  const rep = (VISIBILITY.reputationBaseBps + VISIBILITY.reputationSlopeBps * view.reputation) / 10_000;
  const mult = (blend.bias[seg] / 10_000) * rep * (view.queueGateBps / 10_000);
  return out.map((p) => ({ channel: p.channel, weight: Math.round(p.weight * mult) }));
}

export function playerVisibility(s: GameState, seg: SegmentId, serviceId: string, view: PlayerView, date: IsoDate): number {
  const total = playerVisibilityParts(s, seg, view, date).reduce((a, p) => a + p.weight, 0);
  return view.specializations.includes(serviceId) ? total : Math.round((total * VISIBILITY.nonSpecializedBps) / 10_000);
}

/* ---------- Losowy wybór ważony ---------- */

function pickWeighted(rng: { int(lo: number, hi: number): number }, items: { id: string; w: number }[], k: number): string[] {
  const pool = items.filter((x) => x.w > 0).map((x) => ({ ...x }));
  const out: string[] = [];
  while (out.length < k && pool.length > 0) {
    const total = pool.reduce((a, x) => a + x.w, 0);
    let r = rng.int(0, Math.max(0, total - 1));
    let idx = 0;
    for (let i = 0; i < pool.length; i++) { r -= pool[i]!.w; if (r < 0) { idx = i; break; } idx = i; }
    out.push(pool[idx]!.id);
    pool.splice(idx, 1);
  }
  return out;
}

/* ---------- Inicjalizacja i miesiąc bieżący ---------- */

const emptyMonth = (s: GameState, month: string): MarketMonth => {
  const m = macroAt(s.seed, month);
  return { month, phase: m.phase, index: m.index, demand: 0, seekers: 0, playerInquiries: 0, playerLostCapacity: 0, playerWon: 0, rivalWon: 0, unserved: 0, competitors: 0, avgPriceBps: 0, avgReputation: 0, competitorUtilBps: 0, marketingSpend: 0 };
};

export function ensureMarket(s: GameState, date: IsoDate): void {
  const m = s.market;
  if (m.initializedOn !== null) return;
  m.initializedOn = date;
  for (const size of ['solo', 'small', 'medium'] as CompetitorSize[]) {
    for (let i = 0; i < COMPETITORS.initialMix[size]; i++) m.competitors.push(newCompetitor(s, size, date, false));
  }
  m.current = emptyMonth(s, monthKey(date));
  logEvent(s, { id: `market.start:${date}`, date, type: 'market.start', tone: 'neutral', title: 'Rynek lokalny: model rynku uruchomiony', detail: `${MARKET_CITIES[m.cityId]!.label}: ${m.competitors.length} firm konkurencyjnych w branży. Parametry modelu są kalibracyjne (nie z danych GUS).`, amount: null, category: null });
}

/* ---------- Dzienny przepływ klientów ---------- */

interface DayContext {
  s: GameState; date: IsoDate; hooks: MarketHooks; macro: Macro; priceIdx: number;
  weights: Map<string, { id: string; w: number }[]>;
}

function weightsFor(ctx: DayContext, seg: SegmentId, serviceId: string): { id: string; w: number }[] {
  const key = `${seg}:${serviceId}`;
  const hit = ctx.weights.get(key);
  if (hit) return hit;
  const arr = ctx.s.market.competitors.filter((c) => c.status === 'active').map((c) => ({ id: c.id, w: competitorVisibility(c, seg, serviceId) }));
  if (ctx.hooks.view.active) arr.push({ id: 'player', w: playerVisibility(ctx.s, seg, serviceId, ctx.hooks.view, ctx.date) });
  ctx.weights.set(key, arr);
  return arr;
}

/** Oferta konkurenta na dany projekt: cena z jego poziomu cen i ocena klienta (punkty ×100). */
function competitorOffer(c: Competitor, spec: ProjectSpec, seg: SegmentId, rng: { int(lo: number, hi: number): number }): { priceGross: Grosze; utility: number } {
  const price = mulBps(mulBps(spec.referenceGross, c.priceBps), 10_000 + rng.int(-400, 400));
  const lateDays = Math.max(0, Math.round(compBacklogDays(c)) - 3);
  const fit = POSITIONING[c.positioning].fit[seg];
  const parts = utilityParts(seg, { valueIdx: price / spec.budgetGross, quality: c.quality, reputation: c.reputation, lateDays, fit });
  return { priceGross: price, utility: Math.round((parts.total + noiseOf(rng)) * 100) + 0 };
}

function awardCompetitor(c: Competitor, spec: ProjectSpec, priceGross: Grosze, ind: MarketIndustry): boolean {
  if (compBacklogDays(c) > COMPETITORS.maxBacklogDays) return false;
  const svc = ind.services.find((x) => x.id === spec.serviceId);
  const added = mulBps(priceGross, 10_000 - (svc?.materialShareBps ?? 2_000));
  c.backlogHours += spec.hours;
  c.backlogValue += added;
  c.month.won += 1;
  return true;
}

function bumpCurrent(s: GameState, patch: Partial<Record<'demand' | 'seekers' | 'playerInquiries' | 'playerLostCapacity' | 'playerWon' | 'rivalWon' | 'unserved', number>>): void {
  const cur = s.market.current;
  if (!cur) return;
  for (const [k, v] of Object.entries(patch)) (cur as unknown as Record<string, number>)[k]! += v;
}

function pickChannel(rng: { int(lo: number, hi: number): number }, parts: VisibilityParts[]): ChannelId | null {
  const total = parts.reduce((a, p) => a + p.weight, 0);
  if (total <= 0) return null;
  let r = rng.int(0, total - 1);
  for (const p of parts) { r -= p.weight; if (r < 0) return p.channel; }
  return null;
}

function processProject(ctx: DayContext, serviceId: string, index: number, shares: Record<SegmentId, number>): void {
  const { s, date, hooks } = ctx;
  const ind = hooks.industry;
  const rng = createRng(s.seed, `market:proj:${date}:${serviceId}:${index}`);
  bumpCurrent(s, { demand: 1 });
  // ceny na rynku: drożej → więcej projektów odkładanych lub robionych samodzielnie
  const seeking = clamp(Math.round((DEMAND.seekingRateBps * ctx.macro.spendingBps * (1 - DEMAND.priceElasticity * (ctx.priceIdx - 1))) / 10_000), 500, 8_000);
  if (rng.int(0, 9_999) >= seeking) return; // projekt „własnoręcznie” / odłożony — nie trafia do rynku wykonawców
  bumpCurrent(s, { seekers: 1 });
  // segment
  const total = SEGMENT_IDS.reduce((a, g) => a + shares[g], 0);
  let r = rng.int(0, total - 1);
  let seg: SegmentId = 'standard';
  for (const g of SEGMENT_IDS) { r -= shares[g]; if (r < 0) { seg = g; break; } }
  const segDef = SEGMENTS[seg];
  const spec = ind.rollProject(rng, segDef, serviceId);
  // zestaw firm, z którymi klient porównuje oferty
  const weights = weightsFor(ctx, seg, serviceId);
  let set = pickWeighted(rng, weights, segDef.considerationSize);
  let source: ChannelId | null = null;
  const withPlayer = set.includes('player');
  if (withPlayer) {
    source = pickChannel(rng, playerVisibilityParts(s, seg, hooks.view, date));
    const ch = source ? CHANNELS[source] : null;
    if (ch && rng.int(0, 99) < ch.exclusivePct) set = ['player']; // klient zapytał tylko tę firmę (np. z polecenia)
    else if (ch && ch.extraRivals > 0) {
      const extra = pickWeighted(rng, weights.filter((x) => x.id !== 'player' && !set.includes(x.id)), ch.extraRivals);
      set = [...set, ...extra];
    }
  }
  // oferty konkurentów z zestawu
  const rivals = set.filter((id) => id !== 'player').map((id) => s.market.competitors.find((c) => c.id === id)!).filter(Boolean);
  const offers = rivals.map((c) => ({ c, ...competitorOffer(c, spec, seg, rng) })).sort((a, b) => b.utility - a.utility);
  if (!withPlayer) {
    const winner = offers.find((o) => awardCompetitor(o.c, spec, o.priceGross, ind));
    if (winner) bumpCurrent(s, { rivalWon: 1 });
    else bumpCurrent(s, { unserved: 1 });
    return;
  }
  // gracz w zestawie: tworzy zapytanie (o ile ma moce na obsługę zapytań)
  const best = offers[0] ?? null;
  const created = hooks.view.openEnquiries < DEMAND.maxOpenEnquiries && hooks.createEnquiry({ spec, segment: seg, source, rivals: rivals.length, rivalId: best?.c.id ?? null, rivalUtility: best?.utility ?? 0 });
  if (created) {
    hooks.view.openEnquiries += 1;
    bumpCurrent(s, { playerInquiries: 1 });
    return;
  }
  // brak mocy na obsługę zapytania: klient idzie do najlepszej konkurencyjnej oferty
  bumpCurrent(s, { playerLostCapacity: 1 });
  const winner = offers.find((o) => awardCompetitor(o.c, spec, o.priceGross, ind));
  if (winner) bumpCurrent(s, { rivalWon: 1 });
}

function competitorsWork(s: GameState, date: IsoDate): void {
  const weekday = (((diffDays(date, '2026-01-05') % 7) + 7) % 7) < 5;
  if (!weekday) return;
  for (const c of s.market.competitors) {
    if (c.status !== 'active' || c.backlogHours <= 0) continue;
    const worked = Math.min(c.backlogHours, compCapacityHoursPerDay(c));
    const value = c.backlogHours > 0 ? Math.round((c.backlogValue * worked) / c.backlogHours) : 0;
    c.backlogHours -= worked;
    c.backlogValue = Math.max(0, c.backlogValue - value);
    if (c.backlogHours === 0) c.backlogValue = 0;
    c.month.hours += worked;
    c.month.revenue += value;
  }
}

/* ---------- Miesięczne zamknięcie rynku ---------- */

function closeMonth(s: GameState, closing: string, date: IsoDate): void {
  const m = s.market;
  const macro = macroAt(s.seed, closing);
  const active = m.competitors.filter((c) => c.status === 'active');
  const cur = m.current!;
  cur.competitors = active.length;
  cur.avgPriceBps = active.length ? Math.round(active.reduce((a, c) => a + c.priceBps, 0) / active.length) : 0;
  cur.avgReputation = active.length ? Math.round(active.reduce((a, c) => a + c.reputation, 0) / active.length) : 0;
  const workers = active.reduce((a, c) => a + c.workers, 0);
  cur.competitorUtilBps = workers > 0 ? Math.round((active.reduce((a, c) => a + c.month.hours, 0) * 10_000) / (workers * COMPETITORS.hoursPerWorkerMonth)) : 0;
  cur.marketingSpend = m.marketing.spend.filter((x) => x.month === closing).reduce((a, x) => a + x.amount, 0);
  m.months.push(cur);
  if (m.months.length > 60) m.months.splice(0, m.months.length - 60);

  // ekonomia i decyzje konkurentów: tylko własne wyniki i koniunktura (bez wiedzy o graczu)
  const stress = macro.stressBps / 10_000;
  for (const c of active) {
    const rng = createRng(s.seed, `market:decision:${c.id}:${closing}`);
    const costs = mulBps(c.workers * COMPETITORS.costPerWorker, macro.wageBps) + COMPETITORS.sizes[sizeOfWorkers(c.workers)].overhead + c.marketingMonthly;
    const profit = c.month.revenue - costs;
    c.cash += profit;
    const util = Math.round((c.month.hours * 10_000) / Math.max(1, c.workers * COMPETITORS.hoursPerWorkerMonth));
    c.last = { utilizationBps: util, profit, won: c.month.won };
    c.monthsInLoss = profit < 0 ? c.monthsInLoss + 1 : 0;
    c.highUtilMonths = util >= COMPETITORS.decisions.hireUtilBps ? c.highUtilMonths + 1 : 0;
    c.lowUtilMonths = util <= COMPETITORS.decisions.fireUtilBps ? c.lowUtilMonths + 1 : 0;
    c.month = { won: 0, hours: 0, revenue: 0 };
    const d = COMPETITORS.decisions;
    // ceny: przy małym obłożeniu obniżają (mocniej w złej koniunkturze), przy dużym podnoszą
    if (util < 5_500) c.priceBps = clamp(c.priceBps - d.priceStepBps - (stress > 0.3 ? 100 : 0), d.priceMinBps, d.priceMaxBps);
    else if (util > 8_800) c.priceBps = clamp(c.priceBps + d.priceStepBps, d.priceMinBps, d.priceMaxBps);
    else c.priceBps = clamp(c.priceBps + Math.sign(POSITIONING[c.positioning].typicalPriceBps - c.priceBps) * 50, d.priceMinBps, d.priceMaxBps);
    // marketing: przy słabym obłożeniu i zapasie gotówki rośnie, przy braku gotówki spada do zera
    const cap = c.size === 'solo' ? zl(800) : c.size === 'small' ? zl(2_000) : zl(4_000);
    if (c.cash < costs) c.marketingMonthly = 0;
    else if (util < 6_000 && c.cash > costs * 3) c.marketingMonthly = Math.min(cap, c.marketingMonthly + Math.max(zl(100), mulBps(c.marketingMonthly, d.marketingStepBps)));
    else if (util > 9_000) c.marketingMonthly = roundDiv(mulBps(c.marketingMonthly, 10_000 - d.marketingStepBps), zl(10)) * zl(10);
    // moce: zatrudnia przy stałym przeciążeniu i zapasie gotówki, zwalnia przy stałym niedociążeniu
    if (c.highUtilMonths >= 3 && c.cash > costs * 2 && c.workers < d.maxWorkers) { c.workers += 1; c.highUtilMonths = 0; }
    else if (c.lowUtilMonths >= 3 && c.workers > 1) { c.workers -= 1; c.lowUtilMonths = 0; }
    c.size = sizeOfWorkers(c.workers);
    // jakość i reputacja: powoli; przeciążenie obniża reputację
    const typical = POSITIONING[c.positioning].typicalQuality;
    c.quality = clamp(c.quality + Math.sign(typical - c.quality) * rng.int(0, 1), 30, 96);
    const overload = compBacklogDays(c) > 12 ? 1 : 0;
    c.reputation = clamp(c.reputation + clamp(Math.round((c.quality - 68) / 12) + rng.int(-1, 1), -2, 2) - overload, 20, 95);
    // zmiany strategii w kłopotach / przy sukcesie
    if (c.monthsInLoss >= 3 && c.positioning !== 'low') c.positioning = 'low';
    else if (c.highUtilMonths >= 3 && c.positioning === 'balanced' && c.quality >= 72) c.positioning = 'premium';
    c.marketingReach = competitorAdReach(c.marketingMonthly) === 0 ? Math.round(c.marketingReach * 0.5) : Math.round(c.marketingReach + (competitorAdReach(c.marketingMonthly) - c.marketingReach) / 2);
    // wyjście z rynku
    if (c.cash < COMPETITORS.exit.minCash || c.monthsInLoss >= COMPETITORS.exit.monthsInLoss) {
      c.status = 'exited';
      c.exitedOn = date;
      c.backlogHours = 0;
      c.backlogValue = 0;
      logEvent(s, { id: `market.exit:${c.id}`, date, type: 'market.exit', tone: 'neutral', title: `Rynek: ${c.name} wycofuje się z rynku`, detail: 'Konkurent nie utrzymał rentowności (uproszczony stan ekonomiczny). Jego klienci szukają innych wykonawców.', amount: null, category: null });
    }
  }

  // nowi konkurenci: wchodzą, gdy rynek jest atrakcyjny, a liczba firm poniżej celu
  const nowActive = m.competitors.filter((c) => c.status === 'active').length;
  // liczba firm, które rynek „utrzyma”: zależy od koniunktury i od średniego obłożenia (publiczny sygnał opłacalności)
  const utils = m.competitors.filter((c) => c.status === 'active' && c.last).map((c) => c.last!.utilizationBps);
  const avgUtil = utils.length ? utils.reduce((a, b) => a + b, 0) / utils.length : 7_000;
  const utilAdj = avgUtil >= 9_500 ? 4 : avgUtil >= 8_500 ? 2 : avgUtil <= 5_000 ? -2 : 0;
  const target = (macro.phase === 'wzrost' ? COMPETITORS.targetCount + 2 : macro.phase === 'stabilizacja' ? COMPETITORS.targetCount : macro.phase === 'spowolnienie' ? COMPETITORS.targetCount - 1 : COMPETITORS.targetCount - 2) + utilAdj;
  const sinceEntry = m.lastEntryMonth ? (Number(closing.slice(0, 4)) - Number(m.lastEntryMonth.slice(0, 4))) * 12 + Number(closing.slice(5, 7)) - Number(m.lastEntryMonth.slice(5, 7)) : 99;
  if (nowActive < target && nowActive < COMPETITORS.maxCount && sinceEntry >= COMPETITORS.entry.minMonthsBetween) {
    const chance = COMPETITORS.entry.baseChancePct + (macro.phase === 'wzrost' ? COMPETITORS.entry.growthBonusPct : 0) * 1 + (target - nowActive) * 4;
    if (createRng(s.seed, `market:entry:${closing}`).int(0, 99) < chance) {
      const size: CompetitorSize = createRng(s.seed, `market:entry:size:${closing}`).int(0, 99) < 75 ? 'solo' : 'small';
      const c = newCompetitor(s, size, date, true);
      m.competitors.push(c);
      m.lastEntryMonth = closing;
      logEvent(s, { id: `market.entry:${c.id}`, date, type: 'market.entry', tone: 'neutral', title: `Rynek: nowy konkurent — ${c.name}`, detail: `Firma ${size === 'solo' ? 'jednoosobowa' : 'mała'} wchodzi na rynek (${POSITIONING[c.positioning].label.toLowerCase()}).`, amount: null, category: null });
    }
  }

  // marketing gracza: widoczność zbliża się do celu (opóźnienie efektu), potem opłata za nowy miesiąc
  const nowMacro = macroAt(s.seed, monthKey(date));
  for (const ch of CHANNEL_IDS) {
    const budget = m.marketing.budgets[ch] ?? 0;
    const target = marketingTargetReach(s, ch, budget, nowMacro);
    const cur = m.marketing.reach[ch] ?? 0;
    const next = Math.round(cur + (target - cur) / (1 + CHANNELS[ch].delayMonths));
    m.marketing.reach[ch] = target === 0 && next < 5 ? 0 : Math.max(0, next); // resztki po wyłączeniu kanału wygaszamy do zera
  }
}

/** Opłaty marketingowe i pozycjonowania za bieżący miesiąc (1. dnia miesiąca; idempotentnie). */
function chargeMonthly(s: GameState, date: IsoDate, hooks: MarketHooks): void {
  const m = s.market;
  const month = monthKey(date);
  if (m.marketing.lastChargedMonth !== month) {
    for (const ch of CHANNEL_IDS) {
      const amount = m.marketing.budgets[ch] ?? 0;
      if (amount <= 0) continue;
      hooks.charge(`Marketing: ${CHANNELS[ch].label} — ${month}`, amount);
      m.marketing.spend.push({ month, channel: ch, amount });
    }
    if (m.marketing.spend.length > 400) m.marketing.spend.splice(0, m.marketing.spend.length - 400);
    m.marketing.lastChargedMonth = month;
  }
  const cost = POSITIONING[m.strategy.positioning].monthlyCost;
  if (m.strategy.lastChargedMonth !== month) {
    if (cost > 0) hooks.charge(`Pozycjonowanie: ${POSITIONING[m.strategy.positioning].label} — ${month}`, cost);
    m.strategy.lastChargedMonth = month;
  }
}

/* ---------- Punkt wejścia: jeden dzień rynku ---------- */

export function processMarketDay(s: GameState, date: IsoDate, hooks: MarketHooks): void {
  const key = `market:day:${date}`;
  if (s.processed[key]) return;
  s.processed[key] = true;
  ensureMarket(s, date);
  const m = s.market;
  const month = monthKey(date);
  if (m.current && m.current.month !== month) {
    // po przerwie dłuższej niż miesiąc (np. zawieszenie firmy) rynek „stał” — nie zamykamy zaległych miesięcy, żeby konkurenci nie ponieśli skutków dni, których nie symulowano
    const gap = (Number(month.slice(0, 4)) - Number(m.current.month.slice(0, 4))) * 12 + Number(month.slice(5, 7)) - Number(m.current.month.slice(5, 7));
    if (gap === 1) closeMonth(s, m.current.month, date);
    m.current = emptyMonth(s, month);
  }
  chargeMonthly(s, date, hooks);
  const macro = macroAt(s.seed, month);
  const active = m.competitors.filter((c) => c.status === 'active');
  const priceIdx = active.length ? active.reduce((a, c) => a + c.priceBps, 0) / active.length / 10_000 : 1;
  const ctx: DayContext = { s, date, hooks, macro, priceIdx: clamp(priceIdx, 0.6, 1.6), weights: new Map() };
  const shares = segmentShares(macro);
  for (const { serviceId, expected } of expectedDailyDemand(s, date, hooks.industry, macro)) {
    const whole = Math.floor(expected);
    const frac = Math.round((expected - whole) * 10_000);
    const n = whole + (createRng(s.seed, `market:count:${date}:${serviceId}`).int(0, 9_999) < frac ? 1 : 0);
    for (let i = 0; i < n; i++) processProject(ctx, serviceId, i, shares);
  }
  competitorsWork(s, date);
}

/* ---------- Rozstrzyganie konkurencji przy decyzji klienta ---------- */

export interface RivalContest { contested: boolean; playerWins: boolean; winProbBps: number; reason: string; parts: UtilityParts | null }

/**
 * Klient, który porównuje oferty (rivals > 0), wybiera ofertę gracza albo najsilniejszego konkurenta z zestawu.
 * Ocena oferty gracza: cena względem budżetu klienta, jakość i reputacja firmy, opóźnienie startu, dopasowanie pozycjonowania.
 */
export function contestRival(s: GameState, q: { id: string; priceGross: Grosze; startDate: IsoDate }, enq: { segment: SegmentId; budgetGross: Grosze; desiredStart: IsoDate; flexDays: number; rivals: number; rivalId: string | null; rivalUtility: number }, player: { quality: number; reputation: number }, date: IsoDate): RivalContest {
  if (enq.rivals === 0 || !enq.rivalId) return { contested: false, playerWins: true, winProbBps: 10_000, reason: '', parts: null };
  const rng = createRng(s.seed, `market:contest:${q.id}`);
  const blend = positioningBlend(s, date);
  const parts = utilityParts(enq.segment, {
    valueIdx: q.priceGross / enq.budgetGross, quality: player.quality, reputation: player.reputation,
    lateDays: Math.max(0, diffDays(q.startDate, enq.desiredStart) - enq.flexDays), fit: blend.fit[enq.segment],
  });
  const mine = parts.total + noiseOf(rng);
  const p = winProbabilityBps(mine - enq.rivalUtility / 100);
  const wins = rng.int(0, 9_999) < p;
  const weakest = (['price', 'quality', 'reputation', 'time'] as const).map((k) => [k, parts[k]] as const).sort((a, b) => a[1] - b[1])[0]!;
  const why = { price: 'cena wyższa niż u konkurencji', quality: 'konkurent oferuje wyższą jakość', reputation: 'konkurent ma lepsze opinie', time: 'konkurent zaczyna w dogodniejszym terminie' }[weakest[0]];
  return { contested: true, playerWins: wins, winProbBps: p, reason: `klient wybrał ofertę konkurencji (${why})`, parts };
}

/** Przyznaje zlecenie konkurentowi (raz), gdy gracz go nie zdobył. Zwraca nazwę firmy lub null. */
export function awardToRival(s: GameState, enq: { id: string; serviceId: string; units: number; complexity: 'standard' | 'trudne'; qualityReq: number; segment: SegmentId; rivalId: string | null; rivalAwarded: boolean; budgetGross: Grosze }): string | null {
  if (!enq.rivalId || enq.rivalAwarded) return null;
  const ind = industryOf(s);
  const c = s.market.competitors.find((x) => x.id === enq.rivalId && x.status === 'active');
  (enq as { rivalAwarded: boolean }).rivalAwarded = true;
  if (!c) return null;
  const est = ind.estimate(enq.serviceId, enq.units, enq.complexity, enq.qualityReq);
  const spec = { serviceId: enq.serviceId, hours: est.hours, referenceGross: est.referenceGross } as ProjectSpec;
  const price = mulBps(est.referenceGross, c.priceBps);
  const ok = awardCompetitor(c, spec, price, ind);
  if (ok) bumpCurrent(s, { rivalWon: 1 });
  return ok ? c.name : null;
}

export function recordPlayerWin(s: GameState): void { bumpCurrent(s, { playerWon: 1 }); }

/* ---------- Komendy gracza ---------- */

export function setMarketingBudget(s: GameState, channel: string, monthlyNet: Grosze): string {
  if (s.market.initializedOn === null && s.businesses.every((b) => b.status !== 'active')) throw new CommandError('Marketing wymaga działającej firmy.');
  if (!(channel in CHANNELS)) throw new CommandError('Nieznany kanał marketingowy.');
  if (!Number.isInteger(monthlyNet) || monthlyNet < 0 || monthlyNet > zl(10_000)) throw new CommandError('Budżet miesięczny: od 0 do 10 000 zł netto.');
  const ch = CHANNELS[channel as ChannelId];
  const before = s.market.marketing.budgets[channel] ?? 0;
  if (before === monthlyNet) throw new CommandError('Ten budżet jest już ustawiony.');
  if (monthlyNet > 0) s.market.marketing.budgets[channel] = monthlyNet; else delete s.market.marketing.budgets[channel];
  return `${ch.label}: budżet ${monthlyNet > 0 ? `${formatPLN(monthlyNet)} netto miesięcznie` : 'wyłączony'}. Obowiązuje od 1. dnia następnego miesiąca; efekt narasta z opóźnieniem (~${ch.delayMonths} mies.) i maleje przy rosnącym budżecie.`;
}

export function setPositioning(s: GameState, positioning: string): string {
  if (!(POSITIONINGS as readonly string[]).includes(positioning)) throw new CommandError('Nieznane pozycjonowanie.');
  const st = s.market.strategy;
  if (st.positioning === positioning) throw new CommandError('To pozycjonowanie jest już ustawione.');
  const today = s.clock.today;
  if (st.changedOn && diffDays(today, st.changedOn) < STRATEGY.cooldownDays) {
    throw new CommandError(`Pozycjonowanie można zmienić najwcześniej ${formatDatePL(addDays(st.changedOn, STRATEGY.cooldownDays))} (marka potrzebuje czasu).`);
  }
  const from = st.positioning;
  st.previous = from;
  st.positioning = positioning as Positioning;
  st.changedOn = today;
  st.history.push({ date: today, from, to: st.positioning, note: `Zmiana pozycjonowania: ${POSITIONING[from].label} → ${POSITIONING[st.positioning].label}` });
  if (st.history.length > STRATEGY.maxHistory) st.history.splice(0, st.history.length - STRATEGY.maxHistory);
  logEvent(s, { id: `market.positioning:${today}:${st.history.length}`, date: today, type: 'market.positioning', tone: 'neutral', title: `Strategia: ${POSITIONING[from].label} → ${POSITIONING[st.positioning].label}`, detail: `Efekt narasta stopniowo przez ${STRATEGY.transitionDays} dni; reputacja i klienci nie zmieniają się z dnia na dzień.${POSITIONING[st.positioning].monthlyCost > 0 ? ` Koszt utrzymania: ${formatPLN(POSITIONING[st.positioning].monthlyCost)} netto miesięcznie.` : ''}`, amount: null, category: null });
  return `Pozycjonowanie: ${POSITIONING[st.positioning].label}. Zmiana będzie w pełni widoczna po ${STRATEGY.transitionDays} dniach.`;
}

export { MARKET_PARAMS_STATUS };
