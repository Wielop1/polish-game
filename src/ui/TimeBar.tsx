import { diffDays, firstOfNextMonth, formatDatePL, weekdayIndex } from '../engine/date.ts';
import { netWorthBreakdown } from '../engine/selectors.ts';
import { useGameStore } from '../store/gameStore.ts';
import { Button, Money } from './components/ui.tsx';
import { weekdayNamePL } from './format.ts';

/** Pasek HUD: data gry, gotówka, majątek netto i sterowanie czasem. */
export function TimeBar() {
  const game = useGameStore((s) => s.game)!;
  const advanceDay = useGameStore((s) => s.advanceDay);
  const advanceMonth = useGameStore((s) => s.advanceMonth);
  const today = game.clock.today;
  const nw = netWorthBreakdown(game);
  const daysToMonth = diffDays(firstOfNextMonth(today), today);
  const dayNo = diffDays(today, game.clock.startDate) + 1;

  return (
    <header className="sticky top-0 z-10 border-b border-ink-700/60 bg-ink-900/80 px-4 py-3 backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="text-[11px] tracking-wider text-slate-400 uppercase">
            {weekdayNamePL(weekdayIndex(today))} · dzień gry {dayNo}
          </div>
          <div data-testid="game-date" className="text-lg font-bold text-white sm:text-xl">{formatDatePL(today)}</div>
        </div>

        <dl className="order-3 flex w-full flex-wrap items-center gap-x-6 gap-y-1 sm:order-none sm:w-auto">
          <div>
            <dt className="text-[11px] tracking-wider text-slate-400 uppercase">Gotówka</dt>
            <dd data-testid="hud-cash" className="text-base font-semibold text-gain"><Money value={nw.cash} /></dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wider text-slate-400 uppercase">Oszczędności</dt>
            <dd data-testid="hud-savings" className="text-base font-semibold text-violet"><Money value={nw.savings} /></dd>
          </div>
          {game.businesses.some((b) => b.status === 'active') && (
            <div>
              <dt className="text-[11px] tracking-wider text-slate-400 uppercase">Firma</dt>
              <dd data-testid="hud-business" className="text-base font-semibold text-gold"><Money value={nw.business} /></dd>
            </div>
          )}
          <div>
            <dt className="text-[11px] tracking-wider text-slate-400 uppercase">Majątek netto</dt>
            <dd data-testid="hud-networth" className="text-base font-semibold text-sky"><Money value={nw.netWorth} /></dd>
          </div>
        </dl>

        <div className="flex items-center gap-2">
          <Button variant="secondary" icon="step" onClick={advanceDay} data-testid="advance-day">
            Następny dzień
          </Button>
          <Button variant="primary" icon="fast" onClick={advanceMonth} data-testid="advance-month" title={`Przesuwa o ${daysToMonth} dni, przetwarzając każdy dzień`}>
            Do następnego miesiąca
          </Button>
        </div>
      </div>
    </header>
  );
}
