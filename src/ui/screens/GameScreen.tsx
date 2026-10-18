import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { CITIES, ECONOMY_V01, GAME_START, PLACEHOLDER_NOTICE } from '../../engine/config.ts';
import { formatDatePL } from '../../engine/date.ts';
import { formatPLN } from '../../engine/money.ts';
import { randomSeed } from '../../engine/rng.ts';
import { SAVE_SLOTS } from '../../persistence/repository.ts';
import { isUsingMemoryFallback, useGameStore } from '../../store/gameStore.ts';
import type { FieldErrors } from '../../store/gameStore.ts';
import { Badge, Button, Card, Empty, Money, ScreenHeader, cx } from '../components/ui.tsx';
import { SLOT_LABELS, formatSavedAt } from '../format.ts';

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-200">{label}</label>
      {children}
      {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-loss">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

const inputClass = 'w-full rounded-xl border border-ink-600 bg-ink-900/80 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30';

function NewGameForm() {
  const hasGame = useGameStore((s) => s.game !== null);
  const startNewGame = useGameStore((s) => s.startNewGame);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [seed, setSeed] = useState(() => randomSeed());
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (hasGame && !window.confirm('Rozpocząć nową grę? Obecny postęp zostanie utracony (chyba że masz go w zapisie). Autozapis zostanie zastąpiony.')) return;
    setErrors(startNewGame({ firstName, lastName, seed }) ?? {});
  };

  return (
    <Card title="Nowa gra">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="firstName" label="Imię" error={errors.firstName}>
            <input id="firstName" name="firstName" autoComplete="off" className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="np. Jan" aria-invalid={!!errors.firstName} aria-describedby={errors.firstName ? 'firstName-error' : undefined} maxLength={40} />
          </Field>
          <Field id="lastName" label="Nazwisko" error={errors.lastName}>
            <input id="lastName" name="lastName" autoComplete="off" className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="np. Kowalski" aria-invalid={!!errors.lastName} aria-describedby={errors.lastName ? 'lastName-error' : undefined} maxLength={40} />
          </Field>
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-ink-700 bg-ink-900/50 p-4 text-sm sm:grid-cols-4">
          {[
            ['Wiek startowy', `${GAME_START.age} lata`],
            ['Miasto', CITIES[GAME_START.cityId]!.name],
            ['Start', formatDatePL(GAME_START.date)],
            ['Gotówka', formatPLN(GAME_START.cash, { round: true })],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd className="font-semibold text-slate-100">{v}</dd>
            </div>
          ))}
        </dl>

        <Field id="seed" label="Ziarno losowości (seed)" error={errors.seed} hint="Ten sam seed daje tę samą grę. Zostaw domyślny albo wpisz własny.">
          <div className="flex gap-2">
            <input id="seed" name="seed" className={cx(inputClass, 'font-mono text-sm')} value={seed} onChange={(e) => setSeed(e.target.value)} maxLength={100} autoComplete="off" />
            <Button type="button" variant="secondary" onClick={() => setSeed(randomSeed())}>Losuj</Button>
          </div>
        </Field>

        <div className="rounded-xl border border-gold/30 bg-gold/5 p-3 text-xs leading-relaxed text-gold/90">
          Start: etat ({formatPLN(ECONOMY_V01.netSalary, { round: true })} netto/mies.) i wynajem mieszkania ({formatPLN(ECONOMY_V01.monthlyRent, { round: true })}/mies.). {PLACEHOLDER_NOTICE}
        </div>

        <Button type="submit" variant="primary" className="w-full py-3 text-base" data-testid="start-game">Rozpocznij grę</Button>
      </form>
    </Card>
  );
}

function SaveSlots() {
  const saves = useGameStore((s) => s.saves);
  const loading = useGameStore((s) => s.loadingSaves);
  const game = useGameStore((s) => s.game);
  const saveToSlot = useGameStore((s) => s.saveToSlot);
  const loadFromSlot = useGameStore((s) => s.loadFromSlot);
  const deleteSlot = useGameStore((s) => s.deleteSlot);

  const onSave = (slot: string, occupied: boolean) => {
    if (occupied && !window.confirm('Nadpisać istniejący zapis?')) return;
    void saveToSlot(slot);
  };
  const onLoad = (slot: string) => {
    if (game && !window.confirm('Wczytać zapis? Niezapisany postęp bieżącej gry zostanie utracony.')) return;
    void loadFromSlot(slot);
  };

  return (
    <Card title="Zapisy gry" action={isUsingMemoryFallback() ? <Badge tone="loss">IndexedDB niedostępne — zapisy tylko w pamięci</Badge> : undefined}>
      <ul className="space-y-3">
        {SAVE_SLOTS.map((slot) => {
          const item = saves.find((s) => s.slot === slot);
          const isAuto = slot === 'autosave';
          return (
            <li key={slot} data-testid={`slot-${slot}`} className="rounded-xl border border-ink-700 bg-ink-900/50 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    {SLOT_LABELS[slot]}
                    {isAuto && <Badge tone="sky">automatyczny</Badge>}
                  </div>
                  {item ? (
                    <div className="mt-0.5 text-xs text-slate-400">
                      {item.meta.playerName} · {formatDatePL(item.meta.gameDate)} · majątek <Money value={item.meta.netWorth} round /> · zapisano {formatSavedAt(item.savedAt)}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-xs text-slate-500">{loading ? 'Wczytywanie…' : 'Pusty'}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  {!isAuto && (
                    <Button variant="secondary" disabled={!game} onClick={() => onSave(slot, !!item)} data-testid={`save-${slot}`}>Zapisz</Button>
                  )}
                  <Button variant="secondary" disabled={!item} onClick={() => onLoad(slot)} data-testid={`load-${slot}`}>Wczytaj</Button>
                  <Button variant="danger" disabled={!item} onClick={() => void deleteSlot(slot)} aria-label={`Usuń ${SLOT_LABELS[slot]}`}>Usuń</Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {!game && saves.length === 0 && !loading && <div className="mt-3"><Empty>Brak zapisów — zacznij nową grę.</Empty></div>}
      <p className="mt-3 text-xs text-slate-500">Zapisy są przechowywane lokalnie w przeglądarce (IndexedDB). Autozapis aktualizuje się po każdym przesunięciu czasu.</p>
    </Card>
  );
}

export function GameScreen() {
  return (
    <div>
      <ScreenHeader title="Nowa gra / Wczytaj" subtitle="Zacznij od zera jako 22-latek w Olsztynie albo wróć do zapisanej rozgrywki." />
      <div className="grid gap-5 lg:grid-cols-2">
        <NewGameForm />
        <SaveSlots />
      </div>
    </div>
  );
}
