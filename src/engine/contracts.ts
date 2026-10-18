import { addDays, diffDays } from './date.ts';
import type { IsoDate } from './date.ts';
import type { Contract, EmploymentContract, GameState, LeaseContract } from './state.ts';

export function isActiveOn(c: Contract, date: IsoDate): boolean {
  return c.startDate <= date && (c.endDate === null || date <= c.endDate);
}

const latestStart = <T extends Contract>(list: T[]): T | null =>
  list.length === 0 ? null : list.reduce((a, b) => (b.startDate > a.startDate ? b : a));

export function employmentContracts(s: GameState): EmploymentContract[] {
  return s.contracts.filter((c): c is EmploymentContract => c.type === 'employment');
}

export function leaseContracts(s: GameState): LeaseContract[] {
  return s.contracts.filter((c): c is LeaseContract => c.type === 'lease');
}

/** Umowa o pracę obowiązująca w danym dniu (także w okresie wypowiedzenia). */
export function currentEmployment(s: GameState, date: IsoDate = s.clock.today): EmploymentContract | null {
  return latestStart(employmentContracts(s).filter((c) => isActiveOn(c, date)));
}

/** Podpisana umowa o pracę, która jeszcze się nie zaczęła (najbliższa). */
export function upcomingEmployment(s: GameState, date: IsoDate = s.clock.today): EmploymentContract | null {
  const future = employmentContracts(s).filter((c) => c.startDate > date);
  return future.length === 0 ? null : future.reduce((a, b) => (b.startDate < a.startDate ? b : a));
}

/** Najem, w którym gracz mieszka w danym dniu (przy nakładaniu się umów — nowszy). */
export function currentLease(s: GameState, date: IsoDate = s.clock.today): LeaseContract | null {
  return latestStart(leaseContracts(s).filter((c) => isActiveOn(c, date)));
}

export function activeLeases(s: GameState, date: IsoDate = s.clock.today): LeaseContract[] {
  return leaseContracts(s).filter((c) => isActiveOn(c, date));
}

export function upcomingLease(s: GameState, date: IsoDate = s.clock.today): LeaseContract | null {
  const future = leaseContracts(s).filter((c) => c.startDate > date);
  return future.length === 0 ? null : future.reduce((a, b) => (b.startDate < a.startDate ? b : a));
}

export type EmploymentStatus = 'employed' | 'notice' | 'unemployed';

export function employmentStatus(s: GameState, date: IsoDate = s.clock.today): EmploymentStatus {
  const c = currentEmployment(s, date);
  if (!c) return 'unemployed';
  return c.endDate !== null ? 'notice' : 'employed';
}

/**
 * Początek ciągłości zatrudnienia u danego pracodawcy: cofamy się po umowach tego samego pracodawcy,
 * które następują bezpośrednio po sobie (kolejna zaczyna się dzień po końcu poprzedniej) i kończą się
 * zmianą warunków (awans — `terminatedBy: null`), a nie wypowiedzeniem. Przerwa albo wypowiedzenie
 * zeruje ciągłość; zmiana pracodawcy zaczyna ją od nowa.
 */
export function companyTenureStart(s: GameState, contract: EmploymentContract): IsoDate {
  let start = contract.startDate;
  const all = employmentContracts(s);
  for (;;) {
    const prev = all.find((c) => c.partyId === contract.partyId && c.terminatedBy === null && c.endDate !== null && addDays(c.endDate, 1) === start);
    if (!prev) return start;
    start = prev.startDate;
  }
}

/** Staż w firmie (ciągłość zatrudnienia u pracodawcy) — nie zeruje się przy awansie. */
export function companyTenureDays(s: GameState, contract: EmploymentContract, date: IsoDate = s.clock.today): number {
  return Math.max(0, diffDays(date, companyTenureStart(s, contract)));
}

/** Staż na stanowisku (od początku bieżącej umowy) — zeruje się przy awansie. */
export function positionTenureDays(contract: EmploymentContract, date: IsoDate): number {
  return Math.max(0, diffDays(date, contract.startDate));
}
