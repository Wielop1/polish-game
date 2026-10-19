import { POLICIES } from './bot.ts';
import type { RunMetrics } from './bot.ts';

/** Agregacja wyników symulatora: mediany i rozrzut per strategia, wskaźniki ilorazowe liczone z sum (nie ze średnich ilorazów). */

export interface Stat { mean: number; median: number; p10: number; p90: number }
export interface PolicySummary {
  policy: string;
  label: string;
  runs: number;
  inquiriesPerYear: Stat;
  contractsPerYear: Stat;
  /** Σ kontraktów / Σ zapytań. */
  conversion: number;
  /** Σ kontraktów / Σ wysłanych ofert. */
  quoteWinRate: number;
  declinedShare: number;
  unansweredShare: number;
  revenuePerYear: Stat;
  /** Σ wyniku ekonomicznego kontraktów / Σ przychodu (przed kosztami stałymi). */
  contractMargin: number;
  /** Przychód netto na godzinę efektywnej pracy przy kontraktach (zł). */
  revenuePerWorkHour: number;
  /** Godziny pracy / moc własna (właściciel + pracownicy). */
  capacityUse: number;
  fixedCostsPerMonth: Stat;
  /** Udział płac pracowników przypisanych do kontraktów (null, gdy brak pracowników). */
  payrollUtilization: number | null;
  minBusinessCash: Stat;
  insolvencyRate: number;
  /** Wzrost majątku netto właściciela w skali roku (zł). */
  netWorthGrowthPerYear: Stat;
  /** Przedsiębiorczy zysk po kosztach stałych: (wynik kontraktów − koszty stałe) / rok (zł). */
  operatingProfitPerYear: Stat;
  ownerInjectionsPerYear: Stat;
  avgEmployees: number;
  /** Rynek: udział w zleceniach, zapytania utracone z braku mocy / oferty przegrane z konkurencją (na rok), obłożenie konkurentów, wejścia i wyjścia. */
  marketShare: number | null;
  lostCapacityPerYear: number;
  lostToRivalsPerYear: number;
  competitorUtil: number | null;
  competitorExits: number;
  competitorEntries: number;
  invariantFailures: number;
  /** v0.8.1: projekty B2B i podział przychodu; zysk ekonomiczny właściciela (po kalkulacyjnej wartości jego pracy). */
  projectsPerYear: { enquiries: number; quoted: number; signed: number; done: number };
  projectRevenuePerYear: number;
  privateRevenuePerYear: number;
  projectSurplusShare: number | null;
  privateSurplusShare: number | null;
  ownerEconomicProfitPerYear: Stat;
  avgPaymentDelay: number;
}

const pct = (sorted: number[], q: number): number => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!);
function stat(xs: number[]): Stat {
  const s = [...xs].sort((a, b) => a - b);
  return { mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0, median: pct(s, 0.5), p10: pct(s, 0.1), p90: pct(s, 0.9) };
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const zl = (g: number) => g / 100;
const statZl = (st: Stat): Stat => ({ mean: zl(st.mean), median: zl(st.median), p10: zl(st.p10), p90: zl(st.p90) });

export interface Summary { params: { years: number; runs: number; prefix: string; policies: string[]; capital?: number }; policies: PolicySummary[]; notes: string[] }

export function summarize(runs: RunMetrics[], params: Summary['params']): Summary {
  const out: PolicySummary[] = [];
  for (const id of params.policies) {
    const rs = runs.filter((r) => r.policy === id);
    if (rs.length === 0) continue;
    const yrs = (r: RunMetrics) => Math.max(0.01, r.days / 365);
    const revenue = sum(rs.map((r) => r.revenueNet));
    const hours = sum(rs.map((r) => r.workHours));
    const payroll = sum(rs.map((r) => r.payrollTotal));
    out.push({
      policy: id,
      label: POLICIES.find((p) => p.id === id)?.label ?? id,
      runs: rs.length,
      inquiriesPerYear: stat(rs.map((r) => r.inquiries / yrs(r))),
      contractsPerYear: stat(rs.map((r) => r.contracts / yrs(r))),
      conversion: sum(rs.map((r) => r.contracts)) / Math.max(1, sum(rs.map((r) => r.inquiries))),
      quoteWinRate: sum(rs.map((r) => r.contracts)) / Math.max(1, sum(rs.map((r) => r.quotesSent))),
      declinedShare: sum(rs.map((r) => r.declined)) / Math.max(1, sum(rs.map((r) => r.inquiries))),
      unansweredShare: sum(rs.map((r) => r.unanswered)) / Math.max(1, sum(rs.map((r) => r.inquiries))),
      revenuePerYear: statZl(stat(rs.map((r) => r.revenueNet / yrs(r)))),
      contractMargin: revenue > 0 ? sum(rs.map((r) => r.economicResult)) / revenue : 0,
      revenuePerWorkHour: hours > 0 ? zl(revenue) / hours : 0,
      capacityUse: sum(rs.map((r) => r.capacityHours)) > 0 ? hours / sum(rs.map((r) => r.capacityHours)) : 0,
      fixedCostsPerMonth: statZl(stat(rs.map((r) => r.fixedCostsTotal / (yrs(r) * 12)))),
      payrollUtilization: payroll > 0 ? 1 - sum(rs.map((r) => r.payrollIdle)) / payroll : null,
      minBusinessCash: statZl(stat(rs.map((r) => r.minBusinessCash))),
      insolvencyRate: rs.filter((r) => r.insolvent).length / rs.length,
      netWorthGrowthPerYear: statZl(stat(rs.map((r) => (r.netWorthEnd - r.netWorthStart) / yrs(r)))),
      operatingProfitPerYear: statZl(stat(rs.map((r) => (r.economicResult - r.fixedCostsTotal) / yrs(r)))),
      ownerInjectionsPerYear: statZl(stat(rs.map((r) => r.ownerInjections / yrs(r)))),
      avgEmployees: sum(rs.map((r) => r.avgEmployees)) / rs.length,
      marketShare: (() => { const xs = rs.map((r) => r.marketShare).filter((x): x is number => x !== null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; })(),
      lostCapacityPerYear: sum(rs.map((r) => r.lostCapacity / yrs(r))) / rs.length,
      lostToRivalsPerYear: sum(rs.map((r) => r.lostToRivals / yrs(r))) / rs.length,
      competitorUtil: (() => { const xs = rs.map((r) => r.avgCompetitorUtil).filter((x): x is number => x !== null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; })(),
      competitorExits: sum(rs.map((r) => r.competitorExits)) / rs.length,
      competitorEntries: sum(rs.map((r) => r.competitorEntries)) / rs.length,
      invariantFailures: rs.filter((r) => r.invariantErrors.length > 0).length,
      projectsPerYear: {
        enquiries: sum(rs.map((r) => r.projectEnquiries / yrs(r))) / rs.length, quoted: sum(rs.map((r) => r.projectsQuoted / yrs(r))) / rs.length,
        signed: sum(rs.map((r) => r.projectsSigned / yrs(r))) / rs.length, done: sum(rs.map((r) => r.projectsDone / yrs(r))) / rs.length,
      },
      projectRevenuePerYear: sum(rs.map((r) => r.projectRevenueNet / yrs(r))) / rs.length / 100,
      privateRevenuePerYear: sum(rs.map((r) => r.privateRevenueNet / yrs(r))) / rs.length / 100,
      projectSurplusShare: sum(rs.map((r) => r.projectRevenueNet)) > 0 ? sum(rs.map((r) => r.projectSurplusNet)) / sum(rs.map((r) => r.projectRevenueNet)) : null,
      privateSurplusShare: sum(rs.map((r) => r.privateRevenueNet)) > 0 ? sum(rs.map((r) => r.privateSurplusNet)) / sum(rs.map((r) => r.privateRevenueNet)) : null,
      ownerEconomicProfitPerYear: statZl(stat(rs.map((r) => r.ownerEconomicProfit / yrs(r)))),
      avgPaymentDelay: sum(rs.map((r) => r.avgPaymentDelay)) / rs.length,
    });
  }
  const notes: string[] = [];
  const ranked = [...out].sort((a, b) => b.netWorthGrowthPerYear.median - a.netWorthGrowthPerYear.median);
  if (ranked.length >= 2) {
    const [best, second] = [ranked[0]!, ranked[1]!];
    if (best.netWorthGrowthPerYear.median > 0 && second.netWorthGrowthPerYear.median > 0 && best.netWorthGrowthPerYear.median > 2 * second.netWorthGrowthPerYear.median) notes.push(`DOMINACJA: „${best.label}” daje >2× wyższy medianowy wzrost majątku niż następna strategia.`);
    if (best.netWorthGrowthPerYear.median <= 0) notes.push('Żadna strategia nie ma dodatniego medianowego wzrostu majątku netto.');
  }
  for (const p of out) {
    if (p.insolvencyRate > 0.5) notes.push(`„${p.label}”: niewypłacalność w ${Math.round(p.insolvencyRate * 100)}% przebiegów.`);
    if (p.invariantFailures > 0) notes.push(`„${p.label}”: naruszone niezmienniki w ${p.invariantFailures} przebiegach.`);
  }
  return { params, policies: out, notes };
}

const f0 = (n: number) => Math.round(n).toLocaleString('pl-PL');
const f1 = (n: number) => n.toFixed(1);
const fp = (n: number) => `${Math.round(n * 100)}%`;
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

export function formatSummary(sm: Summary): string {
  const rows: [string, (p: PolicySummary) => string][] = [
    ['zapytania / rok', (p) => f1(p.inquiriesPerYear.median)],
    ['kontrakty / rok', (p) => f1(p.contractsPerYear.median)],
    ['konwersja zapytanie→kontrakt', (p) => fp(p.conversion)],
    ['wygrane z wysłanych ofert', (p) => fp(p.quoteWinRate)],
    ['odrzucone przez gracza', (p) => fp(p.declinedShare)],
    ['bez odpowiedzi (wygasły)', (p) => fp(p.unansweredShare)],
    ['utracone: brak mocy / rok', (p) => f1(p.lostCapacityPerYear)],
    ['przegrane z konkurencją / rok', (p) => f1(p.lostToRivalsPerYear)],
    ['udział w zleceniach rynku', (p) => (p.marketShare === null ? '—' : fp(p.marketShare))],
    ['przychód netto / rok (zł)', (p) => f0(p.revenuePerYear.median)],
    ['marża kontraktów (nadwyżka przed obciążeniami)', (p) => fp(p.contractMargin)],
    ['zysk ekonomiczny po pracy właściciela / rok (zł)', (p) => f0(p.ownerEconomicProfitPerYear.median)],
    ['projekty B2B / rok: zapytania·wycenione·podpisane·zakończone', (p) => `${p.projectsPerYear.enquiries.toFixed(1)}·${p.projectsPerYear.quoted.toFixed(1)}·${p.projectsPerYear.signed.toFixed(1)}·${p.projectsPerYear.done.toFixed(1)}`],
    ['przychód z małych zleceń prywatnych / rok (zł)', (p) => f0(p.privateRevenuePerYear)],
    ['przychód z projektów / rok (zł)', (p) => f0(p.projectRevenuePerYear)],
    ['nadwyżka/przychód: prywatne | projekty', (p) => `${p.privateSurplusShare === null ? '—' : fp(p.privateSurplusShare)} | ${p.projectSurplusShare === null ? '—' : fp(p.projectSurplusShare)}`],
    ['średnia zwłoka płatnika B2B (dni)', (p) => f1(p.avgPaymentDelay)],
    ['przychód / godz. pracy (zł)', (p) => f0(p.revenuePerWorkHour)],
    ['wykorzystanie mocy własnej', (p) => fp(p.capacityUse)],
    ['koszty stałe / mies. (zł)', (p) => f0(p.fixedCostsPerMonth.median)],
    ['płace na kontraktach (udział)', (p) => (p.payrollUtilization === null ? '—' : fp(p.payrollUtilization))],
    ['zysk operacyjny / rok (zł)', (p) => f0(p.operatingProfitPerYear.median)],
    ['min. gotówka firmy (zł, p10)', (p) => f0(p.minBusinessCash.p10)],
    ['niewypłacalność', (p) => fp(p.insolvencyRate)],
    ['obłożenie konkurentów', (p) => (p.competitorUtil === null ? '—' : fp(p.competitorUtil))],
    ['konkurenci: wejścia / wyjścia', (p) => `${p.competitorEntries.toFixed(1)} / ${p.competitorExits.toFixed(1)}`],
    ['wzrost majątku / rok (zł, mediana)', (p) => f0(p.netWorthGrowthPerYear.median)],
    ['  p10 … p90', (p) => `${f0(p.netWorthGrowthPerYear.p10)}…${f0(p.netWorthGrowthPerYear.p90)}`],
  ];
  const w0 = Math.max(...rows.map((r) => r[0].length)) + 2;
  const cols = sm.policies.map((p) => Math.max(p.policy.length, 12) + 2);
  const lines: string[] = [];
  lines.push(`\n=== Wyniki: ${sm.params.years} lat, ${sm.params.runs} seedów (prefiks „${sm.params.prefix}”), kapitał ${(sm.params.capital ?? 9_000_000) / 100} zł ===`);
  lines.push(pad('', w0) + sm.policies.map((p, i) => padL(p.policy, cols[i]!)).join(''));
  for (const [name, fn] of rows) lines.push(pad(name, w0) + sm.policies.map((p, i) => padL(fn(p), cols[i]!)).join(''));
  if (sm.notes.length) { lines.push(''); for (const n of sm.notes) lines.push(`! ${n}`); }
  return lines.join('\n');
}
