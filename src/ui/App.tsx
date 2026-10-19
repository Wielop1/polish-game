import { useEffect, useMemo, useState } from 'react';
import { pendingLifeEvents } from '../engine/lifeEvents.ts';
import { useGameStore } from '../store/gameStore.ts';
import type { Screen } from '../store/gameStore.ts';
import { computeNavAlerts } from './navAlerts.ts';
import { Icon } from './components/icons.tsx';
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
import { B2BClientsScreen, ProjectPackagesScreen, ProjectReferencesScreen, ProjectsScreen } from './screens/ProjectScreens.tsx';
import { MarketCompetitionScreen, MarketDemandScreen, MarketLocalScreen, MarketMarketingScreen, MarketStrategyScreen } from './screens/MarketScreens.tsx';
import { RenoContractsScreen, RenoDashboardScreen, RenoEnquiriesScreen, RenoQuotesScreen, RenoReputationScreen, RenoScheduleScreen, RenoStockScreen } from './screens/RenovationScreens.tsx';
import { CorpBoardScreen, CorpCompaniesScreen, CorpFoundScreen, CorpPartnersScreen, CorpSharesScreen } from './screens/CorpScreens.tsx';
import { CorpDividendsScreen, CorpFinanceScreen, CorpInvestorsScreen, CorpResolutionsScreen } from './screens/CorpScreens2.tsx';
import { OperatorBar } from './OperatorBar.tsx';
import { ScreenHelp } from './ScreenHelp.tsx';
import { ALL_NAV, businessKind, sectionItems, sectionOf, visibleSections } from './nav.ts';
import type { NavSection } from './nav.ts';
import { GuideScreen } from './screens/GuideScreen.tsx';
import { CharacterScreen } from './screens/CharacterScreen.tsx';
import { DashboardScreen } from './screens/DashboardScreen.tsx';
import { EventsScreen } from './screens/EventsScreen.tsx';
import { FinancesScreen } from './screens/FinancesScreen.tsx';
import { GameScreen } from './screens/GameScreen.tsx';
import { NoticeBar } from './NoticeBar.tsx';
import { TimeBar } from './TimeBar.tsx';

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
    case 'guide': return <GuideScreen />;
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
    case 'b2bClients': return <B2BClientsScreen />;
    case 'projects': return <ProjectsScreen />;
    case 'projectPackages': return <ProjectPackagesScreen />;
    case 'projectReferences': return <ProjectReferencesScreen />;
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
  const sections = useMemo(() => (game ? visibleSections(game, screen) : []), [game, screen]);
  const kind = game ? businessKind(game) : null;
  const groupAlert = (sec: NavSection) => sectionItems(sec).some((n) => alerts[n.id]);
  const [open, setOpen] = useState<Set<string>>(() => new Set([sectionOf(screen) ?? 'Start', ...(game && !businessKind(game).business ? ['Moja firma'] : [])]));
  useEffect(() => {
    const t = sectionOf(screen);
    if (t) setOpen((o) => (o.has(t) ? o : new Set(o).add(t)));
  }, [screen]);
  // nowy gracz bez firmy od razu widzi grupę z rejestracją
  const gameId = game?.gameId;
  useEffect(() => {
    if (game && !businessKind(game).business) setOpen((o) => (o.has('Moja firma') ? o : new Set(o).add('Moja firma')));
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps
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
        {open.size > 1 && (
          <button type="button" onClick={() => setOpen(new Set([sectionOf(screen) ?? 'Start']))} className="mt-4 self-end rounded-lg px-2 py-0.5 text-[11px] text-slate-500 hover:bg-ink-800 hover:text-slate-300" data-testid="collapse-groups">Zwiń pozostałe grupy</button>
        )}
        <nav className="mt-2 flex flex-1 flex-col gap-2 overflow-y-auto" aria-label="Główna nawigacja">
          {sections.map((sec) => {
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
                {expanded && <p className="px-3 pt-0.5 pb-1 text-[11px] leading-snug text-slate-500" data-testid={`group-desc-${sec.title}`}>{sec.description}</p>}
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
                          title={alerts[n.id] ? `${n.label}: ${alerts[n.id]!.count} — ${alerts[n.id]!.hint}` : n.hint}
                          className={cx(
                            'flex items-center gap-3 rounded-xl px-3 py-1.5 text-left text-sm font-medium transition',
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
        {kind && !kind.business && (
          <div className="my-3 rounded-xl border border-gold/30 bg-gold/10 p-3 text-xs text-gold" data-testid="no-business-callout">
            <strong>Zlecenia, rynek i pracownicy odblokują się po założeniu firmy.</strong>
            <button type="button" onClick={() => navigate('bizRegister')} className="mt-1 block font-semibold underline">Załóż firmę →</button>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-slate-500">v0.8.1 · zarobek przedsiębiorcy, większe projekty B2B, referencje. Symulacja — nie porada prawna ani podatkowa.</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TimeBar />
        <main className="flex-1 overflow-y-auto px-4 pt-6 pb-28 sm:px-6 md:pb-10">
          <div className="mx-auto max-w-6xl">
            <NoticeBar />
            <div key={screen} className="animate-pop">
              <OperatorBar screen={screen} />
              <ScreenHelp key={screen} screen={screen} />
              {renderScreen(screen)}
            </div>
          </div>
        </main>
        {menuOpen && (
          <div className="fixed inset-x-0 bottom-14 z-30 max-h-[70vh] overflow-y-auto border-t border-ink-700 bg-ink-900/98 p-3 backdrop-blur md:hidden" role="dialog" aria-label="Menu">
            {sections.map((sec) => (
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
          {[ALL_NAV.find((n) => n.id === 'dashboard')!, ALL_NAV.find((n) => n.id === 'finances')!, ALL_NAV.find((n) => n.id === 'decisions')!].map((n) => (
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
