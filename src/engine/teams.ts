import { CommandError, logEvent, nextCounter } from './core.ts';
import { addDays, formatDatePL } from './date.ts';
import type { IsoDate } from './date.ts';
import { employmentActiveOn, employmentById, personById, personName } from './workforce.ts';
import { requireBusiness } from './opsCommon.ts';
import type { Assignment, GameState, Team } from './state.ts';

/**
 * Kalendarz zasobów: przydziały (`ops.assignments`) rezerwują pracowników, podwykonawców, sprzęt i pojazdy do kontraktu
 * na okres [od, do]. Ten sam zasób nie może być przydzielony do dwóch kontraktów w nakładających się okresach.
 * Przydziały są częścią stanu, więc po wczytaniu gry kalendarze odtwarzają się bez zmian.
 */

export const overlaps = (a: { from: IsoDate; to: IsoDate }, from: IsoDate, to: IsoDate): boolean => a.from <= to && from <= a.to;

export function resourceBusy(s: GameState, kind: Assignment['kind'], resourceId: string, from: IsoDate, to: IsoDate, exceptJobId?: string): Assignment | undefined {
  return s.ops.assignments.find((a) => a.kind === kind && a.resourceId === resourceId && a.jobId !== exceptJobId && overlaps(a, from, to));
}

export function reserve(s: GameState, jobId: string, kind: Assignment['kind'], resourceId: string, from: IsoDate, to: IsoDate): Assignment {
  const n = nextCounter(s, 'ops:assignment');
  const a: Assignment = { id: `asg:${n}`, jobId, kind, resourceId, from, to };
  s.ops.assignments.push(a);
  return a;
}

export function releaseJob(s: GameState, jobId: string, kinds?: Assignment['kind'][]): void {
  s.ops.assignments = s.ops.assignments.filter((a) => a.jobId !== jobId || (kinds !== undefined && !kinds.includes(a.kind)));
}

export const assignmentsOfJob = (s: GameState, jobId: string, kind?: Assignment['kind']): Assignment[] => s.ops.assignments.filter((a) => a.jobId === jobId && (!kind || a.kind === kind));

/** Najwcześniejszy dzień ≥ `from`, od którego zasób jest wolny przez `days` dni. */
export function firstFree(s: GameState, kind: Assignment['kind'], resourceId: string, from: IsoDate, days: number): IsoDate {
  let start = from;
  for (let i = 0; i < 400; i++) {
    const hit = resourceBusy(s, kind, resourceId, start, addDays(start, days - 1));
    if (!hit) return start;
    start = addDays(hit.to, 1);
  }
  return start;
}

/* ---------- Ekipy ---------- */

export type TeamMember = Team['members'][number];

export function memberLabel(s: GameState, m: TeamMember): string {
  if (m.kind === 'owner') return 'Właściciel (Ty)';
  if (m.kind === 'employee') {
    const e = employmentById(s, m.id);
    const p = e ? personById(s, e.personId) : undefined;
    return p ? personName(p) : m.id;
  }
  return s.ops.subcontractors.find((x) => x.id === m.id)?.name ?? m.id;
}

function validateMembers(s: GameState, members: TeamMember[]): void {
  const seen = new Set<string>();
  for (const m of members) {
    const key = `${m.kind}:${m.id}`;
    if (seen.has(key)) throw new CommandError('Ten członek jest już w ekipie.');
    seen.add(key);
    if (m.kind === 'owner' && m.id !== 'owner') throw new CommandError('Nieprawidłowy członek ekipy.');
    if (m.kind === 'employee') {
      const e = employmentById(s, m.id);
      if (!e || e.status !== 'active') throw new CommandError('Do ekipy można dodać tylko aktualnie zatrudnionego pracownika (umowa).');
    }
    if (m.kind === 'sub' && !s.ops.subcontractors.some((x) => x.id === m.id)) throw new CommandError('Nieznany podwykonawca.');
  }
  if (members.length === 0) throw new CommandError('Ekipa musi mieć co najmniej jednego członka.');
}

export function createTeam(s: GameState, name: string, members: TeamMember[]): string {
  requireBusiness(s);
  const n = name.trim();
  if (n.length < 2 || n.length > 60) throw new CommandError('Nazwa ekipy: od 2 do 60 znaków.');
  if (s.ops.teams.some((t) => t.name.toLowerCase() === n.toLowerCase())) throw new CommandError('Ekipa o takiej nazwie już istnieje.');
  validateMembers(s, members);
  const id = `team:${nextCounter(s, 'ops:team')}`;
  s.ops.teams.push({ id, name: n, members, createdOn: s.clock.today });
  logEvent(s, { id: `crew.assignment:${id}`, date: s.clock.today, type: 'crew.assignment', tone: 'neutral', title: `Utworzono ekipę: ${n}`, detail: members.map((m) => memberLabel(s, m)).join(', '), amount: null, category: null });
  return `Ekipa „${n}” utworzona (${members.length} osób).`;
}

export function updateTeam(s: GameState, teamId: string, members: TeamMember[]): string {
  requireBusiness(s);
  const t = s.ops.teams.find((x) => x.id === teamId);
  if (!t) throw new CommandError('Nie ma takiej ekipy.');
  if (s.reno.jobs.some((j) => j.crew.teamId === teamId && j.stage !== 'done' && j.stage !== 'cancelled')) throw new CommandError('Ekipa realizuje kontrakt — zmień skład po jego zakończeniu.');
  validateMembers(s, members);
  t.members = members;
  return `Skład ekipy „${t.name}” zmieniony.`;
}

export function deleteTeam(s: GameState, teamId: string): string {
  const t = s.ops.teams.find((x) => x.id === teamId);
  if (!t) throw new CommandError('Nie ma takiej ekipy.');
  if (s.reno.jobs.some((j) => j.crew.teamId === teamId && j.stage !== 'done' && j.stage !== 'cancelled')) throw new CommandError('Ekipa realizuje kontrakt.');
  s.ops.teams = s.ops.teams.filter((x) => x.id !== teamId);
  return `Ekipa „${t.name}” usunięta.`;
}

/** Członkowie ekipy zdolni do pracy w danym dniu (aktywna umowa pracownika); właściciel zawsze. */
export function activeTeamMembers(s: GameState, t: Team, date: IsoDate): TeamMember[] {
  return t.members.filter((m) => m.kind !== 'employee' || (employmentById(s, m.id) && employmentActiveOn(employmentById(s, m.id)!, date)));
}

export function describeConflict(s: GameState, a: Assignment): string {
  const job = s.reno.jobs.find((j) => j.id === a.jobId);
  return `przydzielony do kontraktu ${job ? `„${job.clientName.split(' (')[0]}”` : a.jobId} (${formatDatePL(a.from)} – ${formatDatePL(a.to)})`;
}
