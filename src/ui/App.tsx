import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore.ts';
import type { Screen } from '../store/gameStore.ts';
import { Icon } from './components/icons.tsx';
import type { IconName } from './components/icons.tsx';
import { cx } from './components/ui.tsx';
import { CalendarScreen } from './screens/CalendarScreen.tsx';
import { CharacterScreen } from './screens/CharacterScreen.tsx';
import { DashboardScreen } from './screens/DashboardScreen.tsx';
import { EventsScreen } from './screens/EventsScreen.tsx';
import { FinancesScreen } from './screens/FinancesScreen.tsx';
import { GameScreen } from './screens/GameScreen.tsx';
import { NoticeBar } from './NoticeBar.tsx';
import { TimeBar } from './TimeBar.tsx';

const NAV: { id: Screen; label: string; icon: IconName }[] = [
  { id: 'dashboard', label: 'Pulpit', icon: 'dashboard' },
  { id: 'character', label: 'Postać', icon: 'user' },
  { id: 'finances', label: 'Finanse', icon: 'wallet' },
  { id: 'calendar', label: 'Kalendarz', icon: 'calendar' },
  { id: 'events', label: 'Historia zdarzeń', icon: 'list' },
  { id: 'game', label: 'Nowa gra / Wczytaj', icon: 'save' },
];

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
    case 'game': return <GameScreen />;
  }
}

export function App() {
  const game = useGameStore((s) => s.game);
  const screen = useGameStore((s) => s.screen);
  const navigate = useGameStore((s) => s.navigate);
  const init = useGameStore((s) => s.init);

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
        <nav className="mt-8 flex flex-1 flex-col gap-1" aria-label="Główna nawigacja">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => navigate(n.id)}
              aria-current={screen === n.id ? 'page' : undefined}
              className={cx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition',
                screen === n.id ? 'bg-ink-700 text-white shadow-inner ring-1 ring-ink-600' : 'text-slate-400 hover:bg-ink-800 hover:text-slate-100',
              )}
            >
              <Icon name={n.icon} />
              {n.label}
            </button>
          ))}
        </nav>
        <p className="text-[11px] leading-relaxed text-slate-500">v0.1 · prototyp ekonomii. Wszystkie parametry finansowe są przykładowe.</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TimeBar />
        <main className="flex-1 overflow-y-auto px-4 pt-6 pb-28 sm:px-6 md:pb-10">
          <div className="mx-auto max-w-6xl">
            <NoticeBar />
            <div key={screen} className="animate-pop">
              {renderScreen(screen)}
            </div>
          </div>
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-ink-700 bg-ink-900/95 backdrop-blur md:hidden" aria-label="Nawigacja mobilna">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => navigate(n.id)}
              aria-label={n.label}
              aria-current={screen === n.id ? 'page' : undefined}
              className={cx('flex flex-col items-center gap-0.5 py-2.5 text-[10px]', screen === n.id ? 'text-gain' : 'text-slate-400')}
            >
              <Icon name={n.icon} className="size-5" />
              {n.label.split(' ')[0]}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
