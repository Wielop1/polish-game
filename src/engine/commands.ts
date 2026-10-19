import { LIFESTYLE_LABELS } from './config.ts';
import { CommandError, logEvent, recordHistory } from './core.ts';
import { claimHealthRefund } from './annual.ts';
import { acceptServiceOffer, closeBusiness, declareMalyZusPlus, declineServiceOffer, planTaxFormChange, registerBusiness, resignMalyZusPlus, resumeBusiness, suspendBusiness } from './business.ts';
import type { RegisterInput } from './business.ts';
import { applyForJob, resignFromJob, respondToJobOffer } from './jobs.ts';
import { resolveLifeEvent } from './lifeEvents.ts';
import { signLease } from './housing.ts';
import { addSpecialization, assignCrew, assignVehicle, buyEquipment, buyMaterial, buyMissingForJob, declineEnquiry, maintainEquipment, resolveComplaint, respondToCounter, sendQuote, setAdvertising, signContract, terminateJob } from './renovation.ts';
import type { CrewMember, QuoteInput } from './renovation.ts';
import { hireAccountingOffice, terminateAccountingOffice } from './accounting.ts';
import { closeListing, giveNotice, makeOffer, publishListing, rejectCandidate, setWage } from './workforce.ts';
import type { Offer } from './workforce.ts';
import { acceptSubOffer, acceptSubWork, cancelSubcontract, declineSubOffer, requestSubOffer } from './subcontractors.ts';
import { createTeam, deleteTeam, updateTeam } from './teams.ts';
import type { TeamMember } from './teams.ts';
import { buyVehicle } from './fleet.ts';
import { transferFunds } from './savings.ts';
import type { Grosze } from './money.ts';
import type { GameState, Lifestyle, TaxForm } from './state.ts';
import { LifestyleSchema } from './state.ts';
import { validatePlan } from './time.ts';
import type { TimePlan } from './time.ts';

export type CommandResult = { ok: true; state: GameState; message: string } | { ok: false; error: string };

/**
 * Wykonuje komendę gracza na KOPII stanu. Błąd walidacji (`CommandError`) zwraca `{ ok: false }`
 * i nie zmienia niczego; sukces zwraca nowy stan z odświeżoną migawką historii dnia
 * (komendy działają „dziś”, po zamknięciu dnia przez silnik).
 */
export function runCommand(state: GameState, fn: (draft: GameState) => string): CommandResult {
  const draft = structuredClone(state);
  try {
    const message = fn(draft);
    recordHistory(draft, draft.clock.today);
    return { ok: true, state: draft, message };
  } catch (e) {
    if (e instanceof CommandError) return { ok: false, error: e.message };
    throw e;
  }
}

function changeLifestyle(s: GameState, level: Lifestyle): string {
  if (!LifestyleSchema.safeParse(level).success) throw new CommandError('Nieprawidłowy styl życia.');
  if (s.life.lifestyle === level) throw new CommandError('To już Twój obecny styl życia.');
  const from = s.life.lifestyle;
  s.life.lifestyle = level;
  logEvent(s, {
    id: `lifestyle.changed:${s.clock.today}:${nextLifestyleSeq(s)}`, date: s.clock.today, type: 'lifestyle.changed', tone: 'neutral',
    title: `Zmiana stylu życia: ${LIFESTYLE_LABELS[from]} → ${LIFESTYLE_LABELS[level]}`,
    detail: 'Obowiązuje od najbliższego naliczenia kosztów (żywność, transport, rozrywka)', amount: null, category: null,
  });
  return `Styl życia: ${LIFESTYLE_LABELS[level]}. Nowe kwoty obowiązują od najbliższego naliczenia kosztów.`;
}

function nextLifestyleSeq(s: GameState): number {
  const n = (s.counters.lifestyle ?? 0) + 1;
  s.counters.lifestyle = n;
  return n;
}

function changeTimePlan(s: GameState, plan: TimePlan): string {
  if (!Number.isInteger(plan.sleepHours) || !Number.isInteger(plan.businessHours)) throw new CommandError('Godziny muszą być liczbami całkowitymi.');
  const error = validatePlan(s, plan);
  if (error) throw new CommandError(error);
  if (plan.sleepHours === s.life.timePlan.sleepHours && plan.businessHours === s.life.timePlan.businessHours) {
    throw new CommandError('Plan dnia jest taki sam jak obecny.');
  }
  s.life.timePlan = { sleepHours: plan.sleepHours, businessHours: plan.businessHours };
  const n = (s.counters.timeplan ?? 0) + 1;
  s.counters.timeplan = n;
  logEvent(s, {
    id: `time.plan_changed:${s.clock.today}:${n}`, date: s.clock.today, type: 'time.plan_changed', tone: 'neutral',
    title: `Zmiana planu dnia: sen ${plan.sleepHours} godz., działalność ${plan.businessHours} godz.`,
    detail: 'Wpływa na czas wolny i zmęczenie od następnego dnia', amount: null, category: null,
  });
  return 'Plan dnia zapisany.';
}

/** Publiczne API komend gracza (czyste: stan wejściowy nie jest modyfikowany). */
export const commands = {
  applyForJob: (state: GameState, offerId: string) => runCommand(state, (d) => applyForJob(d, offerId)),
  respondToJobOffer: (state: GameState, applicationId: string, accept: boolean) => runCommand(state, (d) => respondToJobOffer(d, applicationId, accept)),
  resignFromJob: (state: GameState) => runCommand(state, (d) => resignFromJob(d)),
  signLease: (state: GameState, listingId: string, startDate: string) => runCommand(state, (d) => signLease(d, listingId, startDate)),
  setLifestyle: (state: GameState, level: Lifestyle) => runCommand(state, (d) => changeLifestyle(d, level)),
  setTimePlan: (state: GameState, plan: TimePlan) => runCommand(state, (d) => changeTimePlan(d, plan)),
  transferFunds: (state: GameState, fromId: string, toId: string, amount: Grosze) => runCommand(state, (d) => transferFunds(d, fromId, toId, amount)),
  resolveLifeEvent: (state: GameState, eventId: string, optionId: string) => runCommand(state, (d) => resolveLifeEvent(d, eventId, optionId)),
  registerBusiness: (state: GameState, input: RegisterInput) => runCommand(state, (d) => registerBusiness(d, input)),
  closeBusiness: (state: GameState) => runCommand(state, (d) => closeBusiness(d)),
  acceptServiceOffer: (state: GameState, offerId: string, hoursPerDay: number) => runCommand(state, (d) => acceptServiceOffer(d, offerId, hoursPerDay)),
  declineServiceOffer: (state: GameState, offerId: string) => runCommand(state, (d) => declineServiceOffer(d, offerId)),
  suspendBusiness: (state: GameState) => runCommand(state, (d) => suspendBusiness(d)),
  resumeBusiness: (state: GameState, resumeDate: string) => runCommand(state, (d) => resumeBusiness(d, resumeDate)),
  planTaxFormChange: (state: GameState, form: TaxForm) => runCommand(state, (d) => planTaxFormChange(d, form)),
  declareMalyZusPlus: (state: GameState) => runCommand(state, (d) => declareMalyZusPlus(d)),
  resignMalyZusPlus: (state: GameState) => runCommand(state, (d) => resignMalyZusPlus(d)),
  claimHealthRefund: (state: GameState, settlementId: string) => runCommand(state, (d) => claimHealthRefund(d, settlementId)),
  // v0.5 — branża remontowa
  buyEquipment: (state: GameState, catalogId: string) => runCommand(state, (d) => buyEquipment(d, catalogId)),
  maintainEquipment: (state: GameState, itemId: string) => runCommand(state, (d) => maintainEquipment(d, itemId)),
  buyMaterial: (state: GameState, key: string, qty: number) => runCommand(state, (d) => buyMaterial(d, key, qty)),
  buyMissingForJob: (state: GameState, jobId: string) => runCommand(state, (d) => buyMissingForJob(d, jobId)),
  setAdvertising: (state: GameState, level: 'none' | 'local' | 'intensive') => runCommand(state, (d) => setAdvertising(d, level)),
  addSpecialization: (state: GameState, serviceId: string) => runCommand(state, (d) => addSpecialization(d, serviceId)),
  declineEnquiry: (state: GameState, enquiryId: string) => runCommand(state, (d) => declineEnquiry(d, enquiryId)),
  sendQuote: (state: GameState, enquiryId: string, input: QuoteInput) => runCommand(state, (d) => sendQuote(d, enquiryId, input)),
  respondToCounter: (state: GameState, quoteId: string, action: 'accept' | 'decline' | 'hold') => runCommand(state, (d) => respondToCounter(d, quoteId, action)),
  signContract: (state: GameState, quoteId: string, crew?: CrewMember[]) => runCommand(state, (d) => signContract(d, quoteId, crew)),
  terminateJob: (state: GameState, jobId: string) => runCommand(state, (d) => terminateJob(d, jobId)),
  resolveComplaint: (state: GameState, complaintId: string, action: 'repair' | 'discount' | 'reject') => runCommand(state, (d) => resolveComplaint(d, complaintId, action)),
  // v0.5 — księgowość
  hireAccountingOffice: (state: GameState, planId: string) => runCommand(state, (d) => hireAccountingOffice(d, planId)),
  terminateAccountingOffice: (state: GameState) => runCommand(state, (d) => terminateAccountingOffice(d)),
  // v0.6 — pracownicy i rekrutacja (wspólny silnik)
  publishListing: (state: GameState, input: { role: string; minLevel: number; tier: 'basic' | 'premium' }) => runCommand(state, (d) => publishListing(d, input)),
  closeListing: (state: GameState, listingId: string) => runCommand(state, (d) => closeListing(d, listingId)),
  makeOffer: (state: GameState, candidateId: string, offer: Offer) => runCommand(state, (d) => makeOffer(d, candidateId, offer)),
  rejectCandidate: (state: GameState, candidateId: string) => runCommand(state, (d) => rejectCandidate(d, candidateId)),
  giveNotice: (state: GameState, employmentId: string) => runCommand(state, (d) => giveNotice(d, employmentId)),
  setWage: (state: GameState, employmentId: string, gross: Grosze) => runCommand(state, (d) => setWage(d, employmentId, gross)),
  // v0.6 — podwykonawcy, ekipy, pojazdy
  requestSubOffer: (state: GameState, subId: string, jobId: string, scopeBps: number) => runCommand(state, (d) => requestSubOffer(d, subId, jobId, scopeBps)),
  acceptSubOffer: (state: GameState, subcontractId: string) => runCommand(state, (d) => acceptSubOffer(d, subcontractId)),
  declineSubOffer: (state: GameState, subcontractId: string) => runCommand(state, (d) => declineSubOffer(d, subcontractId)),
  cancelSubcontract: (state: GameState, subcontractId: string) => runCommand(state, (d) => cancelSubcontract(d, subcontractId)),
  acceptSubWork: (state: GameState, subcontractId: string) => runCommand(state, (d) => acceptSubWork(d, subcontractId)),
  createTeam: (state: GameState, name: string, members: TeamMember[]) => runCommand(state, (d) => createTeam(d, name, members)),
  updateTeam: (state: GameState, teamId: string, members: TeamMember[]) => runCommand(state, (d) => updateTeam(d, teamId, members)),
  deleteTeam: (state: GameState, teamId: string) => runCommand(state, (d) => deleteTeam(d, teamId)),
  assignCrew: (state: GameState, jobId: string, teamId: string | null, supervision: 'worker' | 'supervise' | 'hands-off', vehicleId: string | null, ownerHoursPerDay?: number) => runCommand(state, (d) => assignCrew(d, jobId, teamId, supervision, vehicleId, ownerHoursPerDay)),
  assignVehicle: (state: GameState, jobId: string, vehicleId: string | null) => runCommand(state, (d) => assignVehicle(d, jobId, vehicleId)),
  buyVehicle: (state: GameState, catalogId: string) => runCommand(state, (d) => buyVehicle(d, catalogId)),
};
