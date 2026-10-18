import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore.ts';
import { cx } from './components/ui.tsx';

/** Komunikat jako „toast” w prawym dolnym rogu — widoczny niezależnie od przewinięcia strony. */
export function NoticeBar() {
  const notice = useGameStore((s) => s.notice);
  const dismiss = useGameStore((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const id = window.setTimeout(dismiss, 7000);
    return () => window.clearTimeout(id);
  }, [notice, dismiss]);

  if (!notice) return null;
  const tones = {
    info: 'border-sky/50 bg-ink-850 text-sky',
    success: 'border-gain/50 bg-ink-850 text-gain',
    error: 'border-loss/60 bg-ink-850 text-loss',
  };
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6 md:justify-end md:px-6">
      <div
        role={notice.kind === 'error' ? 'alert' : 'status'}
        data-testid="notice"
        className={cx('animate-pop pointer-events-auto flex max-w-md items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl shadow-black/50', tones[notice.kind])}
      >
        <span>{notice.text}</span>
        <button type="button" onClick={dismiss} aria-label="Zamknij komunikat" className="text-current opacity-70 hover:opacity-100">✕</button>
      </div>
    </div>
  );
}
