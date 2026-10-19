import { issueDocument } from './business.ts';
import { CommandError, createObligation, ensureParty, logEvent, nextCounter } from './core.ts';
import { addDays, formatDatePL, weekdayIndex } from './date.ts';
import type { IsoDate } from './date.ts';
import { formatPLN, mulBps, roundDiv, zl } from './money.ts';
import type { Grosze } from './money.ts';
import { requireActiveBusiness, requireCash } from './opsCommon.ts';
import { COMPLEXITY_HOURS_BPS, SERVICE_BY_ID } from './renovationCatalog.ts';
import { createRng } from './rng.ts';
import { firstFree, releaseJob, reserve, resourceBusy } from './teams.ts';
import type { Operator, GameState, RenoJob, Subcontract, Subcontractor } from './state.ts';

/**
 * Podwykonawcy (B2B): inne firmy wykonują zakres kontraktu za umówioną cenę. Nie są pracownikami — brak ZUS i płacy etatowej;
 * zakładamy, że to małe firmy zwolnione z VAT (faktura bez VAT, brak odwrotnego obciążenia — SUB-VAT-SIMPLIFIED).
 * Zaliczka dla podwykonawcy to PRZEDPŁATA (aktywo), a nie koszt: koszt podatkowy i ekonomiczny powstaje przy odbiorze pracy
 * (dokument kosztowy na pełną cenę, zapłata tylko reszty ponad zaliczkę).
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const subParty = (id: string) => `party:sub:${id}`;
export const subById = (s: GameState, id: string): Subcontractor | undefined => s.ops.subcontractors.find((x) => x.id === id);
export const ACTIVE_SUB: Subcontract['status'][] = ['accepted', 'in_progress', 'delivered'];
export const subcontractsOfJob = (s: GameState, jobId: string): Subcontract[] => s.ops.subcontracts.filter((c) => c.jobId === jobId);

/** Wydajność podwykonawcy (pkt bazowe) z jakości: 50 → 90%, 90 → 106%. */
export const subSpeedBps = (sub: Subcontractor): number => 9_000 + (sub.quality - 50) * 40;
/** Dzienne postępy (setne godziny normy) przy 8 godzinach pracy. */
export const subDailyCenti = (sub: Subcontractor): number => roundDiv(800 * subSpeedBps(sub), 10_000);

/** Cennik: cena = robocizna jako % ceny referencyjnej usługi × ilość × trudność × zakres. */
export function subPrice(sub: Subcontractor, serviceId: string, units: number, complexity: 'standard' | 'trudne', scopeBps: number): Grosze {
  const def = SERVICE_BY_ID.get(serviceId)!;
  const raw = mulBps(mulBps(mulBps(def.referencePerUnit * units, sub.priceBps), COMPLEXITY_HOURS_BPS[complexity]), scopeBps);
  return Math.max(zl(10), roundDiv(raw, zl(10)) * zl(10));
}

/** Reputacja podwykonawcy z historii kontraktów gracza: liczba, średnia jakość, terminowość. */
export function subHistory(s: GameState, subId: string): { contracts: number; avgQuality: number | null; onTimeBps: number | null; defects: number } {
  const done = s.ops.subcontracts.filter((c) => c.subId === subId && c.status === 'settled');
  const q = done.filter((c) => c.qualityScore !== null);
  return {
    contracts: done.length,
    avgQuality: q.length ? Math.round(q.reduce((a, c) => a + c.qualityScore!, 0) / q.length) : null,
    onTimeBps: done.length ? roundDiv(done.filter((c) => c.delayDays === 0).length * 10_000, done.length) : null,
    defects: done.filter((c) => c.defects).length,
  };
}

export function requestSubOffer(s: GameState, subId: string, jobId: string, scopeBps: number): string {
  const b = requireActiveBusiness(s);
  void b;
  const sub = subById(s, subId);
  const job = s.reno.jobs.find((j) => j.id === jobId);
  if (!sub) throw new CommandError('Nieznany podwykonawca.');
  if (!job || job.stage === 'done' || job.stage === 'cancelled') throw new CommandError('Ten kontrakt nie wymaga podwykonawcy.');
  if (!sub.services.includes(job.serviceId)) throw new CommandError(`${sub.name} nie wykonuje tej usługi.`);
  if (!Number.isInteger(scopeBps) || scopeBps < 1_000 || scopeBps > 10_000 || scopeBps % 500 !== 0) throw new CommandError('Zakres zlecenia: od 10% do 100% pracy (co 5%).');
  if (s.ops.subcontracts.some((c) => c.jobId === jobId && c.subId === subId && ['offered', ...ACTIVE_SUB].includes(c.status))) throw new CommandError('Ten podwykonawca ma już ofertę lub umowę przy tym kontrakcie.');
  const used = s.ops.subcontracts.filter((c) => c.jobId === jobId && ACTIVE_SUB.includes(c.status)).reduce((a, c) => a + c.scopeBps, 0);
  if (used + scopeBps > 10_000) throw new CommandError('Podwykonawcom zlecono już cały zakres pracy tego kontraktu.');
  const today = s.clock.today;
  const required = roundDiv(job.normCenti * scopeBps, 10_000);
  const plannedDays = Math.max(1, Math.ceil(required / subDailyCenti(sub)));
  const from = job.startDate > addDays(today, 1) ? job.startDate : addDays(today, 1);
  const startDate = firstFree(s, 'sub', subId, from, plannedDays + 3);
  const price = subPrice(sub, job.serviceId, job.units, job.complexity, scopeBps);
  const advanceBps = clamp(Math.round(((10_000 - sub.reliabilityBps) * 0.6) / 500) * 500, 0, 3_000);
  const n = nextCounter(s, 'sub:contract');
  s.ops.subcontracts.push({
    id: `subc:${n}`, subId, jobId, serviceId: job.serviceId, scopeBps, priceNet: price, advanceBps, advanceNet: roundDiv(price * advanceBps, 10_000), prepaid: 0, advanceObligationId: null,
    offeredOn: today, expiresOn: addDays(today, 5), startDate, plannedDays, status: 'offered', requiredCenti: required, performedCenti: 0, delayDays: 0, delayFrom: null,
    defects: false, qualityScore: null, deliveredOn: null, settledOn: null, settlementDocId: null, settledNet: 0,
  });
  return `Oferta: ${formatPLN(price)} netto za ${scopeBps / 100}% zakresu, start ${formatDatePL(startDate)}, ok. ${plannedDays} dni pracy${advanceBps ? `, zaliczka ${advanceBps / 100}%` : ''}. Oferta ważna do ${formatDatePL(addDays(today, 5))}.`;
}

export function acceptSubOffer(s: GameState, subcontractId: string): string {
  const b = requireActiveBusiness(s);
  const c = s.ops.subcontracts.find((x) => x.id === subcontractId);
  if (!c || c.status !== 'offered') throw new CommandError('Ta oferta nie jest już dostępna.');
  const today = s.clock.today;
  if (today > c.expiresOn) throw new CommandError('Oferta wygasła.');
  const job = s.reno.jobs.find((j) => j.id === c.jobId);
  if (!job || job.stage === 'done' || job.stage === 'cancelled') throw new CommandError('Kontrakt jest już zakończony.');
  const sub = subById(s, c.subId)!;
  const start = c.startDate > today ? c.startDate : addDays(today, 1);
  const to = addDays(start, c.plannedDays + 6);
  const hit = resourceBusy(s, 'sub', c.subId, start, to);
  if (hit) throw new CommandError(`${sub.name} jest już zajęty w tym terminie — poproś o nową ofertę.`);
  if (c.advanceNet > 0) requireCash(s, b, c.advanceNet, false);
  ensureParty(s, { id: subParty(sub.id), name: sub.name, role: 'service' });
  c.status = 'accepted';
  c.startDate = start;
  reserve(s, job.id, 'sub', sub.id, start, to);
  const rng = createRng(s.seed, `sub:delay:${c.id}`);
  if (rng.int(0, 9_999) >= sub.reliabilityBps) { c.delayDays = rng.int(2, 7); c.delayFrom = start; }
  const q = clamp(sub.quality + createRng(s.seed, `sub:quality:${c.id}`).int(-6, 6), 10, 100);
  c.qualityScore = q;
  c.defects = createRng(s.seed, `sub:defects:${c.id}`).int(0, 9_999) < clamp((70 - q) * 110, 0, 6_000);
  if (c.advanceNet > 0) {
    const ob = createObligation(s, {
      occurrenceId: `subc:${c.id}:advance`, ruleId: `subc:${c.id}`, direction: 'payable', counterpartyId: subParty(sub.id), accountId: b.accountId, amount: c.advanceNet,
      issueDate: today, dueDate: addDays(today, 2), category: 'zaliczka_podwykonawcy', description: `Zaliczka dla podwykonawcy: ${sub.name}`,
    });
    c.advanceObligationId = ob?.id ?? null;
    c.prepaid = c.advanceNet;
  }
  logEvent(s, { id: `sub.contract:${c.id}:accepted`, date: today, type: 'sub.contract', tone: 'neutral', title: `Umowa z podwykonawcą: ${sub.name}`, detail: `${formatPLN(c.priceNet)} netto · start ${formatDatePL(start)}${c.advanceNet ? ` · zaliczka ${formatPLN(c.advanceNet)} (przedpłata, nie koszt)` : ''}`, amount: null, category: null });
  return `Umowa zawarta. ${sub.name} zacznie pracę ${formatDatePL(start)}${start > job.startDate ? ` — po starcie kontraktu (${formatDatePL(job.startDate)}), do tego czasu praca stoi` : ''}${c.advanceNet ? `; zaliczka ${formatPLN(c.advanceNet)} zostanie zapłacona w ciągu 2 dni` : ''}.`;
}

export function declineSubOffer(s: GameState, subcontractId: string): string {
  const c = s.ops.subcontracts.find((x) => x.id === subcontractId);
  if (!c || c.status !== 'offered') throw new CommandError('Ta oferta nie jest już dostępna.');
  c.status = 'declined';
  return 'Oferta odrzucona.';
}

/** Wypowiedzenie przed rozpoczęciem pracy: zaliczka wraca jako należność (zwrot), przydział zasobu znika. */
export function cancelSubcontract(s: GameState, subcontractId: string): string {
  const b = requireActiveBusiness(s);
  const c = s.ops.subcontracts.find((x) => x.id === subcontractId);
  if (!c || c.status !== 'accepted') throw new CommandError('Można odstąpić tylko od umowy, która jeszcze się nie rozpoczęła.');
  if (s.clock.today >= c.startDate) throw new CommandError('Praca podwykonawcy już się rozpoczęła — odbierz ją i rozlicz.');
  const sub = subById(s, c.subId)!;
  if (c.prepaid > 0) {
    createObligation(s, {
      occurrenceId: `subc:${c.id}:refund`, ruleId: `subc:${c.id}`, direction: 'receivable', counterpartyId: subParty(sub.id), accountId: b.accountId, amount: c.prepaid,
      issueDate: s.clock.today, dueDate: addDays(s.clock.today, 7), category: 'zwrot_zaliczki', description: `Zwrot zaliczki od podwykonawcy: ${sub.name}`,
    });
    c.prepaid = 0;
  }
  c.status = 'cancelled';
  s.ops.assignments = s.ops.assignments.filter((a) => !(a.kind === 'sub' && a.jobId === c.jobId && a.resourceId === c.subId));
  return 'Odstąpiono od umowy z podwykonawcą. Zaliczka wróci do firmy w ciągu 7 dni.';
}

/** Odbiór pracy i rozliczenie: dokument kosztowy na pełną (lub proporcjonalną) cenę, zapłata reszty ponad zaliczkę. */
export function settleSubcontract(s: GameState, b: Operator, c: Subcontract, job: RenoJob, date: IsoDate, auto: boolean): void {
  if (c.status === 'settled' || c.status === 'cancelled' || c.status === 'declined' || c.status === 'expired' || c.status === 'offered') return;
  const sub = subById(s, c.subId)!;
  const complete = c.performedCenti >= c.requiredCenti;
  const owed = complete ? c.priceNet : roundDiv(c.priceNet * c.performedCenti, c.requiredCenti);
  if (owed > 0) {
    const cash = owed - c.prepaid;
    const doc = issueDocument(s, b, {
      kind: 'cost', issueDate: date, counterpartyId: subParty(sub.id), orderId: job.orderId, description: `Podwykonawca ${sub.name}: ${SERVICE_BY_ID.get(c.serviceId)!.label}${complete ? '' : ' (zakres częściowy)'}`,
      net: owed, termDays: 7, supplierVat: 'none', cashNet: Math.max(0, cash),
    });
    c.settlementDocId = doc.id;
    if (cash < 0) {
      createObligation(s, {
        occurrenceId: `subc:${c.id}:surplus`, ruleId: `subc:${c.id}`, direction: 'receivable', counterpartyId: subParty(sub.id), accountId: b.accountId, amount: -cash,
        issueDate: date, dueDate: addDays(date, 7), category: 'zwrot_zaliczki', description: `Zwrot nadpłaconej zaliczki: ${sub.name}`,
      });
    }
  } else if (c.prepaid > 0) {
    createObligation(s, {
      occurrenceId: `subc:${c.id}:surplus`, ruleId: `subc:${c.id}`, direction: 'receivable', counterpartyId: subParty(sub.id), accountId: b.accountId, amount: c.prepaid,
      issueDate: date, dueDate: addDays(date, 7), category: 'zwrot_zaliczki', description: `Zwrot zaliczki od podwykonawcy: ${sub.name}`,
    });
  }
  job.actual.subcontract += owed;
  c.prepaid = 0;
  c.settledNet = owed;
  c.settledOn = date;
  c.status = 'settled';
  s.ops.assignments = s.ops.assignments.filter((a) => !(a.kind === 'sub' && a.jobId === c.jobId && a.resourceId === c.subId));
  logEvent(s, { id: `sub.contract:${c.id}:settled`, date, type: 'sub.contract', tone: c.defects ? 'warning' : 'positive', title: `${auto ? 'Automatyczny odbiór' : 'Odbiór'} pracy podwykonawcy: ${sub.name}`, detail: `Rozliczono ${formatPLN(owed)} netto · jakość ${c.qualityScore ?? '?'}/100${c.defects ? ' · stwierdzono wady (większe ryzyko reklamacji)' : ''}${c.delayDays ? ` · opóźnienie ${c.delayDays} dn.` : ''}`, amount: -owed, category: 'koszt_dzialalnosci' });
}

export function acceptSubWork(s: GameState, subcontractId: string): string {
  const b = requireActiveBusiness(s);
  const c = s.ops.subcontracts.find((x) => x.id === subcontractId);
  if (!c || c.status !== 'delivered') throw new CommandError('Ta praca nie została jeszcze zgłoszona do odbioru.');
  const job = s.reno.jobs.find((j) => j.id === c.jobId)!;
  settleSubcontract(s, b, c, job, s.clock.today, false);
  return `Praca odebrana i rozliczona: ${formatPLN(c.settledNet)} netto.`;
}

/** Przy zakończeniu kontraktu rozlicza wszystkich jego podwykonawców (zakres częściowy proporcjonalnie). */
export function settleJobSubcontracts(s: GameState, b: Operator, job: RenoJob, date: IsoDate): void {
  for (const c of s.ops.subcontracts.filter((x) => x.jobId === job.id)) {
    if (c.status === 'offered') { c.status = 'expired'; continue; }
    if (ACTIVE_SUB.includes(c.status)) {
      if ((c.status === 'accepted' || c.status === 'in_progress') && c.performedCenti === 0) {
        // praca się nie zaczęła (kontrakt skończył się bez udziału podwykonawcy) — umowa wygasa, zaliczka wraca
        c.status = 'cancelled';
        const sub = subById(s, c.subId)!;
        if (c.prepaid > 0) createObligation(s, { occurrenceId: `subc:${c.id}:refund`, ruleId: `subc:${c.id}`, direction: 'receivable', counterpartyId: subParty(sub.id), accountId: b.accountId, amount: c.prepaid, issueDate: date, dueDate: addDays(date, 7), category: 'zwrot_zaliczki', description: `Zwrot zaliczki od podwykonawcy: ${sub.name}` });
        c.prepaid = 0;
        s.ops.assignments = s.ops.assignments.filter((a) => !(a.kind === 'sub' && a.jobId === c.jobId && a.resourceId === c.subId));
        continue;
      }
      settleSubcontract(s, b, c, job, date, true);
    }
  }
  releaseJob(s, job.id, ['sub']);
}

/** Dzień: wygasanie ofert, start pracy (z ewentualnym opóźnieniem). */
export function processSubcontracts(s: GameState, date: IsoDate): void {
  for (const c of s.ops.subcontracts) {
    if (c.status === 'offered' && date > c.expiresOn) c.status = 'expired';
    if (c.status === 'accepted' && date >= addDays(c.startDate, c.delayDays)) {
      c.status = 'in_progress';
      const sub = subById(s, c.subId)!;
      if (c.delayDays > 0) logEvent(s, { id: `sub.contract:${c.id}:delay`, date, type: 'sub.contract', tone: 'warning', title: `Opóźnienie podwykonawcy: ${sub.name}`, detail: `Rozpoczął pracę ${c.delayDays} dn. po terminie — to ryzyko współpracy z mniej niezawodnymi firmami.`, amount: null, category: null });
    }
  }
}

export const isWorkdayDate = (date: IsoDate): boolean => weekdayIndex(date) < 5;
