import { useGameStore } from '../store/gameStore.ts';
import { cx } from './components/ui.tsx';

export function NoticeBar() {
  const notice = useGameStore((s) => s.notice);
  const dismiss = useGameStore((s) => s.dismissNotice);
  if (!notice) return null;
  const tones = {
    info: 'border-sky/40 bg-sky/10 text-sky',
    success: 'border-gain/40 bg-gain/10 text-gain',
    error: 'border-loss/40 bg-loss/10 text-loss',
  };
  return (
    <div role={notice.kind === 'error' ? 'alert' : 'status'} data-testid="notice" className={cx('mb-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm', tones[notice.kind])}>
      <span>{notice.text}</span>
      <button type="button" onClick={dismiss} aria-label="Zamknij komunikat" className="text-current opacity-70 hover:opacity-100">✕</button>
    </div>
  );
}
