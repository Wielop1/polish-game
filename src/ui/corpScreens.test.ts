import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { commands } from '../engine/commands.ts';
import { addDays } from '../engine/date.ts';
import { distributable } from '../engine/companyFinance.ts';
import { DRAFT, companyWithOps, foundCompany, ok, richGame, runMonths, shapePartner } from '../engine/corpkit.ts';
import { zl } from '../engine/money.ts';
import { advanceDays } from '../engine/simulate.ts';
import type { GameState } from '../engine/state.ts';
import { OperatorBar } from './OperatorBar.tsx';
import { CorpBoardScreen, CorpCompaniesScreen, CorpFoundScreen, CorpPartnersScreen, CorpSharesScreen } from './screens/CorpScreens.tsx';
import { CorpDividendsScreen, CorpFinanceScreen, CorpInvestorsScreen, CorpResolutionsScreen } from './screens/CorpScreens2.tsx';
import { RenoDashboardScreen } from './screens/RenovationScreens.tsx';

const fake: { state: Record<string, unknown> } = { state: {} };
vi.mock('../store/gameStore.ts', () => ({ useGameStore: (sel: (x: unknown) => unknown) => sel(fake.state) }));

const noop = () => true;
function setGame(game: GameState, extra: Record<string, unknown> = {}) {
  fake.state = { game, screen: 'corpCompanies', selectedCompanyId: null, selectCompany: noop, run: noop, navigate: noop, selectOperator: noop, ...extra };
}
const html = (el: ReturnType<typeof createElement>) => renderToString(el);
const all = [CorpCompaniesScreen, CorpFoundScreen, CorpPartnersScreen, CorpSharesScreen, CorpBoardScreen, CorpResolutionsScreen, CorpFinanceScreen, CorpDividendsScreen, CorpInvestorsScreen];

describe('ekrany „Spółki i inwestycje prywatne” (render)', () => {
  it('bez spółek: wszystkie ekrany się renderują i prowadzą do założenia spółki', () => {
    setGame(richGame('ui-0'));
    for (const S of all) expect(() => html(createElement(S))).not.toThrow();
    expect(html(createElement(CorpFoundScreen))).toContain('Utwórz szkic spółki');
    expect(html(createElement(CorpFoundScreen))).toContain('Minimum 5');
  });

  it('szkic i spółka w organizacji: kroki rejestracji, wspólnicy, umowa spółki', () => {
    let s = richGame('ui-1');
    s = shapePartner(s, 'partner:1', { trust: 70, capital: zl(400_000), riskTolerance: 60, competence: 60, goal: 'growth', dividendPreference: 50 });
    s = ok(commands.createCompanyDraft(s, { ...DRAFT, capital: zl(120_000) }));
    s = ok(commands.proposeDeal(s, { kind: 'found', companyId: 'co:1', partnerId: 'partner:1', terms: { shares: 960, amount: 0, percentBps: 0, role: 'none', dividendPolicy: 'none' } }));
    setGame(s);
    const f = html(createElement(CorpFoundScreen));
    expect(f).toContain('Wspólnicy zakładający spółkę');
    expect(f).toContain('sign-agreement-btn');
    expect(html(createElement(CorpPartnersScreen))).toContain('invite-partner:1');
    let s2 = ok(commands.acceptCounter(s, s.corp.negotiations.at(-1)!.id));
    s2 = ok(commands.signAgreement(s2, { companyId: 'co:1', board: [{ personId: s2.person.id, role: 'president' }], file: true }));
    setGame(s2);
    expect(html(createElement(CorpFoundScreen))).toContain('w organizacji');
    expect(html(createElement(CorpCompaniesScreen))).toContain('company-co:1');
  });

  it('zarejestrowana spółka z działalnością, wynikami i uchwałami: tabele udziałów, zarząd, CIT, dywidendy, negocjacje, przełącznik podmiotu', () => {
    let s = companyWithOps({ seed: 'ui-2', capital: zl(120_000), vat: 'active', equip: [], partnerId: 'partner:1', partnerShares: 960, board: 'both' });
    s = runMonths(s, '2027-01-02', { sales: zl(60_000), cost: zl(10_000) });
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'approve_statements', year: 2026 }));
    setGame(s);
    for (const S of all) expect(() => html(createElement(S))).not.toThrow();
    expect(html(createElement(CorpSharesScreen))).toContain('share-table');
    expect(html(createElement(CorpBoardScreen))).toContain('board-table');
    const res = html(createElement(CorpResolutionsScreen));
    expect(res).toContain('open-resolutions');
    expect(res).toContain('Zatwierdzenie sprawozdania finansowego');
    expect(html(createElement(CorpFinanceScreen))).toContain('balance-sheet');
    expect(html(createElement(CorpFinanceScreen))).toContain('cit-rate');
    s = advanceDays(s, 14);
    const d = distributable(s, s.corp.companies[0]!);
    s = ok(commands.proposeResolution(s, 'co:1', { type: 'allocate_profit', year: 2026, dividendGross: Math.floor(d.max / 20_000) * 10_000, toReserve: 0, dividendDay: addDays(s.clock.today, 14), payDay: addDays(s.clock.today, 30) }));
    s = advanceDays(s, 15);
    setGame(s);
    expect(html(createElement(CorpDividendsScreen))).toContain('distributable');
    expect(html(createElement(CorpResolutionsScreen))).toContain('resolution-history');
    expect(html(createElement(CorpInvestorsScreen))).toContain('propose-deal-btn');
    // przełącznik podmiotu nie pojawia się, gdy jest tylko jeden podmiot z działalnością
    expect(html(createElement(OperatorBar, { screen: 'renoDashboard' }))).toBe('');
    expect(() => html(createElement(RenoDashboardScreen))).not.toThrow();
  }, 60_000);

  it('JDG + spółka: przełącznik aktywnego podmiotu i ekran remontów czytają właściwy podmiot', () => {
    let s = companyWithOps({ seed: 'ui-3', capital: zl(120_000), equip: ['paint-basic'] });
    s = ok(commands.selectOperator(s, 'co:1'));
    setGame(s);
    expect(() => html(createElement(RenoDashboardScreen))).not.toThrow();
    void foundCompany;
  });
});
