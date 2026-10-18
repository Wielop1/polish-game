import { claimHealthRefund, etatYear } from './annual.ts';
import { activeBusiness, docsOf, formForYear, issueDocument, ryczaltAllowed, profileOf } from './business.ts';
import { CommandError, ensureParty, logEvent } from './core.ts';
import { addDays, dateInMonth, firstOfNextMonth, formatDatePL, monthKey, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { industryOf } from './industry.ts';
import { RULES_2026 as R } from './legal.ts';
import { formatPLN, mulBps, roundDiv } from './money.ts';
import type { Grosze } from './money.ts';
import { ACCOUNTING_PLAN_BY_ID } from './renovationCatalog.ts';
import type { AccountingPlan } from './renovationCatalog.ts';
import type { Business, GameState, TaxForm } from './state.ts';
import { healthFromIncome, healthRyczalt, pitCumulative, roundZl, scaleTax } from './tax.ts';

/**
 * Księgowość: wybór między prowadzeniem samodzielnym a biurem rachunkowym (v0.5).
 * Biuro NIE ma własnego kalkulatora: podatki, składki i VAT liczy wspólny silnik, a biuro tylko pobiera abonament
 * (zwykły dokument kosztowy), pilnuje terminów (powiadomienia), zgłasza braki i składa wnioski, które silnik i tak udostępnia graczowi.
 * Porównanie form opodatkowania to wynik obliczeń silnika — informacja, NIE regulowane doradztwo podatkowe (ACC-ADVISORY).
 * Odpowiedzialność za prawidłowość rozliczeń pozostaje po stronie przedsiębiorcy (ACC-RESPONSIBILITY).
 */

export const ACCOUNTING_PARTY = 'party:accounting';

export const planOf = (s: GameState): AccountingPlan | null => {
  const o = s.accounting.office;
  return o ? ACCOUNTING_PLAN_BY_ID.get(o.planId) ?? null : null;
};

/** Czy umowa z biurem obowiązuje w danym dniu. */
export function officeActive(s: GameState, date: IsoDate = s.clock.today): boolean {
  const o = s.accounting.office;
  return !!o && date >= o.since && (o.endsOn === null || date <= o.endsOn);
}

function chargeFee(s: GameState, b: Business, plan: AccountingPlan, date: IsoDate): void {
  const month = monthKey(date);
  if (s.accounting.lastFeeMonth === month) return;
  ensureParty(s, { id: ACCOUNTING_PARTY, name: 'Biuro rachunkowe (fikcyjne)', role: 'service' });
  issueDocument(s, b, { kind: 'cost', issueDate: date, counterpartyId: ACCOUNTING_PARTY, orderId: null, description: `Obsługa księgowa — ${plan.label} — ${month}`, net: plan.monthlyNet, termDays: 7 });
  s.accounting.lastFeeMonth = month;
}

export function hireAccountingOffice(s: GameState, planId: string): string {
  const b = activeBusiness(s);
  if (!b) throw new CommandError('Biuro rachunkowe obsługuje działalność — najpierw ją zarejestruj.');
  if (b.closeOn !== null) throw new CommandError('Działalność jest w trakcie zamykania.');
  const plan = ACCOUNTING_PLAN_BY_ID.get(planId);
  if (!plan) throw new CommandError('Nieznana oferta biura rachunkowego.');
  if (s.accounting.office) throw new CommandError(s.accounting.office.endsOn ? 'Obecna umowa z biurem wygasa — poczekaj do końca okresu.' : 'Masz już umowę z biurem rachunkowym — najpierw ją rozwiąż.');
  const today = s.clock.today;
  const since = parseIso(today).day === 1 ? today : firstOfNextMonth(today);
  s.accounting.office = { planId, since, endsOn: null };
  if (since === today && today >= b.startDate) chargeFee(s, b, plan, today);
  logEvent(s, { id: `accounting.contract:${planId}:${since}`, date: today, type: 'accounting.contract', tone: 'neutral', title: `Umowa z biurem rachunkowym: ${plan.office} — ${plan.label}`, detail: `${formatPLN(plan.monthlyNet)} netto miesięcznie od ${formatDatePL(since)}. Rozliczenia nadal liczy wspólny silnik gry; odpowiedzialność za ich poprawność pozostaje Twoja.`, amount: null, category: null });
  return `Umowa zawarta. Obsługa od ${formatDatePL(since)}, abonament ${formatPLN(plan.monthlyNet)} netto miesięcznie.`;
}

export function terminateAccountingOffice(s: GameState): string {
  const o = s.accounting.office;
  if (!o) throw new CommandError('Nie masz umowy z biurem rachunkowym.');
  if (o.endsOn) throw new CommandError('Umowa jest już wypowiedziana.');
  const today = s.clock.today;
  const { year, month } = parseIso(today > o.since ? today : o.since);
  o.endsOn = dateInMonth(year, month, 'last');
  logEvent(s, { id: `accounting.contract:end:${o.planId}:${o.since}`, date: today, type: 'accounting.contract', tone: 'neutral', title: 'Wypowiedziano umowę z biurem rachunkowym', detail: `Obsługa trwa do ${formatDatePL(o.endsOn)}; od następnego miesiąca prowadzisz ewidencję samodzielnie.`, amount: null, category: null });
  return `Umowa wypowiedziana — obsługa do ${formatDatePL(o.endsOn)}.`;
}

/* ---------- Porównanie form opodatkowania (obliczenia silnika) ---------- */

export interface FormRow { form: TaxForm; tax: Grosze; health: Grosze; total: Grosze }

/**
 * Szacunek rocznego podatku dochodowego i składki zdrowotnej JDG w każdej formie na podstawie dotychczasowych danych roku
 * (przeliczonych na 12 miesięcy), z użyciem tych samych funkcji co silnik rozliczeń. Bez ulg i strat; etat ujęty tak jak w PIT-36 / PIT-37.
 */
export function compareTaxForms(s: GameState, b: Business, year: number, date: IsoDate): { rows: FormRow[]; basis: string; months: number } {
  const months = Math.max(1, parseIso(date).month);
  const scale = (v: Grosze) => roundDiv(v * 12, months);
  const sum = (kind: 'sales' | 'cost') => docsOf(s, b, kind).filter((d) => d.issueDate.startsWith(`${year}-`) && d.issueDate <= date).reduce((a, d) => a + d.taxAmount, 0);
  const revenue = scale(sum('sales'));
  const costs = scale(sum('cost'));
  const social = scale(s.taxPeriods.filter((p) => p.businessId === b.id && p.month.startsWith(`${year}-`)).reduce((a, p) => a + p.social, 0));
  const etat = scale(etatYear(s, year).income);
  const rate = profileOf(b).ryczaltRateBps;
  const income = Math.max(0, revenue - costs - social);
  const rows: FormRow[] = [];
  const etatBase = roundZl(etat);
  const etatTax = scaleTax(etatBase, true);
  // skala: dochody z etatu i JDG łączą się, kwota zmniejszająca 3 600 zł raz
  const skalaTax = scaleTax(roundZl(etat + Math.max(0, revenue - costs - social)), true);
  const skalaHealth = 12 * healthFromIncome('skala', roundDiv(income, 12));
  rows.push({ form: 'skala', tax: skalaTax, health: skalaHealth, total: skalaTax + skalaHealth });
  const linHealth = 12 * healthFromIncome('liniowy', roundDiv(income, 12));
  const lin = pitCumulative({ form: 'liniowy', revenue, costs, socialPaid: social, healthPaid: linHealth, applyReduction: false, ryczaltRateBps: rate });
  rows.push({ form: 'liniowy', tax: etatTax + lin.tax, health: linHealth, total: etatTax + lin.tax + linHealth });
  if (ryczaltAllowed(s, b, year + 1).ok) {
    const rycHealth = 12 * healthRyczalt(revenue);
    const ryc = pitCumulative({ form: 'ryczalt', revenue, costs, socialPaid: social, healthPaid: rycHealth, applyReduction: false, ryczaltRateBps: rate });
    rows.push({ form: 'ryczalt', tax: etatTax + ryc.tax, health: rycHealth, total: etatTax + ryc.tax + rycHealth });
  }
  return { rows, months, basis: `Dane od 1 stycznia do ${formatDatePL(date)} przeliczone na 12 miesięcy (${months} mies. danych); bez ulg i strat z lat ubiegłych; podatek z etatu uwzględniony. To szacunek, nie porada podatkowa.` };
}

/* ---------- Dzienna obsługa biura ---------- */

const once = (s: GameState, key: string): boolean => {
  if (s.processed[key]) return false;
  s.processed[key] = true;
  return true;
};

function notice(s: GameState, date: IsoDate, key: string, tone: 'neutral' | 'warning' | 'positive', title: string, detail = ''): void {
  if (!once(s, `acc:${key}`)) return;
  const long = title.length > 150;
  logEvent(s, { id: `accounting.notice:${key}`, date, type: 'accounting.notice', tone, title: `Biuro rachunkowe: ${long ? `${title.slice(0, 147)}…` : title}`, detail: (long ? title : detail).slice(0, 300), amount: null, category: null });
}

/** Wywoływane codziennie dla aktywnej działalności (po przetworzeniu branży); idempotentne. */
export function processAccounting(s: GameState, b: Business, date: IsoDate): void {
  const o = s.accounting.office;
  if (!o) return;
  const plan = ACCOUNTING_PLAN_BY_ID.get(o.planId);
  if (!plan) return;
  if (o.endsOn && date > o.endsOn) {
    s.accounting.history.push({ planId: o.planId, from: o.since, to: o.endsOn });
    s.accounting.office = null;
    return;
  }
  if (date < o.since) return;
  if (parseIso(date).day === 1 || date === o.since) chargeFee(s, b, plan, date);
  const f = plan.features;
  const limit = addDays(date, 3);
  for (const ob of s.obligations) {
    if (ob.scope !== 'business' || ob.status !== 'open' || ob.direction !== 'payable') continue;
    const tax = ob.category.startsWith('zus_') || ob.category.startsWith('pit_') || ob.category.startsWith('vat_');
    if (f.reminders && tax && ob.dueDate > date && ob.dueDate <= limit) notice(s, date, `deadline:${ob.id}`, 'neutral', `zbliża się termin — ${ob.description}`, `${formatPLN(ob.amount)} do ${formatDatePL(ob.dueDate)}`);
  }
  if (f.gaps) {
    const soon = addDays(date, 5);
    const acc = s.accounts[b.accountId]!;
    let need = 0;
    const payables = s.obligations.filter((x) => x.scope === 'business' && x.status === 'open' && x.direction === 'payable' && x.dueDate <= soon).sort((a, c) => a.dueDate.localeCompare(c.dueDate) || a.id.localeCompare(c.id));
    for (const ob of payables) {
      need += ob.amount;
      if (need > acc.balance) { notice(s, date, `shortfall:${ob.id}`, 'warning', `brak środków na rachunku firmowym na: ${ob.description}`, `Do ${formatDatePL(ob.dueDate)} potrzeba łącznie ${formatPLN(need)}, na rachunku jest ${formatPLN(acc.balance)}. Zrób wkład własny.`); break; }
    }
    for (const ob of s.obligations) {
      if (ob.scope === 'business' && ob.status === 'open' && ob.direction === 'receivable' && ob.category === 'przychod_dzialalnosci' && date > addDays(ob.dueDate, 14)) {
        notice(s, date, `dunning:${ob.id}`, 'warning', `klient zalega z płatnością: ${ob.description}`, `${formatPLN(ob.amount)}, termin minął ${formatDatePL(ob.dueDate)}.`);
      }
    }
    for (const g of industryOf(b)?.gaps?.(s, b, date) ?? []) notice(s, date, `gap:${g.key}`, 'warning', g.text);
  }
  if (f.autoClaim) {
    for (const h of s.healthSettlements) {
      if (h.businessId === b.id && h.status === 'refund_available' && h.claimDeadline !== null && date <= h.claimDeadline && once(s, `acc:claim:${h.id}`)) {
        try {
          const msg = claimHealthRefund(s, h.id);
          logEvent(s, { id: `accounting.notice:claim:${h.id}`, date, type: 'accounting.notice', tone: 'positive', title: 'Biuro rachunkowe: złożyło wniosek o zwrot nadpłaty składki zdrowotnej', detail: msg, amount: null, category: null });
        } catch (e) {
          if (!(e instanceof CommandError)) throw e;
        }
      }
    }
  }
  if (f.formComparison) {
    const { year, month } = parseIso(date);
    if (month >= 10 && !s.accounting.suggestions.some((x) => x.year === year) && date >= `${year}-10-01`) {
      const cmp = compareTaxForms(s, b, year, date);
      const current = formForYear(b, year + 1);
      const best = cmp.rows.reduce((a, r) => (r.total < a.total ? r : a), cmp.rows.find((r) => r.form === current) ?? cmp.rows[0]!);
      s.accounting.suggestions.push({ year, date, current, best: best.form, rows: cmp.rows, basis: cmp.basis });
      const cur = cmp.rows.find((r) => r.form === current);
      notice(s, date, `form:${year}`, best.form === current ? 'positive' : 'neutral', best.form === current ? `porównanie form opodatkowania: obecna forma wychodzi najkorzystniej` : `porównanie form opodatkowania: wg obliczeń gry korzystniejsza może być inna forma`, `Oszacowane roczne obciążenie (PIT + zdrowotna): ${cmp.rows.map((r) => `${r.form} ${formatPLN(r.total, { round: true })}`).join(' · ')}${cur ? '' : ''}. Zmianę można zaplanować do 31 grudnia (od 1 stycznia). Informacja z obliczeń gry, nie doradztwo podatkowe.`);
    }
  }
}

export const feeOf = (planId: string): Grosze => ACCOUNTING_PLAN_BY_ID.get(planId)?.monthlyNet ?? 0;
void mulBps;
void R;
