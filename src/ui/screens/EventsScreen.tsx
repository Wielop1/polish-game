import { useMemo, useState } from 'react';
import { categoryInfo } from '../../engine/categories.ts';
import { formatDatePL } from '../../engine/date.ts';
import type { GameEvent } from '../../engine/state.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Badge, Button, Card, Empty, Money, ScreenHeader, Segmented, moneyTone } from '../components/ui.tsx';

type Filter = 'all' | 'in' | 'out' | 'accrual' | 'warning' | 'life';
const PAGE = 80;

const matches = (e: GameEvent, f: Filter): boolean => {
  switch (f) {
    case 'all': return true;
    case 'in': return e.type === 'obligation.settled' && (e.amount ?? 0) > 0;
    case 'out': return e.type === 'obligation.settled' && (e.amount ?? 0) < 0;
    case 'accrual': return e.type === 'obligation.issued';
    case 'warning': return e.type === 'obligation.overdue';
    case 'life': return !e.type.startsWith('obligation.');
  }
};

const DOT: Record<GameEvent['tone'], string> = { positive: '#34d399', negative: '#fb7185', warning: '#fbbf24', neutral: '#64748b' };

export function EventsScreen() {
  const game = useGameStore((s) => s.game)!;
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);

  const events = useMemo(() => game.events.filter((e) => matches(e, filter)).reverse(), [game.events, filter]);
  const visible = events.slice(0, limit);
  const groups = useMemo(() => {
    const out: { date: string; items: GameEvent[] }[] = [];
    for (const e of visible) {
      const g = out[out.length - 1];
      if (g && g.date === e.date) g.items.push(e);
      else out.push({ date: e.date, items: [e] });
    }
    return out;
  }, [visible]);

  return (
    <div className="space-y-5">
      <ScreenHeader title="Historia zdarzeń" subtitle={`${game.events.length} zdarzeń w dzienniku — każde ma unikalny identyfikator i datę.`}>
        <Segmented<Filter>
          label="Filtr zdarzeń"
          value={filter}
          onChange={(f) => { setFilter(f); setLimit(PAGE); }}
          options={[{ value: 'all', label: 'Wszystkie' }, { value: 'in', label: 'Wpływy' }, { value: 'out', label: 'Wydatki' }, { value: 'accrual', label: 'Naliczenia' }, { value: 'warning', label: 'Ostrzeżenia' }, { value: 'life', label: 'Życie i decyzje' }]}
        />
      </ScreenHeader>

      {groups.length === 0 ? (
        <Empty>Brak zdarzeń w tej kategorii.</Empty>
      ) : (
        <div className="space-y-4" data-testid="events">
          {groups.map((g) => (
            <Card key={g.date}>
              <h2 className="mb-3 text-sm font-semibold text-slate-300">{formatDatePL(g.date)}</h2>
              <ul className="space-y-3">
                {g.items.map((e) => (
                  <li key={e.id} className="flex items-start gap-3">
                    <span className="mt-2 size-2.5 shrink-0 rounded-full" style={{ background: DOT[e.tone] }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-100">{e.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{e.detail}</span>
                        {e.category && <Badge>{categoryInfo(e.category).label}</Badge>}
                      </div>
                    </div>
                    {e.amount !== null && <div className={`shrink-0 text-sm font-medium ${moneyTone(e.amount)}`}><Money value={e.amount} signed /></div>}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          {events.length > limit && <div className="text-center"><Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>Pokaż starsze ({events.length - limit})</Button></div>}
        </div>
      )}
    </div>
  );
}
