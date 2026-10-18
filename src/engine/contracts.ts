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
