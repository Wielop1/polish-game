import { describe, expect, it } from 'vitest';
import { craftCandidate, craftEnquiry, opsGame, toDate } from '../engine/testkit.ts';
import { computeNavAlerts } from './navAlerts.ts';

describe('powiadomienia w menu (kropki)', () => {
  it('nowa gra bez firmy nie ma kropek', () => {
    const s = opsGame();
    expect(Object.keys(computeNavAlerts(s, {}))).toEqual([]);
  });

  it('zapytanie klienta zapala kropkę przy „Zapytania klientów” i gaśnie po obsłużeniu', () => {
    const s = opsGame();
    const enq = craftEnquiry(s);
    expect(computeNavAlerts(s, {}).renoEnquiries?.count).toBe(1);
    enq.status = 'declined';
    expect(computeNavAlerts(s, {}).renoEnquiries).toBeUndefined();
  });

  it('nowy kandydat zapala kropkę w Rekrutacji', () => {
    const s = opsGame();
    craftCandidate(s);
    expect(computeNavAlerts(s, {}).hrRecruitment?.count).toBe(1);
  });

  it('powiadomienia biura znikają po wizycie na ekranie', () => {
    let s = opsGame();
    s.events.push({ id: 'ev:test', date: s.clock.today, type: 'accounting.notice', title: 'Test', detail: '', severity: 'info' } as never);
    s = toDate(s, s.clock.today);
    const unseen = computeNavAlerts(s, {}).bizAccounting;
    expect(unseen?.count).toBeGreaterThan(0);
    expect(computeNavAlerts(s, { bizAccounting: '9999-12-31' }).bizAccounting).toBeUndefined();
  });
});

describe('klucz członka ekipy (formularz Ekipy)', () => {
  it('zachowuje całe id z dwukropkami (pracownik i podwykonawca)', async () => {
    const { splitMemberKey } = await import('./format.ts');
    expect(splitMemberKey('employee:employment:3')).toEqual({ kind: 'employee', id: 'employment:3' });
    expect(splitMemberKey('sub:sub:2')).toEqual({ kind: 'sub', id: 'sub:2' });
    expect(splitMemberKey('owner:owner')).toEqual({ kind: 'owner', id: 'owner' });
  });
});
