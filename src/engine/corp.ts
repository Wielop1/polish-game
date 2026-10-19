import { ZUS_PARTY, isSuspendedOn } from './business.ts';
import { accrueCitAdvance, closeCitYear } from './cit.ts';
import { completeRegistration } from './company.ts';
import { companyBalance, refreshValuation, revenueInMonth } from './companyFinance.ts';
import { CORP } from './corpConfig.ts';
import { currentEmployment } from './contracts.ts';
import { createObligation, ensureParty, logEvent } from './core.ts';
import { addDays, dateInMonth, daysInMonth, diffDays, monthKey, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { processFleet } from './fleet.ts';
import { industryOf } from './industry.ts';
import { RULES_2026 as R } from './legal.ts';
import { expireNegotiations } from './negotiation.ts';
import { companyOperations, withOperator } from './operator.ts';
import { reviewPartners } from './partnerAi.ts';
import { grossOf } from './payroll.ts';
import { finalizeIncrease, processResolutionsDay } from './resolutions.ts';
import { formatPLN, roundDiv } from './money.ts';
import { socialForRegime } from './tax.ts';
import { processWorkforce } from './workforce.ts';
import type { Company, GameState } from './state.ts';

/**
 * Dzienny orkiestrator spółek (v0.8): rejestracja w KRS, wpis podwyższenia kapitału, dzień pracy operacji spółek (te same moduły co JDG,
 * w kontekście operatora), zgromadzenia i uchwały, negocjacje, a na koniec miesiąca/roku: składki wspólnika jednoosobowej spółki, zaliczki CIT,
 * zamknięcie roku, migawka wyniku i wycena. Wszystko idempotentne (klucze `processed`).
 */

export function processCorp(s: GameState, date: IsoDate): void {
  const key = `corp:day:${date}`;
  if (s.processed[key]) return;
  s.processed[key] = true;
  if (s.corp.companies.length === 0) return;
  for (const c of s.corp.companies) {
    if (c.status === 'organizing' && c.decisionOn !== null && date >= c.decisionOn) completeRegistration(s, c, date);
    if (c.status === 'registered' && c.pendingIncrease && date >= c.pendingIncrease.decisionOn) finalizeIncrease(s, c, date);
  }
  // operacje spółek: dzień remontów, pracowników i pojazdów w kontekście spółki
  for (const c of companyOperations(s)) {
    const op = c.operation!;
    if (date < op.startDate) continue;
    withOperator(s, c.id, () => {
      if (!isSuspendedOn(op, date)) industryOf(op)?.processDay(s, op, date);
      processWorkforce(s, op, date);
      processFleet(s, op, date);
    });
  }
  processResolutionsDay(s, date);
  expireNegotiations(s, date);
  const { year, month, day } = parseIso(date);
  if (day === daysInMonth(year, month)) {
    for (const c of s.corp.companies) if (c.status === 'registered') closeCompanyMonth(s, c, date);
  }
}

/** Składki ZUS jedynego wspólnika (osoby gracza): od wpisu spółki do KRS, proporcjonalnie do dni w miesiącu; płatne do 20. dnia (CO-ZUS-SOLE). */
function soleShareholderContributions(s: GameState, c: Company, date: IsoDate): void {
  const { year, month } = parseIso(date);
  const dim = daysInMonth(year, month);
  const first = `${monthKey(date)}-01`;
  const endExclusive = addDays(date, 1);
  let days = 0;
  for (const h of c.soleHistory) {
    if (h.holderId !== s.person.id) continue;
    const from = h.from > first ? h.from : first;
    const to = h.to === null || h.to > endExclusive ? endExclusive : h.to;
    days += Math.max(0, diffDays(to, from));
  }
  days = Math.min(dim, days);
  if (days <= 0) return;
  ensureParty(s, { id: ZUS_PARTY, name: 'ZUS', role: 'service' });
  const next = parseIso(addDays(date, 1));
  const due = dateInMonth(next.year, next.month, CORP.zusDayPerson);
  const frac = (g: number) => roundDiv(g * days, dim);
  const empOk = (() => { const e = currentEmployment(s, date); return !!e && grossOf(e) >= R.minWage; })();
  const jdgActive = s.businesses.some((b) => b.status === 'active');
  const social = empOk || jdgActive ? 0 : frac(socialForRegime('standard', false).total);
  const health = frac(CORP.soleHealth);
  const base = { counterpartyId: ZUS_PARTY, accountId: s.playerAccountId, scope: 'personal' as const, issueDate: date, dueDate: due };
  if (social > 0) createObligation(s, { ...base, occurrenceId: `zus:sole:${c.id}:${monthKey(date)}:social`, ruleId: 'rule:zus-sole', direction: 'payable', amount: social, category: 'zus_spoleczne', description: `Składki społeczne wspólnika jednoosobowej ${c.name} sp. z o.o. (${days} dni)` });
  if (health > 0) createObligation(s, { ...base, occurrenceId: `zus:sole:${c.id}:${monthKey(date)}:health`, ruleId: 'rule:zus-sole', direction: 'payable', amount: health, category: 'zus_zdrowotna', description: `Składka zdrowotna wspólnika jednoosobowej ${c.name} sp. z o.o. (${days} dni)` });
}

function closeCompanyMonth(s: GameState, c: Company, date: IsoDate): void {
  const { year, month } = parseIso(date);
  const mk = monthKey(date);
  const key = `corp:month:${c.id}:${mk}`;
  if (s.processed[key]) return;
  s.processed[key] = true;
  if (c.registeredOn && c.registeredOn <= date) soleShareholderContributions(s, c, date);
  if (c.operation) accrueCitAdvance(s, c, date);
  if (month === 12 && c.registeredOn) closeCompanyYear(s, c, date, year);
  const bal = companyBalance(s, c);
  const contributions = s.corp.shareEvents.filter((e) => e.companyId === c.id && e.kind !== 'transfer' && e.date.startsWith(mk)).reduce((a, e) => a + e.price, 0);
  const dividends = s.corp.resolutions.filter((r) => r.companyId === c.id && r.status === 'executed' && r.executedOn?.startsWith(mk) && r.payload.type === 'allocate_profit').reduce((a, r) => a + (r.payload.type === 'allocate_profit' ? r.payload.dividendGross : 0), 0);
  c.monthly.push({ month: mk, netAssets: bal.netAssets, revenue: revenueInMonth(s, c, mk), contributions, dividends });
  if (c.monthly.length > 60) c.monthly.splice(0, c.monthly.length - 60);
  refreshValuation(s, c, date);
  // art. 233 KSH: strata przewyższająca kapitały zapasowe i połowę kapitału zakładowego
  if (bal.netAssets < c.capital / 2 && c.monthly.length >= 3 && !s.processed[`corp:loss233:${c.id}:${year}`]) {
    s.processed[`corp:loss233:${c.id}:${year}`] = true;
    logEvent(s, { id: `corp.company:${c.id}:loss233:${mk}`, date, type: 'corp.company', tone: 'warning', title: `Ostrzeżenie dla zarządu: ${c.name} sp. z o.o. utraciła ponad połowę kapitału`, detail: `Aktywa netto ${formatPLN(bal.netAssets, { round: true })} przy kapitale zakładowym ${formatPLN(c.capital, { round: true })} — zarząd powinien niezwłocznie zwołać zgromadzenie (art. 233 KSH; sankcje — DEFERRED).`, amount: null, category: null });
  }
  reviewPartners(s, c, date);
}

function closeCompanyYear(s: GameState, c: Company, date: IsoDate, year: number): void {
  if (c.yearResults.some((y) => y.year === year)) return;
  const ret = closeCitYear(s, c, date);
  const bal = companyBalance(s, c);
  const prev = c.yearResults.at(-1)?.netAssetsEnd ?? 0;
  const contributions = s.corp.shareEvents.filter((e) => e.companyId === c.id && e.kind !== 'transfer' && e.date.startsWith(`${year}-`)).reduce((a, e) => a + e.price, 0);
  const exec = s.corp.resolutions.filter((r) => r.companyId === c.id && r.status === 'executed' && r.executedOn?.startsWith(`${year}-`) && r.payload.type === 'allocate_profit');
  const dividendsDeclared = exec.reduce((a, r) => a + (r.payload.type === 'allocate_profit' ? r.payload.dividendGross : 0), 0);
  const transfersToReserve = exec.reduce((a, r) => a + (r.payload.type === 'allocate_profit' ? r.payload.toReserve : 0), 0);
  const netProfit = bal.netAssets - prev - contributions + dividendsDeclared;
  c.yearResults.push({ year, netAssetsEnd: bal.netAssets, contributions, dividendsDeclared, transfersToReserve, netProfit, citTax: ret?.tax ?? 0 });
  logEvent(s, {
    id: `corp.company:${c.id}:year:${year}`, date, type: 'corp.company', tone: netProfit >= 0 ? 'positive' : 'warning',
    title: `Rok obrotowy ${year} zamknięty: ${c.name} sp. z o.o. — wynik netto ${formatPLN(netProfit, { round: true })}`,
    detail: `Sprawozdanie (uproszczone) czeka na zatwierdzenie przez zgromadzenie wspólników do ${year + 1}-06-30 (art. 231 KSH). CIT roku: ${formatPLN(ret?.tax ?? 0, { round: true })}.`, amount: null, category: null,
  });
}
