import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { commands } from '../engine/commands.ts';
import { addDays } from '../engine/date.ts';
import { zl } from '../engine/money.ts';
import { crewKey, defaultQuoteInput } from '../engine/renovation.ts';
import { craftEnquiry, hireEmployee, ok, opsGame, toDate } from '../engine/testkit.ts';
import { RenoQuotesScreen } from './screens/RenovationScreens.tsx';

const fake: { state: Record<string, unknown> } = { state: {} };
vi.mock('../store/gameStore.ts', () => ({ useGameStore: (sel: (x: unknown) => unknown) => sel(fake.state) }));

describe('podpisanie umowy: skład „ja + pracownik” z oferty zostaje zachowany', () => {
  it('krok podpisania pokazuje oboje wykonawców (jak w ofercie) i pozwala zaznaczać kilka osób', () => {
    let s = opsGame();
    s = hireEmployee(s, { expected: zl(5_400), start: '2026-03-01' }).s;
    s = toDate(s, '2026-03-02');
    const emp = s.ops.employments.at(-1)!;
    const enq = craftEnquiry(s);
    const q = { ...defaultQuoteInput(s, enq), teamId: crewKey([{ kind: 'owner', id: 'owner' }, { kind: 'employee', id: emp.id }]), supervision: 'worker' as const };
    s = ok(commands.sendQuote(s, enq.id, q));
    const quote = s.reno.quotes.at(-1)!;
    expect(quote.teamId).not.toBeNull();
    s = structuredClone(s);
    const qq = s.reno.quotes.at(-1)!;
    qq.status = 'accepted'; qq.acceptedOn = s.clock.today; qq.signBy = addDays(s.clock.today, 5);
    fake.state = { game: s, selectedEnquiryId: null, selectEnquiry: () => undefined, navigate: () => undefined, signContract: () => undefined, respondToCounter: () => undefined };
    const text = renderToString(createElement(RenoQuotesScreen)).replace(/<[^>]+>/g, ' ');
    expect(text).toMatch(/Wybrani wykonawcy:[^.]*(Właściciel|Ty)[^.]*\+|Wybrani wykonawcy:[^.]*\+[^.]*(Właściciel|Ty)/);
    expect(text).toContain('(jak w ofercie)');
    expect(renderToString(createElement(RenoQuotesScreen))).toContain(`sign-emp-${qq.id}-${emp.id}`);
  });
});
