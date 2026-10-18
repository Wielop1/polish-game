import { z } from 'zod';
import { isValidIsoDate } from './date.ts';

export const IsoDateSchema = z.string().refine(isValidIsoDate, 'nieprawidłowa data (oczekiwano YYYY-MM-DD)');
export const GroszeSchema = z
  .number()
  .refine(Number.isSafeInteger, 'kwota musi być całkowitą liczbą groszy');
const PositiveGroszeSchema = GroszeSchema.refine((v) => v > 0, 'kwota musi być dodatnia');
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

export const AccountSchema = z.object({
  id: IdSchema,
  ownerId: IdSchema,
  name: z.string().min(1).max(80),
  currency: z.literal('PLN'),
  balance: GroszeSchema,
});

export const DataStatusSchema = z.enum(['placeholder', 'verified']);

export const ContractSchema = z.discriminatedUnion('type', [
  z.object({
    id: IdSchema,
    type: z.literal('employment'),
    partyId: IdSchema,
    title: z.string().min(1).max(120),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema.nullable(),
    /** Wynagrodzenie NETTO miesięcznie (v0.1: bez modelu podatkowego). */
    monthlyAmount: PositiveGroszeSchema,
    dataStatus: DataStatusSchema,
  }),
  z.object({
    id: IdSchema,
    type: z.literal('lease'),
    partyId: IdSchema,
    title: z.string().min(1).max(120),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema.nullable(),
    monthlyAmount: PositiveGroszeSchema,
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
  /** Kwota pobierana z umowy (jedno źródło prawdy). */
  z.object({ type: z.literal('contract'), contractId: IdSchema }),
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
  dataStatus: DataStatusSchema,
});

export const BirthdayRuleSchema = z.object({
  kind: z.literal('birthday'),
  id: IdSchema,
  startDate: IsoDateSchema,
});

export const RuleSchema = z.discriminatedUnion('kind', [ObligationRuleSchema, BirthdayRuleSchema]);

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
  eventId: IdSchema,
});

export const ObligationSchema = z.object({
  id: IdSchema,
  direction: z.enum(['receivable', 'payable']),
  creditorId: IdSchema,
  debtorId: IdSchema,
  counterpartyId: IdSchema,
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
  cash: GroszeSchema,
  netWorth: GroszeSchema,
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
});

export type Person = z.infer<typeof PersonSchema>;
export type Party = z.infer<typeof PartySchema>;
export type Account = z.infer<typeof AccountSchema>;
export type Contract = z.infer<typeof ContractSchema>;
export type AmountSpec = z.infer<typeof AmountSpecSchema>;
export type ObligationRule = z.infer<typeof ObligationRuleSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type Obligation = z.infer<typeof ObligationSchema>;
export type GameEvent = z.infer<typeof GameEventSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type HistoryPoint = z.infer<typeof HistoryPointSchema>;
export type GameState = z.infer<typeof GameStateSchema>;
