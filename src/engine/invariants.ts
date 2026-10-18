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
  //    = kapitał początkowy + naliczone przychody − naliczone koszty + wartość zapasów i sprzętu (aktywa nabyte za koszty).
//    Przelewy własne i kaucje jej nie zmieniają.
  const nw = netWorthBreakdown(s);
  const expectedNetWorth = s.openingCash + accruedIncome - accruedExpense + nw.inventory + nw.equipment + nw.vehicles + nw.prepaid - nw.deferred;
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
    // dokument w całości pokryty wcześniejszą zaliczką (rozliczenie podwykonawcy) nie ma własnego zobowiązania
    const prepaidOnly = s.ops.subcontracts.some((c) => c.settlementDocId === d.id);
    if ((d.obligationIds.length === 0 && !prepaidOnly) || d.obligationIds.some((id) => !oblIds.has(id))) fail(`dokument ${d.number}: brak powiązanych zobowiązań`);
  }
  const numbers = s.documents.map((d) => d.number);
  if (new Set(numbers).size !== numbers.length) fail('zduplikowane numery dokumentów');
  for (const o of s.serviceOrders) {
    if (o.status === 'completed' && (!o.salesDocumentId || !docIds.has(o.salesDocumentId))) fail(`zlecenie ${o.id}: zakończone bez dokumentu sprzedaży`);
    // kontrakt delegowany w całości, bez nadzoru właściciela, nie rezerwuje jego godzin
    const handsOff = o.kind === 'renovation' && s.reno.jobs.some((j) => j.orderId === o.id && j.crew.supervision === 'hands-off');
    if (o.status === 'in_progress' && !handsOff && !s.commitments.some((c) => c.id === o.commitmentId)) fail(`zlecenie ${o.id}: brak rezerwacji czasu`);
  }
  // 11. v0.4: odcinki płacowe, zeznania roczne, straty, roczna składka zdrowotna, zawieszenia, historia formy.
  const oblById = new Map(s.obligations.map((o) => [o.id, o]));
  const payslipIds = new Set<string>();
  const pensionByYear: Record<string, number> = {};
  const exemptByYear: Record<string, number> = {};
  for (const p of s.payslips) {
    if (payslipIds.has(p.id)) fail(`zduplikowany odcinek płacowy ${p.id}`);
    payslipIds.add(p.id);
    if (p.emerytalna + p.rentowa + p.chorobowa !== p.socialTotal) fail(`odcinek ${p.id}: składki nie sumują się`);
    if (!p.legacy && p.gross - p.socialTotal - p.health - p.pitAdvance !== p.net) fail(`odcinek ${p.id}: brutto − składki − zdrowotna − zaliczka ≠ netto`);
    const ob = oblById.get(`obl:${p.id.replace(/^payslip:/, '')}`);
    if (!ob) fail(`odcinek ${p.id}: brak zobowiązania wynagrodzenia`);
    else if (ob.amount !== p.net) fail(`odcinek ${p.id}: netto ${p.net} ≠ zobowiązanie ${ob.amount}`);
    if (p.pitAdvance % 100 !== 0 || p.pitBase % 100 !== 0) fail(`odcinek ${p.id}: podstawa i zaliczka PIT muszą być w pełnych złotych`);
    pensionByYear[p.accrualDate.slice(0, 4)] = (pensionByYear[p.accrualDate.slice(0, 4)] ?? 0) + p.pensionBase;
    exemptByYear[p.payDate.slice(0, 4)] = (exemptByYear[p.payDate.slice(0, 4)] ?? 0) + p.exemptGross;
  }
  for (const [y, v] of Object.entries(pensionByYear)) if (v > 28_260_000) fail(`rok ${y}: podstawa emerytalna ${v} przekracza limit 30-krotności`);
  for (const [y, v] of Object.entries(exemptByYear)) if (v > 8_552_800) fail(`rok ${y}: zwolniony przychód ${v} przekracza limit ulgi dla młodych`);
  const returnIds = new Set<string>();
  for (const r of s.taxReturns) {
    if (returnIds.has(r.id)) fail(`zduplikowane zeznanie ${r.id}`);
    returnIds.add(r.id);
    if (r.balance !== r.tax - r.advances) fail(`zeznanie ${r.id}: saldo ≠ podatek − zaliczki`);
    if (r.base % 100 !== 0 || r.tax % 100 !== 0) fail(`zeznanie ${r.id}: podstawa i podatek w pełnych złotych`);
    if ((r.balance !== 0) !== (r.obligationId !== null)) fail(`zeznanie ${r.id}: zobowiązanie niezgodne z saldem`);
    if (r.obligationId && !oblIds.has(r.obligationId)) fail(`zeznanie ${r.id}: brak zobowiązania`);
  }
  for (const l of s.taxLosses) {
    const years = new Set<number>();
    let used = 0;
    for (const u of l.usages) {
      used += u.amount;
      if (years.has(u.year)) fail(`strata ${l.id}: dwa odliczenia w ${u.year}`);
      years.add(u.year);
      if (u.year <= l.year || u.year > l.year + 5) fail(`strata ${l.id}: odliczenie poza 5 latami (${u.year})`);
      if (u.amount * 2 > l.amount + 1) fail(`strata ${l.id}: odliczenie ${u.amount} przekracza 50% straty`);
    }
    if (used > l.amount) fail(`strata ${l.id}: odliczono więcej niż strata`);
  }
  for (const h of s.healthSettlements) {
    if (h.diff !== h.annualContribution - h.monthlyTotal) fail(`rozliczenie zdrowotnej ${h.id}: różnica niezgodna`);
    if (h.obligationId && !oblIds.has(h.obligationId)) fail(`rozliczenie zdrowotnej ${h.id}: brak zobowiązania`);
  }
  for (const b of s.businesses) {
    let prevTo = '';
    for (const x of b.suspensions) {
      if (x.from < prevTo || (x.to !== null && x.to < x.from)) fail(`działalność ${b.id}: nieprawidłowe zawieszenie ${x.from}–${x.to}`);
      prevTo = x.to ?? '9999-12-31';
    }
    if (b.taxFormHistory[0]?.from !== b.startDate) fail(`działalność ${b.id}: historia form nie zaczyna się od startu`);
    for (let i = 1; i < b.taxFormHistory.length; i++) if (b.taxFormHistory[i]!.from <= b.taxFormHistory[i - 1]!.from) fail(`działalność ${b.id}: historia form nie jest rosnąca`);
  }
  const periodKeys = new Set<string>();
  for (const p of s.taxPeriods) {
    const k = `${p.businessId}:${p.month}`;
    if (periodKeys.has(k)) fail(`zduplikowane rozliczenie miesiąca ${k}`);
    periodKeys.add(k);
  }

  // 7. Branża remontowa (v0.5): zapasy, sprzęt, kontrakty, zaliczki, reklamacje i opinie.
  const docById = new Map(s.documents.map((d) => [d.id, d]));
  const moveIds = new Set<string>();
  const stockSums: Record<string, { qty: number; value: number }> = {};
  const usedByJob = new Map<string, { qty: number; value: number }>();
  for (const m of s.reno.stockMoves) {
    if (moveIds.has(m.id)) fail(`zduplikowany ruch magazynowy ${m.id}`);
    moveIds.add(m.id);
    const acc = (stockSums[m.key] ??= { qty: 0, value: 0 });
    acc.qty += m.qty;
    acc.value += m.value;
    if (m.kind === 'purchase') {
      const d = m.docId ? docById.get(m.docId) : undefined;
      if (!d || d.kind !== 'cost' || d.taxAmount !== m.value) fail(`zakup magazynowy ${m.id}: brak dokumentu kosztowego o wartości ${m.value}`);
      if (m.qty <= 0 || m.value <= 0) fail(`zakup magazynowy ${m.id}: nieprawidłowa ilość lub wartość`);
    } else {
      if (m.qty >= 0 || m.value > 0) fail(`zużycie ${m.id}: nieprawidłowy znak`);
      const k = `${m.jobId}:${m.key}`;
      const u = usedByJob.get(k) ?? { qty: 0, value: 0 };
      usedByJob.set(k, { qty: u.qty - m.qty, value: u.value - m.value });
    }
  }
  for (const [key, st] of Object.entries(s.reno.stock)) {
    if (st.qty < 0 || st.value < 0) fail(`zapas ${key}: ujemna ilość lub wartość`);
    const sum = stockSums[key] ?? { qty: 0, value: 0 };
    if (sum.qty !== st.qty || sum.value !== st.value) fail(`zapas ${key}: ${st.qty}/${st.value} ≠ suma ruchów ${sum.qty}/${sum.value} (podwójne zużycie lub zakup?)`);
  }
  for (const key of Object.keys(stockSums)) if (!s.reno.stock[key]) fail(`ruchy magazynowe bez zapasu ${key}`);
  for (const e of s.reno.equipment) {
    if (e.conditionBps < 0 || e.conditionBps > 10_000) fail(`sprzęt ${e.id}: stan poza zakresem`);
    const d = docById.get(e.docId);
    if (!d || d.kind !== 'cost' || d.taxAmount !== e.cost) fail(`sprzęt ${e.id}: brak dokumentu zakupu o wartości ${e.cost}`);
  }
  const jobIds = new Set<string>();
  const orderById = new Map(s.serviceOrders.map((o) => [o.id, o]));
  for (const j of s.reno.jobs) {
    if (jobIds.has(j.id)) fail(`zduplikowany kontrakt ${j.id}`);
    jobIds.add(j.id);
    const order = orderById.get(j.orderId);
    if (!order || order.kind !== 'renovation') fail(`kontrakt ${j.id}: brak zlecenia typu renovation`);
    if (j.progressCenti > j.normCenti + j.extraCenti) fail(`kontrakt ${j.id}: postęp ponad zakres`);
    const advanceDocs = s.documents.filter((d) => d.orderId === j.orderId && d.part === 'advance');
    const finalDocs = s.documents.filter((d) => d.orderId === j.orderId && d.kind === 'sales' && d.part !== 'advance');
    if (advanceDocs.length > (j.advanceNet > 0 ? 1 : 0)) fail(`kontrakt ${j.id}: wielokrotnie zaksięgowana zaliczka`);
    if (j.advanceNet > 0 && advanceDocs[0]?.net !== j.advanceNet) fail(`kontrakt ${j.id}: zaliczka ${advanceDocs[0]?.net} ≠ ${j.advanceNet}`);
    if (finalDocs.length > (j.stage === 'done' ? 1 : 0)) fail(`kontrakt ${j.id}: ${finalDocs.length} dokumentów rozliczenia końcowego`);
    if (j.stage === 'done') {
      const f = finalDocs[0];
      if (!f || f.id !== j.finalDocId) fail(`kontrakt ${j.id}: brak dokumentu rozliczenia`);
      else if (advanceDocs.reduce((a, d) => a + d.net, 0) + f.net !== j.priceNet - j.penaltyNet) fail(`kontrakt ${j.id}: zaliczka + rozliczenie ≠ cena − kara`);
      if (order && order.status !== 'completed') fail(`kontrakt ${j.id}: zlecenie nie jest zakończone`);
    }
    for (const [key, c] of Object.entries(j.consumed)) {
      const u = usedByJob.get(`${j.id}:${key}`) ?? { qty: 0, value: 0 };
      if (u.qty !== c.qty || u.value !== c.value) fail(`kontrakt ${j.id}: zużycie ${key} ${c.qty}/${c.value} ≠ ruchy ${u.qty}/${u.value}`);
    }
    const consumedValue = Object.values(j.consumed).reduce((a, c) => a + c.value, 0);
    if (consumedValue !== j.actual.materials) fail(`kontrakt ${j.id}: koszt materiałów ${j.actual.materials} ≠ zużycie ${consumedValue}`);
  }
  for (const o of s.serviceOrders) if (o.kind === 'renovation' && !jobIds.has(s.reno.jobs.find((j) => j.orderId === o.id)?.id ?? '')) fail(`zlecenie ${o.id}: brak kontraktu remontowego`);
  const complained = new Set<string>();
  for (const c of s.reno.complaints) {
    if (complained.has(c.jobId)) fail(`kontrakt ${c.jobId}: zduplikowana reklamacja`);
    complained.add(c.jobId);
    if (!jobIds.has(c.jobId)) fail(`reklamacja ${c.id}: nieznany kontrakt`);
  }
  const reviewed = new Set<string>();
  for (const r of s.reno.reviews) {
    if (reviewed.has(r.jobId)) fail(`kontrakt ${r.jobId}: zduplikowana opinia`);
    reviewed.add(r.jobId);
  }
  if (s.accounting.office && !s.accounting.office.planId) fail('księgowość: brak planu');

  // 8. Pracownicy, podwykonawcy, ekipy, przydziały i pojazdy (v0.6).
  const personIds = new Set<string>();
  for (const pr of s.ops.people) {
    if (personIds.has(pr.id)) fail(`zduplikowana osoba ${pr.id}`);
    personIds.add(pr.id);
  }
  const empIds = new Set<string>();
  for (const e of s.ops.employments) {
    if (empIds.has(e.id)) fail(`zduplikowana umowa ${e.id}`);
    empIds.add(e.id);
    if (!personIds.has(e.personId)) fail(`umowa ${e.id}: nieznana osoba`);
    if (e.endDate !== null && e.endDate < e.startDate) fail(`umowa ${e.id}: koniec przed początkiem`);
    for (let i = 1; i < e.wageHistory.length; i++) if (e.wageHistory[i]!.from <= e.wageHistory[i - 1]!.from) fail(`umowa ${e.id}: historia wynagrodzeń nie rośnie`);
  }
  for (const pr of s.ops.people) {
    const overlapping = s.ops.employments.filter((e) => e.personId === pr.id).sort((a, b) => a.startDate.localeCompare(b.startDate));
    for (let i = 1; i < overlapping.length; i++) if ((overlapping[i - 1]!.endDate ?? '9999-12-31') >= overlapping[i]!.startDate) fail(`osoba ${pr.id}: nakładające się umowy`);
  }
  const slipKeys = new Set<string>();
  for (const ps of s.ops.payslips) {
    if (slipKeys.has(ps.id)) fail(`zduplikowana lista płac ${ps.id}`);
    slipKeys.add(ps.id);
    if (ps.net + ps.socialTotal + ps.health + ps.pitAdvance !== ps.gross) fail(`lista płac ${ps.id}: netto + potrącenia ≠ brutto`);
    if (ps.gross + ps.employer.total !== ps.totalCost) fail(`lista płac ${ps.id}: brutto + składki pracodawcy ≠ koszt całkowity`);
    const d = docById.get(ps.docId);
    if (!d || d.part !== 'payroll' || d.net !== ps.totalCost || d.taxAmount !== ps.totalCost) fail(`lista płac ${ps.id}: brak dokumentu kosztowego o kwocie ${ps.totalCost}`);
    const sum = ps.obligationIds.reduce((a, id) => a + (s.obligations.find((o) => o.id === id)?.amount ?? 0), 0);
    if (sum !== ps.totalCost) fail(`lista płac ${ps.id}: zobowiązania ${sum} ≠ koszt całkowity ${ps.totalCost}`);
  }
  const reservations = new Map<string, { jobId: string; from: string; to: string }[]>();
  const jobById = new Map(s.reno.jobs.map((j) => [j.id, j]));
  for (const a of s.ops.assignments) {
    if (!jobById.has(a.jobId)) fail(`przydział ${a.id}: nieznany kontrakt`);
    const k = `${a.kind}:${a.resourceId}`;
    for (const o of reservations.get(k) ?? []) if (o.jobId !== a.jobId && o.from <= a.to && a.from <= o.to) fail(`zasób ${k} przydzielony do dwóch kontraktów w tym samym czasie (${o.jobId}, ${a.jobId})`);
    reservations.set(k, [...(reservations.get(k) ?? []), { jobId: a.jobId, from: a.from, to: a.to }]);
  }
  const subIds = new Set(s.ops.subcontractors.map((x) => x.id));
  const activeScope = new Map<string, number>();
  for (const c of s.ops.subcontracts) {
    if (!subIds.has(c.subId)) fail(`umowa z podwykonawcą ${c.id}: nieznany podwykonawca`);
    if (!jobById.has(c.jobId)) fail(`umowa z podwykonawcą ${c.id}: nieznany kontrakt`);
    if (c.prepaid > c.advanceNet) fail(`umowa z podwykonawcą ${c.id}: przedpłata ponad zaliczkę`);
    if (c.status === 'settled' && c.prepaid !== 0) fail(`umowa z podwykonawcą ${c.id}: rozliczona z niezerową przedpłatą`);
    if (c.status === 'settled' && c.settledNet > 0 && !docById.get(c.settlementDocId ?? '')) fail(`umowa z podwykonawcą ${c.id}: brak dokumentu rozliczenia`);
    if (c.performedCenti > c.requiredCenti) fail(`umowa z podwykonawcą ${c.id}: wykonano ponad zakres`);
    if (['accepted', 'in_progress', 'delivered'].includes(c.status)) activeScope.set(c.jobId, (activeScope.get(c.jobId) ?? 0) + c.scopeBps);
  }
  for (const [job, scope] of activeScope) if (scope > 10_000) fail(`kontrakt ${job}: podwykonawcom zlecono ${scope / 100}% zakresu`);
  for (const j of s.reno.jobs) {
    if (j.crew.teamId && !s.ops.teams.some((t) => t.id === j.crew.teamId)) fail(`kontrakt ${j.id}: nieznana ekipa`);
    if (j.vehicleId && !s.ops.vehicles.some((v) => v.id === j.vehicleId)) fail(`kontrakt ${j.id}: nieznany pojazd`);
    if (j.advanceMode === 'deferred' && j.advanceNet > 0) {
      const adv = docById.get(j.advanceDocId ?? '');
      if (!adv || adv.part !== 'advance' || adv.taxAmount !== 0 || adv.net !== j.advanceNet) fail(`kontrakt ${j.id}: zaliczka nie jest zobowiązaniem do wykonania usługi (przychód podatkowy ≠ 0)`);
      const fin = docById.get(j.finalDocId ?? '');
      if (j.stage === 'done' && (!fin || fin.taxAmount !== fin.net + j.advanceNet)) fail(`kontrakt ${j.id}: przychód podatkowy po wykonaniu ≠ cena − kara`);
    }
  }
  for (const v of s.ops.vehicles) {
    const d = docById.get(v.docId);
    if (!d || d.part !== 'capital' || d.taxAmount !== 0 || d.net !== v.cost) fail(`pojazd ${v.id}: brak dokumentu zakupu bez kosztu podatkowego`);
    if (v.conditionBps < 0 || v.conditionBps > 10_000) fail(`pojazd ${v.id}: stan poza zakresem`);
  }
  return errors;
}
