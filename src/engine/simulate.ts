import { addDays, ageOn, diffDays, firstOfNextMonth, formatDatePL, formatMonthPL, monthKey } from './date.ts';
import type { IsoDate } from './date.ts';
import { assertGrosze, formatPLN, mulBps } from './money.ts';
import type { Grosze } from './money.ts';
import { createRng } from './rng.ts';
import { computeDueDate, isBirthday, isIssueDay } from './schedule.ts';
import { netWorth, playerAccount } from './selectors.ts';
import type { GameEvent, GameState, LedgerEntry, Obligation, ObligationRule } from './state.ts';

/** Ochrona UI przed jednorazowym przeskokiem o absurdalną liczbę dni. */
export const MAX_ADVANCE_DAYS = 3_700;

/* ---------- Księgowanie ---------- */

export interface PostingInput {
  eventId: string;
  date: IsoDate;
  amount: Grosze;
  category: string;
  description: string;
  counterpartyId: string | null;
  obligationId: string | null;
}

/**
 * Jedyna droga zmiany salda: zapis w rejestrze + aktualizacja rachunku.
 * Próba ponownego zaksięgowania tego samego zdarzenia to błąd programistyczny (wyjątek),
 * a nie cichy powrót — podwójne księgowanie musi być głośne.
 */
export function postTransaction(s: GameState, input: PostingInput): LedgerEntry {
  assertGrosze(input.amount, 'kwota transakcji');
  if (input.amount === 0) throw new RangeError('Transakcja o kwocie 0');
  const txId = `tx:${input.eventId}`;
  if (s.processed[txId]) throw new Error(`Podwójne księgowanie: ${txId}`);
  const account = playerAccount(s);
  const newBalance = account.balance + input.amount;
  assertGrosze(newBalance, 'saldo');
  if (newBalance < 0) throw new RangeError(`Saldo rachunku nie może być ujemne (v0.1): ${newBalance}`);
  account.balance = newBalance;
  s.processed[txId] = true;
  const entry: LedgerEntry = {
    id: txId,
    date: input.date,
    accountId: account.id,
    amount: input.amount,
    category: input.category,
    description: input.description,
    counterpartyId: input.counterpartyId,
    obligationId: input.obligationId,
    eventId: input.eventId,
  };
  s.ledger.push(entry);
  return entry;
}

export function logEvent(s: GameState, event: GameEvent): void {
  s.events.push(event);
}

/* ---------- Wystąpienia reguł ---------- */

function resolveAmount(s: GameState, rule: ObligationRule, occurrenceId: string): Grosze {
  const spec = rule.amount;
  switch (spec.type) {
    case 'fixed':
      return spec.amount;
    case 'variable': {
      const bps = createRng(s.seed, occurrenceId).int(-spec.spreadBps, spec.spreadBps);
      return spec.base + mulBps(spec.base, bps);
    }
    case 'contract': {
      const contract = s.contracts.find((c) => c.id === spec.contractId);
      if (!contract) throw new Error(`Brak umowy ${spec.contractId} dla reguły ${rule.id}`);
      return contract.monthlyAmount;
    }
  }
}

function issueObligation(s: GameState, rule: ObligationRule, date: IsoDate): void {
  const occurrenceId = `${rule.id}@${date}`;
  if (s.processed[occurrenceId]) return; // wystąpienie już zastosowane — idempotencja
  s.processed[occurrenceId] = true;

  const amount = resolveAmount(s, rule, occurrenceId);
  assertGrosze(amount, 'kwota zobowiązania');
  if (amount <= 0) throw new RangeError(`Zobowiązanie musi mieć kwotę dodatnią (${occurrenceId})`);
  const dueDate = computeDueDate(date, rule.due);
  const playerId = s.person.id;
  const description = `${rule.description} — ${formatMonthPL(monthKey(date))}`;
  const receivable = rule.direction === 'receivable';

  const obligation: Obligation = {
    id: `obl:${occurrenceId}`,
    direction: rule.direction,
    creditorId: receivable ? playerId : rule.counterpartyId,
    debtorId: receivable ? rule.counterpartyId : playerId,
    counterpartyId: rule.counterpartyId,
    amount,
    issueDate: date,
    dueDate,
    category: rule.category,
    description,
    ruleId: rule.id,
    occurrenceId,
    status: 'open',
    settledDate: null,
    settlementTxId: null,
    overdueSince: null,
  };
  s.obligations.push(obligation);

  const partyName = s.parties[rule.counterpartyId]?.name ?? rule.counterpartyId;
  logEvent(s, {
    id: occurrenceId,
    date,
    type: 'obligation.issued',
    tone: 'neutral',
    title: receivable ? `Naliczono należność: ${description}` : `Naliczono zobowiązanie: ${description}`,
    detail: `${partyName} · ${formatPLN(amount)} · termin ${formatDatePL(dueDate)}`,
    amount: receivable ? amount : -amount,
    category: rule.category,
  });
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
      if (isIssueDay(rule, date)) issueObligation(s, rule, date);
    } else {
      applyBirthday(s, rule.id, rule.startDate, date);
    }
  }
}

/* ---------- Rozliczenia ---------- */

/**
 * Rozlicza zapadłe zobowiązania.
 * 1) Należności są wpłacane w terminie (kontrahenci w v0.1 zawsze płacą).
 * 2) Zobowiązania są regulowane automatycznie (zlecenie stałe), od najstarszego terminu;
 *    każde jest próbowane niezależnie i opłacane w całości albo wcale (brak debetu i płatności częściowych).
 */
export function settleDueObligations(s: GameState, date: IsoDate): void {
  const due = s.obligations
    .filter((o) => o.status === 'open' && o.dueDate <= date)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));

  for (const o of due.filter((x) => x.direction === 'receivable')) settleOne(s, o, date);

  for (const o of due.filter((x) => x.direction === 'payable')) {
    if (playerAccount(s).balance >= o.amount) {
      settleOne(s, o, date);
    } else if (o.overdueSince === null) {
      o.overdueSince = date;
      const partyName = s.parties[o.counterpartyId]?.name ?? o.counterpartyId;
      logEvent(s, {
        id: `overdue:${o.id}`,
        date,
        type: 'obligation.overdue',
        tone: 'warning',
        title: `Brak środków na zapłatę: ${o.description}`,
        detail: `${partyName} · ${formatPLN(o.amount)} · termin minął ${formatDatePL(o.dueDate)}`,
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
  const partyName = s.parties[o.counterpartyId]?.name ?? o.counterpartyId;
  const late = o.overdueSince !== null;
  logEvent(s, {
    id: `settle:${o.id}`,
    date,
    type: 'obligation.settled',
    tone: receivable ? 'positive' : 'negative',
    title: receivable ? `Wpływ: ${o.description}` : `Zapłacono: ${o.description}`,
    detail: `${partyName} · ${formatPLN(o.amount)}${late ? ' · po terminie' : ''}`,
    amount: receivable ? o.amount : -o.amount,
    category: o.category,
  });
}

/* ---------- Dzień i czas ---------- */

function recordHistory(s: GameState, date: IsoDate): void {
  const point = { date, cash: playerAccount(s).balance, netWorth: netWorth(s) };
  const last = s.history[s.history.length - 1];
  if (last && last.date === date) s.history[s.history.length - 1] = point;
  else s.history.push(point);
}

/**
 * Przetwarza jeden dzień kalendarzowy (mutuje przekazany stan).
 * Kolejność: (1) naliczenia z harmonogramu, (2) rozliczenia, (3) migawka historii.
 */
export function processDay(s: GameState, date: IsoDate): void {
  applyScheduledOccurrences(s, date);
  settleDueObligations(s, date);
  recordHistory(s, date);
}

/**
 * Przesuwa grę o `days` dni, przetwarzając KAŻDY dzień po kolei (żadna zaplanowana
 * operacja nie jest pomijana). Zwraca nowy stan; argument pozostaje nietknięty.
 */
export function advanceDays(state: GameState, days: number): GameState {
  if (!Number.isInteger(days) || days < 1 || days > MAX_ADVANCE_DAYS) {
    throw new RangeError(`Liczba dni musi być całkowita z zakresu 1..${MAX_ADVANCE_DAYS}`);
  }
  const draft = structuredClone(state);
  for (let i = 0; i < days; i++) {
    const next = addDays(draft.clock.today, 1);
    processDay(draft, next);
    draft.clock.today = next;
  }
  return draft;
}

export function advanceOneDay(state: GameState): GameState {
  return advanceDays(state, 1);
}

/** Do pierwszego dnia następnego miesiąca (z dnia 1. -> 1. kolejnego miesiąca). */
export function advanceToNextMonth(state: GameState): GameState {
  const target = firstOfNextMonth(state.clock.today);
  return advanceDays(state, diffDays(target, state.clock.today));
}
