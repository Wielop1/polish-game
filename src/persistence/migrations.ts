/**
 * Migracje formatu zapisu. Każda funkcja przekształca SUROWY stan z wersji N do N+1 i jest czysta.
 * Wartości domyślne są tu ZAMROŻONE (kopia, nie import z `config.ts`) — zmiana konfiguracji gry
 * w przyszłości nie może zmieniać wyniku migracji starych zapisów.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const V2 = {
  savings: { id: 'acc:player:savings', name: 'Konto oszczędnościowe', rateBps: 350, taxBps: 1_900 },
  bank: { id: 'party:bank', name: 'Bank (fikcyjny)', role: 'service' },
  skills: { biuro: 2, obsluga_klienta: 2, sprzedaz: 1, techniczne: 1, angielski: 2 },
  fatigue: 10,
  sleepHours: 8,
  /** Poziomy stylu życia: „standardowy” = kwota z zapisu v1 (bez zmiany zachowania), pozostałe — wartości domyślne v0.2. */
  lifestyle: {
    'rule:groceries': { oszczedny: 80_000, komfortowy: 140_000 },
    'rule:transport': { oszczedny: 15_000, komfortowy: 35_000 },
    'rule:leisure': { oszczedny: 15_000, komfortowy: 70_000 },
  } as Record<string, { oszczedny: number; komfortowy: number }>,
} as const;

/** v1 → v2: kariera, mieszkanie, budżet czasu, styl życia, oszczędności, wydarzenia. Historia finansowa pozostaje nietknięta. */
export function migrateV1ToV2(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) throw new Error('Zapis v1 ma nieprawidłową strukturę stanu.');
  const s = structuredClone(raw) as Json;
  const playerAccountId: string = s.playerAccountId;
  const personId: string = s.person?.id;

  // Rachunki: bieżący + nowy rachunek oszczędnościowy (puste saldo — nic nie jest zmyślane).
  for (const acc of Object.values<Json>(s.accounts)) {
    acc.type = 'checking';
    acc.interest = null;
  }
  s.accounts[V2.savings.id] = {
    id: V2.savings.id, ownerId: personId, name: V2.savings.name, type: 'savings', currency: 'PLN', balance: 0,
    interest: { rateBps: V2.savings.rateBps, taxBps: V2.savings.taxBps, accumulator: 0, lastAccrualDate: null, dataStatus: 'placeholder' },
  };
  s.parties[V2.bank.id] ??= { ...V2.bank };

  // Umowy: pola v0.2 z wartościami „brak danych” tam, gdzie v1 ich nie znało.
  const lease = (s.contracts as Json[]).find((c) => c.type === 'lease');
  const utilitiesRule = (s.rules as Json[]).find((r) => r.id === 'rule:utilities' && r.amount?.type === 'fixed');
  for (const c of s.contracts as Json[]) {
    if (c.type === 'employment') {
      Object.assign(c, {
        grossMonthly: null, hoursPerMonth: 168, employmentForm: 'umowa_o_prace', noticeMonths: 1, location: 'Olsztyn',
        jobOfferId: null, terminatedBy: null, terminationNotifiedOn: null,
      });
    } else if (c.type === 'lease') {
      Object.assign(c, {
        utilitiesMonthly: c === lease && utilitiesRule ? utilitiesRule.amount.amount : 0,
        depositAmount: 0, movingCost: 0, areaM2: null, standard: null, district: null, listingId: null, noticeMonths: 1, terminatedOn: null,
      });
    }
  }

  // Reguły: powiązanie z umowami, opłaty z umowy najmu, wydatki zależne od stylu życia.
  for (const r of s.rules as Json[]) {
    if (r.kind !== 'obligation') continue;
    r.contractId = r.amount?.type === 'contract' ? r.amount.contractId : null;
    if (r.id === 'rule:utilities' && r.amount.type === 'fixed' && lease) {
      r.amount = { type: 'contract', contractId: lease.id, field: 'utilitiesMonthly' };
      r.contractId = lease.id;
    }
    const levels = V2.lifestyle[r.id];
    if (levels && (r.amount.type === 'fixed' || r.amount.type === 'variable')) {
      const standard: number = r.amount.type === 'fixed' ? r.amount.amount : r.amount.base;
      const spreadBps: number = r.amount.type === 'variable' ? r.amount.spreadBps : 0;
      r.amount = { type: 'lifestyle', levels: { oszczedny: levels.oszczedny, standardowy: standard, komfortowy: levels.komfortowy }, spreadBps };
    }
  }
  (s.rules as Json[]).push({ kind: 'savings_interest', id: 'rule:savings-interest', accountId: V2.savings.id, counterpartyId: V2.bank.id, startDate: s.clock.startDate });

  for (const tx of s.ledger as Json[]) tx.transferId = null;
  for (const o of s.obligations as Json[]) o.accountId = playerAccountId;
  for (const h of s.history as Json[]) h.savings = 0;

  s.life = {
    skills: { ...V2.skills }, fatigue: V2.fatigue, fatigueDate: null,
    timePlan: { sleepHours: V2.sleepHours, businessHours: 0 }, lifestyle: 'standardowy',
  };
  s.settings = { lifeEvents: true };
  s.assets = [];
  s.pending = [];
  s.applications = [];
  s.lifeEvents = [];
  s.commitments = [];
  s.counters = {};
  return s;
}

/**
 * v2 → v3: działalność gospodarcza (JDG). Historia finansowa nietknięta; zobowiązania z v2 są prywatne
 * (`scope: 'personal'`), a nowe kolekcje JDG są puste — nic nie jest zmyślane.
 */
export function migrateV2ToV3(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) throw new Error('Zapis v2 ma nieprawidłową strukturę stanu.');
  const s = structuredClone(raw) as Json;
  for (const o of s.obligations as Json[]) o.scope = 'personal';
  s.businesses = [];
  s.serviceOffers = [];
  s.serviceOrders = [];
  s.documents = [];
  s.taxPeriods = [];
  return s;
}

/**
 * v3 → v4: kalkulator płac, rozliczenia roczne, straty, zawieszenie, zmiana formy, Mały ZUS Plus.
 * Historia nietknięta: wynagrodzenia naliczone do dnia migracji zachowują dotychczasową kwotę (`payrollFrom`),
 * rozliczenia miesięczne dostają pole `form` (forma z działalności), nowe kolekcje są puste.
 */
export function migrateV3ToV4(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) throw new Error('Zapis v3 ma nieprawidłową strukturę stanu.');
  const s = structuredClone(raw) as Json;
  const [y, m, d] = (s.clock.today as string).split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  s.settings = { ...s.settings, payrollFrom: next };
  for (const r of s.rules as Json[]) {
    if (r.kind === 'obligation' && r.category === 'wynagrodzenie' && r.amount?.type === 'contract') {
      r.amount = { type: 'payroll', contractId: r.amount.contractId };
    }
  }
  const formOf = new Map<string, string>();
  for (const b of s.businesses as Json[]) {
    b.suspensions = [];
    b.taxFormPlan = null;
    b.taxFormHistory = [{ form: b.taxForm, from: b.startDate }];
    b.zus = { ...b.zus, malyPlus: { active: false, base: null, since: null, baseYear: null } };
    formOf.set(b.id, b.taxForm);
  }
  for (const p of s.taxPeriods as Json[]) p.form = formOf.get(p.businessId) ?? 'skala';
  s.payslips = [];
  s.taxReturns = [];
  s.taxLosses = [];
  s.healthSettlements = [];
  return s;
}

/**
 * v4 → v5: moduł branżowy (remonty) i księgowość. Dokumenty dotychczas wystawione to „całość” (nie zaliczki),
 * zlecenia v0.3 to zwykłe zlecenia szablonowe; nowe kolekcje są puste. Historia finansowa pozostaje nietknięta.
 */
export function migrateV4ToV5(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) throw new Error('Zapis v4 ma nieprawidłową strukturę stanu.');
  const s = structuredClone(raw) as Json;
  for (const d of s.documents as Json[]) d.part = 'full';
  for (const o of s.serviceOrders as Json[]) o.kind = 'service';
  s.reno = {
    specializations: [], skillXp: {}, advertising: { level: 'none', since: null, paidMonth: null }, enquiries: [], quotes: [], jobs: [],
    equipment: [], stock: {}, stockMoves: [], reviews: [], complaints: [],
  };
  s.accounting = { office: null, history: [], lastFeeMonth: null, suggestions: [] };
  return s;
}

/**
 * v5 → v6: pracownicy, ekipy, podwykonawcy, pojazdy (`ops`) i nowe pola kontraktów remontowych.
 * Historia nietknięta. Zaliczki sprzed v0.6 pozostają ujęte jak dotąd (`advanceMode: 'legacy'` — przychód w dacie wystawienia),
 * nowe zaliczki są ujmowane jako zobowiązanie do wykonania usługi (kontrolowane rozróżnienie zamiast zmiany zaksięgowanych operacji).
 */
export function migrateV5ToV6(raw: unknown, buildPool: (seed: string) => unknown[]): unknown {
  if (typeof raw !== 'object' || raw === null) throw new Error('Zapis v5 ma nieprawidłową strukturę stanu.');
  const s = structuredClone(raw) as Json;
  for (const j of s.reno.jobs as Json[]) {
    j.actual = { ...j.actual, labor: 0, subcontract: 0, vehicle: 0 };
    j.crew = { teamId: null, supervision: 'worker' };
    j.advanceMode = 'legacy';
    j.qualityHoursCenti = 0;
    j.qualityWeightedSum = 0;
    j.vehicleId = null;
  }
  for (const q of s.reno.quotes as Json[]) {
    q.teamId = null;
    q.supervision = 'worker';
    q.vehicleId = null;
  }
  s.ops = {
    people: [], employments: [], payslips: [], listings: [], candidates: [], subcontractors: buildPool(s.seed as string), subcontracts: [], teams: [], assignments: [], vehicles: [],
    laborAllocated: {}, vehicleRunning: {},
  };
  return s;
}

/** Wartości zamrożone na potrzeby migracji v6 → v7 (kopia, nie import z konfiguracji rynku). */
const V7 = {
  /** Dawna reklama → budżety kanałów (zachowany miesięczny koszt: 400 zł lokalna; 1 100 zł intensywna = wyszukiwarka 600 + portale 500). */
  adBudgets: { local: { local_ads: 40_000 }, intensive: { search: 60_000, portals: 50_000 } } as Record<string, Record<string, number>>,
  /** Maks. widoczność i nasycenie kanałów — do ustawienia startowej widoczności tak, by migracja nie „wyzerowała” trwającej reklamy. */
  channels: { local_ads: { maxReach: 5_500, saturation: 70_000 }, search: { maxReach: 11_000, saturation: 160_000 }, portals: { maxReach: 9_000, saturation: 110_000 } } as Record<string, { maxReach: number; saturation: number }>,
} as const;

/**
 * v6 → v7: rynek lokalny, konkurencja, marketing i pozycjonowanie. Historia finansowa, dokumenty i kontrakty zostają nietknięte.
 * Nie generujemy wstecznie konkurentów, zdarzeń ani przychodów: `market.initializedOn = null` — model rynku startuje „od teraz”
 * w pierwszym przetworzonym dniu firmy remontowej. Dawna reklama (`reno.advertising`) staje się budżetami kanałów marketingowych
 * (ten sam miesięczny koszt, widoczność od razu na poziomie docelowym). Zapytania sprzed v0.7 dostają segment wg wymagań jakościowych
 * i brak konkurencji (nie były porównywane z innymi firmami).
 */
export function migrateV6ToV7(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) throw new Error('Zapis v6 ma nieprawidłową strukturę stanu.');
  const s = structuredClone(raw) as Json;
  const ad = s.reno?.advertising as { level?: string; paidMonth?: string | null } | undefined;
  const budgets: Record<string, number> = { ...(V7.adBudgets[ad?.level ?? 'none'] ?? {}) };
  const reach: Record<string, number> = {};
  for (const [ch, b] of Object.entries(budgets)) {
    const def = V7.channels[ch]!;
    reach[ch] = Math.round((def.maxReach * b) / (b + def.saturation));
  }
  s.market = {
    cityId: 'olsztyn', industryId: 'renovation', initializedOn: null, competitors: [],
    marketing: { budgets, reach, lastChargedMonth: ad?.paidMonth ?? null, spend: [] },
    strategy: { positioning: 'balanced', previous: null, changedOn: null, lastChargedMonth: null, history: [] },
    months: [], current: null, lastEntryMonth: null,
  };
  delete s.reno.advertising;
  for (const e of s.reno.enquiries as Json[]) {
    e.segment = e.qualityReq === 1 ? 'budget' : e.qualityReq === 3 ? 'premium' : 'standard';
    e.source = null;
    e.rivals = 0;
    e.rivalId = null;
    e.rivalUtility = 0;
    e.rivalAwarded = false;
  }
  return s;
}
