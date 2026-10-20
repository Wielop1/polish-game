import { computePayroll } from './payroll.ts';
import { CommandError, createObligation, ensureParty, logEvent, nextCounter } from './core.ts';
import { addDays, addMonths, dateInMonth, daysInMonth, firstOfNextMonth, formatDatePL, monthKey, parseIso, weekdayIndex } from './date.ts';
import type { IsoDate } from './date.ts';
import { RULES_2026 as R } from './legal.ts';
import { formatPLN, mulBps, roundDiv, zl } from './money.ts';
import type { Grosze } from './money.ts';
import { issueDocument, US_PARTY, ZUS_PARTY } from './business.ts';
import { requireActiveBusiness, requireCash } from './opsCommon.ts';
import { CORP } from './corpConfig.ts';
import { createRng } from './rng.ts';
import { macroAt } from './macro.ts';
import {
  FIRST_NAMES, LAST_NAMES, LEVEL_START_XP, LISTING_DAYS, LISTING_TIERS, MARKET_GROSS_BY_LEVEL, MAX_CANDIDATES_PER_LISTING, MAX_EMPLOYEES, ROLE_BY_ID, levelFromXp,
} from './renovationCatalog.ts';
import type {
  Operator, Candidate, EmployerContributions, EmployerPayslip, Employment, GameState, JobListing, WorkerPerson,
} from './state.ts';
import { firstOverload, performanceBps, workHoursPerWorkday } from './time.ts';

/**
 * Pracownicy jako element WSPÓLNEGO silnika (nie modułu branży): osoba (`WorkerPerson`) jest oddzielona od umowy
 * (`Employment`), więc może zmieniać pracodawców i stanowiska bez utraty historii. Płace liczy istniejący kalkulator
 * (`computePayroll`), a koszty pracodawcy — `employerContributions` (reguły EMP-* w legal.ts). Skutki finansowe: dokument
 * kosztowy listy płac (koszt podatkowy = brutto + składki pracodawcy) i trzy zobowiązania: netto, ZUS, zaliczka PIT.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const roundTo = (v: Grosze, unit: Grosze) => Math.max(unit, roundDiv(v, unit) * unit);

export const lastDayOfMonth = (date: IsoDate): IsoDate => {
  const { year, month } = parseIso(date);
  return dateInMonth(year, month, 'last');
};

/* ---------- Składki pracodawcy ---------- */

/**
 * Składki finansowane przez pracodawcę od wynagrodzenia (z proporcją dla niepełnego miesiąca):
 * emerytalna 9,76% i rentowa 6,5% (od podstawy z limitem 30-krotności), wypadkowa 1,67% (płatnik do 9 ubezpieczonych),
 * FP 2,45% i FGŚP 0,10% — tylko gdy miesięczna podstawa (bez proporcji) wynosi co najmniej minimalne wynagrodzenie (EMP-FP-THRESHOLD).
 */
export function employerContributions(gross: Grosze, pensionBase: Grosze, fullMonthlyGross: Grosze): EmployerContributions {
  const E = R.employer;
  const emerytalna = mulBps(pensionBase, E.emerytalnaBps);
  const rentowa = mulBps(pensionBase, E.rentowaBps);
  const wypadkowa = mulBps(gross, E.wypadkowaBps);
  const fundsDue = fullMonthlyGross >= R.minWage;
  const fp = fundsDue ? mulBps(gross, E.fpBps) : 0;
  const fgsp = fundsDue ? mulBps(gross, E.fgspBps) : 0;
  return { emerytalna, rentowa, wypadkowa, fp, fgsp, total: emerytalna + rentowa + wypadkowa + fp + fgsp };
}

/** Szacowany koszt całkowity miesiąca przy danym brutto (bez limitu 30-krotności) i godzinowy koszt pracodawcy. */
export function monthlyEmployerCost(gross: Grosze): Grosze {
  return gross + employerContributions(gross, gross, gross).total;
}
export const hourlyCostOf = (gross: Grosze, hoursPerMonth: number): Grosze => roundDiv(monthlyEmployerCost(gross), hoursPerMonth);

/** Minimalne wynagrodzenie proporcjonalnie do wymiaru czasu pracy. */
export const minGrossFor = (hoursPerMonth: number): Grosze => roundDiv(R.minWage * hoursPerMonth, 160);

/* ---------- Dostęp do danych ---------- */

export const personById = (s: GameState, id: string): WorkerPerson | undefined => s.ops.people.find((p) => p.id === id);
export const employmentById = (s: GameState, id: string): Employment | undefined => s.ops.employments.find((e) => e.id === id);
export const employmentActiveOn = (e: Employment, date: IsoDate): boolean => e.startDate <= date && (e.endDate === null || date <= e.endDate);
export const activeEmployments = (s: GameState, date: IsoDate = s.clock.today): Employment[] => s.ops.employments.filter((e) => employmentActiveOn(e, date));
export const employmentOfPerson = (s: GameState, personId: string, date: IsoDate): Employment | undefined => s.ops.employments.find((e) => e.personId === personId && employmentActiveOn(e, date));

export function wageOn(e: Employment, date: IsoDate): Grosze {
  let g = e.wageHistory[0]!.gross;
  for (const w of e.wageHistory) if (w.from <= date) g = w.gross;
  return g;
}

export function personLevel(p: WorkerPerson, skillId: string): number {
  return Math.max(1, levelFromXp(p.xp[skillId] ?? 0));
}

/** Wydajność pracownika (pkt bazowe): staranność × zmęczenie × morale. */
export function personPerformanceBps(p: WorkerPerson): number {
  const diligence = 8_500 + p.diligence * 30;
  const moraleF = 8_500 + p.morale * 20;
  return roundDiv(roundDiv(diligence * performanceBps(p.fatigue), 10_000) * moraleF, 10_000);
}

export const hoursPerWorkday = (e: Employment): number => workHoursPerWorkday(e.hoursPerMonth);
export const personName = (p: WorkerPerson): string => `${p.firstName} ${p.lastName}`;
export const wageAgeYears = (p: WorkerPerson, date: IsoDate): number => {
  const b = parseIso(p.birthDate);
  const d = parseIso(date);
  return d.year - b.year - (d.month < b.month || (d.month === b.month && d.day < b.day) ? 1 : 0);
};

/* ---------- Rekrutacja ---------- */

export function publishListing(s: GameState, input: { role: string; minLevel: number; tier: 'basic' | 'premium' }): string {
  const b = requireActiveBusiness(s);
  const role = ROLE_BY_ID.get(input.role);
  if (!role) throw new CommandError('Wybierz stanowisko.');
  if (!(input.tier in LISTING_TIERS)) throw new CommandError('Wybierz rodzaj ogłoszenia.');
  if (!Number.isInteger(input.minLevel) || input.minLevel < 1 || input.minLevel > 5) throw new CommandError('Minimalny poziom umiejętności: od 1 do 5.');
  if (s.ops.listings.some((l) => l.status === 'active' && l.businessId === b.id && l.role === input.role)) throw new CommandError('Ogłoszenie na to stanowisko jest już aktywne.');
  if (s.ops.listings.filter((l) => l.status === 'active').length >= 3) throw new CommandError('Możesz mieć najwyżej 3 aktywne ogłoszenia.');
  const tier = LISTING_TIERS[input.tier];
  requireCash(s, b, tier.costNet);
  const today = s.clock.today;
  const start = addDays(today, 1);
  const end = addDays(start, 4);
  const clash = firstOverload(s, start, end, { extraHoursPerDay: 1 });
  if (clash) throw new CommandError(`Rekrutacja zajmuje 1 godz. dziennie przez 5 dni, a ${formatDatePL(clash.date)} brakuje ${clash.missing} godz. Zmień plan dnia lub zakończ inne zobowiązania.`);
  const n = nextCounter(s, 'hr:listing');
  const id = `listing:${n}`;
  const doc = issueDocument(s, b, { kind: 'cost', issueDate: today, counterpartyId: 'party:supplier-reno', orderId: null, description: `Ogłoszenie o pracę: ${role.label} (${tier.label})`, net: tier.costNet, termDays: 0 });
  const commitmentId = `commit:${id}`;
  s.commitments.push({ id: commitmentId, label: `Rekrutacja: ${role.label}`, startDate: start, endDate: end, hoursPerDay: 1, sourceEventId: null });
  const l: JobListing = { id, businessId: b.id, role: input.role, skillId: role.skillId, minLevel: input.minLevel, tier: input.tier, postedOn: today, endsOn: addDays(today, LISTING_DAYS), status: 'active', costDocId: doc.id, commitmentId };
  s.ops.listings.push(l);
  logEvent(s, { id: `hr.recruitment:${id}`, date: today, type: 'hr.recruitment', tone: 'neutral', title: `Opublikowano ogłoszenie: ${role.label}`, detail: `${tier.label} · ${formatPLN(tier.costNet)} netto · aktywne do ${formatDatePL(l.endsOn)} · przeglądanie zgłoszeń zajmie 1 godz. dziennie przez 5 dni`, amount: null, category: null });
  return `Ogłoszenie opublikowane. Zgłoszenia będą napływać do ${formatDatePL(l.endsOn)}.`;
}

export function closeListing(s: GameState, listingId: string): string {
  const l = s.ops.listings.find((x) => x.id === listingId);
  if (!l || l.status !== 'active') throw new CommandError('To ogłoszenie nie jest aktywne.');
  l.status = 'closed';
  return 'Ogłoszenie zamknięte.';
}

/** Sąsiednie umiejętności (druga specjalizacja pracownika). */
const RELATED_SKILLS: Record<string, string[]> = { malowanie: ['gladzie', 'drobne'], gladzie: ['malowanie'], panele: ['drobne'], drobne: ['malowanie', 'panele'] };

function makeCandidate(s: GameState, l: JobListing, date: IsoDate): void {
  const rng = createRng(s.seed, `hr:cand:${l.id}:${date}`);
  // nie same ideały: ok. 35% zgłoszeń to osoby poniżej wymaganego poziomu, reszta od wymaganego w górę (z przewagą niższych)
  const roll = rng.int(0, 99);
  let level: number;
  if (roll < 35 && l.minLevel > 1) level = rng.int(1, l.minLevel - 1);
  else {
    const r = rng.int(0, 99);
    level = clamp(l.minLevel + (r < 55 ? 0 : r < 82 ? 1 : r < 94 ? 2 : 3), 1, 5);
  }
  const age = rng.int(19, 54);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const birth = addDays(addMonths(`${year - age}-${String(month).padStart(2, '0')}-01`, 0), day - 1 + rng.int(0, 200));
  const base = MARKET_GROSS_BY_LEVEL[level]!;
  // presja płacowa z koniunktury (v0.7): oczekiwania rynkowe rosną w dobrej, maleją w złej koniunkturze; płaca minimalna obowiązuje zawsze
  const expected = Math.max(R.minWage, roundTo(roundDiv(roundDiv(base * rng.int(90, 122), 100) * macroAt(s.seed, date.slice(0, 7)).wageBps, 10_000), zl(10)));
  const xpBand = (LEVEL_START_XP[Math.min(5, level + 1)] ?? LEVEL_START_XP[5]!) - LEVEL_START_XP[level]!;
  const pn = nextCounter(s, 'hr:person');
  const person: WorkerPerson = {
    id: `person:${pn}`, firstName: FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)]!, lastName: LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)]!, birthDate: birth,
    xp: { [l.skillId]: LEVEL_START_XP[level]! + (level < 5 ? rng.int(0, Math.max(0, xpBand - 1)) : rng.int(0, 20_000)) }, expectedGross: expected,
    availableFrom: addDays(date, rng.int(0, 45)), diligence: rng.int(35, 95), loyalty: rng.int(30, 95), morale: 60, fatigue: 10, status: 'candidate', lastWorkedOn: null,
  };
  // doświadczony pracownik wykończeniowy zwykle ogarnia też sąsiedni zakres (malarz — gładzie, monter podłóg — drobne prace…): druga umiejętność o poziom niżej;
  // bez tego ekipa 2–3 osób z różnych stanowisk odrzucała ok. 40% zleceń „z braku umiejętności”
  const related = RELATED_SKILLS[l.skillId];
  if (related && level >= 2 && rng.int(0, 99) < 65) {
    const sec = related[rng.int(0, related.length - 1)]!;
    person.xp[sec] = LEVEL_START_XP[level - 1]!;
  }
  s.ops.people.push(person);
  const cn = nextCounter(s, 'hr:candidate');
  s.ops.candidates.push({
    id: `cand:${cn}`, listingId: l.id, personId: person.id, appliedOn: date, expiresOn: addDays(date, 14), status: 'new', rounds: 0, lastOffer: null, counterGross: null, note: '', employmentId: null,
  });
  logEvent(s, { id: `hr.recruitment:cand:${cn}`, date, type: 'hr.recruitment', tone: 'neutral', title: `Nowe zgłoszenie: ${ROLE_BY_ID.get(l.role)!.label}`, detail: `${personName(person)}, ${age} lat · poziom ${level} · oczekuje ${formatPLN(expected, { round: true })} brutto`, amount: null, category: null });
}

export function candidateView(s: GameState, c: Candidate): { person: WorkerPerson; listing: JobListing; level: number } {
  const person = personById(s, c.personId)!;
  const listing = s.ops.listings.find((l) => l.id === c.listingId)!;
  return { person, listing, level: personLevel(person, listing.skillId) };
}

export interface Offer { gross: Grosze; hoursPerMonth: number; startDate: IsoDate }

export function offerChecks(s: GameState, c: Candidate, o: Offer): string | null {
  const person = personById(s, c.personId)!;
  const today = s.clock.today;
  if (!Number.isInteger(o.hoursPerMonth) || o.hoursPerMonth < 80 || o.hoursPerMonth > 168) return 'Wymiar czasu pracy: od 80 do 168 godzin miesięcznie (pełny etat = 160).';
  if (!Number.isInteger(o.gross) || o.gross < minGrossFor(o.hoursPerMonth)) return `Wynagrodzenie nie może być niższe niż minimalne proporcjonalnie do wymiaru (${formatPLN(minGrossFor(o.hoursPerMonth))} brutto).`;
  if (o.startDate <= today) return 'Rozpoczęcie pracy najwcześniej jutro.';
  if (o.startDate > addDays(today, 60)) return 'Rozpoczęcie pracy najpóźniej za 60 dni.';
  if (o.startDate < person.availableFrom) return `Kandydat jest dostępny dopiero od ${formatDatePL(person.availableFrom)} (okres wypowiedzenia u obecnego pracodawcy).`;
  if (activeEmployments(s).length + s.ops.employments.filter((e) => e.status === 'active' && e.startDate > today).length >= MAX_EMPLOYEES) return `Limit zatrudnienia: ${MAX_EMPLOYEES} pracowników (stopa składki wypadkowej 1,67% dotyczy płatnika do ${R.employer.maxInsured} ubezpieczonych, razem z właścicielem).`;
  return null;
}

function hire(s: GameState, b: Operator, c: Candidate, o: Offer): Employment {
  const person = personById(s, c.personId)!;
  const l = s.ops.listings.find((x) => x.id === c.listingId)!;
  const n = nextCounter(s, 'hr:employment');
  const e: Employment = {
    id: `emp:${n}`, personId: person.id, businessId: b.id, role: l.role, grossMonthly: o.gross, hoursPerMonth: o.hoursPerMonth, startDate: o.startDate, endDate: null,
    noticeGivenOn: null, noticeLabel: null, wageHistory: [{ from: o.startDate, gross: o.gross }], hourlyCost: hourlyCostOf(o.gross, o.hoursPerMonth), status: 'active',
  };
  s.ops.employments.push(e);
  person.status = 'employee';
  c.status = 'hired';
  c.employmentId = e.id;
  logEvent(s, { id: `hr.employment:${e.id}`, date: s.clock.today, type: 'hr.employment', tone: 'positive', title: `Zatrudniono: ${personName(person)} (${ROLE_BY_ID.get(l.role)!.label})`, detail: `${formatPLN(o.gross)} brutto miesięcznie · koszt pracodawcy ok. ${formatPLN(monthlyEmployerCost(o.gross))} · od ${formatDatePL(o.startDate)}`, amount: null, category: null });
  return e;
}

/** Oferta zatrudnienia: kandydat akceptuje, negocjuje (jedna kontrpropozycja na rundę, max 2 rundy) albo odmawia. */
export function makeOffer(s: GameState, candidateId: string, o: Offer): string {
  const b = requireActiveBusiness(s);
  const c = s.ops.candidates.find((x) => x.id === candidateId);
  if (!c || (c.status !== 'new' && c.status !== 'countered')) throw new CommandError('Ten kandydat nie czeka na ofertę.');
  const err = offerChecks(s, c, o);
  if (err) throw new CommandError(err);
  const person = personById(s, c.personId)!;
  const expectedPart = roundTo(roundDiv(person.expectedGross * o.hoursPerMonth, 160), zl(10));
  const ratio = roundDiv(o.gross * 10_000, expectedPart);
  c.lastOffer = o;
  const rng = createRng(s.seed, `hr:offer:${c.id}:${c.rounds}`);
  c.rounds += 1;
  if (c.status === 'countered' && c.counterGross !== null && o.gross >= c.counterGross) {
    hire(s, b, c, o);
    return `${personName(person)} przyjął(-ęła) ofertę. Praca od ${formatDatePL(o.startDate)}.`;
  }
  if (ratio >= 10_000) {
    if (rng.int(0, 99) < 90) { hire(s, b, c, o); return `${personName(person)} przyjął(-ęła) ofertę. Praca od ${formatDatePL(o.startDate)}.`; }
    c.status = 'declined'; c.note = 'przyjął(-ęła) ofertę innego pracodawcy';
    return `${personName(person)} odmówił(a): przyjął(-ęła) ofertę innego pracodawcy.`;
  }
  if (ratio >= 9_200 && c.rounds < 2) {
    c.status = 'countered';
    c.counterGross = expectedPart;
    c.expiresOn = addDays(s.clock.today, 7);
    c.note = `proponuje ${formatPLN(expectedPart)} brutto`;
    return `${personName(person)} prosi o ${formatPLN(expectedPart)} brutto miesięcznie. Możesz złożyć nową ofertę (do ${formatDatePL(c.expiresOn)}).`;
  }
  c.status = 'declined';
  c.note = ratio < 9_200 ? 'oferta zbyt niska' : 'brak porozumienia po negocjacjach';
  return `${personName(person)} odmówił(a): ${c.note}.`;
}

export function rejectCandidate(s: GameState, candidateId: string): string {
  const c = s.ops.candidates.find((x) => x.id === candidateId);
  if (!c || (c.status !== 'new' && c.status !== 'countered')) throw new CommandError('Ten kandydat nie czeka na decyzję.');
  c.status = 'rejected';
  const p = personById(s, c.personId);
  if (p) p.status = 'withdrawn';
  return 'Zgłoszenie odrzucone.';
}

/* ---------- Wypowiedzenie i zmiana wynagrodzenia ---------- */

/** Okres wypowiedzenia wg stażu u pracodawcy (art. 36 KP): < 6 mies. — 2 tygodnie, ≥ 6 mies. — 1 miesiąc, ≥ 3 lata — 3 miesiące. */
export function noticePeriod(e: Employment, date: IsoDate): { label: string; endDate: IsoDate } {
  if (addMonths(e.startDate, 36) <= date) return { label: '3 miesiące', endDate: lastDayOfMonth(addMonths(`${date.slice(0, 8)}01`, 3)) };
  if (addMonths(e.startDate, 6) <= date) return { label: '1 miesiąc', endDate: lastDayOfMonth(addMonths(`${date.slice(0, 8)}01`, 1)) };
  let d = addDays(date, 13);
  while (weekdayIndex(d) !== 5) d = addDays(d, 1); // okres liczony w tygodniach upływa w sobotę
  return { label: '2 tygodnie', endDate: d };
}

export function giveNotice(s: GameState, employmentId: string): string {
  requireActiveBusiness(s);
  const e = employmentById(s, employmentId);
  if (!e || e.status !== 'active' || !employmentActiveOn(e, s.clock.today)) throw new CommandError('Ta umowa nie jest aktywna.');
  if (e.noticeGivenOn) throw new CommandError('Wypowiedzenie zostało już złożone.');
  const p = noticePeriod(e, s.clock.today);
  e.noticeGivenOn = s.clock.today;
  e.noticeLabel = p.label;
  e.endDate = p.endDate;
  const person = personById(s, e.personId)!;
  logEvent(s, { id: `hr.employment:${e.id}:notice`, date: s.clock.today, type: 'hr.employment', tone: 'warning', title: `Wypowiedzenie umowy: ${personName(person)}`, detail: `Okres wypowiedzenia ${p.label} — ostatni dzień zatrudnienia ${formatDatePL(p.endDate)}. W tym czasie nadal płacisz wynagrodzenie i składki; ekwiwalent urlopu i odprawy nie są modelowane (FE-HR-02).`, amount: null, category: null });
  return `Wypowiedzenie złożone (${p.label}). Ostatni dzień pracy: ${formatDatePL(p.endDate)}.`;
}

export function setWage(s: GameState, employmentId: string, gross: Grosze): string {
  requireActiveBusiness(s);
  const e = employmentById(s, employmentId);
  if (!e || e.status !== 'active') throw new CommandError('Ta umowa nie jest aktywna.');
  if (!Number.isInteger(gross) || gross < minGrossFor(e.hoursPerMonth)) throw new CommandError(`Wynagrodzenie nie może być niższe niż minimalne proporcjonalnie do wymiaru (${formatPLN(minGrossFor(e.hoursPerMonth))} brutto).`);
  const from = firstOfNextMonth(s.clock.today);
  e.wageHistory = e.wageHistory.filter((w) => w.from < from);
  e.wageHistory.push({ from, gross });
  e.hourlyCost = hourlyCostOf(gross, e.hoursPerMonth);
  return `Nowe wynagrodzenie ${formatPLN(gross)} brutto obowiązuje od ${formatDatePL(from)}.`;
}

/* ---------- Lista płac ---------- */

function ytdFor(s: GameState, personId: string, accrualYear: number, payYear: number) {
  let pensionBase = 0, pitBase = 0, exempt = 0;
  for (const p of s.ops.payslips) {
    if (p.personId !== personId) continue;
    if (parseIso(p.accrualDate).year === accrualYear) pensionBase += p.pensionBase;
    if (parseIso(p.payDate).year === payYear) { pitBase += p.pitBase; exempt += p.exemptGross; }
  }
  return { pensionBase, pitBase, exempt };
}

function issuePayroll(s: GameState, b: Operator, e: Employment, date: IsoDate): void {
  const month = monthKey(date);
  const id = `eps:${e.id}:${month}`;
  if (s.ops.payslips.some((p) => p.id === id)) return;
  const { year, month: m } = parseIso(date);
  const monthStart = dateInMonth(year, m, 1);
  const first = e.startDate > monthStart ? e.startDate : monthStart;
  const last = e.endDate !== null && e.endDate < date ? e.endDate : date;
  if (last < first) return;
  const days = parseIso(last).day - parseIso(first).day + 1;
  const factorBps = Math.min(10_000, roundDiv(days * 10_000, daysInMonth(year, m)));
  const wage = wageOn(e, last);
  const gross = Math.max(1, mulBps(wage, factorBps));
  const person = personById(s, e.personId)!;
  const next = firstOfNextMonth(date);
  const ny = parseIso(next);
  const payDate = dateInMonth(ny.year, ny.month, R.employer.payDay);
  const ytd = ytdFor(s, person.id, year, ny.year);
  const calc = computePayroll({ gross, accrualDate: date, payDate, birthDate: person.birthDate, ytdPensionBase: ytd.pensionBase, ytdPitBase: ytd.pitBase, ytdExempt: ytd.exempt, pit2: true });
  const emp = employerContributions(gross, calc.pensionBase, wage);
  const totalCost = gross + emp.total;
  const zusAmount = calc.socialTotal + calc.health + emp.total;
  const seq = nextCounter(s, `doc:cost:${month}`);
  const docId = `doc:${b.id}:payroll:${month}:${e.id}`;
  const number = `LP/${month.replace('-', '/')}/${String(seq).padStart(3, '0')}`;
  const termDate = dateInMonth(ny.year, ny.month, b.ownerId === s.person.id ? R.employer.zusDay : CORP.zusDayLegalEntity);
  s.documents.push({
    id: docId, businessId: b.id, kind: 'cost', number, issueDate: date, saleDate: date, counterpartyId: `party:emp:${person.id}`, orderId: null,
    description: `Lista płac ${month}: ${personName(person)}`, net: totalCost, vatRateBps: 0, vat: 0, gross: totalCost, vatTreatment: 'exempt', termDate, obligationIds: [], taxAmount: totalCost, part: 'payroll',
  });
  const doc = s.documents[s.documents.length - 1]!;
  ensureParty(s, { id: `party:emp:${person.id}`, name: personName(person), role: 'service' });
  const base = { ruleId: `payroll:${e.id}`, issueDate: date, accountId: b.accountId, direction: 'payable' as const };
  const make = (suffix: string, counterpartyId: string, amount: Grosze, dueDate: IsoDate, category: string, description: string) => {
    if (amount <= 0) return;
    const ob = createObligation(s, { ...base, occurrenceId: `${docId}:${suffix}`, counterpartyId, amount, dueDate, category, description });
    if (ob) doc.obligationIds.push(ob.id);
  };
  make('net', `party:emp:${person.id}`, calc.net, payDate, 'wynagrodzenie_pracownika', `Wynagrodzenie netto ${month}: ${personName(person)}`);
  make('zus', ZUS_PARTY, zusAmount, termDate, 'skladki_pracownicze', `Składki ZUS za ${month}: ${personName(person)}`);
  make('pit', US_PARTY, calc.pitAdvance, dateInMonth(ny.year, ny.month, R.employer.pitDay), 'zaliczka_pit_pracownicza', `Zaliczka PIT za ${month}: ${personName(person)}`);
  const slip: EmployerPayslip = {
    id, employmentId: e.id, personId: person.id, businessId: b.id, month, accrualDate: date, payDate, factorBps, gross, pensionBase: calc.pensionBase, emerytalna: calc.emerytalna,
    rentowa: calc.rentowa, chorobowa: calc.chorobowa, socialTotal: calc.socialTotal, health: calc.health, exemptGross: calc.exemptGross, taxableSocial: calc.taxableSocial, koszty: calc.koszty,
    pitBase: calc.pitBase, pitAdvance: calc.pitAdvance, net: calc.net, reductionApplied: calc.reductionApplied, employer: emp, totalCost, docId, obligationIds: [...doc.obligationIds],
  };
  s.ops.payslips.push(slip);
  logEvent(s, { id: `hr.payroll:${id}`, date, type: 'hr.payroll', tone: 'neutral', title: `Lista płac ${month}: ${personName(person)}`, detail: `brutto ${formatPLN(gross)} · netto ${formatPLN(calc.net)} · składki pracodawcy ${formatPLN(emp.total)} · koszt całkowity ${formatPLN(totalCost)}`, amount: -totalCost, category: 'koszt_dzialalnosci' });
}

/** Miesięczny koszt zatrudnienia (lista płac) i część przypisana do kontraktów; reszta to koszt stały (bezczynność). */
export function payrollMonth(s: GameState, month: string): { total: Grosze; allocated: Grosze; idle: Grosze } {
  const total = s.ops.payslips.filter((p) => p.month === month).reduce((a, p) => a + p.totalCost, 0);
  const allocated = Math.min(total, s.ops.laborAllocated[month] ?? 0);
  return { total, allocated, idle: total - allocated };
}

/* ---------- Przetwarzanie dnia ---------- */

function updateWellbeing(s: GameState, date: IsoDate): void {
  const workday = weekdayIndex(date) < 5;
  for (const e of s.ops.employments) {
    if (!employmentActiveOn(e, date)) continue;
    const p = personById(s, e.personId)!;
    const worked = p.lastWorkedOn === date;
    p.fatigue = clamp(p.fatigue + (workday ? (worked ? 2 : -1) : -4), 0, 100);
    const ratio = roundDiv(wageOn(e, date) * 160 * 10_000, e.hoursPerMonth * p.expectedGross);
    const target = clamp(60 + Math.round((ratio - 10_000) / 40) - Math.round(p.fatigue / 4), 15, 95);
    p.morale = clamp(p.morale + (p.morale < target ? 1 : p.morale > target ? -1 : 0), 0, 100);
  }
}

export function processWorkforce(s: GameState, b: Operator, date: IsoDate): void {
  const key = `ops:day:${b.id}:${date}`;
  if (s.processed[key]) return;
  s.processed[key] = true;
  for (const l of s.ops.listings) {
    if (l.status !== 'active' || l.businessId !== b.id) continue;
    if (date > l.endsOn) { l.status = 'closed'; continue; }
    const live = s.ops.candidates.filter((c) => c.listingId === l.id).length;
    if (live >= MAX_CANDIDATES_PER_LISTING) continue;
    if (createRng(s.seed, `hr:chance:${l.id}:${date}`).int(0, 9_999) < LISTING_TIERS[l.tier].rateBps) makeCandidate(s, l, date);
  }
  for (const c of s.ops.candidates) {
    if ((c.status === 'new' || c.status === 'countered') && date > c.expiresOn) {
      c.status = 'expired';
      const p = personById(s, c.personId);
      if (p) p.status = 'withdrawn';
    }
  }
  for (const e of s.ops.employments) {
    if (e.status === 'active' && e.endDate !== null && date > e.endDate) {
      e.status = 'ended';
      const p = personById(s, e.personId)!;
      p.status = 'former';
      logEvent(s, { id: `hr.employment:${e.id}:ended`, date, type: 'hr.employment', tone: 'neutral', title: `Zakończono zatrudnienie: ${personName(p)}`, detail: `Ostatni dzień pracy: ${formatDatePL(e.endDate)}. Historia zatrudnienia i wynagrodzeń zostaje przy osobie.`, amount: null, category: null });
    }
  }
  updateWellbeing(s, date);
  if (parseIso(date).day === daysInMonth(parseIso(date).year, parseIso(date).month)) {
    for (const e of s.ops.employments) if (e.businessId === b.id) issuePayroll(s, b, e, date);
  }
}
