import { NET_ESTIMATE_BPS } from './config.ts';
import { PROFILE_BY_ID } from './businessCatalog.ts';
import type { BusinessProfile } from './businessCatalog.ts';
import { CommandError, createObligation, ensureParty, logEvent, nextCounter, partyName } from './core.ts';
import { currentEmployment, employmentContracts } from './contracts.ts';
import { addDays, addMonths, daysInMonth, dateInMonth, firstOfNextMonth, formatDatePL, isValidIsoDate, monthKey, monthKeyToYm, parseIso, addMonthsToKey } from './date.ts';
import type { IsoDate } from './date.ts';
import { RULES_2026 as R, carriedForward } from './legal.ts';
import { formatPLN, mulBps, roundDiv, zl } from './money.ts';
import type { Grosze } from './money.ts';
import { createRng } from './rng.ts';
import { periodLabel } from './core.ts';
import type { Business, BusinessDocument, GameState, ServiceOffer, ServiceOrder, TaxForm, TaxPeriod, ZusStart } from './state.ts';
import { healthFromIncome, healthRyczalt, monthsBetween, pitCumulative, socialForRegime, vatExemptionLimit, vatOf, zusRegimeFor } from './tax.ts';
import type { ZusRegime } from './tax.ts';
import { firstOverload, performanceBps } from './time.ts';

/** Najwcześniejszy start JDG: kwoty składki zdrowotnej ryczałtowców za styczeń 2026 nie zostały zweryfikowane. */
export const MIN_BUSINESS_START = '2026-02-01';
const SOCIAL = 'zus_spoleczne';
const HEALTH = 'zus_zdrowotna';
export const US_PARTY = 'party:us';
export const ZUS_PARTY = 'party:zus';

export const BUSINESS_CATEGORIES = {
  revenue: 'przychod_dzialalnosci',
  cost: 'koszt_dzialalnosci',
  pit: 'pit_zaliczka',
  pitAnnual: 'pit_roczny',
  pitRefund: 'pit_zwrot',
  vatDue: 'vat_nalezny',
  vatInput: 'vat_naliczony',
  vatFromClient: 'vat_od_klienta',
  vatToSupplier: 'vat_do_dostawcy',
  social: SOCIAL,
  health: HEALTH,
} as const;

/** Kategorie VAT (przepływ przelotowy) — nie są przychodem ani kosztem działalności w podsumowaniach firmy. */
export const VAT_PASS_THROUGH: ReadonlySet<string> = new Set(['vat_nalezny', 'vat_naliczony', 'vat_od_klienta', 'vat_do_dostawcy']);

/* ---------- Zapytania ---------- */

export function activeBusiness(s: GameState): Business | null {
  return s.businesses.find((b) => b.status === 'active') ?? null;
}

export function profileOf(b: Business): BusinessProfile {
  const p = PROFILE_BY_ID.get(b.profileId);
  if (!p) throw new Error(`Nieznany profil działalności ${b.profileId}`);
  return p;
}

const inMonth = (d: BusinessDocument, mk: string) => d.issueDate.startsWith(mk);
const inYearUpTo = (d: BusinessDocument, year: number, upTo: IsoDate) => d.issueDate.startsWith(`${year}-`) && d.issueDate <= upTo;

export function docsOf(s: GameState, b: Business, kind: 'sales' | 'cost'): BusinessDocument[] {
  return s.documents.filter((d) => d.businessId === b.id && d.kind === kind);
}

function paidContributions(s: GameState, category: string, year: number, upTo: IsoDate): Grosze {
  let sum = 0;
  for (const o of s.obligations) {
    if (o.scope === 'business' && o.category === category && o.status === 'settled' && o.settledDate && o.settledDate.startsWith(`${year}-`) && o.settledDate <= upTo) sum += o.amount;
  }
  return sum;
}

function hasEmploymentInYear(s: GameState, year: number): boolean {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return employmentContracts(s).some((c) => c.startDate <= to && (c.endDate === null || c.endDate >= from));
}

/** Brutto z etatu (dla zapisów v1 bez brutto — szacunek odwrotny do netto 73%). */
function employmentGross(s: GameState, date: IsoDate): Grosze {
  const c = currentEmployment(s, date);
  if (!c) return 0;
  return c.grossMonthly ?? roundDiv(c.monthlyAmount * 10_000, NET_ESTIMATE_BPS);
}

/** Czy można skorzystać z ulgi na start i składek preferencyjnych (brak działalności w ostatnich 60 miesiącach). */
export function zusReliefEligible(s: GameState, startDate: IsoDate): boolean {
  const horizon = addMonths(startDate, -60);
  return !s.businesses.some((b) => b.status === 'active' || (b.closeOn !== null && b.closeOn > horizon));
}

/* ---------- Dokumenty ---------- */

function dueNextMonth(date: IsoDate, day: number): IsoDate {
  const { year, month } = monthKeyToYm(addMonthsToKey(monthKey(date), 1));
  return dateInMonth(year, month, day);
}

/** Opóźnienie zapłaty kontrahenta ponad termin umowny — deterministyczne (seed + dokument). */
export function paymentDelayDays(seed: string, docId: string): number {
  const rng = createRng(seed, `pay-delay:${docId}`);
  const r = rng.int(0, 99);
  if (r < 55) return 0;
  if (r < 85) return rng.int(1, 14);
  return rng.int(15, 35);
}

interface DocInput {
  kind: 'sales' | 'cost';
  issueDate: IsoDate;
  counterpartyId: string;
  orderId: string | null;
  description: string;
  net: Grosze;
  termDays: number;
}

/** Wystawia rekord sprzedaży/kosztu i księguje go przez wspólny silnik zobowiązań (rachunek firmowy). */
export function issueDocument(s: GameState, b: Business, input: DocInput): BusinessDocument {
  const year = parseIso(input.issueDate).year;
  if (input.kind === 'sales' && b.vat.status === 'exempt') {
    const ytd = docsOf(s, b, 'sales').filter((d) => d.issueDate.startsWith(`${year}-`)).reduce((a, d) => a + d.net, 0);
    if (ytd + input.net > vatExemptionLimit(b.startDate, year)) {
      b.vat = { status: 'active', activeFrom: input.issueDate, limitExceededOn: input.issueDate };
      logEvent(s, {
        id: `business.vat:${b.id}:${input.issueDate}`, date: input.issueDate, type: 'business.vat', tone: 'warning',
        title: 'Utrata zwolnienia z VAT — przekroczono limit sprzedaży', detail: `Od tej sprzedaży jesteś czynnym podatnikiem VAT (limit ${formatPLN(vatExemptionLimit(b.startDate, year), { round: true })})`, amount: null, category: null,
      });
    }
  }
  const taxed = b.vat.status === 'active';
  const vat = taxed ? vatOf(input.net, R.vat.rateBps) : 0;
  const gross = input.net + vat;
  const ym = monthKey(input.issueDate).replace('-', '/');
  const prefix = input.kind === 'sales' ? 'FS' : 'FK';
  const seq = nextCounter(s, `doc:${input.kind}:${monthKey(input.issueDate)}`);
  const number = `${prefix}/${ym}/${String(seq).padStart(3, '0')}`;
  const id = `doc:${b.id}:${input.kind}:${monthKey(input.issueDate)}:${seq}`;
  const termDate = addDays(input.issueDate, input.termDays);
  const doc: BusinessDocument = {
    id, businessId: b.id, kind: input.kind, number, issueDate: input.issueDate, saleDate: input.issueDate,
    counterpartyId: input.counterpartyId, orderId: input.orderId, description: input.description,
    net: input.net, vatRateBps: taxed ? R.vat.rateBps : 0, vat, gross, vatTreatment: taxed ? 'taxed' : 'exempt', termDate,
    obligationIds: [], taxAmount: input.kind === 'sales' ? input.net : taxed ? input.net : gross,
  };
  const base = { ruleId: `doc:${id}`, issueDate: input.issueDate, accountId: b.accountId, scope: 'business' as const };
  const vatDue = dueNextMonth(input.issueDate, R.vat.dueDay);
  const make = (suffix: string, o: { direction: 'receivable' | 'payable'; counterpartyId: string; amount: Grosze; dueDate: IsoDate; category: string; description: string }) => {
    const ob = createObligation(s, { ...base, ...o, occurrenceId: `${id}:${suffix}` });
    if (ob) doc.obligationIds.push(ob.id);
  };
  if (input.kind === 'sales') {
    const due = addDays(termDate, paymentDelayDays(s.seed, id));
    make('net', { direction: 'receivable', counterpartyId: input.counterpartyId, amount: input.net, dueDate: due, category: BUSINESS_CATEGORIES.revenue, description: `${number}: ${input.description}` });
    if (taxed) {
      make('vat-client', { direction: 'receivable', counterpartyId: input.counterpartyId, amount: vat, dueDate: due, category: BUSINESS_CATEGORIES.vatFromClient, description: `${number}: VAT od kontrahenta` });
      make('vat-due', { direction: 'payable', counterpartyId: US_PARTY, amount: vat, dueDate: vatDue, category: BUSINESS_CATEGORIES.vatDue, description: `VAT należny z ${number}` });
    }
  } else if (taxed) {
    make('net', { direction: 'payable', counterpartyId: input.counterpartyId, amount: input.net, dueDate: termDate, category: BUSINESS_CATEGORIES.cost, description: `${number}: ${input.description}` });
    make('vat-supplier', { direction: 'payable', counterpartyId: input.counterpartyId, amount: vat, dueDate: termDate, category: BUSINESS_CATEGORIES.vatToSupplier, description: `${number}: VAT dla dostawcy` });
    make('vat-input', { direction: 'receivable', counterpartyId: US_PARTY, amount: vat, dueDate: vatDue, category: BUSINESS_CATEGORIES.vatInput, description: `VAT naliczony z ${number}` });
  } else {
    make('gross', { direction: 'payable', counterpartyId: input.counterpartyId, amount: gross, dueDate: termDate, category: BUSINESS_CATEGORIES.cost, description: `${number}: ${input.description}` });
  }
  s.documents.push(doc);
  logEvent(s, {
    id: `business.document:${id}`, date: input.issueDate, type: 'business.document', tone: 'neutral',
    title: `${input.kind === 'sales' ? 'Sprzedaż' : 'Koszt'} ${number}: ${input.description}`,
    detail: `${partyName(s, input.counterpartyId)} · netto ${formatPLN(input.net)}${taxed ? ` · VAT ${formatPLN(vat)}` : ' · bez VAT (zwolnienie)'}`,
    amount: input.kind === 'sales' ? input.net : -input.net, category: input.kind === 'sales' ? BUSINESS_CATEGORIES.revenue : BUSINESS_CATEGORIES.cost,
  });
  return doc;
}

/* ---------- Rejestracja ---------- */

export interface RegisterInput {
  name: string;
  profileId: string;
  taxForm: TaxForm;
  vatStatus: 'exempt' | 'active';
  startDate: IsoDate;
  zusStart: ZusStart;
  sickness: boolean;
}

/** Dozwolone daty startu: 1. dni miesięcy po dzisiejszym dniu (nie wcześniej niż MIN_BUSINESS_START), do ~4 miesięcy w przód. */
export function allowedBusinessStarts(s: GameState): IsoDate[] {
  const out: IsoDate[] = [];
  let d = firstOfNextMonth(s.clock.today);
  for (let i = 0; i < 4; i++) {
    if (d >= MIN_BUSINESS_START) out.push(d);
    d = firstOfNextMonth(d);
  }
  return out;
}

export function validateRegistration(s: GameState, i: RegisterInput): string | null {
  if (activeBusiness(s)) return 'Prowadzisz już działalność (w v0.3 można prowadzić jedną JDG).';
  const name = i.name.trim();
  if (name.length < 2 || name.length > 60) return 'Nazwa działalności: od 2 do 60 znaków.';
  if (!PROFILE_BY_ID.has(i.profileId)) return 'Wybierz profil działalności.';
  if (!['skala', 'liniowy', 'ryczalt'].includes(i.taxForm)) return 'Wybierz formę opodatkowania.';
  if (!['exempt', 'active'].includes(i.vatStatus)) return 'Wybierz status VAT.';
  if (!isValidIsoDate(i.startDate) || !allowedBusinessStarts(s).includes(i.startDate)) return 'Działalność może rozpocząć się tylko 1. dnia jednego z najbliższych miesięcy (nie wcześniej niż luty 2026).';
  if ((i.zusStart === 'ulga' || i.zusStart === 'preferencyjny') && !zusReliefEligible(s, i.startDate)) {
    return 'Ulga na start i składki preferencyjne wymagają braku działalności w ostatnich 60 miesiącach.';
  }
  return null;
}

export function registerBusiness(s: GameState, i: RegisterInput): string {
  const error = validateRegistration(s, i);
  if (error) throw new CommandError(error);
  const profile = PROFILE_BY_ID.get(i.profileId)!;
  const n = nextCounter(s, 'business');
  const id = `biz:${n}`;
  const accountId = `acc:biz:${n}`;
  s.accounts[accountId] = { id: accountId, ownerId: s.person.id, name: `Rachunek firmowy — ${i.name.trim()}`, type: 'business', currency: 'PLN', balance: 0, interest: null };
  ensureParty(s, { id: ZUS_PARTY, name: 'ZUS', role: 'service' });
  ensureParty(s, { id: US_PARTY, name: 'Urząd Skarbowy', role: 'service' });
  const b: Business = {
    id, ownerId: s.person.id, name: i.name.trim(), profileId: i.profileId, pkd: profile.pkd, registeredOn: s.clock.today,
    startDate: i.startDate, closeOn: null, status: 'active', taxForm: i.taxForm,
    vat: { status: i.vatStatus, activeFrom: i.vatStatus === 'active' ? i.startDate : null, limitExceededOn: null },
    zus: { start: i.zusStart, sickness: i.sickness }, accountId,
  };
  s.businesses.push(b);
  logEvent(s, {
    id: `business.registered:${id}`, date: s.clock.today, type: 'business.registered', tone: 'positive',
    title: `Zarejestrowano działalność: ${b.name}`,
    detail: `${profile.label} (PKD ${profile.pkd}) · start ${formatDatePL(i.startDate)} · ${i.taxForm === 'skala' ? 'skala podatkowa' : i.taxForm === 'liniowy' ? 'podatek liniowy' : 'ryczałt'} · VAT: ${i.vatStatus === 'exempt' ? 'zwolnienie podmiotowe' : 'czynny podatnik'}`,
    amount: null, category: null,
  });
  return `Działalność „${b.name}” zarejestrowana. Rozpoczyna się ${formatDatePL(i.startDate)}. Rachunek firmowy: ${s.accounts[accountId]!.name}.`;
}

export interface RegistrationPreview {
  warnings: string[];
  zusPlan: { regime: ZusRegime | 'standard'; fromMonth: number; toMonth: number | null; social: Grosze }[];
  healthMin: Grosze;
  vatLimit: Grosze;
  ryczaltRateBps: number;
  reliefEligible: boolean;
  etatCoversSocial: boolean;
  ruleIds: string[];
}

export function previewRegistration(s: GameState, i: Pick<RegisterInput, 'profileId' | 'taxForm' | 'vatStatus' | 'startDate' | 'zusStart' | 'sickness'>): RegistrationPreview | null {
  const profile = PROFILE_BY_ID.get(i.profileId);
  if (!profile || !isValidIsoDate(i.startDate)) return null;
  const warnings: string[] = [];
  const eligible = zusReliefEligible(s, i.startDate);
  const covered = employmentGross(s, s.clock.today) >= R.minWage;
  const plan: RegistrationPreview['zusPlan'] = [];
  const reg = (idx: number) => zusRegimeFor(i.zusStart, idx);
  let from = 0;
  let cur = reg(0);
  for (let idx = 1; idx <= 36; idx++) {
    if (reg(idx) !== cur || idx === 36) {
      plan.push({ regime: cur, fromMonth: from + 1, toMonth: reg(idx) !== cur ? idx : null, social: socialForRegime(cur, i.sickness).total });
      from = idx;
      cur = reg(idx);
    }
  }
  if (i.taxForm === 'ryczalt') warnings.push(`Ryczałt: stawka ${profile.ryczaltRateBps / 100}% (${profile.ryczaltCategory}) to przypisanie do profilu — w rzeczywistości zależy od PKWiU usługi.`);
  if (i.taxForm === 'skala' && hasEmploymentInYear(s, parseIso(i.startDate).year)) warnings.push('Skala przy równoległym etacie: symulator nie łączy dochodów z etatu z JDG i nie stosuje kwoty zmniejszającej 3 600 zł do dochodu z JDG.');
  if (covered) warnings.push('Masz etat z wynagrodzeniem ≥ minimalnego: składek społecznych z JDG nie płacisz, ale składka zdrowotna z JDG jest wymagana.');
  else if (currentEmployment(s)) warnings.push('Etat poniżej minimalnego wynagrodzenia: składki społeczne z JDG są wymagane.');
  if (!eligible) warnings.push('Ulga na start i składki preferencyjne są niedostępne (działalność w ostatnich 60 miesiącach).');
  if (carriedForward(parseIso(i.startDate).year)) warnings.push('Przepisy zweryfikowano tylko dla 2026 r. — kolejne lata liczone według tych samych wartości (zasady mogą się zmienić).');
  return {
    warnings, zusPlan: plan, healthMin: R.healthMin, vatLimit: vatExemptionLimit(i.startDate, parseIso(i.startDate).year),
    ryczaltRateBps: profile.ryczaltRateBps, reliefEligible: eligible, etatCoversSocial: covered,
    ruleIds: ['REG-CEIDG', 'REG-PKD-2025', 'ZUS-ULGA-START', 'ZUS-PREF-ELIGIBILITY', 'ZUS-ZBIEG-ETAT', 'HEALTH-MIN-2026', 'VAT-LIMIT-2026', 'PIT-FORM-CHOICE'],
  };
}

export function closeBusiness(s: GameState): string {
  const b = activeBusiness(s);
  if (!b) throw new CommandError('Nie prowadzisz działalności.');
  if (b.closeOn !== null) throw new CommandError(`Działalność kończy się ${formatDatePL(b.closeOn)}.`);
  if (s.clock.today < b.startDate) throw new CommandError('Działalność jeszcze się nie rozpoczęła.');
  if (s.serviceOrders.some((o) => o.status === 'in_progress')) throw new CommandError('Najpierw zakończ trwające zlecenia.');
  const { year, month } = parseIso(s.clock.today);
  b.closeOn = dateInMonth(year, month, 'last');
  for (const o of s.serviceOffers) if (o.status === 'open') o.status = 'expired';
  return `Wniosek o zakończenie działalności złożony. Ostatni dzień działalności: ${formatDatePL(b.closeOn)}. Ostatnie zaliczki i składki zapłacisz do 20. dnia następnego miesiąca, zeznanie roczne rozliczy podatek.`;
}

/* ---------- Zlecenia ---------- */

export function acceptServiceOffer(s: GameState, offerId: string, hoursPerDay: number): string {
  const b = activeBusiness(s);
  const offer = s.serviceOffers.find((o) => o.id === offerId);
  if (!b) throw new CommandError('Nie prowadzisz działalności.');
  if (!offer || offer.status !== 'open') throw new CommandError('Ta oferta nie jest już dostępna.');
  const today = s.clock.today;
  if (today > offer.expiresOn) throw new CommandError('Oferta wygasła.');
  if (today < b.startDate) throw new CommandError('Działalność jeszcze się nie rozpoczęła.');
  if (b.closeOn !== null) throw new CommandError('Działalność jest w trakcie zamykania.');
  if (!Number.isInteger(hoursPerDay) || hoursPerDay < 1 || hoursPerDay > 8) throw new CommandError('Godziny dziennie: od 1 do 8.');
  // usługi dla (byłego) pracodawcy zagrażają ulgom i formom — blokada zamiast modelowania utraty praw
  const employers = new Set(employmentContracts(s).map((c) => c.partyId));
  if (employers.has(offer.clientId)) throw new CommandError('Nie można świadczyć usług dla obecnego lub byłego pracodawcy (utrata ulg ZUS i prawa do liniowego/ryczałtu).');
  const start = addDays(today, 1);
  const deadline = addDays(today, offer.deadlineDays);
  const nominalDays = Math.ceil(offer.hoursTotal / hoursPerDay);
  if (nominalDays > offer.deadlineDays - 1) throw new CommandError(`Przy ${hoursPerDay} godz. dziennie praca zajmie ok. ${nominalDays} dni — zbyt długo na termin ${offer.deadlineDays} dni. Zwiększ godziny dziennie.`);
  const clash = firstOverload(s, start, deadline, { extraHoursPerDay: hoursPerDay });
  if (clash) throw new CommandError(`Brak wolnych godzin: ${clash.date} brakuje ${clash.missing} godz. (etat, sen, obowiązki i inne zobowiązania zajmują dobę). Zmień plan dnia lub zmniejsz liczbę godzin.`);

  const n = nextCounter(s, 'order');
  const id = `order:${n}`;
  const commitmentId = `commit:${id}`;
  s.commitments.push({ id: commitmentId, label: `Zlecenie: ${offer.title}`, startDate: start, endDate: deadline, hoursPerDay, sourceEventId: null });
  const order: ServiceOrder = {
    id, offerId: offer.id, clientId: offer.clientId, title: offer.title, netValue: offer.netValue, hoursTotal: offer.hoursTotal, progressCentiHours: 0,
    hoursPerDay, costNet: offer.costNet, paymentTermDays: offer.paymentTermDays, latePenaltyBps: offer.latePenaltyBps, acceptedOn: today,
    startDate: start, deadline, status: 'in_progress', completedOn: null, salesDocumentId: null, commitmentId, late: false,
  };
  s.serviceOrders.push(order);
  offer.status = 'accepted';
  logEvent(s, {
    id: `business.order:${id}`, date: today, type: 'business.order', tone: 'neutral',
    title: `Przyjęto zlecenie: ${offer.title}`, detail: `${partyName(s, offer.clientId)} · ${formatPLN(offer.netValue)} netto · termin ${formatDatePL(deadline)} · ${hoursPerDay} godz./dzień`, amount: null, category: null,
  });
  if (offer.costNet > 0) {
    issueDocument(s, b, { kind: 'cost', issueDate: today, counterpartyId: 'party:supplier', orderId: id, description: `Koszty realizacji: ${offer.title}`, net: offer.costNet, termDays: 7 });
  }
  return `Zlecenie przyjęte. Praca od ${formatDatePL(start)} (${hoursPerDay} godz. dziennie), termin ${formatDatePL(deadline)}.`;
}

export function declineServiceOffer(s: GameState, offerId: string): string {
  const offer = s.serviceOffers.find((o) => o.id === offerId);
  if (!offer || offer.status !== 'open') throw new CommandError('Ta oferta nie jest już dostępna.');
  offer.status = 'declined';
  return 'Oferta odrzucona.';
}

const FAIL_AFTER_DEADLINE_DAYS = 30;

function progressOrders(s: GameState, b: Business, date: IsoDate): void {
  for (const o of s.serviceOrders) {
    if (o.status !== 'in_progress' || date < o.startDate) continue;
    const c = s.commitments.find((x) => x.id === o.commitmentId);
    o.progressCentiHours += roundDiv(o.hoursPerDay * 100 * performanceBps(s.life.fatigue), 10_000);
    if (o.progressCentiHours >= o.hoursTotal * 100) {
      const late = date > o.deadline;
      const penalty = late ? mulBps(o.netValue, o.latePenaltyBps) : 0;
      const net = Math.max(1, o.netValue - penalty);
      const doc = issueDocument(s, b, { kind: 'sales', issueDate: date, counterpartyId: o.clientId, orderId: o.id, description: o.title, net, termDays: o.paymentTermDays });
      o.status = 'completed';
      o.completedOn = date;
      o.salesDocumentId = doc.id;
      o.late = late;
      if (c) c.endDate = date;
      logEvent(s, {
        id: `business.order:${o.id}:done`, date, type: 'business.order', tone: late ? 'warning' : 'positive',
        title: `Zlecenie wykonane${late ? ' z opóźnieniem' : ''}: ${o.title}`,
        detail: `${late ? `Kara umowna ${formatPLN(penalty)} · ` : ''}wystawiono ${doc.number}, termin płatności ${formatDatePL(doc.termDate)}`, amount: null, category: null,
      });
    } else if (date > addDays(o.deadline, FAIL_AFTER_DEADLINE_DAYS)) {
      o.status = 'failed';
      o.completedOn = date;
      if (c) c.endDate = date;
      logEvent(s, {
        id: `business.order:${o.id}:failed`, date, type: 'business.order', tone: 'warning',
        title: `Zlecenie niewykonane: ${o.title}`, detail: 'Klient zrezygnował po przekroczeniu terminu o 30 dni — brak przychodu, poniesione koszty zostają', amount: null, category: null,
      });
    } else if (c && date >= c.endDate) {
      c.endDate = addDays(date, 1); // praca trwa po terminie — godziny nadal zajęte
    }
  }
}

function manageOffers(s: GameState, b: Business, date: IsoDate): void {
  for (const o of s.serviceOffers) if (o.status === 'open' && date > o.expiresOn) o.status = 'expired';
  const day = parseIso(date).day;
  if (b.closeOn !== null || (day !== 1 && day !== 16)) return;
  const id = `offer:${b.id}:${date}`;
  if (s.serviceOffers.some((o) => o.id === id)) return;
  if (s.serviceOffers.filter((o) => o.status === 'open').length >= 3) return;
  const rng = createRng(s.seed, id);
  if (rng.int(0, 99) >= 75) return;
  const profile = profileOf(b);
  const tpl = profile.templates[rng.int(0, profile.templates.length - 1)]!;
  const net = tpl.netMin + rng.int(0, Math.floor((tpl.netMax - tpl.netMin) / zl(50))) * zl(50);
  const cost = tpl.costMax > tpl.costMin ? tpl.costMin + rng.int(0, Math.floor((tpl.costMax - tpl.costMin) / zl(10))) * zl(10) : tpl.costMin;
  const clientId = `party:client:${tpl.id}`;
  ensureParty(s, { id: clientId, name: tpl.clientName, role: 'service' });
  ensureParty(s, { id: 'party:supplier', name: 'Dostawcy i podwykonawcy', role: 'service' });
  const offer: ServiceOffer = {
    id, templateId: tpl.id, clientId, title: tpl.title, description: tpl.description, netValue: net, hoursTotal: tpl.hours, costNet: cost,
    paymentTermDays: tpl.termDays, deadlineDays: tpl.deadlineDays, latePenaltyBps: tpl.latePenaltyBps, offeredOn: date, expiresOn: addDays(date, 14), status: 'open',
  };
  s.serviceOffers.push(offer);
}

/* ---------- Rozliczenia miesięczne i roczne ---------- */

function annualSettlement(s: GameState, b: Business, year: number, taxTotal: Grosze, advancesIssued: Grosze, date: IsoDate): void {
  const key = `biz:annual:${b.id}:${year}`;
  if (s.processed[key]) return;
  s.processed[key] = true;
  const diff = taxTotal - advancesIssued;
  const due = dateInMonth(year + 1, R.pit.annualDueMonthDay[0], R.pit.annualDueMonthDay[1]);
  if (diff > 0) {
    createObligation(s, {
      occurrenceId: `${key}:payable`, ruleId: `rule:pit-annual`, direction: 'payable', counterpartyId: US_PARTY, accountId: b.accountId, scope: 'business',
      amount: diff, issueDate: date, dueDate: due, category: BUSINESS_CATEGORIES.pitAnnual, description: `Rozliczenie roczne PIT za ${year}`,
    });
  } else if (diff < 0) {
    // nadpłata: zwrot (tryb demonstracyjny — termin 45 dni od terminu zeznania, niezweryfikowany)
    createObligation(s, {
      occurrenceId: `${key}:refund`, ruleId: `rule:pit-annual`, direction: 'receivable', counterpartyId: US_PARTY, accountId: b.accountId, scope: 'business',
      amount: -diff, issueDate: date, dueDate: addDays(due, 45), category: BUSINESS_CATEGORIES.pitRefund, description: `Zwrot nadpłaty PIT za ${year}`,
    });
  }
}

/** Zamknięcie miesiąca JDG: składki ZUS, składka zdrowotna, zaliczka PIT (+ rozliczenie roczne w grudniu/przy zakończeniu). */
function closeMonth(s: GameState, b: Business, date: IsoDate): void {
  const mk = monthKey(date);
  const key = `biz:month:${b.id}:${mk}`;
  if (s.processed[key]) return;
  s.processed[key] = true;
  const year = parseIso(date).year;
  const idx = monthsBetween(monthKey(b.startDate), mk);
  const profile = profileOf(b);
  const revenue = docsOf(s, b, 'sales').filter((d) => inMonth(d, mk)).reduce((a, d) => a + d.taxAmount, 0);
  const costs = docsOf(s, b, 'cost').filter((d) => inMonth(d, mk)).reduce((a, d) => a + d.taxAmount, 0);
  const ruleIds = new Set<string>(['ZUS-PAYMENT-DEADLINE', 'PIT-ADVANCE-DEADLINE', 'PIT-REVENUE-DATE']);

  // składki społeczne: zbieg z etatem, ulga na start, preferencje, standard
  const covered = employmentGross(s, date) >= R.minWage;
  const planned = zusRegimeFor(b.zus.start, idx);
  const regime: TaxPeriod['zusRegime'] = covered ? 'etat' : planned;
  const social = covered ? 0 : socialForRegime(planned, b.zus.sickness).total;
  ruleIds.add(covered ? 'ZUS-ZBIEG-ETAT' : planned === 'ulga' ? 'ZUS-ULGA-START' : planned === 'preferencyjny' ? 'ZUS-PREF-BASE-2026' : 'ZUS-BASE-STANDARD-2026');
  if (social > 0) ruleIds.add('ZUS-RATES-2026');

  // składka zdrowotna
  const cumRevenue = docsOf(s, b, 'sales').filter((d) => inYearUpTo(d, year, date)).reduce((a, d) => a + d.taxAmount, 0);
  const cumCosts = docsOf(s, b, 'cost').filter((d) => inYearUpTo(d, year, date)).reduce((a, d) => a + d.taxAmount, 0);
  let health: Grosze;
  let healthBasis: Grosze;
  if (b.taxForm === 'ryczalt') {
    health = healthRyczalt(cumRevenue);
    healthBasis = cumRevenue;
    ruleIds.add('HEALTH-RYCZALT-2026');
  } else {
    const prev = s.taxPeriods.find((p) => p.businessId === b.id && p.month === addMonthsToKey(mk, -1));
    healthBasis = prev ? prev.revenue - prev.costs - prev.social : 0;
    health = healthFromIncome(b.taxForm, healthBasis);
    ruleIds.add('HEALTH-RATES');
    ruleIds.add('HEALTH-MIN-2026');
  }

  // zaliczka PIT (metoda narastająca; odliczane tylko zapłacone składki)
  const socialPaid = paidContributions(s, SOCIAL, year, date);
  const healthPaid = paidContributions(s, HEALTH, year, date);
  const pit = pitCumulative({
    form: b.taxForm, revenue: cumRevenue, costs: cumCosts, socialPaid, healthPaid,
    applyReduction: b.taxForm === 'skala' && !hasEmploymentInYear(s, year), ryczaltRateBps: profile.ryczaltRateBps,
  });
  ruleIds.add(b.taxForm === 'skala' ? 'PIT-SCALE-2026' : b.taxForm === 'liniowy' ? 'PIT-LINEAR-2026' : 'PIT-RYCZALT-RATES-2026');
  if (b.taxForm === 'skala' && hasEmploymentInYear(s, year)) ruleIds.add('PIT-SKALA-WITH-EMPLOYMENT');
  const advancesIssued = s.taxPeriods.filter((p) => p.businessId === b.id && p.month.startsWith(`${year}-`)).reduce((a, p) => a + p.advance, 0);
  const dueAdvance = Math.max(0, pit.tax - advancesIssued);
  const skipped = dueAdvance > 0 && dueAdvance <= R.pit.advanceMinimum;
  const advance = skipped ? 0 : dueAdvance;
  if (skipped) ruleIds.add('PIT-ADVANCE-MIN-1000');

  const dueDate = dueNextMonth(date, R.zusDueDay);
  const pitDue = dueNextMonth(date, R.pit.advanceDueDay);
  const base = { ruleId: `biz:${mk}`, direction: 'payable' as const, accountId: b.accountId, scope: 'business' as const, issueDate: date };
  if (social > 0) createObligation(s, { ...base, occurrenceId: `${key}:social`, counterpartyId: ZUS_PARTY, amount: social, dueDate, category: SOCIAL, description: periodLabel('Składki społeczne ZUS', date) });
  createObligation(s, { ...base, occurrenceId: `${key}:health`, counterpartyId: ZUS_PARTY, amount: health, dueDate, category: HEALTH, description: periodLabel('Składka zdrowotna', date) });
  if (advance > 0) createObligation(s, { ...base, occurrenceId: `${key}:pit`, counterpartyId: US_PARTY, amount: advance, dueDate: pitDue, category: BUSINESS_CATEGORIES.pit, description: periodLabel('Zaliczka PIT', date) });

  s.taxPeriods.push({
    businessId: b.id, month: mk, revenue, costs, zusRegime: regime, social, health, healthBasis, cumulativeRevenue: cumRevenue, cumulativeCosts: cumCosts,
    taxBase: pit.base, taxCumulative: pit.tax, advance, advanceSkipped: skipped, ruleIds: [...ruleIds].sort(), carriedForward: carriedForward(year),
  });
  logEvent(s, {
    id: `business.tax:${b.id}:${mk}`, date, type: 'business.tax', tone: 'neutral',
    title: `Rozliczenie miesiąca ${mk}: ZUS ${formatPLN(social + health)}${advance > 0 ? `, PIT ${formatPLN(advance)}` : ''}`,
    detail: `Składki do ${formatDatePL(dueDate)}${advance > 0 ? `, zaliczka do ${formatDatePL(pitDue)}` : ''}${skipped ? ' · zaliczka ≤ 1 000 zł — niewpłacana' : ''}`, amount: null, category: null,
  });

  if (parseIso(date).month === 12 || b.closeOn === date) annualSettlement(s, b, year, pit.tax, advancesIssued + advance, date);
  if (b.closeOn === date) {
    b.status = 'closed';
    logEvent(s, { id: `business.closed:${b.id}`, date, type: 'business.closed', tone: 'neutral', title: `Zakończono działalność: ${b.name}`, detail: 'Pozostałe zobowiązania i należności rozliczą się w terminach', amount: null, category: null });
  }
}

/** Na początku roku: utrata zwolnienia z VAT, gdy sprzedaż z poprzedniego roku przekroczyła limit. */
function reviewVatForNewYear(s: GameState, b: Business, date: IsoDate): void {
  if (b.vat.status !== 'exempt') return;
  const year = parseIso(date).year;
  if (parseIso(b.startDate).year >= year) return;
  const prev = docsOf(s, b, 'sales').filter((d) => d.issueDate.startsWith(`${year - 1}-`)).reduce((a, d) => a + d.net, 0);
  if (prev > vatExemptionLimit(b.startDate, year - 1)) {
    b.vat = { status: 'active', activeFrom: date, limitExceededOn: null };
    logEvent(s, { id: `business.vat:${b.id}:${date}`, date, type: 'business.vat', tone: 'warning', title: 'Utrata zwolnienia z VAT', detail: `Sprzedaż w ${year - 1} r. przekroczyła limit — od ${formatDatePL(date)} jesteś czynnym podatnikiem VAT`, amount: null, category: null });
  }
}

/** Dzienna obsługa JDG (wywoływana z `processDay`). Idempotentna dzięki kluczom w `processed`. */
export function processBusiness(s: GameState, date: IsoDate): void {
  for (const b of s.businesses) {
    if (b.status !== 'active' || date < b.startDate) continue;
    if (date.endsWith('-01-01')) reviewVatForNewYear(s, b, date);
    manageOffers(s, b, date);
    progressOrders(s, b, date);
    const { year, month, day } = parseIso(date);
    if (day === daysInMonth(year, month)) closeMonth(s, b, date);
  }
}

