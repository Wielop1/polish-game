import { formatDatePL, formatMonthPL, monthKey } from './date.ts';
import type { IsoDate } from './date.ts';
import { assertGrosze, formatPLN } from './money.ts';
import type { Grosze } from './money.ts';
import { netWorth, savingsBalance } from './selectors.ts';
import type { Account, GameEvent, GameState, LedgerEntry, Obligation, Party } from './state.ts';

/** Błąd walidacji komendy gracza (stan nie zostaje zmieniony). */
export class CommandError extends Error {}

export function accountById(s: GameState, id: string): Account {
  const acc = s.accounts[id];
  if (!acc) throw new Error(`Brak rachunku ${id}`);
  return acc;
}

export function partyName(s: GameState, id: string): string {
  return s.parties[id]?.name ?? id;
}

export function ensureParty(s: GameState, party: Party): void {
  if (!s.parties[party.id]) s.parties[party.id] = party;
}

/** Kolejny numer licznika (deterministyczne identyfikatory komend). */
export function nextCounter(s: GameState, key: string): number {
  const n = (s.counters[key] ?? 0) + 1;
  s.counters[key] = n;
  return n;
}

export function logEvent(s: GameState, event: GameEvent): void {
  s.events.push(event);
}

/* ---------- Księgowanie ---------- */

export interface PostingInput {
  eventId: string;
  date: IsoDate;
  amount: Grosze;
  category: string;
  description: string;
  counterpartyId: string | null;
  obligationId: string | null;
  /** Domyślnie rachunek bieżący gracza. */
  accountId?: string;
  transferId?: string | null;
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
  const account = accountById(s, input.accountId ?? s.playerAccountId);
  const newBalance = account.balance + input.amount;
  assertGrosze(newBalance, 'saldo');
  if (newBalance < 0) throw new RangeError(`Saldo rachunku nie może być ujemne (v0.2): ${newBalance}`);
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
    transferId: input.transferId ?? null,
    eventId: input.eventId,
  };
  s.ledger.push(entry);
  return entry;
}

/* ---------- Zobowiązania ---------- */

export interface ObligationInput {
  /** Id wystąpienia (idempotencja); id zobowiązania = `obl:<occurrenceId>`. */
  occurrenceId: string;
  ruleId: string;
  direction: 'receivable' | 'payable';
  counterpartyId: string;
  accountId?: string;
  amount: Grosze;
  issueDate: IsoDate;
  dueDate: IsoDate;
  category: string;
  /** Pełny opis zobowiązania (np. „Czynsz — Styczeń 2026”). */
  description: string;
}

/** Tworzy zobowiązanie/należność i wpis w dzienniku. Zwraca null, jeśli wystąpienie już zastosowano. */
export function createObligation(s: GameState, input: ObligationInput): Obligation | null {
  if (s.processed[input.occurrenceId]) return null;
  s.processed[input.occurrenceId] = true;
  assertGrosze(input.amount, 'kwota zobowiązania');
  if (input.amount <= 0) throw new RangeError(`Zobowiązanie musi mieć kwotę dodatnią (${input.occurrenceId})`);
  if (input.dueDate < input.issueDate) throw new RangeError(`Termin ${input.dueDate} przed naliczeniem ${input.issueDate}`);
  const receivable = input.direction === 'receivable';
  const playerId = s.person.id;
  const obligation: Obligation = {
    id: `obl:${input.occurrenceId}`,
    direction: input.direction,
    creditorId: receivable ? playerId : input.counterpartyId,
    debtorId: receivable ? input.counterpartyId : playerId,
    counterpartyId: input.counterpartyId,
    accountId: input.accountId ?? s.playerAccountId,
    amount: input.amount,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    category: input.category,
    description: input.description,
    ruleId: input.ruleId,
    occurrenceId: input.occurrenceId,
    status: 'open',
    settledDate: null,
    settlementTxId: null,
    overdueSince: null,
  };
  s.obligations.push(obligation);
  logEvent(s, {
    id: input.occurrenceId,
    date: input.issueDate,
    type: 'obligation.issued',
    tone: 'neutral',
    title: receivable ? `Naliczono należność: ${input.description}` : `Naliczono zobowiązanie: ${input.description}`,
    detail: `${partyName(s, input.counterpartyId)} · ${formatPLN(input.amount)} · termin ${formatDatePL(input.dueDate)}`,
    amount: receivable ? input.amount : -input.amount,
    category: input.category,
  });
  return obligation;
}

/** Opis z okresem rozliczeniowym: „Czynsz — Styczeń 2026”. */
export function periodLabel(base: string, date: IsoDate): string {
  return `${base} — ${formatMonthPL(monthKey(date))}`;
}

/* ---------- Historia ---------- */

export function recordHistory(s: GameState, date: IsoDate): void {
  const point = {
    date,
    cash: accountById(s, s.playerAccountId).balance,
    savings: savingsBalance(s),
    netWorth: netWorth(s),
  };
  const last = s.history[s.history.length - 1];
  if (last && last.date === date) s.history[s.history.length - 1] = point;
  else s.history.push(point);
}
