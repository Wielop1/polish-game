import { useState } from 'react';
import type { Screen } from '../store/gameStore.ts';
import { SCREEN_HELP } from './screenHelp.ts';
import { cx } from './components/ui.tsx';

const key = (screen: Screen) => `pt-help:${screen}`;
/** Domyślnie pomoc jest rozwinięta (na telefonie — zwinięta, żeby nie zajmowała całego ekranu); wybór gracza jest zapamiętywany. */
const read = (screen: Screen): boolean => {
  try {
    const v = localStorage.getItem(key(screen));
    if (v === 'hidden') return true;
    if (v === 'shown') return false;
  } catch { /* brak zapisu lokalnego — zachowanie domyślne */ }
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;
};
const write = (screen: Screen, hidden: boolean): void => { try { localStorage.setItem(key(screen), hidden ? 'hidden' : 'shown'); } catch { /* zapis lokalny niedostępny — pomoc po prostu pokaże się ponownie */ } };

/** Pasek pomocy nad ekranem: pierwszy raz rozwinięty („po co ten ekran i co dalej”), po zamknięciu — mały przycisk „Pomoc”. */
export function ScreenHelp({ screen }: { screen: Screen }) {
  const help = SCREEN_HELP[screen];
  const [hidden, setHidden] = useState(() => read(screen));
  if (!help) return null;
  if (hidden) {
    return (
      <div className="mb-3 flex justify-end">
        <button type="button" onClick={() => { write(screen, false); setHidden(false); }} className="rounded-lg px-2.5 py-1 text-xs text-slate-500 hover:bg-ink-800 hover:text-slate-300" data-testid="help-show">ⓘ Pomoc do tego ekranu</button>
      </div>
    );
  }
  return (
    <aside className={cx('mb-5 flex gap-3 rounded-2xl border border-sky/25 bg-sky/5 p-4 text-sm text-slate-300')} data-testid="screen-help" aria-label="Pomoc do ekranu">
      <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-sky/20 text-xs font-bold text-sky">i</span>
      <div className="min-w-0 flex-1 space-y-1">
        <p><strong className="text-slate-100">Do czego służy ten ekran:</strong> {help.what}</p>
        {help.todo && <p><strong className="text-slate-100">Co dalej:</strong> {help.todo}</p>}
      </div>
      <button type="button" onClick={() => { write(screen, true); setHidden(true); }} className="h-fit shrink-0 rounded-lg px-2.5 py-1 text-xs text-slate-400 hover:bg-ink-800 hover:text-slate-200" data-testid="help-hide">Rozumiem, ukryj</button>
    </aside>
  );
}
