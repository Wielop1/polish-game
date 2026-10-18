import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, ageOn, dateInMonth, daysInMonth, diffDays, firstOfNextMonth, formatDatePL,
  fromDayNumber, isValidIsoDate, toDayNumber, weekdayIndex,
} from './date.ts';

describe('kalendarz', () => {
  it('rozpoznaje lata przestępne i długości miesięcy', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
  it('waliduje daty', () => {
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-1-1')).toBe(false);
  });
  it('numer dnia jest odwracalny w całym zakresie 1900-2200', () => {
    for (let n = toDayNumber('1900-01-01'); n <= toDayNumber('2200-12-31'); n += 1) {
      expect(toDayNumber(fromDayNumber(n))).toBe(n);
    }
  });
  it('addDays przechodzi przez granice miesięcy i lat', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2027-01-01', '2026-01-01')).toBe(365);
  });
  it('addMonths ucina dzień do długości miesiąca', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-01-01', -12)).toBe('2025-01-01');
  });
  it('firstOfNextMonth i dateInMonth', () => {
    expect(firstOfNextMonth('2026-01-01')).toBe('2026-02-01');
    expect(firstOfNextMonth('2026-12-15')).toBe('2027-01-01');
    expect(dateInMonth(2026, 2, 31)).toBe('2026-02-28');
    expect(dateInMonth(2026, 2, 'last')).toBe('2026-02-28');
    expect(dateInMonth(2028, 2, 'last')).toBe('2028-02-29');
  });
  it('dzień tygodnia i wiek', () => {
    expect(weekdayIndex('2026-01-01')).toBe(3); // czwartek
    expect(weekdayIndex('2026-01-05')).toBe(0); // poniedziałek
    expect(ageOn('2003-06-15', '2026-06-14')).toBe(22);
    expect(ageOn('2003-06-15', '2026-06-15')).toBe(23);
  });
  it('formatuje datę po polsku', () => {
    expect(formatDatePL('2026-01-01')).toBe('1 stycznia 2026');
  });
});
