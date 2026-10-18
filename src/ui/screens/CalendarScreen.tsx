import { useMemo, useState } from 'react';
import { addMonthsToKey, dateInMonth, daysInMonth, formatDatePL, formatMonthPL, monthKey, monthKeyToYm, toIso, weekdayIndex, WEEKDAY_SHORT } from '../../engine/date.ts';
import type { IsoDate } from '../../engine/date.ts';
import { scheduledItems } from '../../engine/schedule.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Icon } from '../components/icons.tsx';
import { Badge, Button, Card, Empty, Money, ScreenHeader, cx, moneyTone } from '../components/ui.tsx';

interface DayItem {
  key: string;
  title: string;
  detail: string;
  amount: number | null;
  approximate: boolean;
  future: boolean;
  color: string;
}

const COLOR = { positive: '#34d399', negative: '#fb7185', warning: '#fbbf24', neutral: '#64748b', birthday: '#a78bfa' };

export function CalendarScreen() {
  const game = useGameStore((s) => s.game)!;
  const today = game.clock.today;
  const [cursor, setCursor] = useState(monthKey(today));
  const [selected, setSelected] = useState<IsoDate>(today);

  const { year, month } = monthKeyToYm(cursor);
  const dim = daysInMonth(year, month);
  const first = dateInMonth(year, month, 1);
  const lead = weekdayIndex(first);
  const cells = Math.ceil((lead + dim) / 7) * 7;

  const byDay = useMemo(() => {
    const map = new Map<string, DayItem[]>();
    const push = (date: string, item: DayItem) => map.set(date, [...(map.get(date) ?? []), item]);
    const monthEnd = dateInMonth(year, month, 'last');
    for (const e of game.events) {
      if (e.date < first || e.date > monthEnd) continue;
      push(e.date, {
        key: `e:${e.id}`,
        title: e.title,
        detail: e.detail,
        amount: e.amount,
        approximate: false,
        future: false,
        color: e.type === 'life.birthday' ? COLOR.birthday : COLOR[e.tone],
      });
    }
    for (const [i, s] of scheduledItems(game, first, monthEnd).entries()) {
      push(s.date, {
        key: `s:${i}`,
        title: s.kind === 'issue' ? `Naliczenie: ${s.title}` : s.kind === 'due' ? `Termin: ${s.title}` : s.title,
        detail: s.kind === 'issue' ? 'zaplanowane naliczenie' : s.kind === 'due' ? 'zaplanowana płatność' : 'zaplanowane',
        amount: s.amount,
        approximate: s.approximate,
        future: true,
        color: s.kind === 'birthday' ? COLOR.birthday : s.kind === 'issue' ? COLOR.neutral : (s.amount ?? 0) >= 0 ? COLOR.positive : COLOR.negative,
      });
    }
    return map;
  }, [game, first, year, month]);

  const selectedItems = byDay.get(selected) ?? [];
  const inCursor = selected.startsWith(cursor);

  return (
    <div className="space-y-5">
      <ScreenHeader title="Kalendarz" subtitle="Przeszłość z dziennika zdarzeń, przyszłość z harmonogramu (kwoty losowe oznaczone ~)." />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title={formatMonthPL(cursor)}
          action={
            <div className="flex items-center gap-1">
              <Button variant="ghost" aria-label="Poprzedni miesiąc" onClick={() => setCursor(addMonthsToKey(cursor, -1))}><Icon name="chevronLeft" className="size-4" /></Button>
              <Button variant="secondary" onClick={() => { setCursor(monthKey(today)); setSelected(today); }}>Dziś</Button>
              <Button variant="ghost" aria-label="Następny miesiąc" onClick={() => setCursor(addMonthsToKey(cursor, 1))}><Icon name="chevronRight" className="size-4" /></Button>
            </div>
          }
        >
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] tracking-wide text-slate-500 uppercase">
            {WEEKDAY_SHORT.map((d) => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1" data-testid="calendar-grid">
            {Array.from({ length: cells }, (_, i) => {
              const day = i - lead + 1;
              if (day < 1 || day > dim) return <div key={i} />;
              const date = toIso({ year, month, day });
              const items = byDay.get(date) ?? [];
              const isToday = date === today;
              const isSel = date === selected;
              const past = date < today;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(date)}
                  aria-label={`${formatDatePL(date)}${items.length ? `, zdarzeń: ${items.length}` : ''}`}
                  aria-pressed={isSel}
                  data-today={isToday || undefined}
                  className={cx(
                    'flex min-h-16 flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition sm:min-h-20',
                    isSel ? 'border-sky bg-sky/10' : 'border-ink-700/60 bg-ink-900/40 hover:border-ink-500',
                    isToday && 'ring-2 ring-gain/70',
                    past && !isSel && 'opacity-80',
                  )}
                >
                  <span className={cx('text-xs font-semibold', isToday ? 'text-gain' : 'text-slate-300')}>{day}</span>
                  <span className="flex flex-wrap gap-0.5">
                    {items.slice(0, 6).map((it) => (
                      <i key={it.key} className={cx('size-2 rounded-full', it.future && 'opacity-60 ring-1 ring-white/30')} style={{ background: it.color }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-gain" />wpływ</span>
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-loss" />wydatek</span>
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-gold" />ostrzeżenie</span>
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-violet" />życie</span>
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-slate-500 opacity-60 ring-1 ring-white/30" />obrys = zaplanowane</span>
          </div>
        </Card>

        <Card title={formatDatePL(selected)} action={selected === today ? <Badge tone="gain">dziś</Badge> : selected > today ? <Badge tone="sky">w przyszłości</Badge> : <Badge>przeszłość</Badge>}>
          {!inCursor && <p className="mb-2 text-xs text-slate-500">Wybrany dzień jest poza wyświetlanym miesiącem.</p>}
          {selectedItems.length === 0 ? (
            <Empty>Brak zdarzeń tego dnia.</Empty>
          ) : (
            <ul className="space-y-3" data-testid="day-details">
              {selectedItems.map((it) => (
                <li key={it.key} className="flex items-start gap-3 text-sm">
                  <i className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: it.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-100">{it.title}</div>
                    <div className="text-xs text-slate-500">{it.detail}</div>
                  </div>
                  {it.amount !== null && (
                    <div className={cx('shrink-0 font-medium', moneyTone(it.amount))}>
                      {it.approximate && <span className="text-slate-500">~</span>}
                      <Money value={it.amount} signed />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
