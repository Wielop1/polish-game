import { VAT_PASS_THROUGH } from './business.ts';
import { parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import type { Grosze } from './money.ts';
import type { GameState } from './state.ts';

/**
 * Roczny raport JDG (ekran „Podsumowanie roku”). Wynik FIRMY (ewidencja `business`) jest rozdzielony od prywatnych
 * przepływów właściciela; przelewy własne (wkład/pobranie) są pokazane osobno i NIE są przychodem ani kosztem.
 */
export interface YearReport {
  year: number;
  asOf: IsoDate;
  complete: boolean;
  hasBusiness: boolean;
  /** Wynik memoriałowy firmy. */
  revenue: Grosze;
  costs: Grosze;
  income: Grosze;
  zus: Grosze;
  pit: Grosze;
  result: Grosze;
  /** Przepływy gotówkowe rachunku firmowego (bez przelewów własnych). */
  customerPayments: Grosze;
  cashOut: Grosze;
  ownerContributions: Grosze;
  ownerWithdrawals: Grosze;
  vatPaidNet: Grosze;
  receivables: Grosze;
  payables: Grosze;
  businessCash: Grosze;
  /** Prywatne: wynagrodzenie netto z etatu i wydatki prywatne (memoriałowo). */
  salaryNet: Grosze;
  privateExpenses: Grosze;
  netWorthStart: Grosze;
  netWorthEnd: Grosze;
  netWorthChange: Grosze;
  taxLossCreated: Grosze;
  /** Zmiana wartości zapasów materiałów w roku (zakupy − zużycie; moduł branżowy). */
  inventoryChange: Grosze;
  /** Wynik ekonomiczny = wynik firmy + zmiana zapasów (zakup materiałów jest kosztem podatkowym od razu, kosztem ekonomicznym dopiero przy zużyciu). */
  economicResult: Grosze;
  ruleIds: string[];
}

const COST_ZUS = new Set(['zus_spoleczne', 'zus_zdrowotna']);
const COST_PIT = new Set(['pit_zaliczka', 'pit_roczny']);

export function reportYears(s: GameState): number[] {
  const first = parseIso(s.clock.startDate).year;
  const last = parseIso(s.clock.today).year;
  const out: number[] = [];
  for (let y = first; y <= last; y++) out.push(y);
  return out;
}

export function yearReport(s: GameState, year: number): YearReport {
  const yEnd = `${year}-12-31`;
  const asOf = s.clock.today < yEnd ? s.clock.today : yEnd;
  const inYear = (d: IsoDate) => d.startsWith(`${year}-`);
  const bizAccounts = new Set(Object.values(s.accounts).filter((a) => a.type === 'business').map((a) => a.id));
  const r: YearReport = {
    year, asOf, complete: s.clock.today >= yEnd, hasBusiness: s.businesses.length > 0, revenue: 0, costs: 0, income: 0, zus: 0, pit: 0, result: 0,
    customerPayments: 0, cashOut: 0, ownerContributions: 0, ownerWithdrawals: 0, vatPaidNet: 0, receivables: 0, payables: 0, businessCash: 0,
    salaryNet: 0, privateExpenses: 0, netWorthStart: 0, netWorthEnd: 0, netWorthChange: 0, taxLossCreated: 0, inventoryChange: 0, economicResult: 0, ruleIds: [],
  };
  const jdgIds = new Set(s.businesses.map((b) => b.id));
  for (const o of s.obligations) {
    if (o.scope === 'company') continue; // zobowiązania spółek nie należą do rozliczeń osoby fizycznej
    if (o.scope === 'business') {
      if (inYear(o.issueDate)) {
        if (COST_ZUS.has(o.category)) r.zus += o.amount;
        else if (COST_PIT.has(o.category)) r.pit += o.amount;
        else if (o.category === 'pit_zwrot') r.pit -= o.amount;
        else if (o.category === 'zus_zdrowotna_zwrot') r.zus -= o.amount;
      }
      const openAtEnd = o.issueDate <= asOf && (o.settledDate === null || o.settledDate > asOf);
      if (openAtEnd && !VAT_PASS_THROUGH.has(o.category)) {
        if (o.direction === 'receivable') r.receivables += o.amount;
        else r.payables += o.amount;
      }
    } else if (inYear(o.issueDate)) {
      if (o.category === 'wynagrodzenie') r.salaryNet += o.amount;
      else if (o.direction === 'payable') r.privateExpenses += o.amount;
    }
  }
  for (const d of s.documents) {
    if (!inYear(d.issueDate) || !jdgIds.has(d.businessId)) continue;
    if (d.kind === 'sales') r.revenue += d.taxAmount;
    else r.costs += d.taxAmount;
  }
  for (const tx of s.ledger) {
    if (!bizAccounts.has(tx.accountId) || tx.date > asOf) continue;
    r.businessCash += tx.amount;
    if (!inYear(tx.date)) continue;
    if (tx.transferId) {
      if (tx.amount > 0) r.ownerContributions += tx.amount;
      else r.ownerWithdrawals += -tx.amount;
    } else if ((tx.category === 'przychod_dzialalnosci' || tx.category === 'zaliczka_klienta') && tx.amount > 0) r.customerPayments += tx.amount;
    else if (tx.category.startsWith('vat_')) r.vatPaidNet += -tx.amount;
    if (!tx.transferId && tx.amount < 0 && !tx.category.startsWith('vat_')) r.cashOut += -tx.amount;
  }
  r.income = r.revenue - r.costs;
  r.result = r.income - r.zus - r.pit;
  r.inventoryChange = s.reno.stockMoves.filter((m) => inYear(m.date) && m.date <= asOf).reduce((a, m) => a + m.value, 0);
  r.economicResult = r.result + r.inventoryChange;
  r.taxLossCreated = s.taxLosses.filter((l) => l.year === year).reduce((a, l) => a + l.amount, 0);
  r.ruleIds = [...new Set(s.taxReturns.filter((x) => x.year === year).flatMap((x) => x.ruleIds))].sort();
  const pts = s.history;
  const before = [...pts].reverse().find((p) => p.date <= `${year - 1}-12-31`) ?? pts[0];
  const end = [...pts].reverse().find((p) => p.date <= asOf) ?? pts[pts.length - 1];
  r.netWorthStart = before?.netWorth ?? 0;
  r.netWorthEnd = end?.netWorth ?? 0;
  r.netWorthChange = r.netWorthEnd - r.netWorthStart;
  return r;
}
