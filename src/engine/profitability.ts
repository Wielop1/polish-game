import { addDays, dateInMonth, monthKey, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { businessBalance } from './selectors.ts';
import type { Grosze } from './money.ts';
import { roundDiv } from './money.ts';
import { jobFinancials } from './renovation.ts';
import { subcontractsOfJob } from './subcontractors.ts';
import { payrollMonth, monthlyEmployerCost, activeEmployments, wageOn, personById } from './workforce.ts';
import { typicalMonthlyNet } from './payroll.ts';
import { vehicleDef } from './fleet.ts';
import type { GameState, RenoJob } from './state.ts';

/**
 * Rentowność (v0.6): koszty przypisane do zleceń (materiały, transport, robocizna pracowników wg godzin pracy, podwykonawcy,
 * pojazdy) oddzielone od kosztów stałych (płace bez zlecenia, koszty stałe pojazdów, reklama, księgowość, rekrutacja, składki właściciela).
 * Wynagrodzenie pracownika jest dzielone między kontrakty według przepracowanych godzin — nie obciąża w całości jednego zlecenia,
 * a godziny bez zlecenia są pokazane jako koszt stały (bezczynność).
 */

export interface CrewProfit {
  teamId: string | null;
  name: string;
  jobs: number;
  doneJobs: number;
  revenueNet: Grosze;
  directCosts: Grosze;
  contribution: Grosze;
  contributionBps: number | null;
  workedDays: number;
  delayedJobs: number;
}

export function crewProfitability(s: GameState): CrewProfit[] {
  const groups = new Map<string | null, RenoJob[]>();
  for (const j of s.reno.jobs) {
    if (j.stage === 'cancelled' && j.workedDays === 0) continue;
    const k = j.crew.teamId;
    groups.set(k, [...(groups.get(k) ?? []), j]);
  }
  const out: CrewProfit[] = [];
  for (const [teamId, jobs] of groups) {
    let revenue = 0, direct = 0, days = 0;
    for (const j of jobs) {
      const f = jobFinancials(j, subcontractsOfJob(s, j.id));
      revenue += f.revenueNet;
      direct += f.actualMaterials + f.actualOther + f.actualEmployees + f.actualSubcontract + f.actualVehicle;
      days += j.workedDays;
    }
    const doneJobs = jobs.filter((j) => j.stage === 'done');
    const doneRevenue = doneJobs.reduce((a, j) => a + jobFinancials(j).revenueNet, 0);
    const doneDirect = doneJobs.reduce((a, j) => { const f = jobFinancials(j, subcontractsOfJob(s, j.id)); return a + f.actualMaterials + f.actualOther + f.actualEmployees + f.actualSubcontract + f.actualVehicle; }, 0);
    out.push({
      teamId, name: teamId ? s.ops.teams.find((t) => t.id === teamId)?.name ?? teamId : 'Właściciel samodzielnie', jobs: jobs.length, doneJobs: doneJobs.length, revenueNet: doneRevenue, directCosts: doneDirect,
      contribution: doneRevenue - doneDirect, contributionBps: doneRevenue > 0 ? roundDiv((doneRevenue - doneDirect) * 10_000, doneRevenue) : null, workedDays: days, delayedJobs: jobs.filter((j) => j.lateDays > 0).length,
    });
    void revenue;
    void direct;
  }
  return out.sort((a, b) => (a.teamId ?? '').localeCompare(b.teamId ?? ''));
}

export interface FixedCosts {
  month: string;
  payrollTotal: Grosze;
  payrollAllocated: Grosze;
  payrollIdle: Grosze;
  vehicleFixed: Grosze;
  advertising: Grosze;
  accounting: Grosze;
  recruitment: Grosze;
  ownerContributions: Grosze;
  total: Grosze;
}

export function fixedCosts(s: GameState, month: string): FixedCosts {
  const pay = payrollMonth(s, month);
  const docs = s.documents.filter((d) => d.kind === 'cost' && d.issueDate.startsWith(month));
  const sum = (prefix: string) => docs.filter((d) => d.description.startsWith(prefix)).reduce((a, d) => a + d.taxAmount, 0);
  const vehicleFixed = s.ops.vehicles.filter((v) => monthKey(v.purchasedOn) <= month).reduce((a, v) => a + vehicleDef(v).fixedMonthly, 0);
  const owner = s.obligations.filter((o) => o.scope === 'business' && o.issueDate.startsWith(month) && (o.category === 'zus_spoleczne' || o.category === 'zus_zdrowotna')).reduce((a, o) => a + o.amount, 0);
  const advertising = sum('Reklama');
  const accounting = sum('Obsługa księgowa');
  const recruitment = sum('Ogłoszenie o pracę');
  return { month, payrollTotal: pay.total, payrollAllocated: pay.allocated, payrollIdle: pay.idle, vehicleFixed, advertising, accounting, recruitment, ownerContributions: owner, total: pay.idle + vehicleFixed + advertising + accounting + recruitment + owner };
}

export interface LiquidityPoint { date: IsoDate; balance: Grosze }

/**
 * Prognoza płynności firmy (nie księguje niczego): saldo + należności − zobowiązania w terminach + szacowane miesięczne obciążenia
 * (płace i składki pracowników, koszty stałe pojazdów, składki właściciela wg ostatniego miesiąca). Nie zakłada nowych kontraktów.
 */
export function liquidityForecast(s: GameState, days = 60, step = 7): { points: LiquidityPoint[]; min: Grosze; firstShortfall: IsoDate | null; monthlyBurn: Grosze } {
  const today = s.clock.today;
  const end = addDays(today, days);
  const flows: { date: IsoDate; amount: Grosze }[] = [];
  for (const o of s.obligations) {
    if (o.scope !== 'business' || o.status !== 'open') continue;
    flows.push({ date: o.dueDate > today ? o.dueDate : addDays(today, 1), amount: o.direction === 'receivable' ? o.amount : -o.amount });
  }
  // szacunek obciążeń cyklicznych, jeszcze nienaliczonych (pierwszy dzień miesiąca po dzisiejszym do końca horyzontu)
  const lastPeriod = [...s.taxPeriods].reverse()[0];
  const ownerMonthly = lastPeriod ? lastPeriod.social + lastPeriod.health : 0;
  const vehicleMonthly = s.ops.vehicles.reduce((a, v) => a + vehicleDef(v).fixedMonthly, 0);
  let payrollNet = 0, payrollRest = 0;
  for (const e of activeEmployments(s)) {
    const p = personById(s, e.personId)!;
    const gross = wageOn(e, today);
    const net = typicalMonthlyNet(gross, p.birthDate, today);
    payrollNet += net;
    payrollRest += monthlyEmployerCost(gross) - net;
  }
  const monthlyBurn = payrollNet + payrollRest + vehicleMonthly + ownerMonthly;
  let cursor = parseIso(today);
  for (let i = 0; i < 4; i++) {
    const y = cursor.month === 12 ? cursor.year + 1 : cursor.year;
    const m = cursor.month === 12 ? 1 : cursor.month + 1;
    cursor = { year: y, month: m, day: 1 };
    const accrual = dateInMonth(y, m, 'last'); // lista płac za miesiąc M wypłacana w M+1; tu przybliżamy terminami 10. i 20. miesiąca M
    void accrual;
    const ten = dateInMonth(y, m, 10);
    const twenty = dateInMonth(y, m, 20);
    if (ten > today && ten <= end && payrollNet > 0) flows.push({ date: ten, amount: -payrollNet });
    if (twenty > today && twenty <= end) flows.push({ date: twenty, amount: -(payrollRest + ownerMonthly) });
    const fixedDue = dateInMonth(y, m, 7);
    if (fixedDue > today && fixedDue <= end && vehicleMonthly > 0) flows.push({ date: fixedDue, amount: -vehicleMonthly });
  }
  let bal = businessBalance(s);
  const points: LiquidityPoint[] = [{ date: today, balance: bal }];
  let min = bal;
  let firstShortfall: IsoDate | null = null;
  for (let d = 1; d <= days; d++) {
    const date = addDays(today, d);
    for (const f of flows) if (f.date === date) bal += f.amount;
    if (bal < min) min = bal;
    if (bal < 0 && firstShortfall === null) firstShortfall = date;
    if (d % step === 0) points.push({ date, balance: bal });
  }
  return { points, min, firstShortfall, monthlyBurn };
}

/** Obłożenie ekipy: odsetek dni najbliższego okresu, w których ekipa ma przydzielony aktywny kontrakt. */
export function teamLoad(s: GameState, teamId: string, from: IsoDate = s.clock.today, days = 14): { busyDays: number; days: number; pct: number } {
  let busy = 0;
  for (let i = 1; i <= days; i++) {
    const d = addDays(from, i);
    if (s.reno.jobs.some((j) => j.crew.teamId === teamId && j.stage !== 'done' && j.stage !== 'cancelled' && j.startDate <= d && d <= j.deadline)) busy += 1;
  }
  return { busyDays: busy, days, pct: Math.round((busy * 100) / days) };
}
