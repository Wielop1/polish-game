import { SKILL_LABELS } from './config.ts';
import { createObligation, logEvent, partyName } from './core.ts';
import { formatDatePL } from './date.ts';
import type { IsoDate } from './date.ts';
import { refundDeposit } from './housing.ts';
import { decideApplication, expireOffer } from './jobs.ts';
import { expireLifeEvent } from './lifeEvents.ts';
import type { GameState, PendingAction } from './state.ts';

function execute(s: GameState, a: PendingAction, date: IsoDate): void {
  switch (a.type) {
    case 'application.decision':
      decideApplication(s, a.applicationId, date);
      return;
    case 'application.offer_expiry':
      expireOffer(s, a.applicationId, date);
      return;
    case 'event.expire':
      expireLifeEvent(s, a.eventId, date);
      return;
    case 'deposit.refund':
      refundDeposit(s, a.assetId, date);
      return;
    case 'obligation.issue': {
      const o = a.obligation;
      createObligation(s, { ...o, issueDate: date, dueDate: o.dueDate < date ? date : o.dueDate });
      return;
    }
    case 'skill.gain': {
      s.life.skills[a.skill] = Math.min(5, (s.life.skills[a.skill] ?? 0) + a.levels);
      logEvent(s, {
        id: `life.skill:${a.id}`, date, type: 'life.event', tone: 'positive', title: a.label,
        detail: `${SKILL_LABELS[a.skill]}: poziom ${s.life.skills[a.skill]}/5`, amount: null, category: null,
      });
      return;
    }
    case 'housing.move_in': {
      const c = s.contracts.find((x) => x.id === a.contractId);
      if (!c || c.type !== 'lease') return;
      logEvent(s, {
        id: `housing.move_in:${c.id}`, date, type: 'housing.move_in', tone: 'neutral',
        title: `Przeprowadzka: ${c.title}`, detail: `Od ${formatDatePL(date)} mieszkasz tutaj`,
        amount: null, category: null,
      });
      return;
    }
    case 'contract.milestone': {
      const c = s.contracts.find((x) => x.id === a.contractId);
      if (!c) return;
      if (c.type === 'employment') {
        if (a.milestone === 'start') {
          logEvent(s, {
            id: `job.started:${c.id}`, date, type: 'job.started', tone: 'positive',
            title: `Rozpoczęcie pracy: ${c.title}`, detail: `${partyName(s, c.partyId)} · ${c.location}`, amount: null, category: null,
          });
        } else {
          logEvent(s, {
            id: `job.ended:${c.id}`, date, type: 'job.ended', tone: c.terminatedBy === null ? 'neutral' : 'warning',
            title: c.terminatedBy === null ? `Zmiana warunków zatrudnienia: ${c.title}` : `Zakończenie pracy: ${c.title}`,
            detail: partyName(s, c.partyId), amount: null, category: null,
          });
        }
      } else if (a.milestone === 'end') {
        logEvent(s, {
          id: `housing.lease_ended:${c.id}`, date, type: 'housing.lease_ended', tone: 'neutral',
          title: `Zakończenie najmu: ${c.title}`, detail: partyName(s, c.partyId), amount: null, category: null,
        });
      }
    }
  }
}

/** Wykonuje akcje zaplanowane na `date` lub wcześniej (idempotentnie, w kolejności data → id). */
export function runPendingActions(s: GameState, date: IsoDate): void {
  const due = s.pending.filter((a) => a.date <= date).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (due.length === 0) return;
  for (const a of due) {
    if (s.processed[a.id]) continue;
    s.processed[a.id] = true;
    execute(s, a, date);
  }
  const done = new Set(due.map((a) => a.id));
  s.pending = s.pending.filter((a) => !done.has(a.id));
}
