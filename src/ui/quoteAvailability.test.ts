import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { advanceDays } from '../engine/simulate.ts';
import { commands } from '../engine/commands.ts';
import { createNewGame } from '../engine/newGame.ts';
import { activeBusiness } from '../engine/business.ts';
import { RenoEnquiriesScreen, RenoQuotesScreen } from './screens/RenovationScreens.tsx';
import { addDays } from '../engine/date.ts';
import { zl } from '../engine/money.ts';
import { defaultQuoteInput } from '../engine/renovation.ts';
import type { RenoEnquiry } from '../engine/state.ts';

const fake: { state: Record<string, unknown> } = { state: {} };
vi.mock('../store/gameStore.ts', () => ({ useGameStore: (sel: (x: unknown) => unknown) => sel(fake.state) }));

describe('zajętość terminów w UI wycen', () => {
  it('karta zapytania pokazuje kolizję z kontraktem i najbliższy wolny start, a kreator wyceny — kalendarz', () => {
    let s = createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed: 'smoke', lifeEvents: false });
    s.accounts[s.playerAccountId]!.balance += zl(80_000); s.openingCash += zl(80_000);
    const r = commands.registerBusiness(s, { name: 'Remonty Test', profileId: 'remonty', taxForm: 'skala', vatStatus: 'exempt', startDate: '2026-02-01', zusStart: 'ulga', sickness: false, specialization: 'malowanie' } as never);
    if (!r.ok) throw new Error(r.error);
    s = advanceDays(r.state, 40);
    const tr = commands.transferFunds(s, s.playerAccountId, activeBusiness(s)!.accountId, zl(30_000));
    if (!tr.ok) throw new Error(tr.error);
    const eq = commands.buyEquipment(tr.state, 'paint-basic');
    if (!eq.ok) throw new Error(eq.error);
    s = advanceDays(eq.state, 2);
    const biz = activeBusiness(s)!;
    const enq: RenoEnquiry = { id: 'enq:99', businessId: biz.id, clientId: 'c', clientName: 'Klient (fikcyjny)', location: 'Jaroty', serviceId: 'malowanie', units: 60, complexity: 'standard', qualityReq: 2, desiredStart: addDays(s.clock.today, 5), maxDays: 30, budgetGross: zl(3000), walkAwayGross: zl(3400), haggler: false, flexDays: 3, receivedOn: s.clock.today, respondBy: addDays(s.clock.today, 7), status: 'open', segment: 'standard', source: null, rivals: 0, rivalId: null, rivalUtility: 0, rivalAwarded: false };
    s.reno.enquiries.push(enq);
    // zajęty kalendarz: podpisany kontrakt w oczekiwanym terminie klienta
    const e0 = { ...enq, id: 'enq:98', clientId: 'party:client:98', desiredStart: enq.desiredStart };
    s.parties['party:client:98'] = { id: 'party:client:98', name: 'Klient (fikcyjny)', role: 'service' };
    s.counters['reno:enquiry'] = 99;
    s.reno.enquiries.push(e0);
    const e0q = { ...defaultQuoteInput(s, e0), startDate: enq.desiredStart, durationDays: 10, hoursPerDay: 3 };
    const sent = commands.sendQuote(s, e0.id, e0q);
    if (!sent.ok) throw new Error(sent.error);
    s = sent.state;
    const qq = s.reno.quotes.at(-1)!; qq.status = 'accepted'; qq.acceptedOn = s.clock.today; qq.signBy = addDays(s.clock.today, 5);
    const signed = commands.signContract(s, qq.id);
    if (!signed.ok) throw new Error(signed.error);
    s = signed.state;
    // drugi, zaakceptowany kontrakt w tym samym terminie: doba właściciela jest już zajęta przez pierwszy kontrakt
    const e1 = { ...enq, id: 'enq:97', clientId: 'party:client:97' };
    s.parties['party:client:97'] = { id: 'party:client:97', name: 'Klient (fikcyjny)', role: 'service' };
    s.reno.enquiries.push(e1);
    const sent1 = commands.sendQuote(s, e1.id, { ...e0q, startDate: enq.desiredStart });
    if (!sent1.ok) throw new Error(sent1.error);
    s = sent1.state;
    const q1 = s.reno.quotes.at(-1)!; q1.status = 'accepted'; q1.acceptedOn = s.clock.today; q1.signBy = addDays(s.clock.today, 5);
    const noop = () => undefined;
    fake.state = { game: s, selectedEnquiryId: 'enq:99', selectEnquiry: noop, navigate: noop, declineEnquiry: noop, sendQuote: noop };
    const html = renderToString(createElement(RenoEnquiriesScreen));
    expect(html).toContain('enquiry-availability-enq:99');
    expect(html).toContain('Masz zajęty termin');
    expect(html).toMatch(/Najwcześniej możesz zacząć/);
    const html2 = renderToString(createElement(RenoQuotesScreen));
    expect(html2).toContain('quote-calendar');
    // zaakceptowana oferta: wybór wykonawcy i wyjaśnienie, czemu podpis jest zablokowany
    expect(html2).toContain('sign-who-');
    expect(html2.replace(/<[^>]+>/g, '')).toMatch(/Nie można podpisać: Brak wolnych godzin/);
    expect(html2).toContain('Zleć podwykonawcy');
  });
});
