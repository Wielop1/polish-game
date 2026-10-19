import { activeBusiness } from './business.ts';
import { addDays, diffDays, monthKey } from './date.ts';
import type { IsoDate } from './date.ts';
import { macroAt } from './macro.ts';
import type { Macro } from './macro.ts';
import { organicReferralReach, playerVisibilityParts, positioningBlend } from './market.ts';
import { CHANNELS, CHANNEL_IDS, COMPETITORS, DEMAND, POSITIONING, SEGMENTS, SEGMENT_IDS, MARKET_CITIES } from './marketConfig.ts';
import type { ChannelId, Positioning, SegmentId } from './marketConfig.ts';
import { playerMarketView } from './renovation.ts';
import { roundDiv } from './money.ts';
import { createRng } from './rng.ts';
import { crewProfitability, fixedCosts } from './profitability.ts';
import { budgetFor } from './time.ts';
import { activeEmployments } from './workforce.ts';
import type { GameState } from './state.ts';

/**
 * Selektory rynku dla UI i symulatora balansu (v0.7). Tylko odczyt — niczego nie zmieniają.
 * Informacje o konkurentach są PRZYBLIŻENIAMI: gracz nie widzi ich gotówki, obciążenia ani dokładnych cen.
 */

const shiftMonth = (month: string, delta: number): string => {
  const t = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/* ---------- Koniunktura ---------- */

export interface MacroPoint { month: string; macro: Macro }

/** Ostatnie `n` miesięcy koniunktury (do bieżącego włącznie) — przyszłość nie jest ujawniana. */
export function macroHistory(s: GameState, n = 18, today: IsoDate = s.clock.today): MacroPoint[] {
  const now = monthKey(today);
  return Array.from({ length: n }, (_, i) => shiftMonth(now, i - (n - 1))).map((m) => ({ month: m, macro: macroAt(s.seed, m) }));
}

/* ---------- Lejek popytu gracza ---------- */

export interface FunnelMonth {
  month: string;
  /** Całkowity popyt w mieście i klienci szukający wykonawców (dane rynku; od momentu uruchomienia modelu). */
  demand: number | null;
  seekers: number | null;
  inquiries: number;
  lostCapacity: number;
  quotes: number;
  won: number;
  signed: number;
  done: number;
  /** Zapytania → podpisane umowy (pkt bazowe), null gdy brak zapytań. */
  conversionBps: number | null;
  marketingSpend: number;
  /** Koszt pozyskania zapytania i umowy (grosze), null gdy brak. */
  costPerInquiry: number | null;
  costPerContract: number | null;
}

export function playerFunnel(s: GameState, months = 12): FunnelMonth[] {
  const now = monthKey(s.clock.today);
  const byMonth = new Map(s.market.months.map((m) => [m.month, m]));
  if (s.market.current) byMonth.set(s.market.current.month, s.market.current);
  const out: FunnelMonth[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const month = shiftMonth(now, -i);
    const mm = byMonth.get(month);
    const inquiries = s.reno.enquiries.filter((e) => e.receivedOn.startsWith(month)).length;
    const quotes = s.reno.quotes.filter((q) => q.sentOn.startsWith(month)).length;
    const won = s.reno.quotes.filter((q) => q.acceptedOn?.startsWith(month)).length;
    const signed = s.reno.jobs.filter((j) => j.signedOn.startsWith(month)).length;
    const done = s.reno.jobs.filter((j) => j.finishedOn?.startsWith(month)).length;
    const spend = s.market.marketing.spend.filter((x) => x.month === month).reduce((a, x) => a + x.amount, 0);
    out.push({
      month, demand: mm?.demand ?? null, seekers: mm?.seekers ?? null, inquiries, lostCapacity: mm?.playerLostCapacity ?? 0, quotes, won, signed, done,
      conversionBps: inquiries > 0 ? Math.round((signed * 10_000) / inquiries) : null, marketingSpend: spend,
      costPerInquiry: inquiries > 0 && spend > 0 ? roundDiv(spend, inquiries) : null, costPerContract: signed > 0 && spend > 0 ? roundDiv(spend, signed) : null,
    });
  }
  return out;
}

export interface MarketOverview {
  city: string;
  population: number;
  macro: Macro;
  month: string;
  initialized: boolean;
  /** Ostatni zamknięty miesiąc: popyt, szukający, zapytania do gracza. */
  last: { month: string; demand: number; seekers: number; playerInquiries: number; playerWon: number; competitors: number } | null;
  /** Przybliżony udział gracza w zleceniach rynku (ostatnie 6 miesięcy), jako przedział; null, gdy brak danych. */
  share: { low: number; mid: number; high: number } | null;
  competitors: number;
  /** Średnie tempo zapytań do gracza (6 mies.) i wskaźnik konwersji. */
  inquiriesPerMonth: number;
  conversionBps: number | null;
}

export function marketOverview(s: GameState): MarketOverview {
  const month = monthKey(s.clock.today);
  const closed = s.market.months.slice(-6);
  const last = s.market.months.at(-1) ?? null;
  const pw = closed.reduce((a, m) => a + m.playerWon, 0);
  const rw = closed.reduce((a, m) => a + m.rivalWon, 0);
  const mid = pw + rw > 0 ? pw / (pw + rw) : null;
  const funnel = playerFunnel(s, 6);
  const inq = funnel.reduce((a, f) => a + f.inquiries, 0);
  const signed = funnel.reduce((a, f) => a + f.signed, 0);
  return {
    city: MARKET_CITIES[s.market.cityId]?.label ?? s.market.cityId, population: MARKET_CITIES[s.market.cityId]?.population ?? 0,
    macro: macroAt(s.seed, month), month, initialized: s.market.initializedOn !== null,
    last: last ? { month: last.month, demand: last.demand, seekers: last.seekers, playerInquiries: last.playerInquiries, playerWon: last.playerWon, competitors: last.competitors } : null,
    // gracz nie zna dokładnych wyników konkurentów — pokazujemy przedział ±30% wokół szacunku
    share: mid === null ? null : { low: Math.max(0, mid * 0.7), mid, high: Math.min(1, mid * 1.3) },
    competitors: s.market.competitors.filter((c) => c.status === 'active').length,
    inquiriesPerMonth: closed.length > 0 ? inq / Math.min(6, Math.max(1, closed.length)) : inq,
    conversionBps: inq > 0 ? Math.round((signed * 10_000) / inq) : null,
  };
}

/* ---------- Segmenty ---------- */

export interface SegmentRow {
  id: SegmentId;
  label: string;
  inquiries: number;
  signed: number;
  conversionBps: number | null;
  /** Średnia wartość podpisanych kontraktów (netto, grosze), null gdy brak. */
  avgContract: number | null;
  complaints: number;
  /** Jak widoczna jest Twoja firma dla tego segmentu względem średniego konkurenta (10 000 = średni konkurent). */
  relativeVisibilityBps: number;
}

export function segmentReport(s: GameState): SegmentRow[] {
  const view = playerMarketView(s, s.clock.today);
  const since = addDays(s.clock.today, -365);
  const avgComp = (seg: SegmentId): number => {
    const active = s.market.competitors.filter((c) => c.status === 'active');
    if (active.length === 0) return 10_000;
    return active.reduce((a, c) => a + (c.size === 'solo' ? 7_000 : c.size === 'small' ? 11_000 : 18_000) * (POSITIONING[c.positioning].segmentBias[seg] / 10_000), 0) / active.length;
  };
  return SEGMENT_IDS.map((id) => {
    const enqs = s.reno.enquiries.filter((e) => e.segment === id && e.receivedOn >= since);
    const jobs = s.reno.jobs.filter((j) => j.signedOn >= since && s.reno.enquiries.find((e) => e.clientId === j.clientId)?.segment === id);
    const own = playerVisibilityParts(s, id, view, s.clock.today).reduce((a, p) => a + p.weight, 0);
    return {
      id, label: SEGMENTS[id].label, inquiries: enqs.length, signed: jobs.length,
      conversionBps: enqs.length > 0 ? Math.round((jobs.length * 10_000) / enqs.length) : null,
      avgContract: jobs.length > 0 ? roundDiv(jobs.reduce((a, j) => a + j.priceNet, 0), jobs.length) : null,
      complaints: s.reno.complaints.filter((c) => jobs.some((j) => j.id === c.jobId)).length,
      relativeVisibilityBps: Math.round((own * 10_000) / Math.max(1, avgComp(id))),
    };
  });
}

/* ---------- Marketing ---------- */

export interface ChannelRow {
  id: ChannelId;
  label: string;
  budget: number;
  /** Skuteczna widoczność kanału (wartość z modelu ×10 000) i jej udział w widoczności firmy (%). */
  reach: number;
  sharePct: number;
  /** Docelowa widoczność przy obecnym budżecie (do którego kanał zmierza z opóźnieniem). */
  spend3m: number;
  inquiries3m: number;
  signed3m: number;
  costPerInquiry: number | null;
  costPerContract: number | null;
}

export function channelReport(s: GameState): ChannelRow[] {
  const view = playerMarketView(s, s.clock.today);
  const parts = playerVisibilityParts(s, 'standard', view, s.clock.today);
  const total = Math.max(1, parts.reduce((a, p) => a + p.weight, 0));
  const since = addDays(s.clock.today, -92);
  return CHANNEL_IDS.map((id) => {
    const spend3m = s.market.marketing.spend.filter((x) => x.channel === id && diffDays(s.clock.today, `${x.month}-01`) <= 92).reduce((a, x) => a + x.amount, 0);
    const enq = s.reno.enquiries.filter((e) => e.source === id && e.receivedOn >= since);
    const signed = s.reno.jobs.filter((j) => j.signedOn >= since && enq.some((e) => e.clientId === j.clientId)).length;
    const part = parts.find((p) => p.channel === id)?.weight ?? 0;
    return {
      id, label: CHANNELS[id].label, budget: s.market.marketing.budgets[id] ?? 0,
      reach: (s.market.marketing.reach[id] ?? 0) + (id === 'referrals' ? organicReferralReach(view) : 0), sharePct: Math.round((part * 100) / total),
      spend3m, inquiries3m: enq.length, signed3m: signed,
      costPerInquiry: enq.length > 0 && spend3m > 0 ? roundDiv(spend3m, enq.length) : null,
      costPerContract: signed > 0 && spend3m > 0 ? roundDiv(spend3m, signed) : null,
    };
  });
}

/* ---------- Konkurenci (widok przybliżony) ---------- */

export interface CompetitorView {
  id: string;
  name: string;
  status: 'active' | 'exited';
  positioning: Positioning;
  /** Przybliżona wielkość: liczba pracujących osób jako przedział. */
  sizeBand: string;
  /** Poziom cen względem średniej konkurentów (szacunek). */
  priceLevel: 'niższe' | 'zbliżone' | 'wyższe';
  /** Szacowana ocena klientów (gwiazdki, co 0,5). */
  stars: number;
  marketing: 'niska' | 'średnia' | 'wysoka';
  services: string[];
  /** Jak mocno rywalizuje z Tobą o klientów (0–100), liczone wyłącznie z danych jawnych. */
  threat: number;
}

/** Widok konkurentów dla gracza: oszacowania z deterministycznym „szumem” — bez gotówki, obciążenia i dokładnych cen. */
export function competitorViews(s: GameState): CompetitorView[] {
  const month = monthKey(s.clock.today);
  const active = s.market.competitors.filter((c) => c.status === 'active');
  const est = (id: string, salt: string, spread: number): number => createRng(s.seed, `market:view:${id}:${salt}:${month}`).int(-spread, spread);
  const avgPrice = active.length ? active.reduce((a, c) => a + c.priceBps + est(c.id, 'p', 500), 0) / active.length : 10_000;
  const mine = new Set(s.reno.specializations);
  const bl = positioningBlend(s, s.clock.today);
  return s.market.competitors.map((c) => {
    const p = c.priceBps + est(c.id, 'p', 500);
    const w = Math.max(1, c.workers + est(c.id, 'w', 1));
    const rep = Math.min(5, Math.max(1, (c.reputation + est(c.id, 'r', 6)) / 20));
    const overlap = c.services.filter((x) => mine.has(x)).length / Math.max(1, Math.max(mine.size, 1));
    const segFit = SEGMENT_IDS.reduce((a, g) => a + (Math.min(bl.bias[g], POSITIONING[c.positioning].segmentBias[g]) / 10_000) * SEGMENTS[g].shareBps, 0) / 10_000;
    return {
      id: c.id, name: c.name, status: c.status, positioning: c.positioning,
      sizeBand: w <= 1 ? '1 osoba' : w <= 4 ? '2–4 osoby' : '5 i więcej osób',
      priceLevel: p < avgPrice - 600 ? 'niższe' : p > avgPrice + 600 ? 'wyższe' : 'zbliżone',
      stars: Math.round(rep * 2) / 2,
      marketing: c.marketingMonthly < 400_00 ? 'niska' : c.marketingMonthly < 1_200_00 ? 'średnia' : 'wysoka',
      services: c.services,
      threat: c.status === 'active' ? Math.round(Math.min(100, (overlap * 55 + segFit * 25 + (c.reputation / 100) * 20))) : 0,
    };
  });
}

export interface PriceMarket { avgPriceBps: number; lowBps: number; highBps: number }
/** Przybliżony poziom cen rynkowych (średnia i rozrzut oszacowań), jako % ceny referencyjnej. */
export function marketPrices(s: GameState): PriceMarket | null {
  const month = monthKey(s.clock.today);
  const ps = s.market.competitors.filter((c) => c.status === 'active').map((c) => c.priceBps + createRng(s.seed, `market:view:${c.id}:p:${month}`).int(-500, 500));
  if (ps.length === 0) return null;
  const sorted = [...ps].sort((a, b) => a - b);
  return { avgPriceBps: Math.round(ps.reduce((a, b) => a + b, 0) / ps.length), lowBps: sorted[Math.floor(sorted.length * 0.15)]!, highBps: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.85))]! };
}

/* ---------- Zdolność wykonawcza i rentowność zatrudnienia ---------- */

export interface CapacityOverview {
  /** Wolne godziny właściciela dziennie (średnia z 14 dni) i godziny pracowników dziennie. */
  ownerFreeHoursPerDay: number;
  employeeHoursPerDay: number;
  activeJobs: number;
  /** Ile kontraktów miesięcznie firma jest w stanie obsłużyć przy typowym zleceniu (≈ 22 godz.): moc własna / godziny na zlecenie. */
  contractsPerMonth: number;
}

export function capacityOverview(s: GameState): CapacityOverview {
  let free = 0;
  for (let i = 1; i <= 14; i++) free += Math.max(0, budgetFor(s, addDays(s.clock.today, i)).free);
  const employees = activeEmployments(s);
  const empHours = employees.reduce((a, e) => a + (e.hoursPerMonth / 21), 0);
  const ownerPerDay = free / 14;
  return {
    ownerFreeHoursPerDay: Math.round(ownerPerDay * 10) / 10,
    employeeHoursPerDay: Math.round(empHours * 10) / 10,
    activeJobs: s.reno.jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled').length,
    contractsPerMonth: Math.round(((Math.min(8, ownerPerDay) + empHours) * 21) / 22),
  };
}

export interface EmploymentProfitability {
  employees: number;
  /** Miesięczny koszt pracodawcy (średnia z 3 ostatnich zamkniętych miesięcy), godziny przypisane do kontraktów wg kosztów (%) i bezczynność. */
  payrollMonthly: number;
  allocatedPct: number | null;
  idleMonthly: number;
  /** Wkład kontraktów zespołowych w pokrycie kosztów stałych na godzinę pracy (grosze) — przychód − materiały − transport − pojazd − podwykonawcy. */
  contributionPerHour: number | null;
  /** Obłożenie, przy którym pracownik na siebie zarabia: koszt miesięczny / (wkład na godzinę × 150 godz.), w %. */
  breakEvenPct: number | null;
  /** Prognozowana liczba zapytań, jakie musiałaby generować firma, by obłożyć wszystkich pracowników (zapytań/mies.). */
  inquiriesNeeded: number | null;
}

export function employmentProfitability(s: GameState): EmploymentProfitability {
  const emps = activeEmployments(s);
  const now = monthKey(s.clock.today);
  const months = [shiftMonth(now, -1), shiftMonth(now, -2), shiftMonth(now, -3)].filter((m) => m >= monthKey(activeBusiness(s)?.startDate ?? s.clock.today));
  let total = 0, idle = 0, allocated = 0;
  for (const m of months) { const f = fixedCosts(s, m); total += f.payrollTotal; idle += f.payrollIdle; allocated += f.payrollAllocated; }
  const n = Math.max(1, months.length);
  const teamJobs = s.reno.jobs.filter((j) => j.stage === 'done' && j.crew.teamId !== null && j.actual.labor > 0);
  let contrib = 0, hours = 0;
  for (const j of teamJobs) { contrib += j.priceNet - j.actual.materials - j.actual.transport - j.actual.other - j.actual.rework - j.actual.vehicle - j.actual.subcontract; hours += j.progressCenti / 100; }
  const perHour = hours > 0 ? roundDiv(contrib, Math.round(hours)) : null;
  const monthly = roundDiv(total, n);
  const breakEven = perHour && emps.length > 0 ? Math.round((monthly * 100) / (perHour * COMPETITORS.hoursPerWorkerMonth * emps.length)) : null;
  const jobsPerInquiry = 0.3;
  void crewProfitability;
  return {
    employees: emps.length, payrollMonthly: monthly, allocatedPct: total > 0 ? roundDiv(allocated * 100, total) : null, idleMonthly: roundDiv(idle, n),
    contributionPerHour: perHour, breakEvenPct: breakEven,
    inquiriesNeeded: emps.length > 0 ? Math.round((emps.length * COMPETITORS.hoursPerWorkerMonth * 0.7) / 22 / jobsPerInquiry) : null,
  };
}

export const DEMAND_PARAMS = DEMAND;
