import { LIFESTYLE_LABELS } from './config.ts';
import { CommandError, logEvent, recordHistory } from './core.ts';
import { claimHealthRefund } from './annual.ts';
import { acceptServiceOffer, closeBusiness, declareMalyZusPlus, declineServiceOffer, planTaxFormChange, registerBusiness, resignMalyZusPlus, resumeBusiness, suspendBusiness } from './business.ts';
import type { RegisterInput } from './business.ts';
import { applyForJob, resignFromJob, respondToJobOffer } from './jobs.ts';
import { resolveLifeEvent } from './lifeEvents.ts';
import { signLease } from './housing.ts';
import { addSpecialization, assignCrew, assignVehicle, buyEquipment, buyMaterial, buyMissingForJob, declineEnquiry, maintainEquipment, resolveComplaint, respondToCounter, sendQuote, signContract, terminateJob } from './renovation.ts';
import type { CrewMember, QuoteInput } from './renovation.ts';
import { hireAccountingOffice, terminateAccountingOffice } from './accounting.ts';
import { closeListing, giveNotice, makeOffer, publishListing, rejectCandidate, setWage } from './workforce.ts';
import type { Offer } from './workforce.ts';
import { acceptSubOffer, acceptSubWork, cancelSubcontract, declineSubOffer, requestSubOffer } from './subcontractors.ts';
import { createTeam, deleteTeam, updateTeam } from './teams.ts';
import type { TeamMember } from './teams.ts';
import { buyVehicle } from './fleet.ts';
import { transferFunds } from './savings.ts';
import { EQUIPMENT_BY_ID, VEHICLE_BY_ID } from './renovationCatalog.ts';
import { agreementPreview, createCompanyDraft, deleteDraft, fileForRegistration, requireAssetConsent, requireAuthority, resignFromBoard, selectOperator, signAgreement, startOperation } from './company.ts';
import type { AgreementInput, DraftInput } from './company.ts';
import { acceptCounter, completeSecondary, proposeDeal, reviseDeal, withdrawDeal } from './negotiation.ts';
import { cancelResolution, castVote, proposeResolution } from './resolutions.ts';
import { selectedOperatorId, withOperator } from './operator.ts';
import type { DealTerms, Negotiation, ResolutionPayload } from './state.ts';
import { setMarketingBudget, setPositioning } from './market.ts';
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

/**
 * Komenda operatora: wykonuje się na wybranym przez gracza podmiocie (JDG albo spółka z o.o.) — te same moduły, ale na jego własnym
 * stanie (kontrakty, pracownicy, sprzęt, marketing, rachunek). Czynności wiążące spółkę wymagają reprezentacji (`requireAuthority`).
 */
const op = (d: GameState, fn: () => string): string => withOperator(d, selectedOperatorId(d), () => {
  if (d.corp.context !== null) {
    const co = d.corp.companies.find((x) => x.id === d.corp.context)!;
    if (!co.board.some((m) => m.endedOn === null && m.personId === d.person.id)) throw new CommandError('Nie jesteś członkiem zarządu tej spółki — udziały nie dają prawa prowadzenia jej spraw ani reprezentacji (art. 201, 205 KSH).');
  }
  return fn();
});
const bind = (d: GameState, label: string, amountOf: () => number, fn: () => string): string => op(d, () => {
  requireAuthority(d, label, amountOf());
  return fn();
});

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
  buyEquipment: (state: GameState, catalogId: string) => runCommand(state, (d) => bind(d, 'Zakup sprzętu', () => EQUIPMENT_BY_ID.get(catalogId)?.priceNet ?? 0, () => { requireAssetConsent(d, 'Zakup sprzętu', EQUIPMENT_BY_ID.get(catalogId)?.priceNet ?? 0); return buyEquipment(d, catalogId); })),
  maintainEquipment: (state: GameState, itemId: string) => runCommand(state, (d) => op(d, () => maintainEquipment(d, itemId))),
  buyMaterial: (state: GameState, key: string, qty: number) => runCommand(state, (d) => op(d, () => buyMaterial(d, key, qty))),
  buyMissingForJob: (state: GameState, jobId: string) => runCommand(state, (d) => op(d, () => buyMissingForJob(d, jobId))),
  setMarketingBudget: (state: GameState, channel: string, monthlyNet: Grosze) => runCommand(state, (d) => op(d, () => setMarketingBudget(d, channel, monthlyNet))),
  setPositioning: (state: GameState, positioning: string) => runCommand(state, (d) => op(d, () => setPositioning(d, positioning))),
  addSpecialization: (state: GameState, serviceId: string) => runCommand(state, (d) => op(d, () => addSpecialization(d, serviceId))),
  declineEnquiry: (state: GameState, enquiryId: string) => runCommand(state, (d) => op(d, () => declineEnquiry(d, enquiryId))),
  sendQuote: (state: GameState, enquiryId: string, input: QuoteInput) => runCommand(state, (d) => op(d, () => sendQuote(d, enquiryId, input))),
  respondToCounter: (state: GameState, quoteId: string, action: 'accept' | 'decline' | 'hold') => runCommand(state, (d) => op(d, () => respondToCounter(d, quoteId, action))),
  signContract: (state: GameState, quoteId: string, crew?: CrewMember[]) => runCommand(state, (d) => bind(d, 'Podpisanie kontraktu', () => d.reno.quotes.find((q) => q.id === quoteId)?.planned.total ?? 0, () => signContract(d, quoteId, crew))),
  terminateJob: (state: GameState, jobId: string) => runCommand(state, (d) => op(d, () => terminateJob(d, jobId))),
  resolveComplaint: (state: GameState, complaintId: string, action: 'repair' | 'discount' | 'reject') => runCommand(state, (d) => op(d, () => resolveComplaint(d, complaintId, action))),
  // v0.5 — księgowość
  hireAccountingOffice: (state: GameState, planId: string) => runCommand(state, (d) => hireAccountingOffice(d, planId)),
  terminateAccountingOffice: (state: GameState) => runCommand(state, (d) => terminateAccountingOffice(d)),
  // v0.6 — pracownicy i rekrutacja (wspólny silnik)
  publishListing: (state: GameState, input: { role: string; minLevel: number; tier: 'basic' | 'premium' }) => runCommand(state, (d) => op(d, () => publishListing(d, input))),
  closeListing: (state: GameState, listingId: string) => runCommand(state, (d) => op(d, () => closeListing(d, listingId))),
  makeOffer: (state: GameState, candidateId: string, offer: Offer) => runCommand(state, (d) => bind(d, 'Zatrudnienie pracownika', () => offer.gross * 12, () => makeOffer(d, candidateId, offer))),
  rejectCandidate: (state: GameState, candidateId: string) => runCommand(state, (d) => op(d, () => rejectCandidate(d, candidateId))),
  giveNotice: (state: GameState, employmentId: string) => runCommand(state, (d) => op(d, () => giveNotice(d, employmentId))),
  setWage: (state: GameState, employmentId: string, gross: Grosze) => runCommand(state, (d) => op(d, () => setWage(d, employmentId, gross))),
  // v0.6 — podwykonawcy, ekipy, pojazdy
  requestSubOffer: (state: GameState, subId: string, jobId: string, scopeBps: number) => runCommand(state, (d) => op(d, () => requestSubOffer(d, subId, jobId, scopeBps))),
  acceptSubOffer: (state: GameState, subcontractId: string) => runCommand(state, (d) => bind(d, 'Umowa z podwykonawcą', () => d.ops.subcontracts.find((c) => c.id === subcontractId)?.priceNet ?? 0, () => acceptSubOffer(d, subcontractId))),
  declineSubOffer: (state: GameState, subcontractId: string) => runCommand(state, (d) => op(d, () => declineSubOffer(d, subcontractId))),
  cancelSubcontract: (state: GameState, subcontractId: string) => runCommand(state, (d) => op(d, () => cancelSubcontract(d, subcontractId))),
  acceptSubWork: (state: GameState, subcontractId: string) => runCommand(state, (d) => op(d, () => acceptSubWork(d, subcontractId))),
  createTeam: (state: GameState, name: string, members: TeamMember[]) => runCommand(state, (d) => op(d, () => createTeam(d, name, members))),
  updateTeam: (state: GameState, teamId: string, members: TeamMember[]) => runCommand(state, (d) => op(d, () => updateTeam(d, teamId, members))),
  deleteTeam: (state: GameState, teamId: string) => runCommand(state, (d) => op(d, () => deleteTeam(d, teamId))),
  assignCrew: (state: GameState, jobId: string, teamId: string | null, supervision: 'worker' | 'supervise' | 'hands-off', vehicleId: string | null, ownerHoursPerDay?: number) => runCommand(state, (d) => op(d, () => assignCrew(d, jobId, teamId, supervision, vehicleId, ownerHoursPerDay))),
  assignVehicle: (state: GameState, jobId: string, vehicleId: string | null) => runCommand(state, (d) => op(d, () => assignVehicle(d, jobId, vehicleId))),
  buyVehicle: (state: GameState, catalogId: string) => runCommand(state, (d) => bind(d, 'Zakup pojazdu', () => VEHICLE_BY_ID.get(catalogId)?.priceNet ?? 0, () => { requireAssetConsent(d, 'Zakup pojazdu', VEHICLE_BY_ID.get(catalogId)?.priceNet ?? 0); return buyVehicle(d, catalogId); })),
  // v0.8 — spółki z o.o., wspólnicy, udziały, uchwały
  selectOperator: (state: GameState, id: string) => runCommand(state, (d) => selectOperator(d, id)),
  createCompanyDraft: (state: GameState, input: DraftInput) => runCommand(state, (d) => createCompanyDraft(d, input)),
  deleteCompanyDraft: (state: GameState, companyId: string) => runCommand(state, (d) => deleteDraft(d, companyId)),
  proposeDeal: (state: GameState, input: { kind: Negotiation['kind']; companyId: string; partnerId: string; terms: DealTerms }) => runCommand(state, (d) => proposeDeal(d, input)),
  reviseDeal: (state: GameState, negotiationId: string, terms: DealTerms) => runCommand(state, (d) => reviseDeal(d, negotiationId, terms)),
  acceptCounter: (state: GameState, negotiationId: string) => runCommand(state, (d) => acceptCounter(d, negotiationId)),
  withdrawDeal: (state: GameState, negotiationId: string) => runCommand(state, (d) => withdrawDeal(d, negotiationId)),
  completeSecondary: (state: GameState, negotiationId: string) => runCommand(state, (d) => completeSecondary(d, negotiationId)),
  signAgreement: (state: GameState, input: AgreementInput) => runCommand(state, (d) => signAgreement(d, input)),
  fileForRegistration: (state: GameState, companyId: string) => runCommand(state, (d) => fileForRegistration(d, companyId)),
  startCompanyOperation: (state: GameState, companyId: string, input: { specialization?: string; vat?: 'exempt' | 'active' }) => runCommand(state, (d) => startOperation(d, companyId, input)),
  proposeResolution: (state: GameState, companyId: string, payload: ResolutionPayload) => runCommand(state, (d) => proposeResolution(d, { companyId, payload })),
  castVote: (state: GameState, resolutionId: string, vote: 'for' | 'against' | 'abstain') => runCommand(state, (d) => castVote(d, resolutionId, vote)),
  cancelResolution: (state: GameState, resolutionId: string) => runCommand(state, (d) => cancelResolution(d, resolutionId)),
  resignFromBoard: (state: GameState, companyId: string) => runCommand(state, (d) => resignFromBoard(d, companyId)),
};

export { agreementPreview };
