import { JOB_CATALOG } from './config.ts';
import { typicalMonthlyNet } from './payroll.ts';
import type { JobOffer } from './config.ts';
import { SKILL_LABELS } from './config.ts';
import { CommandError, ensureParty, logEvent, nextCounter, partyName } from './core.ts';
import { currentEmployment, employmentContracts, upcomingEmployment } from './contracts.ts';
import { addDays, addMonthsToKey, dateInMonth, firstOfNextMonth, formatDatePL, monthKey, monthKeyToYm } from './date.ts';
import type { IsoDate } from './date.ts';
import { formatPLN, mulBps } from './money.ts';
import { createRng } from './rng.ts';
import type { EmploymentContract, GameState, JobApplication, Skill } from './state.ts';
import { firstOverload, performanceBps } from './time.ts';

export function offerById(id: string): JobOffer | undefined {
  return JOB_CATALOG.find((o) => o.id === id);
}

/** Ostatni dzień miesiąca przypadającego `noticeMonths` miesięcy po miesiącu wypowiedzenia. */
export function noticeEndDate(from: IsoDate, noticeMonths: number): IsoDate {
  const { year, month } = monthKeyToYm(addMonthsToKey(monthKey(from), noticeMonths));
  return dateInMonth(year, month, 'last');
}

/* ---------- Dopasowanie do oferty ---------- */

export interface SkillGap {
  skill: Skill;
  label: string;
  required: number;
  have: number;
}

export function skillGaps(s: GameState, offer: JobOffer): SkillGap[] {
  return (Object.entries(offer.requiredSkills) as [Skill, number][]).map(([skill, required]) => ({
    skill,
    label: SKILL_LABELS[skill],
    required,
    have: s.life.skills[skill] ?? 0,
  }));
}

/** Szansa (pkt bazowe) na pozytywną decyzję pracodawcy. 0 = brak szans (duże braki kompetencji). */
export function applicationChanceBps(s: GameState, offer: JobOffer): number {
  let score = 3_500;
  for (const g of skillGaps(s, offer)) {
    const margin = g.have - g.required;
    if (margin <= -2) return 0;
    score += margin >= 0 ? 1_200 * Math.min(margin, 2) : -2_500;
  }
  // Zmęczony kandydat wypada gorzej na rozmowie.
  score -= Math.max(0, s.life.fatigue - 50) * 30;
  return Math.min(9_000, Math.max(500, score));
}

export type ChanceLabel = 'brak szans' | 'niska' | 'średnia' | 'wysoka';
export function chanceLabel(bps: number): ChanceLabel {
  if (bps === 0) return 'brak szans';
  if (bps < 3_500) return 'niska';
  if (bps < 6_500) return 'średnia';
  return 'wysoka';
}

const REAPPLY_COOLDOWN_DAYS = 60;

export function applicationBlocker(s: GameState, offerId: string): string | null {
  const offer = offerById(offerId);
  if (!offer) return 'Nie ma takiej oferty.';
  const cur = currentEmployment(s);
  if (cur && cur.jobOfferId === offerId && cur.endDate === null) return 'Już tu pracujesz.';
  const open = s.applications.find((a) => a.offerId === offerId && (a.status === 'pending' || a.status === 'offered'));
  if (open) return open.status === 'pending' ? 'Aplikacja na tę ofertę jest już w trakcie rozpatrywania.' : 'Masz już propozycję pracy na tę ofertę — odpowiedz na nią.';
  const rejected = s.applications.filter((a) => a.offerId === offerId && a.status === 'rejected').sort((a, b) => b.decidedOn!.localeCompare(a.decidedOn!))[0];
  if (rejected?.decidedOn) {
    const until = addDays(rejected.decidedOn, REAPPLY_COOLDOWN_DAYS);
    if (s.clock.today < until) return `Pracodawca odmówił ${formatDatePL(rejected.decidedOn)} — możesz aplikować ponownie od ${formatDatePL(until)}.`;
  }
  return null;
}

/* ---------- Aplikacja i decyzja ---------- */

export function applyForJob(s: GameState, offerId: string): string {
  const blocker = applicationBlocker(s, offerId);
  if (blocker) throw new CommandError(blocker);
  const offer = offerById(offerId)!;
  const today = s.clock.today;
  const id = `app:${offerId}@${today}`;
  if (s.applications.some((a) => a.id === id)) throw new CommandError('Dziś już aplikowałeś na tę ofertę.');
  const delay = createRng(s.seed, `${id}:delay`).int(5, 12);
  const decisionOn = addDays(today, delay);
  const chanceBps = applicationChanceBps(s, offer);
  const app: JobApplication = {
    id, offerId, appliedOn: today, status: 'pending', decisionOn, offerExpiresOn: null, decidedOn: null, startDate: null, chanceBps,
  };
  s.applications.push(app);
  s.pending.push({ id: `pending:${id}:decision`, date: decisionOn, type: 'application.decision', applicationId: id });
  logEvent(s, {
    id: `job.application:${id}`, date: today, type: 'job.application', tone: 'neutral',
    title: `Aplikacja: ${offer.title}`, detail: `${offer.employerName} · odpowiedź w ciągu kilku dni`, amount: null, category: null,
  });
  return `Wysłano aplikację: ${offer.title}. Pracodawca odpowie w ciągu ${delay} dni.`;
}

/** Wykonywane przez silnik w dniu decyzji pracodawcy. Idempotentne (status). */
export function decideApplication(s: GameState, applicationId: string, date: IsoDate): void {
  const app = s.applications.find((a) => a.id === applicationId);
  if (!app || app.status !== 'pending') return;
  const offer = offerById(app.offerId);
  const title = offer?.title ?? app.offerId;
  const employer = offer?.employerName ?? '';
  const roll = createRng(s.seed, `${app.id}:decision`).int(0, 9_999);
  app.decidedOn = date;
  if (offer && roll < app.chanceBps) {
    app.status = 'offered';
    app.offerExpiresOn = addDays(date, 7);
    s.pending.push({ id: `pending:${app.id}:offer_expiry`, date: app.offerExpiresOn, type: 'application.offer_expiry', applicationId: app.id });
    logEvent(s, {
      id: `job.decision:${app.id}`, date, type: 'job.decision', tone: 'positive',
      title: `Propozycja pracy: ${title}`, detail: `${employer} · odpowiedz do ${formatDatePL(app.offerExpiresOn)}`, amount: null, category: null,
    });
  } else {
    app.status = 'rejected';
    logEvent(s, {
      id: `job.decision:${app.id}`, date, type: 'job.decision', tone: 'warning',
      title: `Odmowa: ${title}`, detail: `${employer} · wybrano innego kandydata`, amount: null, category: null,
    });
  }
}

export function expireOffer(s: GameState, applicationId: string, date: IsoDate): void {
  const app = s.applications.find((a) => a.id === applicationId);
  if (!app || app.status !== 'offered') return;
  app.status = 'expired';
  const offer = offerById(app.offerId);
  logEvent(s, {
    id: `job.offer_expired:${app.id}`, date, type: 'job.decision', tone: 'warning',
    title: `Propozycja wygasła: ${offer?.title ?? app.offerId}`, detail: 'Nie odpowiedziano w terminie', amount: null, category: null,
  });
}

/* ---------- Umowy o pracę ---------- */

function firstOfMonthOnOrAfter(date: IsoDate): IsoDate {
  return date.endsWith('-01') ? date : firstOfNextMonth(date);
}

/** Synchronizuje `endDate` reguł należących do umowy z jej `endDate`. */
export function syncContractRules(s: GameState, contractId: string): void {
  const contract = s.contracts.find((c) => c.id === contractId);
  if (!contract) return;
  for (const r of s.rules) if (r.kind === 'obligation' && r.contractId === contractId) r.endDate = contract.endDate;
}

export function terminateEmployment(s: GameState, contract: EmploymentContract, by: 'employee' | 'employer', endDate: IsoDate): void {
  const today = s.clock.today;
  contract.endDate = endDate;
  contract.terminatedBy = by;
  contract.terminationNotifiedOn = today;
  syncContractRules(s, contract.id);
  s.pending.push({ id: `pending:${contract.id}:end`, date: addDays(endDate, 1), type: 'contract.milestone', contractId: contract.id, milestone: 'end' });
}

export function resignFromJob(s: GameState): string {
  const cur = currentEmployment(s);
  if (!cur) throw new CommandError('Nie masz obecnie pracy.');
  if (cur.endDate !== null) throw new CommandError(`Umowa już się kończy ${formatDatePL(cur.endDate)}.`);
  const upcoming = upcomingEmployment(s);
  if (upcoming) throw new CommandError(`Masz już podpisaną nową umowę od ${formatDatePL(upcoming.startDate)} — po jej rozpoczęciu poprzednia wygaśnie zgodnie z wypowiedzeniem.`);
  const end = noticeEndDate(s.clock.today, cur.noticeMonths);
  terminateEmployment(s, cur, 'employee', end);
  logEvent(s, {
    id: `job.resigned:${cur.id}`, date: s.clock.today, type: 'job.resigned', tone: 'warning',
    title: `Rezygnacja z pracy: ${cur.title}`, detail: `${partyName(s, cur.partyId)} · okres wypowiedzenia do ${formatDatePL(end)}`, amount: null, category: null,
  });
  return `Złożono wypowiedzenie. Pracujesz i otrzymujesz wynagrodzenie do ${formatDatePL(end)}.`;
}

/** Data startu nowej pracy: pierwszy dzień miesiąca, po zakończeniu obecnej umowy, min. 7 dni od dziś. */
export function startDateForNewJob(s: GameState): IsoDate {
  const today = s.clock.today;
  const cur = currentEmployment(s);
  let earliest = addDays(today, 7);
  if (cur) {
    const end = cur.endDate ?? noticeEndDate(today, cur.noticeMonths);
    const afterEnd = addDays(end, 1);
    if (afterEnd > earliest) earliest = afterEnd;
  }
  return firstOfMonthOnOrAfter(earliest);
}

export interface NewEmploymentTerms {
  partyId: string;
  title: string;
  startDate: IsoDate;
  grossMonthly: number | null;
  netMonthly: number;
  hoursPerMonth: number;
  noticeMonths: number;
  location: string;
  jobOfferId: string | null;
}

export function createEmployment(s: GameState, t: NewEmploymentTerms): EmploymentContract {
  const id = `contract:emp:${nextCounter(s, 'contract')}`;
  const contract: EmploymentContract = {
    id, type: 'employment', partyId: t.partyId, title: t.title, startDate: t.startDate, endDate: null,
    monthlyAmount: t.netMonthly, grossMonthly: t.grossMonthly, hoursPerMonth: t.hoursPerMonth, employmentForm: 'umowa_o_prace',
    noticeMonths: t.noticeMonths, location: t.location, jobOfferId: t.jobOfferId, terminatedBy: null, terminationNotifiedOn: null,
    dataStatus: 'placeholder',
  };
  s.contracts.push(contract);
  s.rules.push({
    kind: 'obligation', id: `rule:salary:${id}`, direction: 'receivable', counterpartyId: t.partyId, category: 'wynagrodzenie',
    description: 'Wynagrodzenie netto', issueDay: 'last', due: { monthOffset: 1, day: 10 },
    amount: { type: 'payroll', contractId: id }, startDate: t.startDate, endDate: null, contractId: id, dataStatus: 'placeholder',
  });
  s.pending.push({ id: `pending:${id}:start`, date: t.startDate, type: 'contract.milestone', contractId: id, milestone: 'start' });
  return contract;
}

/** Przyjęcie propozycji pracy (z ewentualnym wypowiedzeniem obecnej umowy). */
export function respondToJobOffer(s: GameState, applicationId: string, accept: boolean): string {
  const app = s.applications.find((a) => a.id === applicationId);
  if (!app) throw new CommandError('Nie ma takiej aplikacji.');
  if (app.status !== 'offered') throw new CommandError('Ta propozycja nie jest już aktualna.');
  const today = s.clock.today;
  if (app.offerExpiresOn && today > app.offerExpiresOn) throw new CommandError('Termin odpowiedzi minął.');
  const offer = offerById(app.offerId);
  if (!offer) throw new CommandError('Oferta nie jest już dostępna.');

  if (!accept) {
    app.status = 'declined';
    logEvent(s, { id: `job.declined:${app.id}`, date: today, type: 'job.decision', tone: 'neutral', title: `Odrzucono propozycję: ${offer.title}`, detail: offer.employerName, amount: null, category: null });
    return 'Odrzucono propozycję pracy.';
  }

  const upcoming = upcomingEmployment(s);
  if (upcoming) throw new CommandError(`Masz już podpisaną umowę od ${formatDatePL(upcoming.startDate)}.`);
  const startDate = startDateForNewJob(s);
  const overload = firstOverload(s, startDate, addDays(startDate, 366), { hoursPerMonth: offer.hoursPerMonth });
  if (overload) {
    throw new CommandError(`Ta praca nie zmieści się w Twoim budżecie czasu (brakuje ${overload.missing} godz. dziennie). Zmniejsz sen lub czas na działalność w planie dnia.`);
  }

  const cur = currentEmployment(s);
  let resignedNote = '';
  if (cur && cur.endDate === null) {
    const end = noticeEndDate(today, cur.noticeMonths);
    terminateEmployment(s, cur, 'employee', end);
    logEvent(s, {
      id: `job.resigned:${cur.id}`, date: today, type: 'job.resigned', tone: 'warning',
      title: `Rezygnacja z pracy: ${cur.title}`, detail: `${partyName(s, cur.partyId)} · okres wypowiedzenia do ${formatDatePL(end)}`, amount: null, category: null,
    });
    resignedNote = ` Dotychczasowa umowa kończy się ${formatDatePL(end)}.`;
  }

  ensureParty(s, { id: offer.employerId, name: offer.employerName, role: 'employer' });
  const net = typicalMonthlyNet(offer.grossMonthly, s.person.birthDate, startDate);
  createEmployment(s, {
    partyId: offer.employerId, title: offer.title, startDate, grossMonthly: offer.grossMonthly, netMonthly: net,
    hoursPerMonth: offer.hoursPerMonth, noticeMonths: offer.noticeMonths, location: offer.location, jobOfferId: offer.id,
  });
  app.status = 'accepted';
  app.startDate = startDate;
  logEvent(s, {
    id: `job.hired:${app.id}`, date: today, type: 'job.hired', tone: 'positive',
    title: `Podpisano umowę o pracę: ${offer.title}`, detail: `${offer.employerName} · start ${formatDatePL(startDate)} · netto ≈ ${formatPLN(net)} (szacunek)`, amount: null, category: null,
  });
  return `Podpisano umowę o pracę. Start: ${formatDatePL(startDate)}.${resignedNote}`;
}

/** Awans: nowa umowa na tych samych warunkach z wyższą pensją od 1. dnia następnego miesiąca. */
export function promoteEmployment(s: GameState, raisePct: number): { newContract: EmploymentContract; startDate: IsoDate } {
  const cur = currentEmployment(s);
  if (!cur || cur.endDate !== null) throw new CommandError('Nie masz już umowy, której dotyczy awans.');
  const startDate = firstOfNextMonth(s.clock.today);
  cur.endDate = addDays(startDate, -1);
  syncContractRules(s, cur.id);
  s.pending.push({ id: `pending:${cur.id}:end`, date: startDate, type: 'contract.milestone', contractId: cur.id, milestone: 'end' });
  const bps = raisePct * 100;
  const gross = cur.grossMonthly === null ? null : cur.grossMonthly + mulBps(cur.grossMonthly, bps);
  const net = gross === null ? cur.monthlyAmount + mulBps(cur.monthlyAmount, bps) : typicalMonthlyNet(gross, s.person.birthDate, startDate);
  const title = cur.title.startsWith('Starszy') ? cur.title : `Starszy/a ${cur.title.charAt(0).toLowerCase()}${cur.title.slice(1)}`;
  const newContract = createEmployment(s, {
    partyId: cur.partyId, title, startDate, grossMonthly: gross, netMonthly: net, hoursPerMonth: cur.hoursPerMonth,
    noticeMonths: cur.noticeMonths, location: cur.location, jobOfferId: cur.jobOfferId,
  });
  return { newContract, startDate };
}

export function currentPerformanceBps(s: GameState): number {
  return performanceBps(s.life.fatigue);
}

export function employmentHistory(s: GameState): EmploymentContract[] {
  return [...employmentContracts(s)].sort((a, b) => b.startDate.localeCompare(a.startDate));
}

