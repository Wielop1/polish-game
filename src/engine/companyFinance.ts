import { CORP } from './corpConfig.ts';
import { addDays, daysInMonth, monthKey, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { macroAt } from './macro.ts';
import { mulBps, roundDiv } from './money.ts';
import type { Grosze } from './money.ts';
import { operatorView } from './operator.ts';
import { equipmentValue, inventoryValue, deferredAdvances, prepaidValue, vehiclesValue } from './selectors.ts';
import type { Company, CompanyMonth, CompanyValuation, GameState } from './state.ts';

/** Zaokrąglenie do pełnych złotych (50 gr i więcej w górę) — podstawa i podatek CIT (SIMPLIFIED, jak PIT-ROUNDING). */
export const roundToZl = (g: Grosze): Grosze => roundDiv(g, 100) * 100;

/* ---------- Bilans uproszczony (odrębny majątek spółki) ---------- */

export interface CompanyBalance {
  cash: Grosze;
  receivables: Grosze;
  inventory: Grosze;
  equipment: Grosze;
  vehicles: Grosze;
  prepaid: Grosze;
  payables: Grosze;
  /** Zaliczki od klientów do czasu wykonania usługi (zobowiązanie do wykonania usługi). */
  deferred: Grosze;
  /** Wpłaty na podwyższenie kapitału oczekujące na wpis do KRS (zobowiązanie wobec subskrybenta do czasu wpisu). */
  pendingCapital: Grosze;
  assets: Grosze;
  liabilities: Grosze;
  netAssets: Grosze;
  overduePayables: Grosze;
}

/** Aktywa i zobowiązania spółki — wyłącznie z jej rachunku, zobowiązań i własnych struktur (nie dotyka majątku gracza). */
export function companyBalance(s: GameState, c: Company): CompanyBalance {
  const v = operatorView(s, c.id);
  let receivables = 0;
  let payables = 0;
  let overdue = 0;
  for (const o of s.obligations) {
    if (o.accountId !== c.accountId || o.status !== 'open') continue;
    if (o.direction === 'receivable') receivables += o.amount;
    else {
      payables += o.amount;
      if (o.overdueSince !== null) overdue += o.amount;
    }
  }
  const cash = s.accounts[c.accountId]?.balance ?? 0;
  const inventory = inventoryValue(v);
  const equipment = equipmentValue(v);
  const vehicles = vehiclesValue(v);
  const prepaid = prepaidValue(v);
  const deferred = deferredAdvances(v);
  const pendingCapital = c.pendingIncrease?.contribution ?? 0;
  const assets = cash + receivables + inventory + equipment + vehicles + prepaid;
  const liabilities = payables + deferred + pendingCapital;
  return { cash, receivables, inventory, equipment, vehicles, prepaid, payables, deferred, pendingCapital, assets, liabilities, netAssets: assets - liabilities, overduePayables: overdue };
}

/* ---------- Dane podatkowe z dokumentów ---------- */

export interface TaxFigures { revenue: Grosze; costs: Grosze; income: Grosze; grossSales: Grosze }

/** Przychody i koszty podatkowe spółki z dokumentów jej działalności (kwoty `taxAmount`; sprzedaż brutto — do statusu małego podatnika). */
export function companyTaxFigures(s: GameState, c: Company, year: number, upTo: IsoDate = `${year}-12-31`): TaxFigures {
  const opId = c.operation?.id;
  let revenue = 0;
  let costs = 0;
  let grossSales = 0;
  if (opId) {
    const prefix = `${year}-`;
    for (const d of s.documents) {
      if (d.businessId !== opId || !d.issueDate.startsWith(prefix) || d.issueDate > upTo) continue;
      if (d.kind === 'sales') { revenue += d.taxAmount; grossSales += d.gross; } else costs += d.taxAmount;
    }
  }
  return { revenue, costs, income: revenue - costs, grossSales };
}

export function revenueInMonth(s: GameState, c: Company, month: string): Grosze {
  const opId = c.operation?.id;
  if (!opId) return 0;
  let sum = 0;
  for (const d of s.documents) if (d.businessId === opId && d.kind === 'sales' && d.issueDate.startsWith(month)) sum += d.taxAmount;
  return sum;
}

/** Rok rozpoczęcia działalności spółki (rok daty startu działalności) lub null. */
export const startYearOf = (c: Company): number | null => (c.operation ? parseIso(c.operation.startDate).year : null);

/** Limit przychodów roku dla stawki 9% (2 000 000 € wg kursu z pierwszego dnia roboczego roku; po 2026 r. — te same kwoty, carriedForward). */
export const citRevenueLimit = (_year: number): Grosze => CORP.citRevenueLimit2026;

/** Mały podatnik w roku `year`: sprzedaż brutto (z VAT) w poprzednim roku podatkowym ≤ 2 000 000 € (kurs z października). Brak historii = brak sprzedaży = mały. */
export function isSmallTaxpayer(s: GameState, c: Company, year: number): boolean {
  const prev = companyTaxFigures(s, c, year - 1);
  return prev.grossSales <= CORP.citSmallLimitFor2027;
}

export interface CitRate { rateBps: number; reason: string; smallTaxpayer: boolean; startYear: boolean; eligible9: boolean }

/**
 * Stawka CIT roku: 9% tylko gdy przychody roku (narastająco) nie przekraczają limitu ORAZ podatnik jest małym podatnikiem albo rozpoczął działalność
 * w tym roku (art. 19 ust. 1 pkt 2, 1d, 1e). Inaczej 19%. Wyjątki z ust. 1a/1c nie powstają w grze (spółki tylko z wkładów pieniężnych).
 */
export function citRateFor(s: GameState, c: Company, year: number, cumulativeRevenue: Grosze): CitRate {
  const startYear = startYearOf(c) === year;
  const small = isSmallTaxpayer(s, c, year);
  const underLimit = cumulativeRevenue <= citRevenueLimit(year);
  const eligible9 = underLimit && (small || startYear);
  const reason = eligible9
    ? `9%: przychody ${year} nie przekroczyły limitu 2 mln € (${(citRevenueLimit(year) / 100).toLocaleString('pl-PL')} zł), ${startYear ? 'rok rozpoczęcia działalności' : 'status małego podatnika'} [CO-CIT-RATES]`
    : !underLimit ? `19%: przychody ${year} przekroczyły limit 2 mln € dla stawki 9% [CO-CIT-RATES]`
    : `19%: brak statusu małego podatnika (sprzedaż brutto w ${year - 1} powyżej limitu) i nie jest to rok rozpoczęcia działalności [CO-CIT-SMALL]`;
  return { rateBps: eligible9 ? CORP.citSmallBps : CORP.citStandardBps, reason, smallTaxpayer: small, startYear, eligible9 };
}

/** Dostępna do odliczenia strata z lat ubiegłych w roku `year` (do 5 lat, nie więcej niż 50% straty rocznie). */
export function lossAvailable(s: GameState, c: Company, year: number): { total: Grosze; parts: { lossId: string; amount: Grosze }[] } {
  const parts: { lossId: string; amount: Grosze }[] = [];
  let total = 0;
  for (const l of s.corp.citLosses) {
    if (l.companyId !== c.id || year <= l.year || year > l.year + 5) continue;
    const used = l.usages.reduce((a, u) => a + u.amount, 0);
    const usedThisYear = l.usages.filter((u) => u.year === year).reduce((a, u) => a + u.amount, 0);
    if (usedThisYear > 0) continue;
    const cap = Math.floor(l.amount / 2);
    const amount = Math.min(cap, l.amount - used);
    if (amount > 0) { parts.push({ lossId: l.id, amount }); total += amount; }
  }
  return { total, parts };
}

/** Zaliczki CIT naliczone za rok (suma zobowiązań). */
export function citAdvancesAccrued(s: GameState, c: Company, year: number): Grosze {
  let sum = 0;
  for (const o of s.obligations) if (o.accountId === c.accountId && o.category === 'cit_zaliczka' && o.ruleId === `cit:adv:${c.id}:${year}`) sum += o.amount;
  return sum;
}

/* ---------- Kwota do podziału (art. 192 KSH) ---------- */

export interface Distributable {
  /** Zysk netto zamkniętych lat − uchwalone dywidendy − przeniesienia na kapitał zapasowy (pomniejszony o niepokryte straty). */
  retained: Grosze;
  /** Ograniczenie art. 189 § 2: aktywa netto po wypłacie nie mogą spaść poniżej kapitału zakładowego. */
  byCapital: Grosze;
  /** Ograniczenie gotówkowe (dostępna gotówka po zobowiązaniach wymagalnych do dnia wypłaty). */
  byCash: Grosze;
  max: Grosze;
  reasons: string[];
}

export function distributable(s: GameState, c: Company, payDay: IsoDate = addDays(s.clock.today, CORP.assemblyNoticeDays)): Distributable {
  const bal = companyBalance(s, c);
  const profit = c.yearResults.reduce((a, y) => a + y.netProfit, 0);
  // każda wykonana uchwała o podziale zysku (dywidenda + przeniesienie na kapitał zapasowy) pomniejsza kwotę do podziału
  const allocated = s.corp.resolutions
    .filter((r) => r.companyId === c.id && r.status === 'executed' && r.payload.type === 'allocate_profit')
    .reduce((a, r) => a + (r.payload.type === 'allocate_profit' ? r.payload.dividendGross + r.payload.toReserve : 0), 0);
  const retained = Math.max(0, profit - allocated);
  const byCapital = Math.max(0, bal.netAssets - c.capital);
  let due = 0;
  for (const o of s.obligations) if (o.accountId === c.accountId && o.status === 'open' && o.direction === 'payable' && o.dueDate <= payDay) due += o.amount;
  const byCash = Math.max(0, bal.cash - due);
  const max = Math.min(retained, byCapital, byCash);
  const reasons: string[] = [];
  if (retained === 0) reasons.push('brak zysku do podziału (zysk za zamknięte lata minus wcześniejsze wypłaty i straty — art. 192 KSH)');
  if (byCapital === 0) reasons.push('aktywa netto nie przekraczają kapitału zakładowego (art. 189 § 2 KSH)');
  if (byCash === 0) reasons.push('brak wolnej gotówki po zobowiązaniach wymagalnych do dnia wypłaty');
  return { retained, byCapital, byCash, max, reasons };
}

/* ---------- Wycena spółki ---------- */

const MULT = CORP.valuation;

function volatilityFactorBps(months: CompanyMonth[]): { bps: number; note: string } {
  const rev = months.slice(-12).map((m) => m.revenue);
  if (rev.length < 3) return { bps: 10_000, note: 'za mało miesięcy na ocenę stabilności przychodów' };
  const mean = rev.reduce((a, b) => a + b, 0) / rev.length;
  if (mean <= 0) return { bps: 8_000, note: 'brak przychodów' };
  const sd = Math.sqrt(rev.reduce((a, b) => a + (b - mean) ** 2, 0) / rev.length);
  const cvBps = Math.round((sd / mean) * 10_000);
  const bps = Math.max(8_000, Math.min(12_000, 12_000 - Math.round(cvBps * 0.5)));
  return { bps, note: `zmienność przychodów ${(cvBps / 100).toFixed(0)}% → współczynnik stabilności ${(bps / 10_000).toFixed(2)}` };
}

/** Wycena spółki (szacunek): aktywa netto + część nadwyżki wartości dochodowej; kary za stratę, słabą płynność i zaległości. Nie jest ceną transakcji. */
export function valueCompany(s: GameState, c: Company, date: IsoDate = s.clock.today): CompanyValuation {
  const bal = companyBalance(s, c);
  const factors: string[] = [];
  const recent = c.monthly.slice(-12);
  const months = recent.length;
  const netAssets = bal.netAssets;
  let profit12 = 0;
  if (months >= 2) {
    const last = recent[months - 1]!;
    const prev = c.monthly.length > months ? c.monthly[c.monthly.length - months - 1]! : null;
    const contrib = recent.reduce((a, m) => a + m.contributions, 0);
    const divs = recent.reduce((a, m) => a + m.dividends, 0);
    profit12 = last.netAssets - (prev ? prev.netAssets : 0) - contrib + divs;
    // wynik annualizowany, jeśli historia krótsza niż 12 miesięcy
    if (months < 12) profit12 = roundDiv(profit12 * 12, months);
  }
  const base = Math.max(0, netAssets);
  let estimate = base;
  let earningsValue = 0;
  let multipleBps: number = MULT.baseEarningsMultipleBps;
  if (months >= MULT.minMonthsForEarnings && profit12 > 0) {
    const vol = volatilityFactorBps(c.monthly);
    const macro = macroAt(s.seed, monthKey(date));
    const marketBps = macro.phase === 'wzrost' ? 11_000 : macro.phase === 'stabilizacja' ? 10_000 : macro.phase === 'spowolnienie' ? 9_000 : 7_500;
    const liquid = bal.cash + bal.receivables;
    const liquidityBps = bal.payables > 0 && liquid < bal.payables ? 10_000 - MULT.lowLiquidityPenaltyBps : 10_000;
    const overdueBps = bal.overduePayables > 0 ? 9_000 : 10_000;
    multipleBps = Math.max(MULT.minMultipleBps, Math.min(MULT.maxMultipleBps, mulBps(mulBps(mulBps(mulBps(MULT.baseEarningsMultipleBps, vol.bps), marketBps), liquidityBps), overdueBps)));
    earningsValue = mulBps(profit12, multipleBps);
    const goodwill = Math.max(0, earningsValue - base);
    estimate = base + mulBps(goodwill, MULT.earningsWeightBps);
    factors.push(`zysk netto 12 mies. (annualizowany) ${(profit12 / 100).toFixed(0)} zł × mnożnik ${(multipleBps / 10_000).toFixed(2)}`);
    factors.push(vol.note);
    factors.push(`koniunktura: ${macro.phase}`);
    if (liquidityBps < 10_000) factors.push('płynność poniżej zobowiązań — dyskonto');
    if (overdueBps < 10_000) factors.push('zaległe zobowiązania — dyskonto');
  } else if (months >= MULT.minMonthsForEarnings && profit12 < 0) {
    const lossShare = base > 0 ? Math.min(3_000, Math.round((-profit12 * 10_000) / base)) : 3_000;
    estimate = base - mulBps(base, lossShare);
    factors.push(`strata 12 mies. ${(profit12 / 100).toFixed(0)} zł → dyskonto ${(lossShare / 100).toFixed(0)}% aktywów netto`);
  } else {
    factors.push(months < MULT.minMonthsForEarnings ? 'spółka działa krócej niż 3 miesiące — wycena z aktywów netto' : 'brak zysku do wyceny dochodowej');
  }
  factors.unshift(`aktywa netto ${(netAssets / 100).toFixed(0)} zł`);
  estimate = Math.max(0, estimate);
  return {
    asOf: date, netAssets, profit12, months, multipleBps, earningsValue: Math.max(0, earningsValue), estimate,
    low: mulBps(estimate, 8_000), high: mulBps(estimate, 12_500), factors: factors.map((f) => f.slice(0, 160)),
  };
}

export function refreshValuation(s: GameState, c: Company, date: IsoDate = s.clock.today): void {
  if (c.status !== 'registered') { c.valuation = null; return; }
  c.valuation = valueCompany(s, c, date);
}

/** Pre-money i post-money dla emisji nowych udziałów: wkład / udział po emisji = post-money; pre = post − wkład. */
export function dealValuation(amount: Grosze, percentBps: number): { post: Grosze; pre: Grosze } {
  const post = percentBps > 0 ? roundDiv(amount * 10_000, percentBps) : 0;
  return { post, pre: Math.max(0, post - amount) };
}

export const lastDayOfMonth = (month: string): IsoDate => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
};
