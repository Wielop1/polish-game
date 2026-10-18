import { useMemo } from 'react';
import { formatDatePL } from '../../engine/date.ts';
import { pendingLifeEvents } from '../../engine/lifeEvents.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Badge, Button, Card, Empty, ScreenHeader } from '../components/ui.tsx';

export function DecisionsScreen() {
  const game = useGameStore((s) => s.game)!;
  const resolve = useGameStore((s) => s.resolveLifeEvent);
  const navigate = useGameStore((s) => s.navigate);
  const pending = pendingLifeEvents(game);
  const offers = game.applications.filter((a) => a.status === 'offered');
  const history = useMemo(() => game.lifeEvents.filter((e) => e.status !== 'pending').slice().reverse(), [game.lifeEvents]);

  return (
    <div className="space-y-5">
      <ScreenHeader title="Decyzje i wydarzenia" subtitle="Zdarzenia życiowe zależą od Twojej sytuacji. Konsekwencje wyboru są opisane, ale dokładny wynik bywa nieznany z góry." />

      {offers.length > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gain/40 bg-gain/10 p-4 text-sm text-gain">
          <span>Masz {offers.length} {offers.length === 1 ? 'propozycję pracy czekającą' : 'propozycje pracy czekające'} na odpowiedź.</span>
          <Button variant="secondary" onClick={() => navigate('jobs')}>Przejdź do ofert pracy</Button>
        </div>
      )}

      <div data-testid="pending-decisions" className="space-y-4">
        {pending.length === 0 ? (
          <Empty>Brak oczekujących decyzji. Wydarzenia pojawiają się w trakcie gry — przesuwaj czas.</Empty>
        ) : (
          pending.map((ev) => (
            <Card key={ev.id} title={<span className="flex items-center gap-2">{ev.title}<Badge tone="gold">wymaga decyzji</Badge></span>}>
              <p className="text-sm text-slate-200">{ev.body}</p>
              <p className="mt-1 text-xs text-slate-500">
                Zdarzenie z {formatDatePL(ev.date)}.
                {ev.expiresOn && <> Decyzja do <strong className="text-slate-300">{formatDatePL(ev.expiresOn)}</strong>; bez wyboru zostanie zastosowana opcja domyślna: <em>{ev.options.find((o) => o.id === ev.defaultOptionId)?.label}</em>.</>}
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {ev.options.map((o) => (
                  <div key={o.id} className="flex flex-col justify-between rounded-xl border border-ink-700 bg-ink-900/50 p-3.5">
                    <div>
                      <div className="font-medium text-slate-50">{o.label}{o.id === ev.defaultOptionId && <span className="ml-2 text-xs font-normal text-slate-500">(domyślnie)</span>}</div>
                      <p className="mt-1 text-sm text-slate-400">{o.hint}</p>
                    </div>
                    <Button className="mt-3" variant={o.id === ev.defaultOptionId ? 'secondary' : 'primary'} onClick={() => resolve(ev.id, o.id)} data-testid={`choose-${ev.templateId}-${o.id}`}>Wybierz</Button>
                  </div>
                ))}
              </div>
            </Card>
          ))
        )}
      </div>

      <Card title="Historia wydarzeń życiowych">
        {history.length === 0 ? <Empty>Jeszcze nic się nie wydarzyło.</Empty> : (
          <ul className="divide-y divide-ink-700/70" data-testid="life-history">
            {history.map((e) => {
              const chosen = e.options.find((o) => o.id === e.chosenOptionId);
              return (
                <li key={e.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-slate-100">{e.title}</div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">{formatDatePL(e.date)}{e.status === 'expired' && <Badge tone="gold">termin minął</Badge>}</div>
                  </div>
                  {chosen && <div className="mt-0.5 text-xs text-slate-400">Wybór: {chosen.label}</div>}
                  {e.outcome && <div className="mt-1 text-sm text-slate-300">{e.outcome}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
