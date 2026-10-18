import { activeBusiness, issueDocument, planTaxFormChange, isSuspendedOn } from './business.ts';
import { CommandError, ensureParty } from './core.ts';
import { currentEmployment } from './contracts.ts';
import { addDays, firstOfNextMonth } from './date.ts';
import type { IsoDate } from './date.ts';
import { noticeEndDate, terminateEmployment } from './jobs.ts';
import { mulBps, roundDiv, zl } from './money.ts';
import type { Grosze } from './money.ts';
import { typicalMonthlyNet } from './payroll.ts';
import { businessBalance, netWorth, savingsBalance } from './selectors.ts';
import { advanceDays } from './simulate.ts';
import type { GameState, TaxForm } from './state.ts';
import { budgetFor, performanceBps } from './time.ts';

/**
 * Planowanie finansowe: PROGNOZA na KOPII stanu (`structuredClone`). Niczego nie księguje w grze, nie tworzy
 * zobowiązań ani zdarzeń — wynik to tylko tabela prognoz przy jawnych założeniach. Prognoza używa tego samego silnika
 * (kalkulator płac, ZUS, PIT, VAT, czas), więc jest z nim spójna; nie jest gwarancją wyniku.
 */
export interface PlanAssumptions {
  months: number;
  /** Stawka netto za godzinę pracy dla klientów (przychód przed VAT). */
  hourlyRate: Grosze;
  /** Koszty działalności jako % przychodu (pkt bazowe). */
  costShareBps: number;
  /** Pożądana liczba godzin pracy dla firmy dziennie (ogranicza ją wolny czas). */
  desiredHoursPerDay: number;
}

export const DEFAULT_ASSUMPTIONS: PlanAssumptions = { months: 12, hourlyRate: zl(150), costShareBps: 800, desiredHoursPerDay: 4 };

export interface PlanScenario {
  id: string;
  label: string;
  resignJob?: boolean;
  /** Mnożnik wymiaru etatu (np. 5000 = pół etatu). */
  workHoursFactorBps?: number;
  /** Zmiana formy opodatkowania od najbliższego 1 stycznia. */
  taxFormNextYear?: TaxForm;
  revenueFactorBps?: number;
  costFactorBps?: number;
  /** Dłuższy horyzont dla scenariuszy z przyszłą zmianą (domyślnie `assumptions.months`). */
  months?: number;
}

export interface PlanMonth {
  month: string;
  liquid: Grosze;
  revenue: Grosze;
}

export interface PlanResult {
  scenarioId: string;
  label: string;
  feasible: boolean;
  warnings: string[];
  months: number;
  /** Wolne godziny dziennie w dzień roboczy po zmianach scenariusza (przed rezerwacją na firmę). */
  freeHoursPerDay: number;
  businessHoursPerDay: number;
  salaryNet: Grosze;
  businessRevenue: Grosze;
  businessCosts: Grosze;
  taxesAndZus: Grosze;
  privateExpenses: Grosze;
  netWorthChange: Grosze;
  minLiquidity: Grosze;
  endLiquidity: Grosze;
  overdueCount: number;
  monthly: PlanMonth[];
}

const liquid = (s: GameState) => s.accounts[s.playerAccountId]!.balance + savingsBalance(s) + businessBalance(s);

/** Najmniejszy czas wolny w dni robocze najbliższego tygodnia (po zmianach scenariusza). */
function freeHours(s: GameState, from: IsoDate = s.clock.today): number {
  let min = 24;
  for (let i = 1; i <= 14; i++) min = Math.min(min, budgetFor(s, addDays(from, i)).free);
  return Math.max(0, min);
}

function runScenario(base: GameState, a: PlanAssumptions, sc: PlanScenario): PlanResult {
  const months = sc.months ?? a.months;
  let s = structuredClone(base);
  s.settings.lifeEvents = false; // założenie prognozy: bez zdarzeń losowych
  const warnings: string[] = [];
  const result: PlanResult = {
    scenarioId: sc.id, label: sc.label, feasible: true, warnings, months, freeHoursPerDay: 0, businessHoursPerDay: 0, salaryNet: 0, businessRevenue: 0,
    businessCosts: 0, taxesAndZus: 0, privateExpenses: 0, netWorthChange: 0, minLiquidity: 0, endLiquidity: 0, overdueCount: 0, monthly: [],
  };
  const startDate = s.clock.today;
  const startNetWorth = netWorth(s);

  try {
    const cur = currentEmployment(s);
    if (sc.resignJob && cur && cur.endDate === null) terminateEmployment(s, cur, 'employee', noticeEndDate(s.clock.today, cur.noticeMonths));
    if (sc.workHoursFactorBps && cur && cur.endDate === null) {
      const f = sc.workHoursFactorBps;
      cur.hoursPerMonth = Math.max(1, mulBps(cur.hoursPerMonth, f));
      if (cur.grossMonthly !== null) {
        cur.grossMonthly = mulBps(cur.grossMonthly, f);
        cur.monthlyAmount = typicalMonthlyNet(cur.grossMonthly, s.person.birthDate, s.clock.today);
      } else cur.monthlyAmount = mulBps(cur.monthlyAmount, f);
    }
    if (sc.taxFormNextYear) {
      if (!activeBusiness(s)) throw new CommandError('Zmiana formy opodatkowania wymaga prowadzonej działalności.');
      planTaxFormChange(s, sc.taxFormNextYear);
    }
  } catch (e) {
    if (!(e instanceof CommandError)) throw e;
    result.feasible = false;
    warnings.push(e.message);
    return result;
  }

  const biz = activeBusiness(s);
  // po rezygnacji liczy się czas wolny dopiero po okresie wypowiedzenia
  const afterJob = sc.resignJob ? currentEmployment(s)?.endDate ?? null : null;
  result.freeHoursPerDay = freeHours(s, afterJob && afterJob > s.clock.today ? afterJob : s.clock.today);
  const bh = biz ? Math.min(a.desiredHoursPerDay, result.freeHoursPerDay) : 0;
  result.businessHoursPerDay = bh;
  if (!biz) warnings.push('Brak działalności — prognoza obejmuje tylko etat i wydatki prywatne.');
  else if (bh < a.desiredHoursPerDay) warnings.push(`Wolny czas pozwala na ${bh} z ${a.desiredHoursPerDay} godz. pracy dla firmy dziennie.`);
  if (biz && bh > 0) {
    s.commitments.push({ id: 'commit:planning', label: 'Planowana praca dla firmy', startDate: addDays(startDate, 1), endDate: addDays(startDate, months * 31 + 5), hoursPerDay: bh, sourceEventId: null });
  }
  ensureParty(s, { id: 'party:planning', name: 'Klienci (prognoza)', role: 'service' });

  let minLiq = liquid(s);
  for (let m = 0; m < months; m++) {
    // do 15. dnia miesiąca: wystawienie sprzedaży wynikającej z założeń (godziny × stawka × wydajność)
    const target = addDays(firstOfNextMonth(s.clock.today), 14);
    s = advanceDays(s, Math.max(1, daysBetween(s.clock.today, target)));
    const b = activeBusiness(s);
    let revenue = 0;
    if (b && bh > 0 && s.clock.today >= b.startDate && !isSuspendedOn(b, s.clock.today) && b.closeOn === null) {
      const hours = bh * 30;
      revenue = mulBps(roundDiv(a.hourlyRate * hours * performanceBps(s.life.fatigue), 10_000), sc.revenueFactorBps ?? 10_000);
      if (revenue > 0) {
        issueDocument(s, b, { kind: 'sales', issueDate: s.clock.today, counterpartyId: 'party:planning', orderId: null, description: 'Prognozowana sprzedaż', net: revenue, termDays: 14 });
        const cost = mulBps(mulBps(revenue, a.costShareBps), sc.costFactorBps ?? 10_000);
        if (cost > 0) issueDocument(s, b, { kind: 'cost', issueDate: s.clock.today, counterpartyId: 'party:planning', orderId: null, description: 'Prognozowane koszty', net: cost, termDays: 7 });
      }
    }
    minLiq = Math.min(minLiq, liquid(s));
    result.monthly.push({ month: s.clock.today.slice(0, 7), liquid: liquid(s), revenue });
  }
  const end = advanceDays(s, Math.max(1, daysBetween(s.clock.today, firstOfNextMonth(s.clock.today))));
  minLiq = Math.min(minLiq, liquid(end));

  const inHorizon = (d: IsoDate) => d > startDate && d <= end.clock.today;
  for (const o of end.obligations) {
    if (!inHorizon(o.issueDate)) continue;
    const biz = o.scope === 'business';
    if (o.category === 'wynagrodzenie') result.salaryNet += o.amount;
    else if (o.category === 'przychod_dzialalnosci') result.businessRevenue += o.amount;
    else if (o.category === 'koszt_dzialalnosci') result.businessCosts += o.amount;
    else if (['zus_spoleczne', 'zus_zdrowotna', 'pit_zaliczka', 'pit_roczny'].includes(o.category) && o.direction === 'payable') result.taxesAndZus += o.amount;
    else if (['pit_zwrot', 'zus_zdrowotna_zwrot'].includes(o.category)) result.taxesAndZus -= o.amount;
    else if (!biz && o.direction === 'payable') result.privateExpenses += o.amount;
  }
  result.netWorthChange = netWorth(end) - startNetWorth;
  result.minLiquidity = minLiq;
  result.endLiquidity = liquid(end);
  result.overdueCount = end.obligations.filter((o) => o.status === 'open' && o.overdueSince !== null).length;
  if (result.minLiquidity < 0) warnings.push('Prognozowana płynność spada poniżej zera.');
  if (result.overdueCount > 0) warnings.push(`Na koniec horyzontu ${result.overdueCount} zobowiązań byłoby po terminie.`);
  return result;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  const f = from.split('-').map(Number) as [number, number, number];
  const t = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(f[0], f[1] - 1, f[2])) / 86_400_000);
}

/** Standardowy zestaw scenariuszy z wymagań (etat + JDG, bez etatu, pół etatu, zmiana formy, wyższe przychody). */
export function standardScenarios(s: GameState): PlanScenario[] {
  const biz = activeBusiness(s);
  const list: PlanScenario[] = [
    { id: 'baseline', label: 'Etat i JDG (bez zmian)' },
    { id: 'no-job', label: 'Rezygnacja z etatu, skupienie na firmie', resignJob: true },
    { id: 'half-job', label: 'Zmniejszenie etatu o połowę', workHoursFactorBps: 5_000 },
    { id: 'more-revenue', label: 'Wyższe przychody (+25%) i koszty (+10%)', revenueFactorBps: 12_500, costFactorBps: 11_000 },
  ];
  if (biz) {
    const nextForms = (['skala', 'liniowy', 'ryczalt'] as const).filter((f) => f !== biz.taxForm);
    for (const f of nextForms) list.push({ id: `form-${f}`, label: `Zmiana formy na ${f === 'skala' ? 'skalę' : f === 'liniowy' ? 'podatek liniowy' : 'ryczałt'} od nowego roku`, taxFormNextYear: f, months: Math.max(DEFAULT_ASSUMPTIONS.months, 24) });
  }
  return list;
}

export function runPlanning(state: GameState, assumptions: PlanAssumptions, scenarios: PlanScenario[]): PlanResult[] {
  return scenarios.map((sc) => runScenario(state, assumptions, sc));
}
