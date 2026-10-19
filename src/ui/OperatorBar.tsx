import { listOperators, selectedOperatorId } from '../engine/operator.ts';
import { useGameStore } from '../store/gameStore.ts';
import type { Screen } from '../store/gameStore.ts';
import { cx } from './components/ui.tsx';

/** Ekrany prowadzenia działalności remontowej: działają na wybranym podmiocie (JDG albo spółka z o.o.). */
export const OPERATOR_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
  'renoDashboard', 'renoEnquiries', 'renoQuotes', 'renoContracts', 'renoSchedule', 'renoStock', 'renoReputation',
  'hrEmployees', 'hrRecruitment', 'opsSubcontractors', 'opsTeams', 'opsSchedule', 'opsVehicles', 'opsProfit',
  'marketLocal', 'marketCompetition', 'marketMarketing', 'marketStrategy', 'marketDemand',
]);

/** Wybór aktywnego podmiotu (widoczny tylko, gdy gracz ma więcej niż jeden podmiot prowadzący działalność). */
export function OperatorBar({ screen }: { screen: Screen }) {
  const game = useGameStore((s) => s.game);
  const select = useGameStore((s) => s.selectOperator);
  if (!game || !OPERATOR_SCREENS.has(screen)) return null;
  const ops = listOperators(game);
  if (ops.length < 2) return null;
  const current = selectedOperatorId(game);
  return (
    <div role="group" aria-label="Aktywny podmiot" data-testid="operator-bar" className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-ink-700 bg-ink-900/60 p-2.5 text-sm">
      <span className="px-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">Aktywny podmiot</span>
      {ops.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === current} data-testid={`operator-${o.id}`} onClick={() => { if (o.id !== current) select(o.id); }}
          className={cx('rounded-lg border px-3 py-1', o.id === current ? 'border-sky bg-sky/15 text-white' : 'border-ink-600 text-slate-300 hover:border-ink-500')}>
          {o.label}
        </button>
      ))}
      <span className="text-xs text-slate-500">{current === 'jdg' ? 'osoba fizyczna' : 'osoba prawna — odrębny majątek, pracownicy i kontrakty'}</span>
    </div>
  );
}
