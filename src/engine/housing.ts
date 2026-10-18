import { HOUSING_CATALOG } from './config.ts';
import type { HousingListing } from './config.ts';
import { CommandError, ensureParty, logEvent, nextCounter, partyName, postTransaction } from './core.ts';
import { currentLease, upcomingLease } from './contracts.ts';
import { addDays, addMonthsToKey, dateInMonth, firstOfNextMonth, formatDatePL, monthKey, monthKeyToYm } from './date.ts';
import type { IsoDate } from './date.ts';
import { formatPLN } from './money.ts';
import type { Grosze } from './money.ts';
import { syncContractRules } from './jobs.ts';
import type { Asset, GameState, LeaseContract } from './state.ts';

export const DEPOSIT_REFUND_DELAY_DAYS = 14;

export function listingById(id: string): HousingListing | undefined {
  return HOUSING_CATALOG.find((l) => l.id === id);
}

/** Koniec obowiązywania obecnej umowy najmu po wypowiedzeniu złożonym dziś (ostatni dzień miesiąca). */
export function leaseEndIfTerminatedToday(s: GameState, lease: LeaseContract): IsoDate {
  if (lease.endDate !== null) return lease.endDate;
  const { year, month } = monthKeyToYm(addMonthsToKey(monthKey(s.clock.today), lease.noticeMonths));
  return dateInMonth(year, month, 'last');
}

/**
 * Dozwolone daty wprowadzenia się: pierwsze dni miesięcy od najbliższego do dnia po wygaśnięciu obecnej umowy.
 * Wcześniejsza data = nakładanie się umów (płacisz za oba mieszkania); późniejsza byłaby bezdomnością, więc jej nie ma.
 */
export function allowedMoveInDates(s: GameState): IsoDate[] {
  const cur = currentLease(s);
  if (!cur || upcomingLease(s)) return [];
  const oldEnd = leaseEndIfTerminatedToday(s, cur);
  const last = addDays(oldEnd, 1);
  const out: IsoDate[] = [];
  for (let d = firstOfNextMonth(s.clock.today); d <= last; d = firstOfNextMonth(d)) out.push(d);
  return out;
}

export interface LeasePreview {
  listing: HousingListing;
  startDate: IsoDate;
  oldLeaseEnd: IsoDate;
  /** Liczba miesięcy, w których naliczane będą czynsze za oba mieszkania. */
  overlapMonths: number;
  /** Szacunkowy koszt nakładania się umów (czynsz + opłaty starego lokalu). */
  overlapCost: Grosze;
  depositNow: Grosze;
  movingCost: Grosze;
  /** Kaucja ze starego mieszkania wracająca po wyprowadzce (aktywo → gotówka). */
  oldDepositRefund: Grosze;
  oldDepositRefundOn: IsoDate | null;
  newMonthlyCost: Grosze;
}

export function previewLease(s: GameState, listingId: string, startDate: IsoDate): LeasePreview | null {
  const listing = listingById(listingId);
  const cur = currentLease(s);
  if (!listing || !cur) return null;
  const oldEnd = leaseEndIfTerminatedToday(s, cur);
  let overlapMonths = 0;
  for (let d = startDate; d <= oldEnd; d = firstOfNextMonth(d)) overlapMonths += 1;
  const oldDeposit = s.assets.find((a) => a.contractId === cur.id && a.status === 'held');
  return {
    listing,
    startDate,
    oldLeaseEnd: oldEnd,
    overlapMonths,
    overlapCost: overlapMonths * (cur.monthlyAmount + cur.utilitiesMonthly),
    depositNow: listing.deposit,
    movingCost: listing.movingCost,
    oldDepositRefund: oldDeposit?.amount ?? 0,
    oldDepositRefundOn: oldDeposit ? addDays(oldEnd, DEPOSIT_REFUND_DELAY_DAYS) : null,
    newMonthlyCost: listing.rent + listing.utilities,
  };
}

export function signLease(s: GameState, listingId: string, startDate: IsoDate): string {
  const listing = listingById(listingId);
  if (!listing) throw new CommandError('Nie ma takiej oferty najmu.');
  const cur = currentLease(s);
  if (!cur) throw new CommandError('Brak obecnej umowy najmu.');
  const upcoming = upcomingLease(s);
  if (upcoming) throw new CommandError(`Masz już podpisaną umowę najmu od ${formatDatePL(upcoming.startDate)}.`);
  if (cur.listingId === listingId) throw new CommandError('Już mieszkasz w tym lokalu.');
  if (!allowedMoveInDates(s).includes(startDate)) throw new CommandError('Niedozwolona data wprowadzenia się.');
  if (s.accounts[s.playerAccountId]!.balance < listing.deposit) {
    throw new CommandError(`Brak środków na kaucję (${formatPLN(listing.deposit)}) na rachunku bieżącym.`);
  }

  const today = s.clock.today;
  const n = nextCounter(s, 'contract');
  const contractId = `contract:lease:${n}`;
  const landlordId = `party:landlord:${listing.id}`;
  ensureParty(s, { id: landlordId, name: `Wynajmujący (${listing.district})`, role: 'landlord' });

  // 1) Wypowiedzenie obecnej umowy (jeśli jeszcze nie wypowiedziana) i zaplanowanie zwrotu jej kaucji.
  const oldEnd = leaseEndIfTerminatedToday(s, cur);
  if (cur.endDate === null) {
    cur.endDate = oldEnd;
    cur.terminatedOn = today;
    syncContractRules(s, cur.id);
    s.pending.push({ id: `pending:${cur.id}:end`, date: addDays(oldEnd, 1), type: 'contract.milestone', contractId: cur.id, milestone: 'end' });
  }
  const oldDeposit = s.assets.find((a) => a.contractId === cur.id && a.status === 'held');
  if (oldDeposit && oldDeposit.refundDueOn === null) {
    oldDeposit.refundDueOn = addDays(oldEnd, DEPOSIT_REFUND_DELAY_DAYS);
    s.pending.push({ id: `pending:${oldDeposit.id}:refund`, date: oldDeposit.refundDueOn, type: 'deposit.refund', assetId: oldDeposit.id });
  }

  // 2) Nowa umowa i jej reguły (czynsz + opłaty) — od dnia wprowadzenia się.
  const contract: LeaseContract = {
    id: contractId, type: 'lease', partyId: landlordId, title: `${listing.title}, ${listing.district}`, startDate, endDate: null,
    monthlyAmount: listing.rent, utilitiesMonthly: listing.utilities, depositAmount: listing.deposit, movingCost: listing.movingCost,
    areaM2: listing.areaM2, standard: listing.standard, district: listing.district, listingId: listing.id,
    noticeMonths: listing.noticeMonths, terminatedOn: null, dataStatus: 'placeholder',
  };
  s.contracts.push(contract);
  const base = { kind: 'obligation', direction: 'payable', startDate, endDate: null, contractId, dataStatus: 'placeholder' } as const;
  s.rules.push({
    ...base, id: `rule:rent:${contractId}`, counterpartyId: landlordId, category: 'czynsz', description: 'Czynsz',
    issueDay: 1, due: { monthOffset: 0, day: 10 }, amount: { type: 'contract', contractId },
  });
  s.rules.push({
    ...base, id: `rule:utilities:${contractId}`, counterpartyId: landlordId, category: 'media', description: 'Opłaty eksploatacyjne',
    issueDay: 5, due: { monthOffset: 0, day: 15 }, amount: { type: 'contract', contractId, field: 'utilitiesMonthly' },
  });

  // 3) Kaucja — aktywo, nie koszt: gotówka → aktywo, majątek netto bez zmian.
  if (listing.deposit > 0) {
    const asset: Asset = {
      id: `asset:deposit:${contractId}`, type: 'deposit', amount: listing.deposit, partyId: landlordId, contractId,
      status: 'held', paidOn: today, refundDueOn: null, refundedOn: null,
    };
    s.assets.push(asset);
    postTransaction(s, {
      eventId: `deposit-pay:${asset.id}`, date: today, amount: -listing.deposit, category: 'kaucja',
      description: `Kaucja zwrotna: ${listing.title}, ${listing.district}`, counterpartyId: landlordId, obligationId: null,
    });
    logEvent(s, {
      id: `deposit.paid:${asset.id}`, date: today, type: 'deposit.paid', tone: 'neutral',
      title: `Wpłacono kaucję: ${listing.title}`, detail: `${partyName(s, landlordId)} · kaucja jest Twoim aktywem, nie kosztem`, amount: -listing.deposit, category: 'kaucja',
    });
  }

  // 4) Dzień wprowadzenia się: zapis w dzienniku + koszt przeprowadzki (naliczany tego dnia).
  s.pending.push({ id: `pending:${contractId}:move_in`, date: startDate, type: 'housing.move_in', contractId });
  if (listing.movingCost > 0) {
    s.pending.push({
      id: `pending:${contractId}:moving`, date: startDate, type: 'obligation.issue',
      obligation: {
        occurrenceId: `moving:${contractId}`, ruleId: 'cmd:housing', direction: 'payable', counterpartyId: 'party:movers',
        accountId: s.playerAccountId, amount: listing.movingCost, dueDate: startDate, category: 'przeprowadzka',
        description: `Przeprowadzka: ${listing.title}`,
      },
    });
    ensureParty(s, { id: 'party:movers', name: 'Firma przeprowadzkowa', role: 'service' });
  }
  logEvent(s, {
    id: `housing.lease_signed:${contractId}`, date: today, type: 'housing.lease_signed', tone: 'neutral',
    title: `Podpisano umowę najmu: ${listing.title}, ${listing.district}`,
    detail: `Od ${formatDatePL(startDate)} · czynsz ${formatPLN(listing.rent)} + opłaty ${formatPLN(listing.utilities)}`, amount: null, category: null,
  });

  const overlap = startDate <= oldEnd;
  return overlap
    ? `Umowa podpisana. Do ${formatDatePL(oldEnd)} płacisz za oba mieszkania (nakładające się okresy umów).`
    : `Umowa podpisana. Przeprowadzka ${formatDatePL(startDate)}; poprzednia umowa kończy się ${formatDatePL(oldEnd)}.`;
}

/** Wykonywane przez silnik: zwrot kaucji po wyprowadzce (aktywo → gotówka, bez wpływu na majątek netto). */
export function refundDeposit(s: GameState, assetId: string, date: IsoDate): void {
  const asset = s.assets.find((a) => a.id === assetId);
  if (!asset || asset.status !== 'held') return;
  postTransaction(s, {
    eventId: `deposit-refund:${asset.id}`, date, amount: asset.amount, category: 'zwrot_kaucji',
    description: 'Zwrot kaucji po zakończeniu najmu', counterpartyId: asset.partyId, obligationId: null,
  });
  asset.status = 'refunded';
  asset.refundedOn = date;
  logEvent(s, {
    id: `deposit.refunded:${asset.id}`, date, type: 'deposit.refunded', tone: 'positive',
    title: 'Zwrot kaucji', detail: `${partyName(s, asset.partyId)} · kaucja wróciła na rachunek`, amount: asset.amount, category: 'zwrot_kaucji',
  });
}
