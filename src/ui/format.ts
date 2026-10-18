import { formatDatePL } from '../engine/date.ts';

export function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function weekdayNamePL(index: number): string {
  return ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'][index] ?? '';
}

export { formatDatePL };

export const SLOT_LABELS: Record<string, string> = {
  autosave: 'Autozapis',
  'slot-1': 'Slot 1',
  'slot-2': 'Slot 2',
  'slot-3': 'Slot 3',
};

/** Parsuje kwotę w złotych wpisaną przez użytkownika („1 234,56”, „1234.5”) do groszy; null gdy nieprawidłowa. */
export function parseZloty(input: string): number | null {
  const cleaned = input.replace(/\s|\u00a0/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const grosze = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(grosze) ? grosze : null;
}
