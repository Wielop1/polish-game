import { create } from 'zustand';
import { ZodError } from 'zod';
import type { RegisterInput } from '../engine/business.ts';
import { commands } from '../engine/commands.ts';
import type { CommandResult } from '../engine/commands.ts';
import type { Grosze } from '../engine/money.ts';
import type { CrewMember, QuoteInput } from '../engine/renovation.ts';
import type { Offer } from '../engine/workforce.ts';
import type { TeamMember } from '../engine/teams.ts';
import { createNewGame, NewGameInputSchema } from '../engine/newGame.ts';
import type { NewGameInput } from '../engine/newGame.ts';
import { advanceOneDay, advanceToNextMonth } from '../engine/simulate.ts';
import type { GameState, Lifestyle, TaxForm } from '../engine/state.ts';
import type { TimePlan } from '../engine/time.ts';
import { createIndexedDbRepository, createMemoryRepository, createResilientRepository } from '../persistence/repository.ts';
import type { SaveListItem, SaveRepository } from '../persistence/repository.ts';
import { loadGame, saveGame } from '../persistence/service.ts';

export type Screen =
  | 'dashboard' | 'character' | 'finances' | 'calendar' | 'events'
  | 'jobs' | 'housing' | 'lifestyle' | 'time' | 'savings' | 'decisions'
  | 'bizRegister' | 'bizOverview' | 'bizOrders' | 'bizFinance' | 'bizTax' | 'bizDocs' | 'bizCalendar'
  | 'bizSettlement' | 'bizReport' | 'planning' | 'bizAccounting'
  | 'renoDashboard' | 'renoEnquiries' | 'renoQuotes' | 'renoContracts' | 'renoSchedule' | 'renoStock' | 'renoReputation'
  | 'hrEmployees' | 'hrRecruitment' | 'opsSubcontractors' | 'opsTeams' | 'opsSchedule' | 'opsVehicles' | 'opsProfit'
  | 'marketLocal' | 'marketCompetition' | 'marketMarketing' | 'marketStrategy' | 'marketDemand'
  | 'corpCompanies' | 'corpFound' | 'corpPartners' | 'corpShares' | 'corpBoard' | 'corpResolutions' | 'corpFinance' | 'corpDividends' | 'corpInvestors'
  | 'game';

export interface Notice {
  kind: 'info' | 'success' | 'error';
  text: string;
}

export type FieldErrors = Partial<Record<'firstName' | 'lastName' | 'seed', string>>;

let repository: (SaveRepository & { isFallback(): boolean }) | null = null;
let overrideActive = false;

export function getRepository(): SaveRepository {
  if (!repository) {
    const primary = typeof indexedDB === 'undefined' ? createMemoryRepository() : createIndexedDbRepository();
    repository = createResilientRepository(primary, createMemoryRepository());
  }
  return repository;
}
/** Do testów: podmiana magazynu zapisów. */
export function setRepository(repo: SaveRepository): void {
  repository = Object.assign(repo, { isFallback: () => false });
  overrideActive = true;
}
export function isUsingMemoryFallback(): boolean {
  return !overrideActive && (typeof indexedDB === 'undefined' || (repository?.isFallback() ?? false));
}

interface GameStore {
  game: GameState | null;
  screen: Screen;
  saves: SaveListItem[];
  notice: Notice | null;
  loadingSaves: boolean;

  init: () => Promise<void>;
  navigate: (screen: Screen) => void;
  /** Data gry ostatniej wizyty na ekranie (do powiadomień „nowe od ostatniej wizyty”). */
  visited: Record<string, string>;
  dismissNotice: () => void;
  startNewGame: (input: NewGameInput) => FieldErrors | null;
  advanceDay: () => void;
  advanceMonth: () => void;
  /** Komendy gracza: zwracają wynik, a store pokazuje komunikat i autozapisuje stan po sukcesie. */
  applyForJob: (offerId: string) => boolean;
  respondToJobOffer: (applicationId: string, accept: boolean) => boolean;
  resignFromJob: () => boolean;
  signLease: (listingId: string, startDate: string) => boolean;
  setLifestyle: (level: Lifestyle) => boolean;
  setTimePlan: (plan: TimePlan) => boolean;
  transferFunds: (fromId: string, toId: string, amount: Grosze) => boolean;
  resolveLifeEvent: (eventId: string, optionId: string) => boolean;
  registerBusiness: (input: RegisterInput) => boolean;
  closeBusiness: () => boolean;
  suspendBusiness: () => boolean;
  resumeBusiness: (date: string) => boolean;
  planTaxFormChange: (form: TaxForm) => boolean;
  declareMalyZusPlus: () => boolean;
  resignMalyZusPlus: () => boolean;
  claimHealthRefund: (settlementId: string) => boolean;
  /** Zapytanie wybrane do wyceny (ekran „Wyceny”). */
  selectedEnquiryId: string | null;
  selectEnquiry: (id: string | null) => void;
  buyEquipment: (catalogId: string) => boolean;
  maintainEquipment: (itemId: string) => boolean;
  buyMaterial: (key: string, qty: number) => boolean;
  buyMissingForJob: (jobId: string) => boolean;
  setMarketingBudget: (channel: string, monthlyNet: number) => boolean;
  setPositioning: (positioning: string) => boolean;
  addSpecialization: (serviceId: string) => boolean;
  declineEnquiry: (enquiryId: string) => boolean;
  sendQuote: (enquiryId: string, input: QuoteInput) => boolean;
  respondToCounter: (quoteId: string, action: 'accept' | 'decline' | 'hold') => boolean;
  signContract: (quoteId: string, crew?: CrewMember[]) => boolean;
  terminateJob: (jobId: string) => boolean;
  resolveComplaint: (complaintId: string, action: 'repair' | 'discount' | 'reject') => boolean;
  publishListing: (input: { role: string; minLevel: number; tier: 'basic' | 'premium' }) => boolean;
  closeListing: (listingId: string) => boolean;
  makeOffer: (candidateId: string, offer: Offer) => boolean;
  rejectCandidate: (candidateId: string) => boolean;
  giveNotice: (employmentId: string) => boolean;
  setWage: (employmentId: string, gross: Grosze) => boolean;
  requestSubOffer: (subId: string, jobId: string, scopeBps: number) => boolean;
  acceptSubOffer: (subcontractId: string) => boolean;
  declineSubOffer: (subcontractId: string) => boolean;
  cancelSubcontract: (subcontractId: string) => boolean;
  acceptSubWork: (subcontractId: string) => boolean;
  createTeam: (name: string, members: TeamMember[]) => boolean;
  updateTeam: (teamId: string, members: TeamMember[]) => boolean;
  deleteTeam: (teamId: string) => boolean;
  assignCrew: (jobId: string, teamId: string | null, supervision: 'worker' | 'supervise' | 'hands-off', vehicleId: string | null, ownerHours?: number) => boolean;
  assignVehicle: (jobId: string, vehicleId: string | null) => boolean;
  buyVehicle: (catalogId: string) => boolean;
  hireAccountingOffice: (planId: string) => boolean;
  terminateAccountingOffice: () => boolean;
  acceptServiceOffer: (offerId: string, hoursPerDay: number) => boolean;
  /** v0.8: dowolna komenda spółek/udziałów/uchwał (wynik: komunikat, autozapis) oraz wybór spółki w ekranach „Spółki i inwestycje prywatne”. */
  run: (fn: (g: GameState) => CommandResult) => boolean;
  selectedCompanyId: string | null;
  selectCompany: (id: string | null) => void;
  selectOperator: (id: string) => boolean;
  declineServiceOffer: (offerId: string) => boolean;
  saveToSlot: (slot: string) => Promise<void>;
  loadFromSlot: (slot: string) => Promise<void>;
  deleteSlot: (slot: string) => Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useGameStore = create<GameStore>((set, get) => {
  const refreshSaves = async () => {
    try {
      set({ saves: await getRepository().list(), loadingSaves: false });
    } catch (e) {
      set({ loadingSaves: false, notice: { kind: 'error', text: `Nie można odczytać zapisów: ${errMsg(e)}` } });
    }
  };

  const autosave = async (state: GameState) => {
    try {
      await saveGame(getRepository(), 'autosave', state, new Date().toISOString());
      await refreshSaves();
    } catch (e) {
      set({ notice: { kind: 'error', text: `Autozapis nie powiódł się: ${errMsg(e)}` } });
    }
  };

  const applyAdvance = (fn: (s: GameState) => GameState) => {
    const game = get().game;
    if (!game) return;
    try {
      const next = fn(game);
      set({ game: next, notice: null });
      void autosave(next);
    } catch (e) {
      set({ notice: { kind: 'error', text: `Błąd symulacji: ${errMsg(e)}` } });
    }
  };

  const exec = (fn: (g: GameState) => CommandResult): boolean => {
    const game = get().game;
    if (!game) return false;
    const result = fn(game);
    if (!result.ok) {
      set({ notice: { kind: 'error', text: result.error } });
      return false;
    }
    set({ game: result.state, notice: { kind: 'success', text: result.message } });
    void autosave(result.state);
    return true;
  };

  return {
    game: null,
    screen: 'game',
    saves: [],
    notice: null,
    loadingSaves: true,

    init: refreshSaves,
    visited: {},
    navigate: (screen) => set((st) => ({ screen, notice: null, visited: { ...st.visited, [screen]: st.game?.clock.today ?? '' } })),
    dismissNotice: () => set({ notice: null }),

    startNewGame: (input) => {
      const parsed = NewGameInputSchema.safeParse(input);
      if (!parsed.success) {
        const errors: FieldErrors = {};
        for (const issue of (parsed.error as ZodError).issues) {
          const key = issue.path[0];
          if ((key === 'firstName' || key === 'lastName' || key === 'seed') && !errors[key]) errors[key] = issue.message;
        }
        return errors;
      }
      const game = createNewGame(input);
      set({ game, screen: 'dashboard', notice: { kind: 'success', text: `Nowa gra: ${game.person.firstName} ${game.person.lastName}` } });
      void autosave(game);
      return null;
    },

    advanceDay: () => applyAdvance(advanceOneDay),
    advanceMonth: () => applyAdvance(advanceToNextMonth),

    applyForJob: (offerId) => exec((g) => commands.applyForJob(g, offerId)),
    respondToJobOffer: (applicationId, accept) => exec((g) => commands.respondToJobOffer(g, applicationId, accept)),
    resignFromJob: () => exec((g) => commands.resignFromJob(g)),
    signLease: (listingId, startDate) => exec((g) => commands.signLease(g, listingId, startDate)),
    setLifestyle: (level) => exec((g) => commands.setLifestyle(g, level)),
    setTimePlan: (plan) => exec((g) => commands.setTimePlan(g, plan)),
    transferFunds: (fromId, toId, amount) => exec((g) => commands.transferFunds(g, fromId, toId, amount)),
    resolveLifeEvent: (eventId, optionId) => exec((g) => commands.resolveLifeEvent(g, eventId, optionId)),
    registerBusiness: (input) => {
      const done = exec((g) => commands.registerBusiness(g, input));
      if (done) set({ screen: 'bizOverview' }); // zachowuje komunikat o sukcesie
      return done;
    },
    closeBusiness: () => exec((g) => commands.closeBusiness(g)),
    suspendBusiness: () => exec((g) => commands.suspendBusiness(g)),
    resumeBusiness: (date) => exec((g) => commands.resumeBusiness(g, date)),
    planTaxFormChange: (form) => exec((g) => commands.planTaxFormChange(g, form)),
    declareMalyZusPlus: () => exec((g) => commands.declareMalyZusPlus(g)),
    resignMalyZusPlus: () => exec((g) => commands.resignMalyZusPlus(g)),
    claimHealthRefund: (id) => exec((g) => commands.claimHealthRefund(g, id)),
    selectedEnquiryId: null,
    selectEnquiry: (id) => set({ selectedEnquiryId: id }),
    buyEquipment: (id) => exec((g) => commands.buyEquipment(g, id)),
    maintainEquipment: (id) => exec((g) => commands.maintainEquipment(g, id)),
    buyMaterial: (key, qty) => exec((g) => commands.buyMaterial(g, key, qty)),
    buyMissingForJob: (id) => exec((g) => commands.buyMissingForJob(g, id)),
    setMarketingBudget: (channel, monthlyNet) => exec((g) => commands.setMarketingBudget(g, channel, monthlyNet)),
    setPositioning: (positioning) => exec((g) => commands.setPositioning(g, positioning)),
    addSpecialization: (id) => exec((g) => commands.addSpecialization(g, id)),
    declineEnquiry: (id) => exec((g) => commands.declineEnquiry(g, id)),
    sendQuote: (enquiryId, input) => {
      const done = exec((g) => commands.sendQuote(g, enquiryId, input));
      if (done) set({ selectedEnquiryId: null });
      return done;
    },
    respondToCounter: (id, action) => exec((g) => commands.respondToCounter(g, id, action)),
    signContract: (id, crew) => {
      const done = exec((g) => commands.signContract(g, id, crew));
      if (done) set({ screen: 'renoContracts' });
      return done;
    },
    terminateJob: (id) => exec((g) => commands.terminateJob(g, id)),
    resolveComplaint: (id, action) => exec((g) => commands.resolveComplaint(g, id, action)),
    publishListing: (input) => exec((g) => commands.publishListing(g, input)),
    closeListing: (id) => exec((g) => commands.closeListing(g, id)),
    makeOffer: (id, offer) => exec((g) => commands.makeOffer(g, id, offer)),
    rejectCandidate: (id) => exec((g) => commands.rejectCandidate(g, id)),
    giveNotice: (id) => exec((g) => commands.giveNotice(g, id)),
    setWage: (id, gross) => exec((g) => commands.setWage(g, id, gross)),
    requestSubOffer: (subId, jobId, scope) => exec((g) => commands.requestSubOffer(g, subId, jobId, scope)),
    acceptSubOffer: (id) => exec((g) => commands.acceptSubOffer(g, id)),
    declineSubOffer: (id) => exec((g) => commands.declineSubOffer(g, id)),
    cancelSubcontract: (id) => exec((g) => commands.cancelSubcontract(g, id)),
    acceptSubWork: (id) => exec((g) => commands.acceptSubWork(g, id)),
    createTeam: (name, members) => exec((g) => commands.createTeam(g, name, members)),
    updateTeam: (id, members) => exec((g) => commands.updateTeam(g, id, members)),
    deleteTeam: (id) => exec((g) => commands.deleteTeam(g, id)),
    assignCrew: (jobId, teamId, supervision, vehicleId, ownerHours) => exec((g) => commands.assignCrew(g, jobId, teamId, supervision, vehicleId, ownerHours)),
    assignVehicle: (jobId, vehicleId) => exec((g) => commands.assignVehicle(g, jobId, vehicleId)),
    buyVehicle: (id) => exec((g) => commands.buyVehicle(g, id)),
    hireAccountingOffice: (id) => exec((g) => commands.hireAccountingOffice(g, id)),
    terminateAccountingOffice: () => exec((g) => commands.terminateAccountingOffice(g)),
    acceptServiceOffer: (offerId, hoursPerDay) => exec((g) => commands.acceptServiceOffer(g, offerId, hoursPerDay)),
    declineServiceOffer: (offerId) => exec((g) => commands.declineServiceOffer(g, offerId)),
    run: (fn) => exec(fn),
    selectedCompanyId: null,
    selectCompany: (id) => set({ selectedCompanyId: id }),
    selectOperator: (id) => exec((g) => commands.selectOperator(g, id)),

    saveToSlot: async (slot) => {
      const game = get().game;
      if (!game) return;
      try {
        await saveGame(getRepository(), slot, game, new Date().toISOString());
        await refreshSaves();
        set({ notice: { kind: 'success', text: 'Gra zapisana.' } });
      } catch (e) {
        set({ notice: { kind: 'error', text: `Zapis nie powiódł się: ${errMsg(e)}` } });
      }
    },

    loadFromSlot: async (slot) => {
      try {
        const result = await loadGame(getRepository(), slot);
        if (!result.ok) {
          set({ notice: { kind: 'error', text: result.error } });
          return;
        }
        set({ game: result.state, screen: 'dashboard', notice: { kind: 'success', text: 'Gra wczytana.' } });
      } catch (e) {
        set({ notice: { kind: 'error', text: `Wczytanie nie powiodło się: ${errMsg(e)}` } });
      }
    },

    deleteSlot: async (slot) => {
      try {
        await getRepository().remove(slot);
        await refreshSaves();
        set({ notice: { kind: 'info', text: 'Zapis usunięty.' } });
      } catch (e) {
        set({ notice: { kind: 'error', text: `Nie można usunąć zapisu: ${errMsg(e)}` } });
      }
    },
  };
});
