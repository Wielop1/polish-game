import { z } from 'zod';
import { isValidIsoDate } from './date.ts';

export const IsoDateSchema = z.string().refine(isValidIsoDate, 'nieprawidłowa data (oczekiwano YYYY-MM-DD)');
export const GroszeSchema = z
  .number()
  .refine(Number.isSafeInteger, 'kwota musi być całkowitą liczbą groszy');
const PositiveGroszeSchema = GroszeSchema.refine((v) => v > 0, 'kwota musi być dodatnia');
const NonNegGroszeSchema = GroszeSchema.refine((v) => v >= 0, 'kwota nie może być ujemna');

export const SKILL_IDS = ['biuro', 'obsluga_klienta', 'sprzedaz', 'techniczne', 'angielski'] as const;
export const SkillIdSchema = z.enum(SKILL_IDS);
export const LifestyleSchema = z.enum(['oszczedny', 'standardowy', 'komfortowy']);
export const HousingStandardSchema = z.enum(['podstawowy', 'dobry', 'wysoki']);
export const EmploymentFormSchema = z.enum(['umowa_o_prace', 'umowa_zlecenie', 'umowa_o_dzielo', 'b2b']);
const IdSchema = z.string().min(1).max(200);

/* ---------- Encje ---------- */

export const PersonSchema = z.object({
  id: IdSchema,
  firstName: z.string().min(1).max(40),
  lastName: z.string().min(1).max(40),
  birthDate: IsoDateSchema,
  cityId: IdSchema,
});

/** Strona zewnętrzna (pracodawca, wynajmujący, dostawca). W v0.1 zawsze wypłacalna i bierna. */
export const PartySchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  role: z.enum(['employer', 'landlord', 'utility', 'retail', 'service']),
});

export const DataStatusSchema = z.enum(['placeholder', 'verified']);

/** Zasady oprocentowania rachunku oszczędnościowego (konfigurowalne, oznaczone statusem danych). */
export const AccountInterestSchema = z.object({
  /** Oprocentowanie nominalne w skali roku, w punktach bazowych (350 = 3,50%). */
  rateBps: z.number().int().min(0).max(100_000),
  /** Podatek od odsetek w pkt bazowych (0 = brak). Parametr przykładowy, nie fakt prawny. */
  taxBps: z.number().int().min(0).max(10_000),
  /** Suma sald dziennych (grosze·dni) od ostatniej kapitalizacji. */
  accumulator: z.number().int().min(0).refine(Number.isSafeInteger),
  lastAccrualDate: IsoDateSchema.nullable(),
  dataStatus: z.enum(['placeholder', 'verified']),
});

export const AccountSchema = z.object({
  id: IdSchema,
  ownerId: IdSchema,
  name: z.string().min(1).max(80),
  type: z.enum(['checking', 'savings', 'business', 'company']),
  currency: z.literal('PLN'),
  balance: GroszeSchema,
  interest: AccountInterestSchema.nullable(),
});

export const ContractSchema = z.discriminatedUnion('type', [
  z.object({
    id: IdSchema,
    type: z.literal('employment'),
    partyId: IdSchema,
    title: z.string().min(1).max(120),
    startDate: IsoDateSchema,
    /** Ostatni dzień obowiązywania (null = bezterminowa). Ustawiany przy wypowiedzeniu. */
    endDate: IsoDateSchema.nullable(),
    /** Wynagrodzenie NETTO miesięcznie — SZACUNEK (bez kalkulatora płac); to ta kwota jest naliczana. */
    monthlyAmount: PositiveGroszeSchema,
    /** Brutto z oferty; null dla umów z zapisów v1 (brak danych). */
    grossMonthly: PositiveGroszeSchema.nullable(),
    hoursPerMonth: z.number().int().min(1).max(400),
    employmentForm: EmploymentFormSchema,
    noticeMonths: z.number().int().min(0).max(3),
    location: z.string().min(1).max(120),
    jobOfferId: IdSchema.nullable(),
    terminatedBy: z.enum(['employee', 'employer']).nullable(),
    terminationNotifiedOn: IsoDateSchema.nullable(),
    dataStatus: DataStatusSchema,
  }),
  z.object({
    id: IdSchema,
    type: z.literal('lease'),
    partyId: IdSchema,
    title: z.string().min(1).max(120),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema.nullable(),
    /** Czynsz najmu miesięcznie. */
    monthlyAmount: PositiveGroszeSchema,
    /** Opłaty eksploatacyjne (media, administracja) miesięcznie. */
    utilitiesMonthly: NonNegGroszeSchema,
    /** Kaucja zwrotna — aktywo (patrz `assets`), nie koszt. */
    depositAmount: NonNegGroszeSchema,
    movingCost: NonNegGroszeSchema,
    areaM2: z.number().int().min(1).max(500).nullable(),
    standard: HousingStandardSchema.nullable(),
    district: z.string().max(80).nullable(),
    listingId: IdSchema.nullable(),
    noticeMonths: z.number().int().min(0).max(6),
    terminatedOn: IsoDateSchema.nullable(),
    dataStatus: DataStatusSchema,
  }),
]);

/* ---------- Reguły harmonogramu ---------- */

const DayOfMonthSchema = z.union([z.number().int().min(1).max(31), z.literal('last')]);

export const AmountSpecSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixed'), amount: PositiveGroszeSchema }),
  /** base ± spreadBps (losowane deterministycznie z seeda i identyfikatora wystąpienia). */
  z.object({
    type: z.literal('variable'),
    base: PositiveGroszeSchema,
    spreadBps: z.number().int().min(0).max(9_999),
  }),
  /** Kwota pobierana z umowy (jedno źródło prawdy); domyślnie `monthlyAmount`. */
  z.object({
    type: z.literal('contract'),
    contractId: IdSchema,
    field: z.enum(['monthlyAmount', 'utilitiesMonthly']).optional(),
  }),
  /** Wynagrodzenie z etatu liczone kalkulatorem płac (brutto → netto) w dniu naliczenia; tworzy odcinek płacowy. */
  z.object({ type: z.literal('payroll'), contractId: IdSchema }),
  /** Kwota zależna od aktualnego stylu życia gracza w dniu naliczenia. */
  z.object({
    type: z.literal('lifestyle'),
    levels: z.object({ oszczedny: PositiveGroszeSchema, standardowy: PositiveGroszeSchema, komfortowy: PositiveGroszeSchema }),
    spreadBps: z.number().int().min(0).max(9_999),
  }),
]);

export const ObligationRuleSchema = z.object({
  kind: z.literal('obligation'),
  id: IdSchema,
  /** receivable = należność gracza, payable = zobowiązanie gracza. */
  direction: z.enum(['receivable', 'payable']),
  counterpartyId: IdSchema,
  category: z.string().min(1),
  description: z.string().min(1).max(120),
  /** Dzień naliczenia w miesiącu. */
  issueDay: DayOfMonthSchema,
  /** Termin płatności: miesiące po miesiącu naliczenia + dzień miesiąca. */
  due: z.object({ monthOffset: z.number().int().min(0).max(12), day: DayOfMonthSchema }),
  amount: AmountSpecSchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema.nullable(),
  /** Umowa, do której należy reguła; jej zakończenie kończy regułę. */
  contractId: IdSchema.nullable(),
  dataStatus: DataStatusSchema,
});

export const BirthdayRuleSchema = z.object({
  kind: z.literal('birthday'),
  id: IdSchema,
  startDate: IsoDateSchema,
});

/** Miesięczna kapitalizacja odsetek od rachunku oszczędnościowego (ostatniego dnia miesiąca). */
export const SavingsInterestRuleSchema = z.object({
  kind: z.literal('savings_interest'),
  id: IdSchema,
  accountId: IdSchema,
  counterpartyId: IdSchema,
  startDate: IsoDateSchema,
});

export const RuleSchema = z.discriminatedUnion('kind', [ObligationRuleSchema, BirthdayRuleSchema, SavingsInterestRuleSchema]);

/* ---------- Rejestry ---------- */

export const LedgerEntrySchema = z.object({
  id: IdSchema,
  date: IsoDateSchema,
  accountId: IdSchema,
  /** Ze znakiem: dodatnia = wpływ, ujemna = wypływ. Nigdy 0. */
  amount: GroszeSchema.refine((v) => v !== 0, 'transakcja nie może mieć kwoty 0'),
  category: z.string().min(1),
  description: z.string().min(1).max(200),
  counterpartyId: IdSchema.nullable(),
  obligationId: IdSchema.nullable(),
  /** Para wpisów jednego przelewu między własnymi rachunkami (suma = 0). */
  transferId: IdSchema.nullable(),
  eventId: IdSchema,
});

export const ObligationSchema = z.object({
  id: IdSchema,
  direction: z.enum(['receivable', 'payable']),
  creditorId: IdSchema,
  debtorId: IdSchema,
  counterpartyId: IdSchema,
  /** Rachunek, z którego/na który ma nastąpić rozliczenie. */
  accountId: IdSchema,
  /** Ewidencja: prywatna, działalności gospodarczej (JDG) albo spółki z o.o. (odrębny podmiot prawny). */
  scope: z.enum(['personal', 'business', 'company']),
  amount: PositiveGroszeSchema,
  issueDate: IsoDateSchema,
  dueDate: IsoDateSchema,
  category: z.string().min(1),
  description: z.string().min(1).max(200),
  ruleId: IdSchema,
  occurrenceId: IdSchema,
  status: z.enum(['open', 'settled']),
  settledDate: IsoDateSchema.nullable(),
  settlementTxId: IdSchema.nullable(),
  /** Pierwszy dzień, w którym zobowiązanie po terminie nie zostało opłacone. */
  overdueSince: IsoDateSchema.nullable(),
});

export const EventTypeSchema = z.enum([
  'game.started',
  'life.birthday',
  'obligation.issued',
  'obligation.settled',
  'obligation.overdue',
  'job.application',
  'job.decision',
  'job.hired',
  'job.started',
  'job.ended',
  'job.resigned',
  'housing.lease_signed',
  'housing.move_in',
  'housing.lease_ended',
  'deposit.paid',
  'deposit.refunded',
  'lifestyle.changed',
  'time.plan_changed',
  'time.overload',
  'savings.transfer',
  'savings.interest',
  'life.event',
  'life.decision',
  'business.registered',
  'business.closed',
  'business.order',
  'business.document',
  'business.tax',
  'business.vat',
  'business.suspended',
  'business.resumed',
  'business.taxform',
  'business.zus',
  'tax.return',
  'tax.health',
  'tax.loss',
  'reno.enquiry',
  'market.start',
  'market.entry',
  'market.exit',
  'market.positioning',
  'reno.quote',
  'reno.contract',
  'reno.work',
  'reno.issue',
  'reno.review',
  'reno.complaint',
  'reno.stock',
  'accounting.notice',
  'accounting.contract',
  'hr.recruitment',
  'hr.employment',
  'hr.payroll',
  'sub.contract',
  'fleet.vehicle',
  'crew.assignment',
  'corp.company',
  'corp.shares',
  'corp.board',
  'corp.resolution',
  'corp.dividend',
  'corp.tax',
  'corp.negotiation',
  'corp.partner',
]);

export const GameEventSchema = z.object({
  id: IdSchema,
  date: IsoDateSchema,
  type: EventTypeSchema,
  tone: z.enum(['neutral', 'positive', 'negative', 'warning']),
  title: z.string().min(1).max(200),
  detail: z.string().max(300),
  /** Kwota powiązana ze zdarzeniem (ze znakiem z perspektywy gracza) lub null. */
  amount: GroszeSchema.nullable(),
  category: z.string().nullable(),
});

export const HistoryPointSchema = z.object({
  date: IsoDateSchema,
  /** Saldo rachunku bieżącego. */
  cash: GroszeSchema,
  /** Saldo rachunku oszczędnościowego. */
  savings: GroszeSchema,
  netWorth: GroszeSchema,
});

/* ---------- Aktywa, plan, kariera, wydarzenia ---------- */

/** Kaucja zwrotna: aktywo posiadane do czasu zwrotu (nie jest kosztem). */
export const AssetSchema = z.object({
  id: IdSchema,
  type: z.literal('deposit'),
  amount: PositiveGroszeSchema,
  partyId: IdSchema,
  contractId: IdSchema,
  status: z.enum(['held', 'refunded']),
  paidOn: IsoDateSchema,
  refundDueOn: IsoDateSchema.nullable(),
  refundedOn: IsoDateSchema.nullable(),
});

/** Akcje zaplanowane na konkretny dzień (jednorazowe), wykonywane idempotentnie przez silnik. */
export const PendingActionSchema = z.discriminatedUnion('type', [
  z.object({ id: IdSchema, date: IsoDateSchema, type: z.literal('application.decision'), applicationId: IdSchema }),
  z.object({ id: IdSchema, date: IsoDateSchema, type: z.literal('application.offer_expiry'), applicationId: IdSchema }),
  z.object({ id: IdSchema, date: IsoDateSchema, type: z.literal('contract.milestone'), contractId: IdSchema, milestone: z.enum(['start', 'end']) }),
  z.object({ id: IdSchema, date: IsoDateSchema, type: z.literal('housing.move_in'), contractId: IdSchema }),
  z.object({ id: IdSchema, date: IsoDateSchema, type: z.literal('deposit.refund'), assetId: IdSchema }),
  z.object({ id: IdSchema, date: IsoDateSchema, type: z.literal('event.expire'), eventId: IdSchema }),
  /** Naliczenie zobowiązania/należności w przyszłym dniu (np. koszt przeprowadzki, wypłata za zlecenie). */
  z.object({
    id: IdSchema,
    date: IsoDateSchema,
    type: z.literal('obligation.issue'),
    obligation: z.object({
      occurrenceId: IdSchema,
      ruleId: IdSchema,
      direction: z.enum(['receivable', 'payable']),
      counterpartyId: IdSchema,
      accountId: IdSchema,
      amount: PositiveGroszeSchema,
      dueDate: IsoDateSchema,
      category: z.string().min(1),
      description: z.string().min(1).max(200),
    }),
  }),
  z.object({ id: IdSchema, date: IsoDateSchema, type: z.literal('skill.gain'), skill: SkillIdSchema, levels: z.number().int().min(1).max(5), label: z.string().min(1).max(120) }),
]);

export const JobApplicationSchema = z.object({
  id: IdSchema,
  offerId: IdSchema,
  appliedOn: IsoDateSchema,
  status: z.enum(['pending', 'offered', 'rejected', 'accepted', 'declined', 'expired']),
  decisionOn: IsoDateSchema,
  /** Do kiedy obowiązuje propozycja pracodawcy (status `offered`). */
  offerExpiresOn: IsoDateSchema.nullable(),
  decidedOn: IsoDateSchema.nullable(),
  /** Data rozpoczęcia pracy po przyjęciu propozycji. */
  startDate: IsoDateSchema.nullable(),
  /** Szansa w pkt bazowych policzona w chwili aplikacji (diagnostyka; UI pokazuje opis jakościowy). */
  chanceBps: z.number().int().min(0).max(10_000),
});

export const LifeEventOptionSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  /** Opis konsekwencji widoczny przed wyborem (bez dokładnego wyniku losowego). */
  hint: z.string().max(300),
});

export const LifeEventSchema = z.object({
  id: IdSchema,
  templateId: IdSchema,
  date: IsoDateSchema,
  status: z.enum(['pending', 'resolved', 'expired']),
  title: z.string().min(1).max(160),
  body: z.string().max(600),
  options: z.array(LifeEventOptionSchema),
  defaultOptionId: IdSchema.nullable(),
  expiresOn: IsoDateSchema.nullable(),
  chosenOptionId: IdSchema.nullable(),
  resolvedOn: IsoDateSchema.nullable(),
  outcome: z.string().max(400).nullable(),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});

/** Czasowe zobowiązanie godzinowe (np. kurs, dorywcza praca) odejmowane od czasu wolnego. */
export const CommitmentSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  hoursPerDay: z.number().int().min(1).max(8),
  sourceEventId: IdSchema.nullable(),
});

export const LifeSchema = z.object({
  skills: z.record(z.string(), z.number().int().min(0).max(5)),
  /** Zmęczenie 0–100 (0 = wypoczęty). Ogranicza wydajność w pracy. */
  fatigue: z.number().int().min(0).max(100),
  /** Ostatni dzień, dla którego naliczono zmianę zmęczenia (idempotencja). */
  fatigueDate: IsoDateSchema.nullable(),
  timePlan: z.object({
    sleepHours: z.number().int().min(4).max(10),
    /** Godziny dziennie zarezerwowane na przyszłą działalność (v0.5+); na razie tylko zajmują czas. */
    businessHours: z.number().int().min(0).max(8),
  }),
  lifestyle: LifestyleSchema,
});

/* ---------- Działalność gospodarcza (JDG) — v0.3 ---------- */

export const TaxFormSchema = z.enum(['skala', 'liniowy', 'ryczalt']);
export const ZusStartSchema = z.enum(['ulga', 'preferencyjny', 'standard']);

/**
 * Operator gospodarczy (v0.8): wspólna część działalności prowadzonej przez JDG albo spółkę z o.o. — to, czego potrzebują moduły
 * wspólnego silnika (dokumenty, rachunek, VAT, pracownicy, branża). Nie zawiera niczego z podatków osoby fizycznej (forma opodatkowania, ZUS właściciela).
 * `ownerId` = osoba gracza (JDG) albo identyfikator spółki.
 */
export const OperatorSchema = z.object({
  id: IdSchema,
  ownerId: IdSchema,
  name: z.string().min(1).max(80),
  profileId: IdSchema,
  /** Kod PKD 2025 (np. „62.10.B”). */
  pkd: z.string().min(1).max(20),
  registeredOn: IsoDateSchema,
  /** Pierwszy dzień działalności (zawsze 1. dzień miesiąca). */
  startDate: IsoDateSchema,
  /** Ostatni dzień działalności po złożeniu wniosku o zakończenie (null = działa). */
  closeOn: IsoDateSchema.nullable(),
  status: z.enum(['active', 'closed']),
  vat: z.object({
    status: z.enum(['exempt', 'active']),
    activeFrom: IsoDateSchema.nullable(),
    /** Data czynności, która przekroczyła limit zwolnienia (jeśli to była przyczyna utraty zwolnienia). */
    limitExceededOn: IsoDateSchema.nullable(),
  }),
  accountId: IdSchema,
  /** Zawieszenia działalności (pełne miesiące; `to` = ostatni dzień zawieszenia, null = trwa). */
  suspensions: z.array(z.object({ from: IsoDateSchema, to: IsoDateSchema.nullable() })),
});

/**
 * JDG: jednoosobowa działalność gospodarcza osoby fizycznej. To NIE jest osoba prawna —
 * właścicielem rachunku i wszystkich zobowiązań jest osoba gracza (`ownerId`); „firmowy” jest tylko
 * rachunek i odrębna ewidencja (zobowiązania z `scope: 'business'`).
 */
export const BusinessSchema = OperatorSchema.extend({
  taxForm: TaxFormSchema,
  zus: z.object({
    start: ZusStartSchema,
    /** Dobrowolne ubezpieczenie chorobowe. */
    sickness: z.boolean(),
    /** Mały ZUS Plus (v0.4): deklaracja gracza; podstawa wyliczana co roku z danych roku poprzedniego. */
    malyPlus: z.object({
      active: z.boolean(),
      base: PositiveGroszeSchema.nullable(),
      since: IsoDateSchema.nullable(),
      /** Rok, z którego danych wyliczono podstawę. */
      baseYear: z.number().int().nullable(),
    }),
  }),
  /** Zaplanowana zmiana formy opodatkowania od 1 stycznia roku `effectiveYear`. */
  taxFormPlan: z.object({ form: TaxFormSchema, effectiveYear: z.number().int(), declaredOn: IsoDateSchema }).nullable(),
  /** Historia form opodatkowania (od daty). */
  taxFormHistory: z.array(z.object({ form: TaxFormSchema, from: IsoDateSchema })),
});

export const ServiceOfferSchema = z.object({
  id: IdSchema,
  templateId: IdSchema,
  clientId: IdSchema,
  title: z.string().min(1).max(160),
  description: z.string().max(400),
  netValue: PositiveGroszeSchema,
  hoursTotal: z.number().int().min(1).max(500),
  costNet: NonNegGroszeSchema,
  /** Termin płatności z umowy (dni od wystawienia dokumentu). */
  paymentTermDays: z.number().int().min(0).max(120),
  /** Termin wykonania: dni od przyjęcia zlecenia. */
  deadlineDays: z.number().int().min(1).max(180),
  latePenaltyBps: z.number().int().min(0).max(5_000),
  offeredOn: IsoDateSchema,
  expiresOn: IsoDateSchema,
  status: z.enum(['open', 'accepted', 'declined', 'expired']),
});

export const ServiceOrderSchema = z.object({
  id: IdSchema,
  offerId: IdSchema,
  clientId: IdSchema,
  title: z.string().min(1).max(160),
  netValue: PositiveGroszeSchema,
  hoursTotal: z.number().int().min(1),
  /** Postęp w setnych godziny (uwzględnia wydajność). */
  progressCentiHours: z.number().int().min(0),
  hoursPerDay: z.number().int().min(1).max(8),
  costNet: NonNegGroszeSchema,
  paymentTermDays: z.number().int().min(0).max(120),
  latePenaltyBps: z.number().int().min(0).max(5_000),
  acceptedOn: IsoDateSchema,
  startDate: IsoDateSchema,
  deadline: IsoDateSchema,
  status: z.enum(['in_progress', 'completed', 'failed']),
  completedOn: IsoDateSchema.nullable(),
  salesDocumentId: IdSchema.nullable(),
  commitmentId: IdSchema,
  /** Czy zlecenie zakończono po terminie (kara umowna zmniejszyła wartość). */
  late: z.boolean(),
  /** `renovation` = kontrakt branżowy (v0.5), realizowany przez moduł branżowy; `service` = szablonowe zlecenie v0.3. */
  kind: z.enum(['service', 'renovation']),
});

/** Rekord sprzedaży/kosztu. UWAGA: to symulacyjny rekord, nie faktura w rozumieniu KSeF. */
export const DocumentSchema = z.object({
  id: IdSchema,
  businessId: IdSchema,
  kind: z.enum(['sales', 'cost']),
  number: z.string().min(1).max(40),
  issueDate: IsoDateSchema,
  saleDate: IsoDateSchema,
  counterpartyId: IdSchema,
  orderId: IdSchema.nullable(),
  description: z.string().min(1).max(200),
  net: PositiveGroszeSchema,
  vatRateBps: z.number().int().min(0).max(10_000),
  vat: NonNegGroszeSchema,
  gross: PositiveGroszeSchema,
  vatTreatment: z.enum(['exempt', 'taxed']),
  /** Termin płatności z umowy (zapłata kontrahenta może nastąpić później). */
  termDate: IsoDateSchema,
  obligationIds: z.array(IdSchema),
  /** Kwota stanowiąca przychód (sprzedaż) albo koszt uzyskania przychodu (koszt) dla podatku dochodowego. */
  taxAmount: NonNegGroszeSchema,
  /** `advance` = zaliczka (odrębny dokument; od v0.6 nie jest przychodem podatkowym do wykonania usługi), `final` = rozliczenie końcowe pomniejszone o zaliczkę, `payroll` = lista płac, `capital` = zakup środka trwałego bez kosztu podatkowego, `full` = całość. */
  part: z.enum(['full', 'advance', 'final', 'payroll', 'capital']),
});

/** Miesięczne rozliczenie podatkowo-składkowe JDG (ślad obliczeń dla ekranu „Podatki i ZUS”). */
export const TaxPeriodSchema = z.object({
  businessId: IdSchema,
  /** Miesiąc rozliczeniowy YYYY-MM. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  revenue: GroszeSchema,
  costs: GroszeSchema,
  zusRegime: z.enum(['ulga', 'preferencyjny', 'standard', 'etat', 'maly_plus', 'zawieszenie']),
  /** Forma opodatkowania obowiązująca w tym miesiącu. */
  form: TaxFormSchema,
  /** Składki społeczne (emerytalna, rentowa, chorobowa, wypadkowa, FP/FS) łącznie. */
  social: NonNegGroszeSchema,
  health: NonNegGroszeSchema,
  /** Podstawa składki zdrowotnej (dochód miesiąca poprzedniego albo przychód narastająco — zależnie od formy). */
  healthBasis: GroszeSchema,
  cumulativeRevenue: GroszeSchema,
  cumulativeCosts: GroszeSchema,
  /** Podstawa opodatkowania narastająco po odliczeniach. */
  taxBase: GroszeSchema,
  taxCumulative: NonNegGroszeSchema,
  advance: NonNegGroszeSchema,
  advanceSkipped: z.boolean(),
  /** Reguły prawne użyte w obliczeniu (identyfikatory z LEGAL_SOURCES.md). */
  ruleIds: z.array(z.string()),
  carriedForward: z.boolean(),
});

/* ---------- v0.4: płace, rozliczenia roczne, straty ---------- */

/** Odcinek płacowy (pasek wynagrodzenia): brutto → składki → zaliczka PIT → netto. */
export const PayslipSchema = z.object({
  id: IdSchema,
  contractId: IdSchema,
  partyId: IdSchema,
  /** Miesiąc pracy (YYYY-MM). */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  accrualDate: IsoDateSchema,
  /** Dzień wypłaty — od niego liczy się przychód w PIT. */
  payDate: IsoDateSchema,
  gross: PositiveGroszeSchema,
  /** Podstawa składek emerytalnej i rentowej (po uwzględnieniu rocznego limitu 30-krotności). */
  pensionBase: NonNegGroszeSchema,
  emerytalna: NonNegGroszeSchema,
  rentowa: NonNegGroszeSchema,
  chorobowa: NonNegGroszeSchema,
  socialTotal: NonNegGroszeSchema,
  health: NonNegGroszeSchema,
  /** Część brutto zwolniona z PIT (ulga dla młodych). */
  exemptGross: NonNegGroszeSchema,
  /** Składki społeczne przypadające na część opodatkowaną (odliczane w PIT). */
  taxableSocial: NonNegGroszeSchema,
  koszty: NonNegGroszeSchema,
  /** Podstawa zaliczki (zaokrąglona do zł). */
  pitBase: NonNegGroszeSchema,
  pitAdvance: NonNegGroszeSchema,
  net: PositiveGroszeSchema,
  /** Czy zaliczkę pomniejszono o 1/12 kwoty zmniejszającej (PIT-2). */
  reductionApplied: NonNegGroszeSchema,
  /** Odcinek odtworzony dla wynagrodzenia sprzed kalkulatora (kwota wypłacona wg starego szacunku). */
  legacy: z.boolean(),
});

export const TaxReturnSchema = z.object({
  id: IdSchema,
  year: z.number().int(),
  /** Zeznanie: PIT-37 (etat), PIT-36 (skala: etat + JDG), PIT-36L (liniowy), PIT-28 (ryczałt). */
  form: z.enum(['PIT-37', 'PIT-36', 'PIT-36L', 'PIT-28']),
  income: GroszeSchema,
  /** Strata z lat ubiegłych odliczona w tym zeznaniu. */
  lossDeducted: NonNegGroszeSchema,
  deductions: NonNegGroszeSchema,
  base: NonNegGroszeSchema,
  tax: NonNegGroszeSchema,
  /** Zaliczki (pracodawcy i własne) zaliczone na poczet podatku. */
  advances: NonNegGroszeSchema,
  /** Dodatnie = do zapłaty, ujemne = nadpłata. */
  balance: GroszeSchema,
  dueDate: IsoDateSchema,
  obligationId: IdSchema.nullable(),
  businessId: IdSchema.nullable(),
  ruleIds: z.array(z.string()),
  carriedForward: z.boolean(),
});

export const TaxLossSchema = z.object({
  id: IdSchema,
  businessId: IdSchema,
  /** Rok powstania straty. */
  year: z.number().int(),
  /** Forma, w której powstała (skala/liniowy — ryczałt strat nie generuje). */
  form: z.enum(['skala', 'liniowy']),
  amount: PositiveGroszeSchema,
  usages: z.array(z.object({ year: z.number().int(), amount: PositiveGroszeSchema })),
});

export const HealthSettlementSchema = z.object({
  id: IdSchema,
  businessId: IdSchema,
  year: z.number().int(),
  form: TaxFormSchema,
  /** Miesiące działalności (bez zawieszonych), za które naliczano składkę. */
  months: z.number().int().min(0).max(12),
  annualBase: GroszeSchema,
  annualContribution: NonNegGroszeSchema,
  monthlyTotal: NonNegGroszeSchema,
  /** Dodatnie = dopłata, ujemne = nadpłata. */
  diff: GroszeSchema,
  status: z.enum(['none', 'due', 'refund_available', 'refund_claimed', 'refund_expired']),
  dueDate: IsoDateSchema.nullable(),
  claimDeadline: IsoDateSchema.nullable(),
  obligationId: IdSchema.nullable(),
  carriedForward: z.boolean(),
});


/* ---------- Branża remontowa (v0.5) ---------- */

export const MaterialStandardSchema = z.enum(['eko', 'std', 'premium']);
export const ComplexitySchema = z.enum(['standard', 'trudne']);

export const SegmentIdSchema = z.enum(['budget', 'standard', 'premium']);
export const PositioningSchema = z.enum(['low', 'balanced', 'premium']);
export const ChannelIdSchema = z.enum(['search', 'local_ads', 'portals', 'referrals', 'card', 'partnerships']);

export const RenoEnquirySchema = z.object({
  id: IdSchema,
  businessId: IdSchema,
  clientId: IdSchema,
  clientName: z.string().min(1).max(80),
  location: z.string().min(1).max(60),
  serviceId: z.string().min(1),
  units: z.number().int().min(1),
  complexity: ComplexitySchema,
  qualityReq: z.number().int().min(1).max(3),
  desiredStart: IsoDateSchema,
  /** Maksymalny oczekiwany czas realizacji (dni od rozpoczęcia). */
  maxDays: z.number().int().min(1),
  /** Szacowany budżet klienta (brutto — kwota, którą klient jest gotów zapłacić). */
  budgetGross: PositiveGroszeSchema,
  /** Cena, powyżej której klient odrzuci ofertę (ukryta przed graczem w UI). */
  walkAwayGross: PositiveGroszeSchema,
  haggler: z.boolean(),
  flexDays: z.number().int().min(0),
  receivedOn: IsoDateSchema,
  respondBy: IsoDateSchema,
  status: z.enum(['open', 'quoted', 'won', 'lost', 'expired', 'declined']),
  /** v0.7: segment klienta, kanał, przez który trafiło zapytanie (null = brak danych/zapisy sprzed v0.7), oraz konkurencja o to zlecenie. */
  segment: SegmentIdSchema,
  source: ChannelIdSchema.nullable(),
  /** Liczba konkurentów, z którymi klient porównuje oferty (0 = klient zapytał tylko tę firmę). */
  rivals: z.number().int().min(0),
  /** Najsilniejszy konkurent w zestawie klienta i jego ocena oferty (punkty ×100); do rozstrzygnięcia przy decyzji klienta. */
  rivalId: IdSchema.nullable(),
  rivalUtility: z.number().int(),
  /** Czy zlecenie zostało już przyznane konkurentowi (zapobiega podwójnemu księgowaniu obciążenia konkurenta). */
  rivalAwarded: z.boolean(),
});

export const RenoCostPlanSchema = z.object({
  materials: NonNegGroszeSchema,
  labor: NonNegGroszeSchema,
  transport: NonNegGroszeSchema,
  other: NonNegGroszeSchema,
  total: NonNegGroszeSchema,
});

export const RenoQuoteSchema = z.object({
  id: IdSchema,
  enquiryId: IdSchema,
  businessId: IdSchema,
  serviceId: z.string().min(1),
  units: z.number().int().min(1),
  complexity: ComplexitySchema,
  standard: MaterialStandardSchema,
  /** Cena ofertowa netto (bez VAT). */
  priceNet: PositiveGroszeSchema,
  /** Stawka VAT obowiązująca w chwili wysłania oferty (0 = zwolnienie podmiotowe). */
  vatRateBps: z.number().int().min(0).max(10_000),
  advanceBps: z.number().int().min(0).max(5_000),
  paymentTermDays: z.number().int().min(0).max(30),
  startDate: IsoDateSchema,
  durationDays: z.number().int().min(1),
  hoursPerDay: z.number().int().min(1).max(8),
  laborRate: NonNegGroszeSchema,
  planned: RenoCostPlanSchema,
  plannedCenti: z.number().int().min(1),
  sentOn: IsoDateSchema,
  decideOn: IsoDateSchema,
  status: z.enum(['sent', 'counter', 'accepted', 'rejected', 'declined', 'signed', 'expired']),
  counter: z.object({ kind: z.enum(['discount', 'deadline']), discountBps: z.number().int().min(0), newStart: IsoDateSchema.nullable(), newDuration: z.number().int().nullable() }).nullable(),
  held: z.boolean(),
  note: z.string().max(200),
  acceptedOn: IsoDateSchema.nullable(),
  signBy: IsoDateSchema.nullable(),
  /** Dni od zapytania do wysłania oferty (komunikacja). */
  replyDays: z.number().int().min(0),
  /** Planowana ekipa (null = właściciel samodzielnie), nadzór właściciela i pojazd. */
  teamId: IdSchema.nullable(),
  supervision: z.enum(['worker', 'supervise', 'hands-off']),
  vehicleId: IdSchema.nullable(),
});

export const RenoJobSchema = z.object({
  id: IdSchema,
  orderId: IdSchema,
  quoteId: IdSchema,
  businessId: IdSchema,
  clientId: IdSchema,
  clientName: z.string(),
  location: z.string(),
  serviceId: z.string().min(1),
  units: z.number().int().min(1),
  complexity: ComplexitySchema,
  difficulty: z.number().int().min(1).max(4),
  standard: MaterialStandardSchema,
  qualityReq: z.number().int().min(1).max(3),
  budgetGross: PositiveGroszeSchema,
  priceNet: PositiveGroszeSchema,
  vatRateBps: z.number().int().min(0),
  advanceNet: NonNegGroszeSchema,
  advanceDocId: IdSchema.nullable(),
  finalDocId: IdSchema.nullable(),
  paymentTermDays: z.number().int().min(0),
  planned: RenoCostPlanSchema,
  plannedCenti: z.number().int().min(1),
  /** Stawka własnej robocizny przyjęta w wycenie (do porównania planu z wykonaniem). */
  laborRate: NonNegGroszeSchema,
  /** Ostatni przetworzony dzień pracy (idempotencja). */
  lastDay: IsoDateSchema.nullable(),
  /** Do tego dnia (włącznie) prace są wstrzymane z powodu problemów organizacyjnych. */
  pauseUntil: IsoDateSchema.nullable(),
  /** Norma pracy w setnych godziny (bez uwzględnienia wydajności wykonawcy). */
  normCenti: z.number().int().min(1),
  /** Dodatkowa praca (problemy, poprawki) w setnych godziny normy. */
  extraCenti: z.number().int().min(0),
  progressCenti: z.number().int().min(0),
  hoursPerDay: z.number().int().min(1).max(8),
  startDate: IsoDateSchema,
  deadline: IsoDateSchema,
  signedOn: IsoDateSchema,
  stage: z.enum(['preparation', 'materials', 'execution', 'handover', 'settlement', 'done', 'cancelled']),
  /** Zapotrzebowanie materiałowe: klucz zapasu (`materiał:standard`) → ilość. */
  need: z.record(z.string(), z.number().int().min(0)),
  consumed: z.record(z.string(), z.object({ qty: z.number().int().min(0), value: NonNegGroszeSchema })),
  /** Koszty rzeczywiste (ekonomiczne): zużyte materiały, transport, inne, poprawki. */
  actual: z.object({ materials: NonNegGroszeSchema, transport: NonNegGroszeSchema, other: NonNegGroszeSchema, rework: NonNegGroszeSchema, labor: NonNegGroszeSchema, subcontract: NonNegGroszeSchema, vehicle: NonNegGroszeSchema }),
  /** Ekipa realizująca kontrakt: `teamId` null = właściciel samodzielnie; nadzór dotyczy ekip bez właściciela jako wykonawcy. */
  crew: z.object({ teamId: IdSchema.nullable(), supervision: z.enum(['worker', 'supervise', 'hands-off']) }),
  /** Sposób ujęcia zaliczki: `legacy` (v0.5: przychód w dacie wystawienia) albo `deferred` (od v0.6: przychód dopiero po wykonaniu usługi). */
  advanceMode: z.enum(['legacy', 'deferred']),
  /** Przepracowane setne godziny i suma godzin × bazowa jakość wykonawców (jakość ważona czasem pracy). */
  qualityHoursCenti: z.number().int().min(0),
  qualityWeightedSum: z.number().int().min(0),
  /** Pojazd przydzielony do kontraktu (rezerwacja w `ops.assignments`). */
  vehicleId: IdSchema.nullable(),
  workedDays: z.number().int().min(0),
  blockedDays: z.number().int().min(0),
  perfSumBps: z.number().int().min(0),
  perfDays: z.number().int().min(0),
  issues: z.array(z.object({ id: IdSchema, date: IsoDateSchema, kind: z.enum(['techniczny', 'organizacyjny']), title: z.string(), addedCenti: z.number().int().min(0), delayDays: z.number().int().min(0) })),
  reworkDone: z.boolean(),
  quality: z.number().int().min(0).max(100).nullable(),
  finishedOn: IsoDateSchema.nullable(),
  handoverOn: IsoDateSchema.nullable(),
  settledOn: IsoDateSchema.nullable(),
  lateDays: z.number().int().min(0),
  penaltyNet: NonNegGroszeSchema,
  /** Początek okresu bezczynności z powodu braków/awarii — do opisu w harmonogramie. */
  blockedReason: z.string().max(400).nullable(),
});

export const EquipmentItemSchema = z.object({
  id: IdSchema,
  catalogId: z.string().min(1),
  purchasedOn: IsoDateSchema,
  /** Kwota zakupu (podstawa kosztu podatkowego — koszt jednorazowo w dacie zakupu, PARAMETR/SIMPLIFIED). */
  cost: PositiveGroszeSchema,
  docId: IdSchema,
  /** Stan techniczny 0–10 000 pkt bazowych; wartość księgowa = cost × stan. */
  conditionBps: z.number().int().min(0).max(10_000),
  usedCenti: z.number().int().min(0),
});

export const StockMoveSchema = z.object({
  id: IdSchema,
  date: IsoDateSchema,
  key: z.string().min(1),
  /** Ze znakiem: dodatnia = przyjęcie, ujemna = zużycie. */
  qty: z.number().int().refine((v) => v !== 0),
  /** Ze znakiem: wartość zapasu (netto/koszt podatkowy dokumentu). */
  value: z.number().int(),
  kind: z.enum(['purchase', 'use']),
  jobId: IdSchema.nullable(),
  docId: IdSchema.nullable(),
});

export const RenoReviewSchema = z.object({
  id: IdSchema,
  jobId: IdSchema,
  date: IsoDateSchema,
  /** Ocena w dziesiątych gwiazdki (10–50). */
  rating10: z.number().int().min(10).max(50),
  parts: z.object({ quality: z.number().int(), punctuality: z.number().int(), conformity: z.number().int(), price: z.number().int(), communication: z.number().int() }),
  comment: z.string().max(200),
});

export const RenoComplaintSchema = z.object({
  id: IdSchema,
  jobId: IdSchema,
  raisedOn: IsoDateSchema,
  deadline: IsoDateSchema,
  severity: z.number().int().min(1).max(3),
  description: z.string().max(200),
  status: z.enum(['pending', 'open', 'repairing', 'resolved', 'refunded', 'escalated']),
  commitmentId: IdSchema.nullable(),
  costDocId: IdSchema.nullable(),
  resolvedOn: IsoDateSchema.nullable(),
  /** Korekta oceny po rozwiązaniu (dziesiąte gwiazdki). */
  ratingDelta10: z.number().int(),
});

export const RenovationStateSchema = z.object({
  specializations: z.array(z.string()),
  /** Doświadczenie (setne godziny efektywnej pracy) per usługa — rośnie wyłącznie od wykonanej pracy. */
  skillXp: z.record(z.string(), z.number().int().min(0)),
  enquiries: z.array(RenoEnquirySchema),
  quotes: z.array(RenoQuoteSchema),
  jobs: z.array(RenoJobSchema),
  equipment: z.array(EquipmentItemSchema),
  stock: z.record(z.string(), z.object({ qty: z.number().int().min(0), value: NonNegGroszeSchema })),
  stockMoves: z.array(StockMoveSchema),
  reviews: z.array(RenoReviewSchema),
  complaints: z.array(RenoComplaintSchema),
});


/* ---------- Rynek lokalny, konkurencja, marketing i strategia (v0.7) ---------- */

export const CompetitorSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  status: z.enum(['active', 'exited']),
  enteredOn: IsoDateSchema,
  exitedOn: IsoDateSchema.nullable(),
  size: z.enum(['solo', 'small', 'medium']),
  workers: z.number().int().min(1).max(30),
  services: z.array(z.string()).min(1),
  positioning: PositioningSchema,
  /** Poziom cen względem ceny referencyjnej (10 000 = cena referencyjna). */
  priceBps: z.number().int().min(4_000).max(25_000),
  quality: z.number().int().min(0).max(100),
  reputation: z.number().int().min(0).max(100),
  marketingMonthly: NonNegGroszeSchema,
  /** Skuteczna widoczność z marketingu (waga ×10 000), wygładzona opóźnieniem efektu. */
  marketingReach: z.number().int().min(0),
  /** Zaległość pracy: godziny i wartość dodana (cena bez materiałów) jeszcze nie wykonanych zleceń. */
  backlogHours: z.number().int().min(0),
  backlogValue: NonNegGroszeSchema,
  /** Uproszczony stan ekonomiczny (bez księgowości i podatków); może być ujemny. */
  cash: z.number().int(),
  monthsInLoss: z.number().int().min(0),
  highUtilMonths: z.number().int().min(0),
  lowUtilMonths: z.number().int().min(0),
  /** Bieżący miesiąc: zdobyte zlecenia, przepracowane godziny, zrealizowana wartość. */
  month: z.object({ won: z.number().int().min(0), hours: z.number().int().min(0), revenue: NonNegGroszeSchema }),
  /** Poprzedni zamknięty miesiąc (null tuż po wejściu na rynek). */
  last: z.object({ utilizationBps: z.number().int(), profit: z.number().int(), won: z.number().int().min(0) }).nullable(),
});

export const MarketMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  phase: z.enum(['wzrost', 'stabilizacja', 'spowolnienie', 'recesja']),
  index: z.number().int(),
  /** Całkowity popyt (projekty w mieście), z tego szukający wykonawcy, zapytania do gracza, zlecenia wygrane przez gracza i przez konkurentów. */
  demand: z.number().int().min(0),
  seekers: z.number().int().min(0),
  playerInquiries: z.number().int().min(0),
  playerLostCapacity: z.number().int().min(0),
  playerWon: z.number().int().min(0),
  rivalWon: z.number().int().min(0),
  unserved: z.number().int().min(0),
  competitors: z.number().int().min(0),
  avgPriceBps: z.number().int(),
  avgReputation: z.number().int(),
  /** Średnie obłożenie aktywnych konkurentów w miesiącu (ważone liczbą wykonawców; pkt bazowe) — wskaźnik nadmiaru/niedoboru mocy na rynku. */
  competitorUtilBps: z.number().int().min(0),
  marketingSpend: NonNegGroszeSchema,
});

export const MarketStateSchema = z.object({
  cityId: z.string().min(1),
  industryId: z.string().min(1),
  /** Dzień uruchomienia modelu rynku dla tej gry (null = jeszcze nie uruchomiony; zapisy sprzed v0.7 startują „od teraz”, bez historii wstecz). */
  initializedOn: IsoDateSchema.nullable(),
  competitors: z.array(CompetitorSchema),
  marketing: z.object({
    /** Miesięczny budżet netto per kanał (klucze = ChannelId). */
    budgets: z.record(z.string(), NonNegGroszeSchema),
    /** Skuteczna widoczność per kanał (waga ×10 000), wygładzona opóźnieniem efektu. */
    reach: z.record(z.string(), z.number().int().min(0)),
    lastChargedMonth: z.string().nullable(),
    spend: z.array(z.object({ month: z.string(), channel: z.string(), amount: NonNegGroszeSchema })),
  }),
  strategy: z.object({
    positioning: PositioningSchema,
    previous: PositioningSchema.nullable(),
    changedOn: IsoDateSchema.nullable(),
    lastChargedMonth: z.string().nullable(),
    history: z.array(z.object({ date: IsoDateSchema, from: PositioningSchema, to: PositioningSchema, note: z.string().max(200) })),
  }),
  /** Zamknięte miesiące (najnowsze na końcu) i bieżący miesiąc w toku. */
  months: z.array(MarketMonthSchema),
  current: MarketMonthSchema.nullable(),
  lastEntryMonth: z.string().nullable(),
});

/* ---------- Pracownicy, ekipy, podwykonawcy, pojazdy (v0.6) ---------- */

export const WorkerPersonSchema = z.object({
  id: IdSchema,
  firstName: z.string().min(1).max(40),
  lastName: z.string().min(1).max(40),
  birthDate: IsoDateSchema,
  /** Doświadczenie (setne godziny) per umiejętność — poziom wynika z doświadczenia. */
  xp: z.record(z.string(), z.number().int().min(0)),
  /** Oczekiwane wynagrodzenie brutto miesięcznie przy pełnym etacie. */
  expectedGross: PositiveGroszeSchema,
  availableFrom: IsoDateSchema,
  diligence: z.number().int().min(0).max(100),
  loyalty: z.number().int().min(0).max(100),
  morale: z.number().int().min(0).max(100),
  fatigue: z.number().int().min(0).max(100),
  status: z.enum(['candidate', 'employee', 'former', 'withdrawn']),
  lastWorkedOn: IsoDateSchema.nullable(),
});

export const EmploymentSchema = z.object({
  id: IdSchema,
  personId: IdSchema,
  businessId: IdSchema,
  role: z.string().min(1),
  grossMonthly: PositiveGroszeSchema,
  /** Wymiar czasu pracy: godziny w miesiącu (160 = pełny etat). */
  hoursPerMonth: z.number().int().min(40).max(200),
  startDate: IsoDateSchema,
  /** Ostatni dzień zatrudnienia (null = bezterminowo / bez wypowiedzenia). */
  endDate: IsoDateSchema.nullable(),
  noticeGivenOn: IsoDateSchema.nullable(),
  noticeLabel: z.string().nullable(),
  wageHistory: z.array(z.object({ from: IsoDateSchema, gross: PositiveGroszeSchema })),
  /** Koszt całkowity pracodawcy za godzinę (grosze) — podstawa przypisywania kosztu pracy do kontraktów. */
  hourlyCost: z.number().int().min(0),
  status: z.enum(['active', 'ended']),
});

export const EmployerContributionsSchema = z.object({
  emerytalna: NonNegGroszeSchema, rentowa: NonNegGroszeSchema, wypadkowa: NonNegGroszeSchema, fp: NonNegGroszeSchema, fgsp: NonNegGroszeSchema, total: NonNegGroszeSchema,
});

export const EmployerPayslipSchema = z.object({
  id: IdSchema,
  employmentId: IdSchema,
  personId: IdSchema,
  businessId: IdSchema,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  accrualDate: IsoDateSchema,
  payDate: IsoDateSchema,
  factorBps: z.number().int().min(1).max(10_000),
  gross: PositiveGroszeSchema,
  pensionBase: NonNegGroszeSchema,
  emerytalna: NonNegGroszeSchema,
  rentowa: NonNegGroszeSchema,
  chorobowa: NonNegGroszeSchema,
  socialTotal: NonNegGroszeSchema,
  health: NonNegGroszeSchema,
  exemptGross: NonNegGroszeSchema,
  taxableSocial: NonNegGroszeSchema,
  koszty: NonNegGroszeSchema,
  pitBase: NonNegGroszeSchema,
  pitAdvance: NonNegGroszeSchema,
  net: PositiveGroszeSchema,
  reductionApplied: NonNegGroszeSchema,
  employer: EmployerContributionsSchema,
  totalCost: PositiveGroszeSchema,
  docId: IdSchema,
  obligationIds: z.array(IdSchema),
});

export const JobListingSchema = z.object({
  id: IdSchema,
  businessId: IdSchema,
  role: z.string().min(1),
  skillId: z.string().min(1),
  minLevel: z.number().int().min(1).max(5),
  tier: z.enum(['basic', 'premium']),
  postedOn: IsoDateSchema,
  endsOn: IsoDateSchema,
  status: z.enum(['active', 'closed']),
  costDocId: IdSchema.nullable(),
  commitmentId: IdSchema.nullable(),
});

export const CandidateSchema = z.object({
  id: IdSchema,
  listingId: IdSchema,
  personId: IdSchema,
  appliedOn: IsoDateSchema,
  expiresOn: IsoDateSchema,
  status: z.enum(['new', 'countered', 'hired', 'declined', 'rejected', 'expired']),
  rounds: z.number().int().min(0),
  lastOffer: z.object({ gross: PositiveGroszeSchema, hoursPerMonth: z.number().int(), startDate: IsoDateSchema }).nullable(),
  counterGross: PositiveGroszeSchema.nullable(),
  note: z.string().max(200),
  employmentId: IdSchema.nullable(),
});

export const SubcontractorSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  services: z.array(z.string()),
  /** Cennik: pracochłonność robocizny jako % ceny referencyjnej usługi (materiały zapewnia zleceniodawca). */
  priceBps: z.number().int().min(1_000).max(9_000),
  quality: z.number().int().min(0).max(100),
  /** Prawdopodobieństwo dotrzymania terminu (pkt bazowe). */
  reliabilityBps: z.number().int().min(0).max(10_000),
});

export const SubcontractSchema = z.object({
  id: IdSchema,
  subId: IdSchema,
  jobId: IdSchema,
  serviceId: z.string().min(1),
  scopeBps: z.number().int().min(1_000).max(10_000),
  priceNet: PositiveGroszeSchema,
  advanceBps: z.number().int().min(0).max(3_000),
  advanceNet: NonNegGroszeSchema,
  /** Zaliczka wpłacona podwykonawcy, jeszcze nierozliczona — aktywo (przedpłata), nie koszt. */
  prepaid: NonNegGroszeSchema,
  advanceObligationId: IdSchema.nullable(),
  offeredOn: IsoDateSchema,
  expiresOn: IsoDateSchema,
  startDate: IsoDateSchema,
  plannedDays: z.number().int().min(1),
  status: z.enum(['offered', 'accepted', 'in_progress', 'delivered', 'settled', 'declined', 'expired', 'cancelled']),
  requiredCenti: z.number().int().min(1),
  performedCenti: z.number().int().min(0),
  /** Opóźnienie (dni bez pracy) wynikające z ryzyka — losowane deterministycznie przy akceptacji. */
  delayDays: z.number().int().min(0),
  delayFrom: IsoDateSchema.nullable(),
  defects: z.boolean(),
  qualityScore: z.number().int().min(0).max(100).nullable(),
  deliveredOn: IsoDateSchema.nullable(),
  settledOn: IsoDateSchema.nullable(),
  settlementDocId: IdSchema.nullable(),
  settledNet: NonNegGroszeSchema,
});

export const TeamSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(60),
  members: z.array(z.object({ kind: z.enum(['owner', 'employee', 'sub']), id: IdSchema })),
  createdOn: IsoDateSchema,
});

export const AssignmentSchema = z.object({
  id: IdSchema,
  jobId: IdSchema,
  kind: z.enum(['employee', 'sub', 'equipment', 'vehicle']),
  resourceId: IdSchema,
  from: IsoDateSchema,
  to: IsoDateSchema,
});

export const VehicleSchema = z.object({
  id: IdSchema,
  catalogId: z.string().min(1),
  purchasedOn: IsoDateSchema,
  cost: PositiveGroszeSchema,
  docId: IdSchema,
  conditionBps: z.number().int().min(0).max(10_000),
  usedDays: z.number().int().min(0),
});

export const OpsSchema = z.object({
  people: z.array(WorkerPersonSchema),
  employments: z.array(EmploymentSchema),
  payslips: z.array(EmployerPayslipSchema),
  listings: z.array(JobListingSchema),
  candidates: z.array(CandidateSchema),
  subcontractors: z.array(SubcontractorSchema),
  subcontracts: z.array(SubcontractSchema),
  teams: z.array(TeamSchema),
  assignments: z.array(AssignmentSchema),
  vehicles: z.array(VehicleSchema),
  /** Koszt pracy pracowników przypisany do kontraktów w miesiącu (YYYY-MM) — reszta listy płac to koszt stały (bezczynność). */
  laborAllocated: z.record(z.string(), z.number().int().min(0)),
  /** Zmienne koszty eksploatacji pojazdów naliczone w miesiącu (rozliczane dokumentem na koniec miesiąca). */
  vehicleRunning: z.record(z.string(), z.number().int().min(0)),
});

/* ---------- Księgowość (v0.5) ---------- */

export const AccountingSchema = z.object({
  office: z.object({ planId: z.string().min(1), since: IsoDateSchema, endsOn: IsoDateSchema.nullable() }).nullable(),
  history: z.array(z.object({ planId: z.string(), from: IsoDateSchema, to: IsoDateSchema })),
  lastFeeMonth: z.string().nullable(),
  suggestions: z.array(z.object({
    year: z.number().int(),
    date: IsoDateSchema,
    current: TaxFormSchema,
    best: TaxFormSchema,
    rows: z.array(z.object({ form: TaxFormSchema, tax: NonNegGroszeSchema, health: NonNegGroszeSchema, total: NonNegGroszeSchema })),
    basis: z.string().max(200),
  })),
});


/* ---------- Spółki z o.o., wspólnicy, udziały, uchwały i dywidendy (v0.8) ---------- */

const ScoreSchema = z.number().int().min(0).max(100);
const BpsSchema = z.number().int().min(0).max(10_000);

/** Postać AI: wspólnik albo inwestor. Kapitał prywatny postaci jest poza księgą gracza (strona zewnętrzna). */
export const PartnerSchema = z.object({
  id: IdSchema,
  firstName: z.string().min(1).max(40),
  lastName: z.string().min(1).max(40),
  birthYear: z.number().int().min(1940).max(2010),
  kind: z.enum(['partner', 'investor']),
  /** Dostępny kapitał prywatny postaci (maleje przy inwestycjach, rośnie o dywidendy netto i sprzedaż udziałów). */
  capital: NonNegGroszeSchema,
  experience: ScoreSchema,
  competence: ScoreSchema,
  riskTolerance: ScoreSchema,
  goal: z.enum(['income', 'growth', 'exit']),
  /** 0 = woli reinwestować zysk, 100 = woli dywidendy. */
  dividendPreference: ScoreSchema,
  horizonMonths: z.number().int().min(6).max(240),
  /** Zaufanie do gracza (0–100); zmienia się wyłącznie od wyników spółki i decyzji zgodnych lub sprzecznych z interesami postaci. */
  trust: ScoreSchema,
  tradeSkill: z.string().nullable(),
  bio: z.string().max(260),
  history: z.array(z.object({ date: IsoDateSchema, note: z.string().max(240), trustDelta: z.number().int() })),
  lastReviewMonth: z.string().nullable(),
});

export const BoardMemberSchema = z.object({
  id: IdSchema,
  /** Osoba gracza albo postać AI. Funkcja zarządcza jest niezależna od udziałów i od umowy o pracę. */
  personId: IdSchema,
  role: z.enum(['president', 'member']),
  appointedOn: IsoDateSchema,
  endedOn: IsoDateSchema.nullable(),
  endReason: z.enum(['dismissed', 'resigned']).nullable(),
  /** Uchwała powołująca (null = powołany w umowie spółki). */
  resolutionId: IdSchema.nullable(),
});

export const CitLossSchema = z.object({
  id: IdSchema,
  companyId: IdSchema,
  year: z.number().int(),
  amount: PositiveGroszeSchema,
  usages: z.array(z.object({ year: z.number().int(), amount: PositiveGroszeSchema })),
});

export const CompanyYearResultSchema = z.object({
  year: z.number().int(),
  /** Aktywa netto na koniec roku (po wszystkich naliczeniach, w tym podatku). */
  netAssetsEnd: GroszeSchema,
  /** Wpłaty wspólników na kapitał (nominał + nadwyżka) zarejestrowane w roku — nie są przychodem. */
  contributions: NonNegGroszeSchema,
  /** Dywidendy uchwalone w roku (brutto) — nie są kosztem. */
  dividendsDeclared: NonNegGroszeSchema,
  /** Przeniesienia z zysku na kapitał zapasowy uchwalone w roku. */
  transfersToReserve: NonNegGroszeSchema,
  /** Wynik finansowy netto roku = zmiana aktywów netto − wpłaty + dywidendy. */
  netProfit: GroszeSchema,
  citTax: NonNegGroszeSchema,
});

export const CompanyMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  netAssets: GroszeSchema,
  revenue: NonNegGroszeSchema,
  /** Wpłaty wspólników na kapitał zarejestrowane w miesiącu i dywidendy uchwalone w miesiącu (korekty wyniku). */
  contributions: NonNegGroszeSchema,
  dividends: NonNegGroszeSchema,
});

export const CompanyValuationSchema = z.object({
  asOf: IsoDateSchema,
  netAssets: GroszeSchema,
  profit12: GroszeSchema,
  months: z.number().int().min(0),
  multipleBps: z.number().int().min(0),
  earningsValue: NonNegGroszeSchema,
  estimate: NonNegGroszeSchema,
  low: NonNegGroszeSchema,
  high: NonNegGroszeSchema,
  /** Czynniki wyceny w czytelnej postaci (ślad dla gracza). */
  factors: z.array(z.string().max(160)),
});

export const CompanySchema = z.object({
  id: IdSchema,
  name: z.string().min(2).max(60),
  cityId: IdSchema,
  profileId: IdSchema,
  specialization: z.string().nullable(),
  /** `draft` = szkic (negocjacje ze wspólnikami), `organizing` = spółka w organizacji (umowa zawarta, wniosek do KRS), `registered` = wpis do KRS. */
  status: z.enum(['draft', 'organizing', 'registered', 'closed']),
  createdOn: IsoDateSchema,
  agreementOn: IsoDateSchema.nullable(),
  filedOn: IsoDateSchema.nullable(),
  /** Dzień rozpoznania wniosku przez sąd rejestrowy (S24: następny dzień po złożeniu wniosku, art. 20a ust. 2 ustawy o KRS). */
  decisionOn: IsoDateSchema.nullable(),
  registeredOn: IsoDateSchema.nullable(),
  /** Numer KRS (symulowany — gra nie łączy się z rejestrem). */
  krsNumber: z.string().nullable(),
  /** Kapitał zakładowy z umowy spółki oraz wartość nominalna i liczba udziałów (rejestr: `corp.holdings`). */
  capital: NonNegGroszeSchema,
  nominal: PositiveGroszeSchema,
  shareCount: z.number().int().min(0),
  /** Kapitał zapasowy (nadwyżka ponad wartość nominalną przy objęciu udziałów + przeniesienia z zysku). */
  supplementary: NonNegGroszeSchema,
  accountId: IdSchema,
  partyId: IdSchema,
  board: z.array(BoardMemberSchema),
  representation: z.enum(['each_alone', 'joint_two', 'all_jointly']),
  /** Status VAT, o który spółka wystąpi przy uruchomieniu działalności. */
  vatPlan: z.enum(['exempt', 'active']),
  operation: OperatorSchema.nullable(),
  slices: z.object({
    reno: RenovationStateSchema,
    ops: OpsSchema,
    marketing: MarketStateSchema.shape.marketing,
    strategy: MarketStateSchema.shape.strategy,
  }),
  /** Podwyższenie kapitału oczekujące na wpis do KRS (skuteczne dopiero z chwilą wpisu — art. 262 § 4 KSH). */
  pendingIncrease: z.object({
    resolutionId: IdSchema, subscriberId: IdSchema, shares: z.number().int().min(1), contribution: PositiveGroszeSchema,
    nominalTotal: PositiveGroszeSchema, filedOn: IsoDateSchema, decisionOn: IsoDateSchema, negotiationId: IdSchema.nullable(),
  }).nullable(),
  /** Lata obrotowe, za które zgromadzenie wspólników zatwierdziło sprawozdanie finansowe. */
  statementsApproved: z.array(z.number().int()),
  yearResults: z.array(CompanyYearResultSchema),
  /** Migawki miesięczne (aktywa netto na koniec miesiąca i przychód podatkowy) — podstawa wyceny i wyniku 12 miesięcy. */
  monthly: z.array(CompanyMonthSchema),
  /** Ostatnia wycena spółki (szacunek, nie cena transakcji); odświeżana co miesiąc i po zdarzeniach zmieniających kapitał. */
  valuation: CompanyValuationSchema.nullable(),
  /** Okresy, w których jedyny wspólnik (osoba gracza) podlegał ubezpieczeniom — dla składek ZUS. */
  soleHistory: z.array(z.object({ holderId: IdSchema, from: IsoDateSchema, to: IsoDateSchema.nullable() })),
});

export const ShareLotSchema = z.object({
  id: IdSchema,
  count: z.number().int().min(1),
  acquiredOn: IsoDateSchema,
  via: z.enum(['founding', 'issue', 'purchase']),
  /** Cena zapłacona za pozostałe udziały partii (koszt nabycia). */
  paid: NonNegGroszeSchema,
  eventId: IdSchema,
});

/** Centralny rejestr udziałów: jeden wiersz = wspólnik w spółce. */
export const ShareHoldingSchema = z.object({
  id: IdSchema,
  companyId: IdSchema,
  holderId: IdSchema,
  count: z.number().int().min(0),
  nominal: PositiveGroszeSchema,
  /** Prawa głosu na udział (domyślnie 1 — art. 242 KSH). Pole przygotowane pod udziały uprzywilejowane (poza zakresem). */
  votesPerShare: z.number().int().min(1),
  restrictions: z.array(z.object({ kind: z.enum(['lockup', 'pledge']), until: IsoDateSchema.nullable(), note: z.string().max(120) })),
  lots: z.array(ShareLotSchema),
  history: z.array(z.object({ date: IsoDateSchema, kind: z.enum(['acquire', 'dispose']), count: z.number().int().min(1), eventId: IdSchema, note: z.string().max(200) })),
});

export const ShareEventSchema = z.object({
  id: IdSchema,
  companyId: IdSchema,
  date: IsoDateSchema,
  kind: z.enum(['founding', 'issue', 'transfer']),
  fromId: IdSchema.nullable(),
  toId: IdSchema,
  count: z.number().int().min(1),
  nominal: PositiveGroszeSchema,
  /** Łączna cena (nowe udziały: wkład; przeniesienie: cena sprzedaży). */
  price: NonNegGroszeSchema,
  /** Koszt nabycia przeniesionych udziałów u zbywcy (FIFO) — do ustalenia zysku ze sprzedaży; 0 dla zawiązania i emisji. */
  costBasis: NonNegGroszeSchema,
  resolutionId: IdSchema.nullable(),
  note: z.string().max(240),
});

export const ResolutionPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('appoint_board'), personId: IdSchema, role: z.enum(['president', 'member']) }),
  z.object({ type: z.literal('dismiss_board'), memberId: IdSchema }),
  z.object({ type: z.literal('approve_statements'), year: z.number().int() }),
  z.object({ type: z.literal('allocate_profit'), year: z.number().int(), dividendGross: NonNegGroszeSchema, toReserve: NonNegGroszeSchema, dividendDay: IsoDateSchema, payDay: IsoDateSchema }),
  z.object({ type: z.literal('capital_increase'), negotiationId: IdSchema, subscriberId: IdSchema, shares: z.number().int().min(1), issuePriceEach: PositiveGroszeSchema }),
  z.object({ type: z.literal('change_representation'), mode: z.enum(['each_alone', 'joint_two', 'all_jointly']) }),
  z.object({ type: z.literal('consent_acquisition'), label: z.string().max(80), maxAmount: PositiveGroszeSchema, validUntil: IsoDateSchema }),
]);

export const ResolutionSchema = z.object({
  id: IdSchema,
  companyId: IdSchema,
  title: z.string().min(1).max(160),
  payload: ResolutionPayloadSchema,
  proposedOn: IsoDateSchema,
  proposedBy: IdSchema,
  /** Dzień zgromadzenia wspólników (zwołanie: min. 2 tygodnie — art. 238 § 1 KSH; jedyny wspólnik — od razu, art. 156). */
  assemblyOn: IsoDateSchema,
  threshold: z.object({ kind: z.enum(['absolute', 'two_thirds', 'three_quarters', 'unanimous']), ruleId: z.string() }),
  voters: z.array(z.object({ holderId: IdSchema, votes: z.number().int().min(0), excluded: z.string().nullable() })),
  votes: z.array(z.object({ holderId: IdSchema, vote: z.enum(['for', 'against', 'abstain']), votes: z.number().int().min(0), castOn: IsoDateSchema })),
  status: z.enum(['scheduled', 'passed', 'rejected', 'executed', 'failed', 'cancelled']),
  tally: z.object({ for: z.number().int(), against: z.number().int(), abstain: z.number().int(), cast: z.number().int(), needed: z.number().int() }).nullable(),
  decidedOn: IsoDateSchema.nullable(),
  executedOn: IsoDateSchema.nullable(),
  outcome: z.string().max(400),
  history: z.array(z.object({ date: IsoDateSchema, text: z.string().max(240) })),
});

export const DealTermsSchema = z.object({
  shares: z.number().int().min(0),
  /** Łączna kwota: wkład (objęcie udziałów) albo cena (zakup/sprzedaż istniejących udziałów). */
  amount: NonNegGroszeSchema,
  /** Udział w kapitale po transakcji (pkt bazowe) — dla emisji wynika z liczby udziałów. */
  percentBps: BpsSchema,
  role: z.enum(['none', 'board_member', 'president']),
  dividendPolicy: z.enum(['none', 'distribute', 'reinvest']),
});

export const NegotiationSchema = z.object({
  id: IdSchema,
  /** found = wspólnik zakładający spółkę; subscribe = objęcie nowych udziałów (pieniądze do spółki); secondary_sell = gracz sprzedaje istniejące udziały; secondary_buy = gracz kupuje istniejące udziały. */
  kind: z.enum(['found', 'subscribe', 'secondary_sell', 'secondary_buy']),
  companyId: IdSchema,
  partnerId: IdSchema,
  status: z.enum(['open', 'countered', 'agreed', 'declined', 'expired', 'completed', 'void']),
  terms: DealTermsSchema,
  rounds: z.array(z.object({ by: z.enum(['player', 'partner']), date: IsoDateSchema, terms: DealTermsSchema, note: z.string().max(260) })),
  openedOn: IsoDateSchema,
  expiresOn: IsoDateSchema,
  resolutionId: IdSchema.nullable(),
  reason: z.string().max(300),
});

export const DividendSchema = z.object({
  id: IdSchema,
  companyId: IdSchema,
  /** Rok obrotowy, z którego zysku pochodzi uchwała. */
  year: z.number().int(),
  resolutionId: IdSchema,
  grossTotal: PositiveGroszeSchema,
  declaredOn: IsoDateSchema,
  dividendDay: IsoDateSchema,
  payDay: IsoDateSchema,
  taxDueDay: IsoDateSchema,
  /** Kwota dostępna do podziału w dniu uchwały (art. 192 KSH) i aktywa netto po wypłacie — ślad weryfikacji. */
  distributableAtDeclaration: NonNegGroszeSchema,
  lines: z.array(z.object({
    holderId: IdSchema, shares: z.number().int().min(1), gross: PositiveGroszeSchema, tax: NonNegGroszeSchema, net: PositiveGroszeSchema,
    obligationId: IdSchema, receivableId: IdSchema.nullable(),
  })),
  taxObligationId: IdSchema.nullable(),
  status: z.enum(['declared', 'paid']),
});

export const CitReturnSchema = z.object({
  id: IdSchema,
  companyId: IdSchema,
  year: z.number().int(),
  revenue: NonNegGroszeSchema,
  costs: NonNegGroszeSchema,
  /** Dochód (przychody − koszty) przed odliczeniem straty; ujemny = strata roku. */
  income: GroszeSchema,
  lossDeducted: NonNegGroszeSchema,
  base: NonNegGroszeSchema,
  rateBps: z.number().int().min(0).max(10_000),
  /** Dlaczego taka stawka: id reguły z LEGAL_RULES + krótki opis. */
  rateReason: z.string().max(240),
  tax: NonNegGroszeSchema,
  advances: NonNegGroszeSchema,
  /** Dodatnie = do zapłaty, ujemne = nadpłata. */
  balance: GroszeSchema,
  dueDate: IsoDateSchema,
  obligationId: IdSchema.nullable(),
  smallTaxpayer: z.boolean(),
  startYear: z.boolean(),
  carriedForward: z.boolean(),
});

export const CorpSchema = z.object({
  companies: z.array(CompanySchema),
  partners: z.array(PartnerSchema),
  holdings: z.array(ShareHoldingSchema),
  shareEvents: z.array(ShareEventSchema),
  resolutions: z.array(ResolutionSchema),
  negotiations: z.array(NegotiationSchema),
  dividends: z.array(DividendSchema),
  citReturns: z.array(CitReturnSchema),
  citLosses: z.array(CitLossSchema),
  /** Aktywny podmiot przy zarządzaniu działalnością: 'jdg' albo id spółki. */
  selected: z.string(),
  /** Kontekst operatora w trakcie obliczeń (zawsze null w stanie spoczynkowym — niezmiennik). */
  context: z.string().nullable(),
});

/* ---------- Stan gry ---------- */

export const GameStateSchema = z.object({
  gameId: IdSchema,
  seed: z.string().min(1).max(100),
  clock: z.object({ startDate: IsoDateSchema, today: IsoDateSchema }),
  person: PersonSchema,
  parties: z.record(z.string(), PartySchema),
  accounts: z.record(z.string(), AccountSchema),
  playerAccountId: IdSchema,
  contracts: z.array(ContractSchema),
  rules: z.array(RuleSchema),
  ledger: z.array(LedgerEntrySchema),
  obligations: z.array(ObligationSchema),
  events: z.array(GameEventSchema),
  /** Identyfikatory już zastosowanych wystąpień i transakcji — ochrona przed podwójnym księgowaniem. */
  processed: z.record(z.string(), z.literal(true)),
  history: z.array(HistoryPointSchema),
  openingCash: GroszeSchema,
  life: LifeSchema,
  settings: z.object({
    lifeEvents: z.boolean(),
    /** Od tego dnia wynagrodzenia z etatu liczy kalkulator płac (wcześniejsze — dotychczasowa kwota). */
    payrollFrom: IsoDateSchema,
  }),
  assets: z.array(AssetSchema),
  pending: z.array(PendingActionSchema),
  applications: z.array(JobApplicationSchema),
  lifeEvents: z.array(LifeEventSchema),
  commitments: z.array(CommitmentSchema),
  /** Liczniki do deterministycznych identyfikatorów komend (np. przelewów). */
  counters: z.record(z.string(), z.number().int().min(0)),
  /** JDG gracza (historia, najwyżej jedna aktywna). v0.3. */
  businesses: z.array(BusinessSchema),
  serviceOffers: z.array(ServiceOfferSchema),
  serviceOrders: z.array(ServiceOrderSchema),
  documents: z.array(DocumentSchema),
  taxPeriods: z.array(TaxPeriodSchema),
  payslips: z.array(PayslipSchema),
  taxReturns: z.array(TaxReturnSchema),
  taxLosses: z.array(TaxLossSchema),
  healthSettlements: z.array(HealthSettlementSchema),
  /** Moduł branży remontowej (v0.5). Pusty, dopóki gracz nie prowadzi takiej działalności. */
  reno: RenovationStateSchema,
  /** Rynek lokalny, konkurenci, marketing i pozycjonowanie firmy (v0.7; wspólna warstwa dla branż). */
  market: MarketStateSchema,
  accounting: AccountingSchema,
  /** Pracownicy, rekrutacja, podwykonawcy, ekipy, przydziały zasobów i pojazdy (v0.6; wspólny silnik, nie moduł branży). */
  ops: OpsSchema,
  /** Spółki z o.o., wspólnicy, rejestr udziałów, uchwały, dywidendy i CIT (v0.8). */
  corp: CorpSchema,
});

export type Person = z.infer<typeof PersonSchema>;
export type Party = z.infer<typeof PartySchema>;
export type Account = z.infer<typeof AccountSchema>;
export type Contract = z.infer<typeof ContractSchema>;
export type AmountSpec = z.infer<typeof AmountSpecSchema>;
export type ObligationRule = z.infer<typeof ObligationRuleSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type SavingsInterestRule = z.infer<typeof SavingsInterestRuleSchema>;
export type Skill = z.infer<typeof SkillIdSchema>;
export type Lifestyle = z.infer<typeof LifestyleSchema>;
export type HousingStandard = z.infer<typeof HousingStandardSchema>;
export type EmploymentContract = Extract<Contract, { type: 'employment' }>;
export type LeaseContract = Extract<Contract, { type: 'lease' }>;
export type Asset = z.infer<typeof AssetSchema>;
export type PendingAction = z.infer<typeof PendingActionSchema>;
export type JobApplication = z.infer<typeof JobApplicationSchema>;
export type LifeEvent = z.infer<typeof LifeEventSchema>;
export type Commitment = z.infer<typeof CommitmentSchema>;
export type Life = z.infer<typeof LifeSchema>;
export type TaxForm = z.infer<typeof TaxFormSchema>;
export type ZusStart = z.infer<typeof ZusStartSchema>;
export type Business = z.infer<typeof BusinessSchema>;
export type Operator = z.infer<typeof OperatorSchema>;
export type ServiceOffer = z.infer<typeof ServiceOfferSchema>;
export type ServiceOrder = z.infer<typeof ServiceOrderSchema>;
export type BusinessDocument = z.infer<typeof DocumentSchema>;
export type TaxPeriod = z.infer<typeof TaxPeriodSchema>;
export type Payslip = z.infer<typeof PayslipSchema>;
export type TaxReturn = z.infer<typeof TaxReturnSchema>;
export type TaxLoss = z.infer<typeof TaxLossSchema>;
export type HealthSettlement = z.infer<typeof HealthSettlementSchema>;
export type RenoEnquiry = z.infer<typeof RenoEnquirySchema>;
export type RenoQuote = z.infer<typeof RenoQuoteSchema>;
export type Competitor = z.infer<typeof CompetitorSchema>;
export type MarketMonth = z.infer<typeof MarketMonthSchema>;
export type MarketState = z.infer<typeof MarketStateSchema>;
export type RenoJob = z.infer<typeof RenoJobSchema>;
export type RenoCostPlan = z.infer<typeof RenoCostPlanSchema>;
export type EquipmentItem = z.infer<typeof EquipmentItemSchema>;
export type StockMove = z.infer<typeof StockMoveSchema>;
export type RenoReview = z.infer<typeof RenoReviewSchema>;
export type RenoComplaint = z.infer<typeof RenoComplaintSchema>;
export type RenovationState = z.infer<typeof RenovationStateSchema>;
export type Accounting = z.infer<typeof AccountingSchema>;
export type WorkerPerson = z.infer<typeof WorkerPersonSchema>;
export type Employment = z.infer<typeof EmploymentSchema>;
export type EmployerPayslip = z.infer<typeof EmployerPayslipSchema>;
export type EmployerContributions = z.infer<typeof EmployerContributionsSchema>;
export type JobListing = z.infer<typeof JobListingSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type Subcontractor = z.infer<typeof SubcontractorSchema>;
export type Subcontract = z.infer<typeof SubcontractSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type Assignment = z.infer<typeof AssignmentSchema>;
export type Vehicle = z.infer<typeof VehicleSchema>;
export type Ops = z.infer<typeof OpsSchema>;
export type MaterialStandard = z.infer<typeof MaterialStandardSchema>;
export type Complexity = z.infer<typeof ComplexitySchema>;
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type Obligation = z.infer<typeof ObligationSchema>;
export type GameEvent = z.infer<typeof GameEventSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type HistoryPoint = z.infer<typeof HistoryPointSchema>;
export type Partner = z.infer<typeof PartnerSchema>;
export type BoardMember = z.infer<typeof BoardMemberSchema>;
export type Company = z.infer<typeof CompanySchema>;
export type CompanyMonth = z.infer<typeof CompanyMonthSchema>;
export type CompanyValuation = z.infer<typeof CompanyValuationSchema>;
export type CompanyYearResult = z.infer<typeof CompanyYearResultSchema>;
export type ShareHolding = z.infer<typeof ShareHoldingSchema>;
export type ShareLot = z.infer<typeof ShareLotSchema>;
export type ShareEvent = z.infer<typeof ShareEventSchema>;
export type Resolution = z.infer<typeof ResolutionSchema>;
export type ResolutionPayload = z.infer<typeof ResolutionPayloadSchema>;
export type DealTerms = z.infer<typeof DealTermsSchema>;
export type Negotiation = z.infer<typeof NegotiationSchema>;
export type Dividend = z.infer<typeof DividendSchema>;
export type CitReturn = z.infer<typeof CitReturnSchema>;
export type CitLoss = z.infer<typeof CitLossSchema>;
export type Corp = z.infer<typeof CorpSchema>;
export type GameState = z.infer<typeof GameStateSchema>;
