import { z } from 'zod';
import { CITIES, ECONOMY_V01, GAME_START, LIFESTYLE, SAVINGS, START_HOME, START_SKILLS, TIME } from './config.ts';
import { addDays, addMonths, diffDays } from './date.ts';
import { createRng } from './rng.ts';
import { emptyAccounting, emptyReno } from './industryDefaults.ts';
import { logEvent, postTransaction } from './core.ts';
import { typicalMonthlyNet } from './payroll.ts';
import { processDay } from './simulate.ts';
import type { Contract, GameState, Party, Rule } from './state.ts';
import { formatPLN } from './money.ts';

const NAME_RE = /^[\p{L}][\p{L}' .-]*$/u;
const NameSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Podaj wartość')
      .max(40, 'Maksymalnie 40 znaków')
      .regex(NAME_RE, 'Dozwolone są litery, spacje, apostrof, kropka i myślnik'),
  );

export const NewGameInputSchema = z.object({
  firstName: NameSchema,
  lastName: NameSchema,
  seed: z.string().trim().min(1, 'Seed nie może być pusty').max(100),
  /** Losowe wydarzenia życiowe (domyślnie włączone; wyłączenie służy głównie testom mechaniki bazowej). */
  lifeEvents: z.boolean().optional(),
});
export type NewGameInput = z.input<typeof NewGameInputSchema>;

export const PLAYER_ID = 'person:player';
export const PLAYER_ACCOUNT_ID = 'acc:player:main';
export const SAVINGS_ACCOUNT_ID = 'acc:player:savings';

const PARTIES: Party[] = [
  { id: 'party:employer', name: 'Pracodawca', role: 'employer' },
  { id: 'party:landlord', name: 'Wynajmujący', role: 'landlord' },
  { id: 'party:utilities', name: 'Dostawcy mediów', role: 'utility' },
  { id: 'party:telecom', name: 'Operator telekomunikacyjny', role: 'utility' },
  { id: 'party:grocery', name: 'Sklepy spożywcze', role: 'retail' },
  { id: 'party:transport', name: 'Komunikacja i paliwo', role: 'service' },
  { id: 'party:leisure', name: 'Rozrywka i usługi', role: 'service' },
  { id: 'party:bank', name: SAVINGS.bankName, role: 'service' },
];

function buildContracts(startDate: string, birthDate: string): Contract[] {
  return [
    {
      id: 'contract:employment',
      type: 'employment',
      partyId: 'party:employer',
      title: ECONOMY_V01.jobTitle,
      startDate,
      endDate: null,
      monthlyAmount: typicalMonthlyNet(ECONOMY_V01.grossSalary, birthDate, startDate),
      grossMonthly: ECONOMY_V01.grossSalary,
      hoursPerMonth: ECONOMY_V01.startHoursPerMonth,
      employmentForm: 'umowa_o_prace',
      noticeMonths: 1,
      location: 'Olsztyn',
      jobOfferId: null,
      terminatedBy: null,
      terminationNotifiedOn: null,
      dataStatus: 'placeholder',
    },
    {
      id: 'contract:lease',
      type: 'lease',
      partyId: 'party:landlord',
      title: START_HOME.title,
      startDate,
      endDate: null,
      monthlyAmount: ECONOMY_V01.monthlyRent,
      utilitiesMonthly: ECONOMY_V01.startUtilities,
      depositAmount: 0,
      movingCost: 0,
      areaM2: START_HOME.areaM2,
      standard: START_HOME.standard,
      district: START_HOME.district,
      listingId: null,
      noticeMonths: 1,
      terminatedOn: null,
      dataStatus: 'placeholder',
    },
  ];
}

function buildRules(startDate: string): Rule[] {
  const base = { startDate, endDate: null, dataStatus: 'placeholder' } as const;
  const E = ECONOMY_V01;
  const L = LIFESTYLE;
  return [
    {
      ...base, kind: 'obligation', id: 'rule:salary', direction: 'receivable', counterpartyId: 'party:employer', category: 'wynagrodzenie',
      description: 'Wynagrodzenie netto', issueDay: 'last', due: { monthOffset: 1, day: E.salaryPayDay },
      amount: { type: 'payroll', contractId: 'contract:employment' }, contractId: 'contract:employment',
    },
    {
      ...base, kind: 'obligation', id: 'rule:rent', direction: 'payable', counterpartyId: 'party:landlord', category: 'czynsz',
      description: 'Czynsz', issueDay: E.rentIssueDay, due: { monthOffset: 0, day: E.rentDueDay },
      amount: { type: 'contract', contractId: 'contract:lease' }, contractId: 'contract:lease',
    },
    {
      ...base, kind: 'obligation', id: 'rule:utilities', direction: 'payable', counterpartyId: 'party:utilities', category: 'media',
      description: 'Media i opłaty eksploatacyjne', issueDay: E.utilitiesIssueDay, due: { monthOffset: 0, day: E.utilitiesDueDay },
      amount: { type: 'contract', contractId: 'contract:lease', field: 'utilitiesMonthly' }, contractId: 'contract:lease',
    },
    {
      ...base, kind: 'obligation', id: 'rule:phone', direction: 'payable', counterpartyId: 'party:telecom', category: 'lacznosc',
      description: 'Telefon i internet', issueDay: E.phoneInternet.issueDay, due: { monthOffset: 0, day: E.phoneInternet.dueDay },
      amount: { type: 'fixed', amount: E.phoneInternet.amount }, contractId: null,
    },
    {
      ...base, kind: 'obligation', id: 'rule:groceries', direction: 'payable', counterpartyId: 'party:grocery', category: 'zywnosc',
      description: 'Zakupy spożywcze', issueDay: L.groceries.issueDay, due: { monthOffset: 0, day: L.groceries.dueDay },
      amount: { type: 'lifestyle', levels: { oszczedny: L.groceries.oszczedny, standardowy: L.groceries.standardowy, komfortowy: L.groceries.komfortowy }, spreadBps: 0 }, contractId: null,
    },
    {
      ...base, kind: 'obligation', id: 'rule:transport', direction: 'payable', counterpartyId: 'party:transport', category: 'transport',
      description: 'Transport', issueDay: L.transport.issueDay, due: { monthOffset: 0, day: L.transport.dueDay },
      amount: { type: 'lifestyle', levels: { oszczedny: L.transport.oszczedny, standardowy: L.transport.standardowy, komfortowy: L.transport.komfortowy }, spreadBps: 0 }, contractId: null,
    },
    {
      ...base, kind: 'obligation', id: 'rule:leisure', direction: 'payable', counterpartyId: 'party:leisure', category: 'rozrywka',
      description: 'Rozrywka i drobne wydatki', issueDay: L.leisure.issueDay, due: { monthOffset: 0, day: L.leisure.dueDay },
      amount: { type: 'lifestyle', levels: { oszczedny: L.leisure.oszczedny, standardowy: L.leisure.standardowy, komfortowy: L.leisure.komfortowy }, spreadBps: L.leisure.spreadBps }, contractId: null,
    },
    { kind: 'birthday', id: 'rule:birthday', startDate },
    { kind: 'savings_interest', id: 'rule:savings-interest', accountId: SAVINGS_ACCOUNT_ID, counterpartyId: 'party:bank', startDate },
  ];
}

/** Data urodzenia dająca dokładnie `age` lat w dniu `on` — wybierana deterministycznie z seeda. */
function pickBirthDate(seed: string, on: string, age: number): string {
  const latest = addMonths(on, -12 * age); // urodziny dokładnie w dniu startu
  const earliest = addDays(addMonths(on, -12 * (age + 1)), 1);
  const span = diffDays(latest, earliest);
  return addDays(earliest, createRng(seed, 'person.birthDate').int(0, span));
}

/** Tworzy nową grę. Rzuca ZodError przy nieprawidłowych danych wejściowych. */
export function createNewGame(input: NewGameInput): GameState {
  const { firstName, lastName, seed, lifeEvents } = NewGameInputSchema.parse(input);
  const startDate = GAME_START.date;
  if (!CITIES[GAME_START.cityId]) throw new Error(`Nieznane miasto: ${GAME_START.cityId}`);

  const birthDate = pickBirthDate(seed, startDate, GAME_START.age);
  const state: GameState = {
    gameId: `game:${seed}`,
    seed,
    clock: { startDate, today: startDate },
    person: {
      id: PLAYER_ID,
      firstName,
      lastName,
      birthDate,
      cityId: GAME_START.cityId,
    },
    parties: Object.fromEntries(PARTIES.map((p) => [p.id, p])),
    accounts: {
      [PLAYER_ACCOUNT_ID]: {
        id: PLAYER_ACCOUNT_ID,
        ownerId: PLAYER_ID,
        name: 'Rachunek osobisty',
        type: 'checking',
        currency: 'PLN',
        balance: 0,
        interest: null,
      },
      [SAVINGS_ACCOUNT_ID]: {
        id: SAVINGS_ACCOUNT_ID,
        ownerId: PLAYER_ID,
        name: SAVINGS.accountName,
        type: 'savings',
        currency: 'PLN',
        balance: 0,
        interest: { rateBps: SAVINGS.rateBps, taxBps: SAVINGS.taxBps, accumulator: 0, lastAccrualDate: null, dataStatus: 'placeholder' },
      },
    },
    playerAccountId: PLAYER_ACCOUNT_ID,
    contracts: buildContracts(startDate, birthDate),
    rules: buildRules(startDate),
    ledger: [],
    obligations: [],
    events: [],
    processed: {},
    history: [],
    openingCash: GAME_START.cash,
    life: {
      skills: { ...START_SKILLS },
      fatigue: TIME.startFatigue,
      fatigueDate: null,
      timePlan: { sleepHours: TIME.defaultSleep, businessHours: 0 },
      lifestyle: 'standardowy',
    },
    settings: { lifeEvents: lifeEvents ?? true, payrollFrom: startDate },
    assets: [],
    pending: [],
    applications: [],
    lifeEvents: [],
    commitments: [],
    counters: {},
    businesses: [],
    serviceOffers: [],
    serviceOrders: [],
    documents: [],
    taxPeriods: [],
    payslips: [],
    taxReturns: [],
    taxLosses: [],
    healthSettlements: [],
    reno: emptyReno(),
    accounting: emptyAccounting(),
  };

  postTransaction(state, {
    eventId: 'init:opening-balance',
    date: startDate,
    amount: GAME_START.cash,
    category: 'kapital_poczatkowy',
    description: 'Środki na start',
    counterpartyId: null,
    obligationId: null,
  });
  logEvent(state, {
    id: 'game.started',
    date: startDate,
    type: 'game.started',
    tone: 'neutral',
    title: `Początek gry — ${firstName} ${lastName}, ${CITIES[GAME_START.cityId]!.name}`,
    detail: `Kapitał na start: ${formatPLN(GAME_START.cash)}`,
    amount: GAME_START.cash,
    category: 'kapital_poczatkowy',
  });
  // Dzień startu jest „zamknięty” dopiero po przetworzeniu jego zdarzeń.
  processDay(state, startDate);
  return state;
}
