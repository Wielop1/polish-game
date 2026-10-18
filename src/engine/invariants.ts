import { netWorthBreakdown } from './selectors.ts';
import type { GameState } from './state.ts';

/**
 * Niezmienniki finansowe i spójności stanu. Zwraca listę naruszeń (pusta = stan spójny).
 * Używane w testach, a także przy wczytywaniu zapisu (uszkodzony zapis jest odrzucany).
 */
export function checkInvariants(s: GameState): string[] {
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(msg);

  const account = s.accounts[s.playerAccountId];
  if (!account) {
    fail(`brak rachunku gracza ${s.playerAccountId}`);
    return errors;
  }

  // 1. Saldo rachunku = suma transakcji; transakcje całkowite, niezerowe, unikalne, chronologiczne.
  let ledgerSum = 0;
  const txIds = new Set<string>();
  let prevDate = '';
  for (const tx of s.ledger) {
    if (!Number.isSafeInteger(tx.amount) || tx.amount === 0) fail(`transakcja ${tx.id} ma nieprawidłową kwotę ${tx.amount}`);
    if (txIds.has(tx.id)) fail(`zduplikowane id transakcji ${tx.id}`);
    txIds.add(tx.id);
    if (!s.processed[tx.id]) fail(`transakcja ${tx.id} nie jest oznaczona jako przetworzona`);
    if (tx.accountId === account.id) ledgerSum += tx.amount;
    if (tx.date < prevDate) fail(`rejestr nie jest chronologiczny przy ${tx.id}`);
    prevDate = tx.date;
  }
  if (ledgerSum !== account.balance) fail(`saldo ${account.balance} ≠ suma transakcji ${ledgerSum}`);
  if (account.balance < 0) fail(`ujemne saldo ${account.balance}`);

  // 2. Zobowiązania: unikalne, powiązane z transakcją dokładnie wtedy, gdy rozliczone.
  const oblIds = new Set<string>();
  const txById = new Map(s.ledger.map((t) => [t.id, t]));
  let accruedIncome = 0;
  let accruedExpense = 0;
  for (const o of s.obligations) {
    if (oblIds.has(o.id)) fail(`zduplikowane id zobowiązania ${o.id}`);
    oblIds.add(o.id);
    if (!Number.isSafeInteger(o.amount) || o.amount <= 0) fail(`zobowiązanie ${o.id} ma nieprawidłową kwotę`);
    if (o.dueDate < o.issueDate) fail(`zobowiązanie ${o.id}: termin przed naliczeniem`);
    if (o.direction === 'receivable') accruedIncome += o.amount;
    else accruedExpense += o.amount;
    const linked = s.ledger.filter((t) => t.obligationId === o.id);
    if (o.status === 'settled') {
      const tx = o.settlementTxId ? txById.get(o.settlementTxId) : undefined;
      const expected = o.direction === 'receivable' ? o.amount : -o.amount;
      if (!tx) fail(`rozliczone zobowiązanie ${o.id} nie ma transakcji`);
      else if (tx.amount !== expected) fail(`transakcja ${tx.id} ma kwotę ${tx.amount}, oczekiwano ${expected}`);
      if (linked.length !== 1) fail(`zobowiązanie ${o.id} ma ${linked.length} transakcji (oczekiwano 1)`);
      if (!o.settledDate) fail(`rozliczone zobowiązanie ${o.id} bez daty rozliczenia`);
    } else if (linked.length !== 0) {
      fail(`otwarte zobowiązanie ${o.id} ma już transakcję`);
    }
    if (o.status === 'open' && o.dueDate > s.clock.today && o.overdueSince !== null) {
      fail(`zobowiązanie ${o.id} oznaczone jako zaległe przed terminem`);
    }
  }
  for (const tx of s.ledger) {
    if (tx.obligationId && !oblIds.has(tx.obligationId)) fail(`transakcja ${tx.id} wskazuje nieistniejące zobowiązanie`);
  }

  // 3. Tożsamość księgowa: majątek netto = kapitał początkowy + naliczone przychody − naliczone koszty.
  const nw = netWorthBreakdown(s);
  const expectedNetWorth = s.openingCash + accruedIncome - accruedExpense;
  if (nw.netWorth !== expectedNetWorth) {
    fail(`majątek netto ${nw.netWorth} ≠ kapitał + przychody − koszty (${expectedNetWorth})`);
  }

  // 4. Zegar i historia.
  if (s.clock.today < s.clock.startDate) fail('data bieżąca przed datą startu');
  const lastPoint = s.history[s.history.length - 1];
  if (!lastPoint) fail('pusta historia majątku');
  else {
    if (lastPoint.date !== s.clock.today) fail(`ostatni punkt historii (${lastPoint.date}) ≠ dzisiaj (${s.clock.today})`);
    if (lastPoint.netWorth !== nw.netWorth) fail('ostatni punkt historii ma inny majątek netto niż stan');
    if (lastPoint.cash !== account.balance) fail('ostatni punkt historii ma inną gotówkę niż stan');
  }
  for (let i = 1; i < s.history.length; i++) {
    if (s.history[i]!.date <= s.history[i - 1]!.date) {
      fail(`historia nie jest ściśle rosnąca przy ${s.history[i]!.date}`);
      break;
    }
  }
  const eventIds = new Set<string>();
  for (const e of s.events) {
    if (eventIds.has(e.id)) fail(`zduplikowane id zdarzenia ${e.id}`);
    eventIds.add(e.id);
  }

  // 5. Odwołania do umów i stron.
  for (const rule of s.rules) {
    if (rule.kind !== 'obligation') continue;
    if (!s.parties[rule.counterpartyId]) fail(`reguła ${rule.id}: nieznany kontrahent ${rule.counterpartyId}`);
    if (rule.amount.type === 'contract') {
      const id = rule.amount.contractId;
      if (!s.contracts.some((c) => c.id === id)) fail(`reguła ${rule.id}: nieznana umowa ${id}`);
    }
  }
  return errors;
}
