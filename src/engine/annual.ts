import { BUSINESS_CATEGORIES, US_PARTY, ZUS_PARTY, docsOf, formOn, profileOf } from './business.ts';
import { CommandError, createObligation, ensureParty, logEvent } from './core.ts';
import { addDays, addMonths, dateInMonth, formatDatePL, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { RULES_2026 as R, carriedForward } from './legal.ts';
import { formatPLN, mulBps } from './money.ts';
import type { Grosze } from './money.ts';
import { materializeLegacyPayslips } from './payroll.ts';
import type { Business, GameState, HealthSettlement, TaxLoss, TaxReturn } from './state.ts';
import { healthRyczalt, pitCumulative, roundZl, scaleTax } from './tax.ts';

/**
 * Rozliczenia roczne (31 grudnia): zeznania PIT (łączna skala etat + JDG, osobno liniowy i ryczałt), straty z lat
 * ubiegłych, roczna składka zdrowotna. Zaliczki pracodawcy i przedsiębiorcy są zaliczane na poczet podatku rocznego.
 */

const paid = (s: GameState, category: string, year: number, upTo: IsoDate): Grosze =>
  s.obligations
    .filter((o) => o.scope === 'business' && o.category === category && o.status === 'settled' && o.settledDate !== null && o.settledDate.startsWith(`${year}-`) && o.settledDate <= upTo)
    .reduce((a, o) => a + o.amount, 0);

export interface EtatYear {
  taxableGross: Grosze;
  exempt: Grosze;
  social: Grosze;
  koszty: Grosze;
  advances: Grosze;
  /** Dochód z etatu do opodatkowania skalą (przed zaokrągleniem). */
  income: Grosze;
  payslips: number;
}

/** Przychody z umów o pracę w roku podatkowym = rok WYPŁATY (przychód powstaje w miesiącu wypłaty). */
export function etatYear(s: GameState, year: number): EtatYear {
  let taxableGross = 0, exempt = 0, social = 0, koszty = 0, advances = 0, n = 0;
  for (const p of s.payslips) {
    if (parseIso(p.payDate).year !== year) continue;
    n += 1;
    taxableGross += p.gross - p.exemptGross;
    exempt += p.exemptGross;
    social += p.taxableSocial;
    koszty += p.koszty;
    advances += p.pitAdvance;
  }
  return { taxableGross, exempt, social, koszty, advances, income: Math.max(0, taxableGross - social - koszty), payslips: n };
}

interface JdgYear {
  b: Business;
  form: 'skala' | 'liniowy' | 'ryczalt';
  revenue: Grosze;
  costs: Grosze;
  socialPaid: Grosze;
  healthPaid: Grosze;
  advances: Grosze;
  lossDeducted: Grosze;
  lossCreated: Grosze;
}

function jdgYear(s: GameState, b: Business, year: number, date: IsoDate): JdgYear {
  const form = formOn(b, date);
  const revenue = docsOf(s, b, 'sales').filter((d) => d.issueDate.startsWith(`${year}-`)).reduce((a, d) => a + d.taxAmount, 0);
  const costs = docsOf(s, b, 'cost').filter((d) => d.issueDate.startsWith(`${year}-`)).reduce((a, d) => a + d.taxAmount, 0);
  const advances = s.taxPeriods.filter((p) => p.businessId === b.id && p.month.startsWith(`${year}-`)).reduce((a, p) => a + p.advance, 0);
  return { b, form, revenue, costs, socialPaid: paid(s, BUSINESS_CATEGORIES.social, year, date), healthPaid: paid(s, BUSINESS_CATEGORIES.health, year, date), advances, lossDeducted: 0, lossCreated: 0 };
}

/** Straty z lat ubiegłych: zasada 50% straty rocznie przez 5 kolejnych lat, nie więcej niż dochód (przychód) roku. */
function applyLosses(s: GameState, j: JdgYear, year: number): void {
  const base = j.form === 'ryczalt' ? j.revenue : j.revenue - j.costs;
  if (j.form !== 'ryczalt' && base < 0) {
    const id = `loss:${j.b.id}:${year}`;
    if (!s.taxLosses.some((l) => l.id === id)) {
      const loss: TaxLoss = { id, businessId: j.b.id, year, form: j.form, amount: -base, usages: [] };
      s.taxLosses.push(loss);
      j.lossCreated = -base;
      logEvent(s, {
        id: `tax.loss:${id}`, date: `${year}-12-31`, type: 'tax.loss', tone: 'warning',
        title: `Strata podatkowa za ${year}: ${formatPLN(-base)}`, detail: `Można ją odliczać od dochodu z działalności w latach ${year + 1}–${year + 5} (do 50% rocznie). To nie jest ujemny przepływ gotówki.`, amount: null, category: null,
      });
    }
    return;
  }
  let room = Math.max(0, base);
  for (const l of [...s.taxLosses].sort((a, b) => a.year - b.year)) {
    if (room <= 0) break;
    if (l.year >= year || year > l.year + 5) continue;
    if (l.usages.some((u) => u.year === year)) continue;
    const remaining = l.amount - l.usages.reduce((a, u) => a + u.amount, 0);
    const use = Math.min(remaining, mulBps(l.amount, 5_000), room);
    if (use <= 0) continue;
    l.usages.push({ year, amount: use });
    j.lossDeducted += use;
    room -= use;
  }
}

export function lossRemaining(l: TaxLoss): Grosze {
  return l.amount - l.usages.reduce((a, u) => a + u.amount, 0);
}

function makeReturn(s: GameState, year: number, date: IsoDate, r: Omit<TaxReturn, 'id' | 'obligationId' | 'dueDate' | 'carriedForward' | 'balance'> & { account: string; scope: 'personal' | 'business' }): void {
  ensureParty(s, { id: US_PARTY, name: 'Urząd Skarbowy', role: 'service' });
  const balance = r.tax - r.advances;
  const filingDue = dateInMonth(year + 1, 4, 30);
  const id = `return:${year}:${r.form}`;
  const refundDue = addDays(filingDue, R.refund.daysAfterFiling);
  let obligationId: string | null = null;
  if (balance !== 0) {
    const ob = createObligation(s, {
      occurrenceId: `${id}:obl`, ruleId: 'rule:pit-annual', direction: balance > 0 ? 'payable' : 'receivable', counterpartyId: US_PARTY,
      accountId: r.account, scope: r.scope, amount: Math.abs(balance), issueDate: date, dueDate: balance > 0 ? filingDue : refundDue,
      category: balance > 0 ? BUSINESS_CATEGORIES.pitAnnual : BUSINESS_CATEGORIES.pitRefund,
      description: `${balance > 0 ? 'Podatek wg' : 'Zwrot nadpłaty wg'} ${r.form} za ${year}`,
    });
    obligationId = ob?.id ?? null;
  }
  const { account: _a, scope: _s, ...rest } = r;
  void _a; void _s;
  s.taxReturns.push({ ...rest, id, balance, dueDate: balance > 0 ? filingDue : refundDue, obligationId, carriedForward: carriedForward(year) });
  logEvent(s, {
    id: `tax.return:${id}`, date, type: 'tax.return', tone: balance > 0 ? 'warning' : 'positive',
    title: `Rozliczenie roczne ${r.form} za ${year}: ${balance > 0 ? `do zapłaty ${formatPLN(balance)}` : balance < 0 ? `nadpłata ${formatPLN(-balance)}` : 'bez dopłaty'}`,
    detail: `Podatek ${formatPLN(r.tax)} − zaliczki ${formatPLN(r.advances)}${balance > 0 ? ` · termin ${formatDatePL(filingDue)}` : balance < 0 ? ` · zwrot do ${formatDatePL(refundDue)} (45 dni od złożenia zeznania)` : ''}`, amount: null, category: null,
  });
}

function healthAnnual(s: GameState, j: JdgYear, year: number, date: IsoDate): void {
  const b = j.b;
  const id = `health:${b.id}:${year}`;
  if (s.healthSettlements.some((h) => h.id === id)) return;
  const months = s.taxPeriods.filter((p) => p.businessId === b.id && p.month.startsWith(`${year}-`) && p.zusRegime !== 'zawieszenie').length;
  if (months === 0) return;
  const monthlyTotal = s.obligations
    .filter((o) => o.scope === 'business' && o.accountId === b.accountId && o.category === BUSINESS_CATEGORIES.health && o.issueDate.startsWith(`${year}-`))
    .reduce((a, o) => a + o.amount, 0);
  let annualBase: Grosze;
  let annualContribution: Grosze;
  if (j.form === 'ryczalt') {
    annualBase = j.revenue;
    annualContribution = months * healthRyczalt(j.revenue);
  } else {
    const income = Math.max(0, j.revenue - j.costs - j.socialPaid);
    annualBase = Math.max(income, months * R.minWage);
    annualContribution = mulBps(annualBase, j.form === 'skala' ? R.healthScaleBps : R.healthLinearBps);
  }
  const diff = annualContribution - monthlyTotal;
  const dueDate = dateInMonth(year + 1, R.health.annualDueMonthDay[0], R.health.annualDueMonthDay[1]);
  const claimDeadline = dateInMonth(year + 1, R.health.refundClaimMonthDay[0], R.health.refundClaimMonthDay[1]);
  let obligationId: string | null = null;
  let status: HealthSettlement['status'] = 'none';
  if (diff > 0) {
    ensureParty(s, { id: ZUS_PARTY, name: 'ZUS', role: 'service' });
    status = 'due';
    obligationId = createObligation(s, {
      occurrenceId: `${id}:due`, ruleId: 'rule:health-annual', direction: 'payable', counterpartyId: ZUS_PARTY, accountId: b.accountId, scope: 'business',
      amount: diff, issueDate: date, dueDate, category: BUSINESS_CATEGORIES.health, description: `Dopłata roczna składki zdrowotnej za ${year}`,
    })?.id ?? null;
  } else if (diff < 0) status = 'refund_available';
  s.healthSettlements.push({
    id, businessId: b.id, year, form: j.form, months, annualBase, annualContribution, monthlyTotal, diff, status,
    dueDate: diff > 0 ? dueDate : null, claimDeadline: diff < 0 ? claimDeadline : null, obligationId, carriedForward: carriedForward(year),
  });
  logEvent(s, {
    id: `tax.health:${id}`, date, type: 'tax.health', tone: diff > 0 ? 'warning' : 'neutral',
    title: `Roczne rozliczenie składki zdrowotnej za ${year}: ${diff > 0 ? `dopłata ${formatPLN(diff)}` : diff < 0 ? `nadpłata ${formatPLN(-diff)} (wymaga wniosku)` : 'bez różnicy'}`,
    detail: `Należna ${formatPLN(annualContribution)} − opłacona miesięcznie ${formatPLN(monthlyTotal)}${diff > 0 ? ` · termin ${formatDatePL(dueDate)}` : diff < 0 ? ` · wniosek o zwrot do ${formatDatePL(claimDeadline)}` : ''}`, amount: null, category: null,
  });
}

/** Wniosek o zwrot nadpłaty składki zdrowotnej (tylko na wniosek, do końca maja; zwrot do 3 miesięcy po terminie PIT). */
export function claimHealthRefund(s: GameState, settlementId: string): string {
  const h = s.healthSettlements.find((x) => x.id === settlementId);
  if (!h || h.status !== 'refund_available') throw new CommandError('Brak nadpłaty do zwrotu.');
  if (h.claimDeadline === null || s.clock.today > h.claimDeadline) throw new CommandError('Termin na wniosek o zwrot minął.');
  const b = s.businesses.find((x) => x.id === h.businessId);
  if (!b) throw new CommandError('Nie znaleziono działalności.');
  ensureParty(s, { id: ZUS_PARTY, name: 'ZUS', role: 'service' });
  const due = addMonths(dateInMonth(h.year + 1, 4, 30), 3);
  const ob = createObligation(s, {
    occurrenceId: `${h.id}:refund`, ruleId: 'rule:health-annual', direction: 'receivable', counterpartyId: ZUS_PARTY, accountId: b.accountId, scope: 'business',
    amount: -h.diff, issueDate: s.clock.today, dueDate: due > s.clock.today ? due : addDays(s.clock.today, 1), category: 'zus_zdrowotna_zwrot', description: `Zwrot nadpłaty składki zdrowotnej za ${h.year}`,
  });
  h.status = 'refund_claimed';
  h.obligationId = ob?.id ?? null;
  return `Złożono wniosek o zwrot ${formatPLN(-h.diff)}. Wpłyniesz na rachunek firmowy do ${formatDatePL(due)}.`;
}

/** Codziennie: wygasanie niezłożonych wniosków o zwrot; 31 grudnia: rozliczenia roczne. Idempotentne. */
export function processAnnual(s: GameState, date: IsoDate): void {
  for (const h of s.healthSettlements) {
    if (h.status === 'refund_available' && h.claimDeadline !== null && date > h.claimDeadline) {
      h.status = 'refund_expired';
      logEvent(s, {
        id: `tax.health:${h.id}:expired`, date, type: 'tax.health', tone: 'warning',
        title: `Minął termin wniosku o zwrot nadpłaty składki zdrowotnej za ${h.year}`, detail: `${formatPLN(-h.diff)} nie została zwrócona automatycznie (zaliczenie na przyszłe składki — poza zakresem symulacji)`, amount: null, category: null,
      });
    }
  }
  const { year, month, day } = parseIso(date);
  if (month !== 12 || day !== 31) return;
  const key = `annual:${year}`;
  if (s.processed[key]) return;
  s.processed[key] = true;
  // zapisy v3: rozliczenie roczne JDG mogło powstać wcześniej (klucz `biz:annual:…`) — nie dublujemy
  if (Object.keys(s.processed).some((k) => k.startsWith('biz:annual:') && k.endsWith(`:${year}`))) return;

  materializeLegacyPayslips(s);
  const etat = etatYear(s, year);
  const jdgs = s.businesses
    .filter((b) => s.taxPeriods.some((p) => p.businessId === b.id && p.month.startsWith(`${year}-`)))
    .map((b) => {
      const j = jdgYear(s, b, year, date);
      applyLosses(s, j, year);
      return j;
    });

  const ruleBase = ['PIT-ANNUAL-SOURCES', 'PIT-ANNUAL-DEADLINE', 'PIT-ROUNDING'];
  const lossRule = (js: JdgYear[]) => (js.some((j) => j.lossDeducted > 0 || j.lossCreated > 0) ? ['PIT-LOSS-5Y'] : []);
  const advancesOf = (js: JdgYear[]) => js.reduce((a, j) => a + j.advances, 0);

  // (1) skala: etat + JDG na skali — jedno zeznanie, kwota zmniejszająca raz
  const skala = jdgs.filter((j) => j.form === 'skala');
  if (skala.length > 0 || etat.payslips > 0) {
    const jdgIncome = skala.reduce((a, j) => a + pitCumulative({ form: 'skala', revenue: j.revenue, costs: j.costs + j.lossDeducted, socialPaid: j.socialPaid, healthPaid: 0, applyReduction: false, ryczaltRateBps: 0 }).base, 0);
    const base = roundZl(etat.income + jdgIncome);
    const tax = scaleTax(base, true);
    makeReturn(s, year, date, {
      year, form: skala.length > 0 ? 'PIT-36' : 'PIT-37', income: etat.income + jdgIncome, lossDeducted: skala.reduce((a, j) => a + j.lossDeducted, 0),
      deductions: etat.social + skala.reduce((a, j) => a + j.socialPaid, 0), base, tax, advances: etat.advances + advancesOf(skala), businessId: skala[0]?.b.id ?? null,
      ruleIds: [...ruleBase, 'PIT-SCALE-2026', 'PAY-PIT-ADVANCE', ...(etat.exempt > 0 ? ['PAY-YOUTH-RELIEF-2026'] : []), ...lossRule(skala)], account: s.playerAccountId, scope: 'personal',
    });
  }
  // (2) liniowy — osobno (PIT-36L); (3) ryczałt — osobno (PIT-28)
  for (const [form, label] of [['liniowy', 'PIT-36L'], ['ryczalt', 'PIT-28']] as const) {
    const group = jdgs.filter((j) => j.form === form);
    if (group.length === 0) continue;
    let base = 0;
    let tax = 0;
    for (const j of group) {
      const r = form === 'liniowy'
        ? pitCumulative({ form, revenue: j.revenue, costs: j.costs + j.lossDeducted, socialPaid: j.socialPaid, healthPaid: j.healthPaid, applyReduction: false, ryczaltRateBps: 0 })
        : pitCumulative({ form, revenue: j.revenue - j.lossDeducted, costs: 0, socialPaid: j.socialPaid, healthPaid: j.healthPaid, applyReduction: false, ryczaltRateBps: profileOf(j.b).ryczaltRateBps });
      base += r.base;
      tax += r.tax;
    }
    makeReturn(s, year, date, {
      year, form: label, income: group.reduce((a, j) => a + (form === 'ryczalt' ? j.revenue : j.revenue - j.costs), 0), lossDeducted: group.reduce((a, j) => a + j.lossDeducted, 0),
      deductions: group.reduce((a, j) => a + j.socialPaid + (form === 'liniowy' ? Math.min(j.healthPaid, R.pit.linearHealthDeductionLimit) : mulBps(j.healthPaid, R.pit.ryczaltHealthDeductionBps)), 0),
      base, tax, advances: advancesOf(group), businessId: group[0]!.b.id,
      ruleIds: [...ruleBase, form === 'liniowy' ? 'PIT-LINEAR-2026' : 'PIT-RYCZALT-RATES-2026', ...lossRule(group)], account: group[0]!.b.accountId, scope: 'business',
    });
  }
  // (4) roczna składka zdrowotna
  for (const j of jdgs) healthAnnual(s, j, year, date);
}

