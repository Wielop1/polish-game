/**
 * Kalendarz gry: daty jako napisy ISO `YYYY-MM-DD`, bez stref czasowych i bez `Date`.
 * Arytmetyka na numerach dni (algorytmy civil-from-days / days-from-civil, H. Hinnant).
 */
export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MONTH_NAMES_GENITIVE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
] as const;
export const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
] as const;
export const WEEKDAY_SHORT = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'niedz'] as const;

export interface Ymd {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidIsoDate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return year >= 1900 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function parseIso(value: IsoDate): Ymd {
  const m = ISO_RE.exec(value);
  if (!m || !isValidIsoDate(value)) throw new RangeError(`Nieprawidłowa data: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function toIso({ year, month, day }: Ymd): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Liczba dni od 1970-01-01 (może być ujemna). */
export function toDayNumber(date: IsoDate): number {
  const { year, month, day } = parseIso(date);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(n: number): IsoDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return toIso({ year: month <= 2 ? y + 1 : y, month, day });
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function diffDays(later: IsoDate, earlier: IsoDate): number {
  return toDayNumber(later) - toDayNumber(earlier);
}

/** Dodaje miesiące, ucinając dzień do długości miesiąca docelowego (31 sty + 1 mies. = 28/29 lut). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseIso(date);
  const index = year * 12 + (month - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return toIso({ year: ny, month: nm, day: Math.min(day, daysInMonth(ny, nm)) });
}

export function firstOfNextMonth(date: IsoDate): IsoDate {
  const { year, month } = parseIso(date);
  return toIso({ year: month === 12 ? year + 1 : year, month: month === 12 ? 1 : month + 1, day: 1 });
}

/** Dzień miesiąca (1-31) lub 'last' -> konkretna data w danym miesiącu, ucięta do jego długości. */
export function dateInMonth(year: number, month: number, day: number | 'last'): IsoDate {
  const dim = daysInMonth(year, month);
  return toIso({ year, month, day: day === 'last' ? dim : Math.min(day, dim) });
}

export function monthKey(date: IsoDate): string {
  return date.slice(0, 7);
}

export function monthKeyToYm(key: string): { year: number; month: number } {
  const [y, m] = key.split('-');
  return { year: Number(y), month: Number(m) };
}

export function addMonthsToKey(key: string, months: number): string {
  const { year, month } = monthKeyToYm(key);
  const index = year * 12 + (month - 1) + months;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** 0 = poniedziałek ... 6 = niedziela. */
export function weekdayIndex(date: IsoDate): number {
  // 1970-01-01 był czwartkiem (index 3 przy poniedziałku = 0)
  return (((toDayNumber(date) + 3) % 7) + 7) % 7;
}

/** Pełne lata ukończone w dniu `on`. */
export function ageOn(birthDate: IsoDate, on: IsoDate): number {
  const b = parseIso(birthDate);
  const o = parseIso(on);
  let age = o.year - b.year;
  if (o.month < b.month || (o.month === b.month && o.day < b.day)) age -= 1;
  return age;
}

/** „1 stycznia 2026” */
export function formatDatePL(date: IsoDate): string {
  const { year, month, day } = parseIso(date);
  return `${day} ${MONTH_NAMES_GENITIVE[month - 1]} ${year}`;
}

export function formatMonthPL(key: string): string {
  const { year, month } = monthKeyToYm(key);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function formatDateShortPL(date: IsoDate): string {
  const { month, day } = parseIso(date);
  return `${day} ${MONTH_NAMES_GENITIVE[month - 1]}`;
}
