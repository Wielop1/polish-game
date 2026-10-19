import './industries.ts';
import { processAccounting } from './accounting.ts';
import { processFleet } from './fleet.ts';
import { processWorkforce } from './workforce.ts';
import { addDays, ageOn, diffDays, firstOfNextMonth, formatDatePL } from './date.ts';
import type { IsoDate } from './date.ts';
import { accountById, createObligation, logEvent, partyName, periodLabel, postTransaction, recordHistory } from './core.ts';
import { formatPLN, mulBps } from './money.ts';
import type { Grosze } from './money.ts';
import { createRng } from './rng.ts';
import { processAnnual } from './annual.ts';
import { processBusiness } from './business.ts';
import { rollLifeEvents } from './lifeEvents.ts';
import { runPendingActions } from './pending.ts';
import { applySavingsInterest } from './savings.ts';
import { computeDueDate, isBirthday, isIssueDay } from './schedule.ts';
import { clampFatigue, budgetFor, fatigueDelta } from './time.ts';
import { buildPayslip, materializeLegacyPayslips } from './payroll.ts';
import type { EmploymentContract, GameState, Obligation, ObligationRule, Payslip } from './state.ts';

export { postTransaction, logEvent } from './core.ts';
export type { PostingInput } from './core.ts';

/** Ochrona UI przed jednorazowym przeskokiem o absurdalną liczbę dni. */
export const MAX_ADVANCE_DAYS = 3_700;

/* ---------- Wystąpienia reguł ---------- */

export function resolveAmount(s: GameState, rule: ObligationRule, occurrenceId: string): Grosze {
  const spec = rule.amount;
  switch (spec.type) {
    case 'fixed':
      return spec.amount;
    case 'variable': {
      const bps = createRng(s.seed, occurrenceId).int(-spec.spreadBps, spec.spreadBps);
      return spec.base + mulBps(spec.base, bps);
    }
    case 'lifestyle': {
      const base = spec.levels[s.life.lifestyle];
      if (spec.spreadBps === 0) return base;
      const bps = createRng(s.seed, occurrenceId).int(-spec.spreadBps, spec.spreadBps);
      return base + mulBps(base, bps);
    }
    case 'payroll': {
      const contract = s.contracts.find((c) => c.id === spec.contractId);
      if (!contract) throw new Error(`Brak umowy ${spec.contractId} dla reguły ${rule.id}`);
      return contract.monthlyAmount; // typowe netto (do projekcji); rzeczywista kwota z odcinka płacowego
    }
    case 'contract': {
      const contract = s.contracts.find((c) => c.id === spec.contractId);
      if (!contract) throw new Error(`Brak umowy ${spec.contractId} dla reguły ${rule.id}`);
      if (spec.field === 'utilitiesMonthly') {
        if (contract.type !== 'lease') throw new Error(`Reguła ${rule.id}: opłaty eksploatacyjne dotyczą tylko najmu`);
        return contract.utilitiesMonthly;
      }
      return contract.monthlyAmount;
    }
  }
}

function issueFromRule(s: GameState, rule: ObligationRule, date: IsoDate): void {
  const occurrenceId = `${rule.id}@${date}`;
  if (s.processed[occurrenceId]) return; // wystąpienie już zastosowane — idempotencja
  const dueDate = computeDueDate(date, rule.due);
  let payslip: Payslip | null = null;
  let amount: number;
  if (rule.amount.type === 'payroll' && date >= s.settings.payrollFrom) {
    materializeLegacyPayslips(s);
    const contractId = rule.amount.contractId;
    const contract = s.contracts.find((c): c is EmploymentContract => c.type === 'employment' && c.id === contractId);
    if (!contract) throw new Error(`Brak umowy ${contractId} dla reguły ${rule.id}`);
    payslip = buildPayslip(s, contract, rule.id, date, dueDate);
    amount = payslip.net;
  } else {
    amount = resolveAmount(s, rule, occurrenceId);
  }
  createObligation(s, {
    occurrenceId,
    ruleId: rule.id,
    direction: rule.direction,
    counterpartyId: rule.counterpartyId,
    amount,
    issueDate: date,
    dueDate,
    category: rule.category,
    description: periodLabel(rule.description, date),
  });
  if (payslip) s.payslips.push(payslip);
}

function applyBirthday(s: GameState, ruleId: string, startDate: IsoDate, date: IsoDate): void {
  if (date < startDate || !isBirthday(s.person.birthDate, date)) return;
  const occurrenceId = `${ruleId}@${date}`;
  if (s.processed[occurrenceId]) return;
  s.processed[occurrenceId] = true;
  const age = ageOn(s.person.birthDate, date);
  logEvent(s, {
    id: occurrenceId,
    date,
    type: 'life.birthday',
    tone: 'neutral',
    title: `Urodziny — kończysz ${age} lat`,
    detail: `${s.person.firstName} ${s.person.lastName}`,
    amount: null,
    category: null,
  });
}

/** Stosuje wszystkie wystąpienia reguł przypadające na dany dzień (kolejność: po id reguły). Idempotentne. */
export function applyScheduledOccurrences(s: GameState, date: IsoDate): void {
  const rules = [...s.rules].sort((a, b) => a.id.localeCompare(b.id));
  for (const rule of rules) {
    if (rule.kind === 'obligation') {
      if (isIssueDay(rule, date)) issueFromRule(s, rule, date);
    } else if (rule.kind === 'birthday') {
      applyBirthday(s, rule.id, rule.startDate, date);
    } else {
      applySavingsInterest(s, rule, date);
    }
  }
}

/* ---------- Rozliczenia ---------- */

/**
 * Rozlicza zapadłe zobowiązania.
 * 1) Należności są wpłacane w terminie — kontrahenci w v0.2 zawsze płacą.
 * 2) Zobowiązania są regulowane automatycznie (zlecenie stałe) z właściwego rachunku, od najstarszego terminu;
 *    każde jest próbowane niezależnie i opłacane w całości albo wcale (brak debetu i płatności częściowych).
 */
export function settleDueObligations(s: GameState, date: IsoDate): void {
  const due = s.obligations
    .filter((o) => o.status === 'open' && o.dueDate <= date)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));

  for (const o of due.filter((x) => x.direction === 'receivable')) settleOne(s, o, date);

  for (const o of due.filter((x) => x.direction === 'payable')) {
    if (accountById(s, o.accountId).balance >= o.amount) {
      settleOne(s, o, date);
    } else if (o.overdueSince === null) {
      o.overdueSince = date;
      logEvent(s, {
        id: `overdue:${o.id}`,
        date,
        type: 'obligation.overdue',
        tone: 'warning',
        title: `Brak środków na zapłatę: ${o.description}`,
        detail: `${partyName(s, o.counterpartyId)} · ${formatPLN(o.amount)} · termin minął ${formatDatePL(o.dueDate)}`,
        amount: -o.amount,
        category: o.category,
      });
    }
  }
}

function settleOne(s: GameState, o: Obligation, date: IsoDate): void {
  const receivable = o.direction === 'receivable';
  const tx = postTransaction(s, {
    eventId: `settle:${o.id}`,
    accountId: o.accountId,
    date,
    amount: receivable ? o.amount : -o.amount,
    category: o.category,
    description: o.description,
    counterpartyId: o.counterpartyId,
    obligationId: o.id,
  });
  o.status = 'settled';
  o.settledDate = date;
  o.settlementTxId = tx.id;
  const late = o.overdueSince !== null;
  logEvent(s, {
    id: `settle:${o.id}`,
    date,
    type: 'obligation.settled',
    tone: receivable ? 'positive' : 'negative',
    title: receivable ? `Wpływ: ${o.description}` : `Zapłacono: ${o.description}`,
    detail: `${partyName(s, o.counterpartyId)} · ${formatPLN(o.amount)}${late ? ' · po terminie' : ''}`,
    amount: receivable ? o.amount : -o.amount,
    category: o.category,
  });
}

/* ---------- Zmęczenie ---------- */

function updateFatigue(s: GameState, date: IsoDate): void {
  if (s.life.fatigueDate !== null && date <= s.life.fatigueDate) return; // idempotencja
  const b = budgetFor(s, date);
  let budget = b;
  if (b.free < 0) {
    // Plan przekracza 24 godziny (nie powinno się zdarzyć dzięki walidacji) — brakujące godziny kosztują sen.
    budget = { ...b, sleep: Math.max(0, b.sleep + b.free), free: 0 };
    logEvent(s, {
      id: `time.overload:${date}`, date, type: 'time.overload', tone: 'warning',
      title: 'Przeciążenie czasowe', detail: `Obowiązki przekroczyły dobę o ${-b.free} godz. — kosztem snu`, amount: null, category: null,
    });
  }
  s.life.fatigue = clampFatigue(s.life.fatigue + fatigueDelta(budget));
  s.life.fatigueDate = date;
}

/* ---------- Dzień i czas ---------- */

/**
 * Przetwarza jeden dzień kalendarzowy (mutuje przekazany stan).
 * Kolejność: (1) akcje zaplanowane, (2) naliczenia z harmonogramu, (3) wydarzenia losowe,
 * (4) JDG (oferty, zlecenia, dokumenty, miesięczne rozliczenia), (5) rozliczenia, (6) zmęczenie, (7) migawka historii.
 */
export function processDay(s: GameState, date: IsoDate): void {
  runPendingActions(s, date);
  applyScheduledOccurrences(s, date);
  rollLifeEvents(s, date);
  processBusiness(s, date);
  for (const b of s.businesses) {
    if (b.status !== 'active' || date < b.startDate) continue;
    processAccounting(s, b, date);
    processWorkforce(s, b, date);
    processFleet(s, b, date);
  }
  processAnnual(s, date);
  settleDueObligations(s, date);
  updateFatigue(s, date);
  recordHistory(s, date);
}

/**
 * Przesuwa grę o `days` dni, przetwarzając KAŻDY dzień po kolei (żadna zaplanowana
 * operacja nie jest pomijana). Zwraca nowy stan; argument pozostaje nietknięty.
 */
export function advanceDays(state: GameState, days: number): GameState {
  const draft = structuredClone(state);
  advanceDaysInPlace(draft, days);
  return draft;
}

/**
 * Jak `advanceDays`, ale MUTUJE przekazany stan (bez kopii). Dla wywołujących na wyłączność — np. symulator balansu,
 * który nie potrzebuje niezmiennych migawek co dzień. Wynik jest identyczny z `advanceDays`.
 */
export function advanceDaysInPlace(state: GameState, days: number): GameState {
  if (!Number.isInteger(days) || days < 1 || days > MAX_ADVANCE_DAYS) {
    throw new RangeError(`Liczba dni musi być całkowita z zakresu 1..${MAX_ADVANCE_DAYS}`);
  }
  for (let i = 0; i < days; i++) {
    const next = addDays(state.clock.today, 1);
    processDay(state, next);
    state.clock.today = next;
  }
  return state;
}

export function advanceOneDay(state: GameState): GameState {
  return advanceDays(state, 1);
}

/** Do pierwszego dnia następnego miesiąca (z dnia 1. -> 1. kolejnego miesiąca). */
export function advanceToNextMonth(state: GameState): GameState {
  const target = firstOfNextMonth(state.clock.today);
  return advanceDays(state, diffDays(target, state.clock.today));
}

