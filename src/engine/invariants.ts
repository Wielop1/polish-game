import { employmentContracts } from './contracts.ts';
import { netWorthBreakdown } from './selectors.ts';
import type { GameState } from './state.ts';
import { budgetFor } from './time.ts';

/**
 * Niezmienniki finansowe i spójności stanu. Zwraca listę naruszeń (pusta = stan spójny).
 * Używane w testach, a także przy wczytywaniu zapisu (uszkodzony zapis jest odrzucany).
 */
export function checkInvariants(s: GameState): string[] {
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(msg);

  const main = s.accounts[s.playerAccountId];
  if (!main) {
    fail(`brak rachunku gracza ${s.playerAccountId}`);
    return errors;
  }

  // 1. Saldo KAŻDEGO rachunku = suma jego transakcji; transakcje całkowite, niezerowe, unikalne, chronologiczne.
  const sums: Record<string, number> = {};
  const txIds = new Set<string>();
  const transfers = new Map<string, number[]>();
  let prevDate = '';
  for (const tx of s.ledger) {
    if (!Number.isSafeInteger(tx.amount) || tx.amount === 0) fail(`transakcja ${tx.id} ma nieprawidłową kwotę ${tx.amount}`);
    if (txIds.has(tx.id)) fail(`zduplikowane id transakcji ${tx.id}`);
    txIds.add(tx.id);
    if (!s.processed[tx.id]) fail(`transakcja ${tx.id} nie jest oznaczona jako przetworzona`);
    if (!s.accounts[tx.accountId]) fail(`transakcja ${tx.id} wskazuje nieistniejący rachunek ${tx.accountId}`);
    sums[tx.accountId] = (sums[tx.accountId] ?? 0) + tx.amount;
    if (tx.date < prevDate) fail(`rejestr nie jest chronologiczny przy ${tx.id}`);
    prevDate = tx.date;
    if (tx.transferId) transfers.set(tx.transferId, [...(transfers.get(tx.transferId) ?? []), tx.amount]);
  }
  for (const acc of Object.values(s.accounts)) {
    const sum = sums[acc.id] ?? 0;
    if (sum !== acc.balance) fail(`saldo ${acc.id}: ${acc.balance} ≠ suma transakcji ${sum}`);
    if (acc.balance < 0) fail(`ujemne saldo ${acc.id}: ${acc.balance}`);
  }
  // Przelewy własne: dokładnie dwa wpisy o sumie zero.
  for (const [id, amounts] of transfers) {
    if (amounts.length !== 2 || amounts[0]! + amounts[1]! !== 0) fail(`przelew ${id} nie jest parą wpisów o sumie zero`);
  }

  // 2. Zobowiązania: unikalne, powiązane z transakcją dokładnie wtedy, gdy rozliczone.
  const oblIds = new Set<string>();
  const txById = new Map(s.ledger.map((t) => [t.id, t]));
  const txByObligation = new Map<string, number>();
  for (const tx of s.ledger) if (tx.obligationId) txByObligation.set(tx.obligationId, (txByObligation.get(tx.obligationId) ?? 0) + 1);
  let accruedIncome = 0;
  let accruedExpense = 0;
  for (const o of s.obligations) {
    if (oblIds.has(o.id)) fail(`zduplikowane id zobowiązania ${o.id}`);
    oblIds.add(o.id);
    if (!Number.isSafeInteger(o.amount) || o.amount <= 0) fail(`zobowiązanie ${o.id} ma nieprawidłową kwotę`);
    if (o.dueDate < o.issueDate) fail(`zobowiązanie ${o.id}: termin przed naliczeniem`);
    if (!s.accounts[o.accountId]) fail(`zobowiązanie ${o.id} wskazuje nieistniejący rachunek ${o.accountId}`);
    if (o.direction === 'receivable') accruedIncome += o.amount;
    else accruedExpense += o.amount;
    const linked = txByObligation.get(o.id) ?? 0;
    if (o.status === 'settled') {
      const tx = o.settlementTxId ? txById.get(o.settlementTxId) : undefined;
      const expected = o.direction === 'receivable' ? o.amount : -o.amount;
      if (!tx) fail(`rozliczone zobowiązanie ${o.id} nie ma transakcji`);
      else {
        if (tx.amount !== expected) fail(`transakcja ${tx.id} ma kwotę ${tx.amount}, oczekiwano ${expected}`);
        if (tx.accountId !== o.accountId) fail(`transakcja ${tx.id} na innym rachunku niż zobowiązanie ${o.id}`);
      }
      if (linked !== 1) fail(`zobowiązanie ${o.id} ma ${linked} transakcji (oczekiwano 1)`);
      if (!o.settledDate) fail(`rozliczone zobowiązanie ${o.id} bez daty rozliczenia`);
    } else if (linked !== 0) {
      fail(`otwarte zobowiązanie ${o.id} ma już transakcję`);
    }
    if (o.status === 'open' && o.dueDate > s.clock.today && o.overdueSince !== null) {
      fail(`zobowiązanie ${o.id} oznaczone jako zaległe przed terminem`);
    }
  }
  for (const tx of s.ledger) {
    if (tx.obligationId && !oblIds.has(tx.obligationId)) fail(`transakcja ${tx.id} wskazuje nieistniejące zobowiązanie`);
  }

  // 3. Kaucje: aktywo (nie koszt) — wpłata i zwrot muszą mieć pokrycie w rejestrze.
  const assetIds = new Set<string>();
  for (const a of s.assets) {
    if (assetIds.has(a.id)) fail(`zduplikowane id aktywa ${a.id}`);
    assetIds.add(a.id);
    const pay = txById.get(`tx:deposit-pay:${a.id}`);
    if (!pay || pay.amount !== -a.amount) fail(`kaucja ${a.id}: brak wpłaty w rejestrze o kwocie ${a.amount}`);
    const refund = txById.get(`tx:deposit-refund:${a.id}`);
    if (a.status === 'refunded') {
      if (!refund || refund.amount !== a.amount) fail(`kaucja ${a.id} oznaczona jako zwrócona bez zwrotu w rejestrze`);
    } else if (refund) fail(`kaucja ${a.id} ma zwrot w rejestrze, ale status „held”`);
    if (!s.contracts.some((c) => c.id === a.contractId)) fail(`kaucja ${a.id} wskazuje nieistniejącą umowę`);
  }

  // 4. Tożsamość księgowa: majątek netto (rachunki + kaucje + należności − zobowiązania)
  //    = kapitał początkowy + naliczone przychody − naliczone koszty. Przelewy własne i kaucje jej nie zmieniają.
  const nw = netWorthBreakdown(s);
  const expectedNetWorth = s.openingCash + accruedIncome - accruedExpense;
  if (nw.netWorth !== expectedNetWorth) {
    fail(`majątek netto ${nw.netWorth} ≠ kapitał + przychody − koszty (${expectedNetWorth})`);
  }

  // 5. Zegar i historia.
  if (s.clock.today < s.clock.startDate) fail('data bieżąca przed datą startu');
  const lastPoint = s.history[s.history.length - 1];
  if (!lastPoint) fail('pusta historia majątku');
  else {
    if (lastPoint.date !== s.clock.today) fail(`ostatni punkt historii (${lastPoint.date}) ≠ dzisiaj (${s.clock.today})`);
    if (lastPoint.netWorth !== nw.netWorth) fail('ostatni punkt historii ma inny majątek netto niż stan');
    if (lastPoint.cash !== nw.cash || lastPoint.savings !== nw.savings) fail('ostatni punkt historii ma inne salda niż stan');
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

  // 6. Odwołania reguł do umów i stron; zakończona umowa kończy swoje reguły.
  const contractById = new Map(s.contracts.map((c) => [c.id, c]));
  for (const rule of s.rules) {
    if (rule.kind === 'savings_interest') {
      if (!s.accounts[rule.accountId]) fail(`reguła ${rule.id}: nieznany rachunek ${rule.accountId}`);
      continue;
    }
    if (rule.kind !== 'obligation') continue;
    if (!s.parties[rule.counterpartyId]) fail(`reguła ${rule.id}: nieznany kontrahent ${rule.counterpartyId}`);
    if (rule.amount.type === 'contract' && !contractById.has(rule.amount.contractId)) fail(`reguła ${rule.id}: nieznana umowa ${rule.amount.contractId}`);
    if (rule.contractId) {
      const c = contractById.get(rule.contractId);
      if (!c) fail(`reguła ${rule.id}: nieznana umowa ${rule.contractId}`);
      else if (rule.endDate !== c.endDate) fail(`reguła ${rule.id}: koniec reguły (${rule.endDate}) ≠ koniec umowy (${c.endDate})`);
    }
  }

  // 7. Umowy o pracę nie nakładają się (jedna praca naraz); najmy mogą się nakładać świadomie.
  const emp = [...employmentContracts(s)].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (let i = 1; i < emp.length; i++) {
    const prev = emp[i - 1]!;
    if (prev.endDate === null || emp[i]!.startDate <= prev.endDate) fail(`umowy o pracę ${prev.id} i ${emp[i]!.id} nakładają się`);
  }

  // 8. Budżet czasu: dziś nie można przekraczać 24 godzin; plan, umiejętności i zmęczenie w zakresach.
  if (budgetFor(s, s.clock.today).free < 0) fail('budżet czasu na dziś przekracza 24 godziny');
  if (s.life.fatigue < 0 || s.life.fatigue > 100) fail('zmęczenie poza zakresem 0–100');

  // 9. Wydarzenia i akcje zaplanowane: unikalne id.
  const lifeIds = new Set<string>();
  for (const e of s.lifeEvents) {
    if (lifeIds.has(e.id)) fail(`zduplikowane id wydarzenia życiowego ${e.id}`);
    lifeIds.add(e.id);
    if (e.status === 'pending' && e.options.length === 0) fail(`wydarzenie ${e.id} oczekuje na decyzję, ale nie ma opcji`);
    if (e.status !== 'pending' && e.outcome === null) fail(`rozstrzygnięte wydarzenie ${e.id} bez opisu skutku`);
  }
  const pendingIds = new Set<string>();
  for (const p of s.pending) {
    if (pendingIds.has(p.id)) fail(`zduplikowana akcja zaplanowana ${p.id}`);
    pendingIds.add(p.id);
    if (s.processed[p.id]) fail(`akcja ${p.id} jest już wykonana, a nadal zaplanowana`);
  }

  // 10. JDG (v0.3): jedna aktywna działalność, rachunek firmowy, dokumenty, zlecenia i rozliczenia.
  const bizAccounts = Object.values(s.accounts).filter((a) => a.type === 'business');
  const businessById = new Map(s.businesses.map((b) => [b.id, b]));
  if (s.businesses.filter((b) => b.status === 'active').length > 1) fail('więcej niż jedna aktywna działalność');
  for (const b of s.businesses) {
    const acc = s.accounts[b.accountId];
    if (!acc || acc.type !== 'business') fail(`działalność ${b.id}: brak rachunku firmowego`);
    else if (acc.ownerId !== b.ownerId || b.ownerId !== s.person.id) fail(`działalność ${b.id}: rachunek firmowy musi należeć do osoby fizycznej (JDG nie jest osobą prawną)`);
  }
  for (const acc of bizAccounts) if (!s.businesses.some((b) => b.accountId === acc.id)) fail(`rachunek firmowy ${acc.id} bez działalności`);
  for (const o of s.obligations) {
    const isBiz = s.accounts[o.accountId]?.type === 'business';
    if ((o.scope === 'business') !== isBiz) fail(`zobowiązanie ${o.id}: ewidencja ${o.scope} niezgodna z rachunkiem`);
  }
  const docIds = new Set<string>();
  for (const d of s.documents) {
    if (docIds.has(d.id)) fail(`zduplikowany dokument ${d.id}`);
    docIds.add(d.id);
    if (!businessById.has(d.businessId)) fail(`dokument ${d.number}: nieznana działalność`);
    if (d.net + d.vat !== d.gross) fail(`dokument ${d.number}: netto + VAT ≠ brutto`);
    if (d.vatTreatment === 'exempt' && d.vat !== 0) fail(`dokument ${d.number}: zwolnienie z VAT, ale VAT ≠ 0`);
    if (d.obligationIds.length === 0 || d.obligationIds.some((id) => !oblIds.has(id))) fail(`dokument ${d.number}: brak powiązanych zobowiązań`);
  }
  const numbers = s.documents.map((d) => d.number);
  if (new Set(numbers).size !== numbers.length) fail('zduplikowane numery dokumentów');
  for (const o of s.serviceOrders) {
    if (o.status === 'completed' && (!o.salesDocumentId || !docIds.has(o.salesDocumentId))) fail(`zlecenie ${o.id}: zakończone bez dokumentu sprzedaży`);
    if (o.status === 'in_progress' && !s.commitments.some((c) => c.id === o.commitmentId)) fail(`zlecenie ${o.id}: brak rezerwacji czasu`);
  }
  const periodKeys = new Set<string>();
  for (const p of s.taxPeriods) {
    const k = `${p.businessId}:${p.month}`;
    if (periodKeys.has(k)) fail(`zduplikowane rozliczenie miesiąca ${k}`);
    periodKeys.add(k);
  }
  return errors;
}
