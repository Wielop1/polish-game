import { useEffect, useMemo, useState } from 'react';
import { pendingLifeEvents } from '../engine/lifeEvents.ts';
import { useGameStore } from '../store/gameStore.ts';
import type { Screen } from '../store/gameStore.ts';
import { computeNavAlerts } from './navAlerts.ts';
import { Icon } from './components/icons.tsx';
import type { IconName } from './components/icons.tsx';
import { cx } from './components/ui.tsx';
import { CalendarScreen } from './screens/CalendarScreen.tsx';
import { DecisionsScreen } from './screens/DecisionsScreen.tsx';
import { HousingScreen } from './screens/HousingScreen.tsx';
import { JobsScreen } from './screens/JobsScreen.tsx';
import { LifestyleScreen } from './screens/LifestyleScreen.tsx';
import { SavingsScreen } from './screens/SavingsScreen.tsx';
import { TimeScreen } from './screens/TimeScreen.tsx';
import { BizCalendarScreen, BizDocsScreen, BizFinanceScreen, BizOrdersScreen, BizOverviewScreen, BizRegisterScreen, BizTaxScreen } from './screens/BusinessScreens.tsx';
import { BizReportScreen, BizSettlementScreen, PlanningScreen } from './screens/AnnualScreens.tsx';
import { HrEmployeesScreen, HrRecruitmentScreen, MultiScheduleScreen, ProfitabilityScreen, SubcontractorsScreen, TeamsScreen, VehiclesScreen } from './screens/WorkforceScreens.tsx';
import { BizAccountingScreen } from './screens/AccountingScreen.tsx';
import { MarketCompetitionScreen, MarketDemandScreen, MarketLocalScreen, MarketMarketingScreen, MarketStrategyScreen } from './screens/MarketScreens.tsx';
import { RenoContractsScreen, RenoDashboardScreen, RenoEnquiriesScreen, RenoQuotesScreen, RenoReputationScreen, RenoScheduleScreen, RenoStockScreen } from './screens/RenovationScreens.tsx';
import { CorpBoardScreen, CorpCompaniesScreen, CorpFoundScreen, CorpPartnersScreen, CorpSharesScreen } from './screens/CorpScreens.tsx';
import { CorpDividendsScreen, CorpFinanceScreen, CorpInvestorsScreen, CorpResolutionsScreen } from './screens/CorpScreens2.tsx';
import { OperatorBar } from './OperatorBar.tsx';
import { CharacterScreen } from './screens/CharacterScreen.tsx';
import { DashboardScreen } from './screens/DashboardScreen.tsx';
import { EventsScreen } from './screens/EventsScreen.tsx';
import { FinancesScreen } from './screens/FinancesScreen.tsx';
import { GameScreen } from './screens/GameScreen.tsx';
import { NoticeBar } from './NoticeBar.tsx';
import { TimeBar } from './TimeBar.tsx';

interface NavItem {
  id: Screen;
  label: string;
  icon: IconName;
}
interface NavBlock {
  label?: string;
  items: NavItem[];
}
interface NavSection {
  title: string;
  blocks: NavBlock[];
}
const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Przegląd',
    blocks: [{
      items: [
        { id: 'dashboard', label: 'Pulpit', icon: 'dashboard' },
        { id: 'character', label: 'Postać', icon: 'user' },
        { id: 'finances', label: 'Finanse', icon: 'wallet' },
        { id: 'calendar', label: 'Kalendarz', icon: 'calendar' },
        { id: 'events', label: 'Historia zdarzeń', icon: 'list' },
      ],
    }],
  },
  {
    title: 'Życie',
    blocks: [{
      items: [
        { id: 'jobs', label: 'Oferty pracy', icon: 'briefcase' },
        { id: 'housing', label: 'Mieszkanie', icon: 'home' },
        { id: 'lifestyle', label: 'Styl życia', icon: 'heart' },
        { id: 'time', label: 'Budżet czasu', icon: 'clock' },
        { id: 'savings', label: 'Oszczędności', icon: 'coins' },
        { id: 'decisions', label: 'Decyzje i wydarzenia', icon: 'bell' },
      ],
    }],
  },
  {
    title: 'Firma (JDG)',
    blocks: [
      {
        items: [
          { id: 'bizRegister', label: 'Rejestracja JDG', icon: 'building' },
          { id: 'bizOverview', label: 'Moja działalność', icon: 'briefcase' },
          { id: 'bizFinance', label: 'Finanse firmy', icon: 'trend' },
          { id: 'planning', label: 'Planowanie', icon: 'trend' },
        ],
      },
      {
        label: 'Podatki i księgowość',
        items: [
          { id: 'bizTax', label: 'Podatki i ZUS', icon: 'shield' },
          { id: 'bizAccounting', label: 'Księgowość', icon: 'file' },
          { id: 'bizDocs', label: 'Dokumenty', icon: 'receipt' },
          { id: 'bizCalendar', label: 'Kalendarz obowiązków', icon: 'calendar' },
          { id: 'bizSettlement', label: 'Rozliczenie roczne', icon: 'receipt' },
          { id: 'bizReport', label: 'Podsumowanie roku', icon: 'list' },
        ],
      },
      {
        label: 'Ludzie',
        items: [
          { id: 'hrEmployees', label: 'Pracownicy', icon: 'user' },
          { id: 'hrRecruitment', label: 'Rekrutacja', icon: 'bell' },
        ],
      },
    ],
  },
  {
    title: 'Zlecenia',
    blocks: [
      {
        items: [
          { id: 'renoDashboard', label: 'Pulpit zleceń', icon: 'dashboard' },
          { id: 'renoEnquiries', label: 'Zapytania klientów', icon: 'bell' },
          { id: 'renoQuotes', label: 'Wyceny', icon: 'receipt' },
          { id: 'renoContracts', label: 'Kontrakty', icon: 'briefcase' },
          { id: 'bizOrders', label: 'Oferty i kontrakty', icon: 'file' },
        ],
      },
      {
        label: 'Realizacja',
        items: [
          { id: 'renoSchedule', label: 'Harmonogram', icon: 'calendar' },
          { id: 'opsSchedule', label: 'Harmonogram wielu kontraktów', icon: 'calendar' },
          { id: 'opsTeams', label: 'Ekipy', icon: 'user' },
          { id: 'opsSubcontractors', label: 'Podwykonawcy', icon: 'file' },
          { id: 'renoStock', label: 'Magazyn i sprzęt', icon: 'coins' },
          { id: 'opsVehicles', label: 'Pojazdy', icon: 'home' },
        ],
      },
      {
        label: 'Wyniki',
        items: [
          { id: 'opsProfit', label: 'Rentowność', icon: 'trend' },
          { id: 'renoReputation', label: 'Reputacja i reklamacje', icon: 'heart' },
        ],
      },
    ],
  },
  {
    title: 'Rynek',
    blocks: [{
      items: [
        { id: 'marketLocal', label: 'Rynek lokalny', icon: 'trend' },
        { id: 'marketCompetition', label: 'Konkurencja', icon: 'user' },
        { id: 'marketMarketing', label: 'Marketing', icon: 'bell' },
        { id: 'marketStrategy', label: 'Strategia firmy', icon: 'shield' },
        { id: 'marketDemand', label: 'Analiza popytu', icon: 'list' },
      ],
    }],
  },
  {
    title: 'Spółki i inwestycje prywatne',
    blocks: [
      {
        items: [
          { id: 'corpCompanies', label: 'Moje spółki', icon: 'building' },
          { id: 'corpFound', label: 'Załóż spółkę', icon: 'file' },
        ],
      },
      {
        label: 'Własność i zarządzanie',
        items: [
          { id: 'corpPartners', label: 'Wspólnicy', icon: 'user' },
          { id: 'corpShares', label: 'Udziały i kapitał', icon: 'coins' },
          { id: 'corpBoard', label: 'Zarząd', icon: 'shield' },
          { id: 'corpResolutions', label: 'Uchwały', icon: 'list' },
        ],
      },
      {
        label: 'Finanse',
        items: [
          { id: 'corpFinance', label: 'Finanse i CIT', icon: 'receipt' },
          { id: 'corpDividends', label: 'Dywidendy', icon: 'wallet' },
          { id: 'corpInvestors', label: 'Inwestorzy i negocjacje', icon: 'trend' },
        ],
      },
    ],
  },
  { title: 'System', blocks: [{ items: [{ id: 'game', label: 'Nowa gra / Wczytaj', icon: 'save' }] }] },
];
const sectionItems = (sec: NavSection) => sec.blocks.flatMap((b) => b.items);
const ALL_NAV = NAV_SECTIONS.flatMap(sectionItems);
const sectionOf = (id: Screen) => NAV_SECTIONS.find((sec) => sectionItems(sec).some((n) => n.id === id))?.title;

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-xl bg-linear-to-br from-gain to-sky text-ink-950 shadow-lg shadow-emerald-500/20">
        <Icon name="trend" className="size-6" />
      </div>
      <div className="leading-tight">
        <div className="text-base font-extrabold tracking-tight text-white">POLSKI TYCOON</div>
        <div className="text-[11px] tracking-wide text-slate-400 uppercase">symulator przedsiębiorcy</div>
      </div>
    </div>
  );
}

function renderScreen(screen: Screen) {
  switch (screen) {
    case 'dashboard': return <DashboardScreen />;
    case 'character': return <CharacterScreen />;
    case 'finances': return <FinancesScreen />;
    case 'calendar': return <CalendarScreen />;
    case 'events': return <EventsScreen />;
    case 'jobs': return <JobsScreen />;
    case 'housing': return <HousingScreen />;
    case 'lifestyle': return <LifestyleScreen />;
    case 'time': return <TimeScreen />;
    case 'savings': return <SavingsScreen />;
    case 'decisions': return <DecisionsScreen />;
    case 'bizRegister': return <BizRegisterScreen />;
    case 'bizOverview': return <BizOverviewScreen />;
    case 'bizOrders': return <BizOrdersScreen />;
    case 'bizFinance': return <BizFinanceScreen />;
    case 'bizTax': return <BizTaxScreen />;
    case 'bizDocs': return <BizDocsScreen />;
    case 'bizCalendar': return <BizCalendarScreen />;
    case 'bizSettlement': return <BizSettlementScreen />;
    case 'bizReport': return <BizReportScreen />;
    case 'planning': return <PlanningScreen />;
    case 'bizAccounting': return <BizAccountingScreen />;
    case 'renoDashboard': return <RenoDashboardScreen />;
    case 'renoEnquiries': return <RenoEnquiriesScreen />;
    case 'renoQuotes': return <RenoQuotesScreen />;
    case 'renoContracts': return <RenoContractsScreen />;
    case 'renoSchedule': return <RenoScheduleScreen />;
    case 'renoStock': return <RenoStockScreen />;
    case 'renoReputation': return <RenoReputationScreen />;
    case 'hrEmployees': return <HrEmployeesScreen />;
    case 'hrRecruitment': return <HrRecruitmentScreen />;
    case 'opsSubcontractors': return <SubcontractorsScreen />;
    case 'opsTeams': return <TeamsScreen />;
    case 'opsSchedule': return <MultiScheduleScreen />;
    case 'opsVehicles': return <VehiclesScreen />;
    case 'opsProfit': return <ProfitabilityScreen />;
    case 'marketLocal': return <MarketLocalScreen />;
    case 'marketCompetition': return <MarketCompetitionScreen />;
    case 'marketMarketing': return <MarketMarketingScreen />;
    case 'marketStrategy': return <MarketStrategyScreen />;
    case 'marketDemand': return <MarketDemandScreen />;
    case 'corpCompanies': return <CorpCompaniesScreen />;
    case 'corpFound': return <CorpFoundScreen />;
    case 'corpPartners': return <CorpPartnersScreen />;
    case 'corpShares': return <CorpSharesScreen />;
    case 'corpBoard': return <CorpBoardScreen />;
    case 'corpResolutions': return <CorpResolutionsScreen />;
    case 'corpFinance': return <CorpFinanceScreen />;
    case 'corpDividends': return <CorpDividendsScreen />;
    case 'corpInvestors': return <CorpInvestorsScreen />;
    case 'game': return <GameScreen />;
  }
}

export function App() {
  const game = useGameStore((s) => s.game);
  const screen = useGameStore((s) => s.screen);
  const navigate = useGameStore((s) => s.navigate);
  const init = useGameStore((s) => s.init);
  const visited = useGameStore((s) => s.visited);
  const [menuOpen, setMenuOpen] = useState(false);
  const alerts = useMemo(() => (game ? computeNavAlerts(game, visited) : {}), [game, visited]);
  const groupAlert = (sec: NavSection) => sectionItems(sec).some((n) => alerts[n.id]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(['Przegląd', sectionOf(screen) ?? '']));
  useEffect(() => {
    const t = sectionOf(screen);
    if (t) setOpen((o) => (o.has(t) ? o : new Set(o).add(t)));
  }, [screen]);
  const toggle = (title: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(title)) n.add(title); return n; });
  const totalAlerts = Object.keys(alerts).length;
  const attention = game ? pendingLifeEvents(game).length + game.applications.filter((a) => a.status === 'offered').length : 0;

  useEffect(() => {
    void init();
  }, [init]);

  if (!game) {
    return (
      <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        <Logo />
        <NoticeBar />
        <GameScreen />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-ink-700/60 bg-ink-900/60 p-5 backdrop-blur md:flex">
        <Logo />
        <nav className="mt-6 flex flex-1 flex-col gap-2 overflow-y-auto" aria-label="Główna nawigacja">
          {NAV_SECTIONS.map((sec) => {
            const expanded = open.has(sec.title);
            return (
              <div key={sec.title}>
                <button
                  type="button"
                  onClick={() => toggle(sec.title)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-[11px] font-semibold tracking-wider text-slate-400 uppercase transition hover:bg-ink-800 hover:text-slate-200"
                >
                  <Icon name="chevronRight" className={cx('size-3.5 transition-transform', expanded && 'rotate-90')} />
                  <span className="flex-1">{sec.title}</span>
                  {!expanded && attention > 0 && sectionItems(sec).some((n) => n.id === 'decisions') && <span data-testid="attention-badge" className="grid min-w-5 place-items-center rounded-full bg-gold px-1.5 text-[11px] font-bold text-ink-950 normal-case">{attention}</span>}
                  {groupAlert(sec) && <span aria-hidden="true" data-testid={`group-dot-${sec.title}`} className="size-1.5 rounded-full bg-gold" />}
                </button>
                {expanded && sec.blocks.map((blk, bi) => (
                  <div key={bi} className="mt-0.5">
                    {blk.label && <div className="mt-2 mb-0.5 px-3 text-[10px] font-semibold tracking-wider text-slate-600 uppercase">{blk.label}</div>}
                    <div className="flex flex-col gap-0.5">
                      {blk.items.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => navigate(n.id)}
                          aria-current={screen === n.id ? 'page' : undefined}
                          title={alerts[n.id] ? `${n.label}: ${alerts[n.id]!.count} — ${alerts[n.id]!.hint}` : undefined}
                          className={cx(
                            'flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition',
                            screen === n.id ? 'bg-ink-700 text-white shadow-inner ring-1 ring-ink-600' : 'text-slate-400 hover:bg-ink-800 hover:text-slate-100',
                          )}
                        >
                          <Icon name={n.icon} />
                          <span className="flex-1">{n.label}</span>
                          {alerts[n.id] && <span aria-hidden="true" data-testid={`nav-dot-${n.id}`} className="size-2.5 shrink-0 rounded-full bg-gold shadow-[0_0_6px] shadow-gold/60" />}
                          {n.id === 'decisions' && attention > 0 && <span data-testid="attention-badge" className="grid min-w-5 place-items-center rounded-full bg-gold px-1.5 text-[11px] font-bold text-ink-950">{attention}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </nav>
        <p className="text-[11px] leading-relaxed text-slate-500">v0.8 · spółki z o.o., wspólnicy, udziały, CIT i dywidendy. Symulacja — nie porada prawna ani podatkowa.</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TimeBar />
        <main className="flex-1 overflow-y-auto px-4 pt-6 pb-28 sm:px-6 md:pb-10">
          <div className="mx-auto max-w-6xl">
            <NoticeBar />
            <div key={screen} className="animate-pop">
              <OperatorBar screen={screen} />
              {renderScreen(screen)}
            </div>
          </div>
        </main>
        {menuOpen && (
          <div className="fixed inset-x-0 bottom-14 z-30 max-h-[70vh] overflow-y-auto border-t border-ink-700 bg-ink-900/98 p-3 backdrop-blur md:hidden" role="dialog" aria-label="Menu">
            {NAV_SECTIONS.map((sec) => (
              <div key={sec.title} className="mb-2">
                <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{sec.title}{groupAlert(sec) && <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />}</div>
                {sec.blocks.map((blk, bi) => (
                  <div key={bi}>
                    {blk.label && <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wider text-slate-600 uppercase">{blk.label}</div>}
                    <div className="grid grid-cols-2 gap-1">
                      {blk.items.map((n) => (
                        <button key={n.id} type="button" onClick={() => { navigate(n.id); setMenuOpen(false); }} className={cx('flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm', screen === n.id ? 'bg-ink-700 text-white' : 'text-slate-300')}>
                          <Icon name={n.icon} className="size-4" />{n.label}
                          {alerts[n.id] && <span aria-hidden="true" data-testid={`mnav-dot-${n.id}`} className="ml-auto size-2.5 shrink-0 rounded-full bg-gold" />}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-ink-700 bg-ink-900/95 backdrop-blur md:hidden" aria-label="Nawigacja mobilna">
          {[ALL_NAV[0]!, ALL_NAV.find((n) => n.id === 'finances')!, ALL_NAV.find((n) => n.id === 'decisions')!].map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => { navigate(n.id); setMenuOpen(false); }}
              aria-label={n.label}
              aria-current={screen === n.id ? 'page' : undefined}
              className={cx('relative flex flex-col items-center gap-0.5 py-2.5 text-[10px]', screen === n.id ? 'text-gain' : 'text-slate-400')}
            >
              <Icon name={n.icon} className="size-5" />
              {n.label.split(' ')[0]}
              {n.id === 'decisions' && attention > 0 && <span className="absolute top-1 right-[28%] grid min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-ink-950">{attention}</span>}
            </button>
          ))}
          <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label="Więcej" className={cx('relative flex flex-col items-center gap-0.5 py-2.5 text-[10px]', menuOpen ? 'text-gain' : 'text-slate-400')}>
            <Icon name="menu" className="size-5" />Więcej
            {totalAlerts > 0 && !menuOpen && <span aria-hidden="true" data-testid="more-dot" className="absolute top-2 right-[30%] size-2.5 rounded-full bg-gold" />}
          </button>
        </nav>
      </div>
    </div>
  );
}
