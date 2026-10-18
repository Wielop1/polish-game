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
  type: z.enum(['checking', 'savings']),
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
  settings: z.object({ lifeEvents: z.boolean() }),
  assets: z.array(AssetSchema),
  pending: z.array(PendingActionSchema),
  applications: z.array(JobApplicationSchema),
  lifeEvents: z.array(LifeEventSchema),
  commitments: z.array(CommitmentSchema),
  /** Liczniki do deterministycznych identyfikatorów komend (np. przelewów). */
  counters: z.record(z.string(), z.number().int().min(0)),
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
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type Obligation = z.infer<typeof ObligationSchema>;
export type GameEvent = z.infer<typeof GameEventSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type HistoryPoint = z.infer<typeof HistoryPointSchema>;
export type GameState = z.infer<typeof GameStateSchema>;
