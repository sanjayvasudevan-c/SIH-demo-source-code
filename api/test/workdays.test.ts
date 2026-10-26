import { describe, expect, it, beforeEach } from 'vitest';
import { addWorkingDays, isWorkingDay, setHolidays, workingDaysBetween } from '../src/lib/workdays.js';
import { parseDateOnly, isoDate } from '../src/lib/dates.js';

const d = parseDateOnly;

describe('workdays', () => {
  beforeEach(() => setHolidays([]));

  it('treats Saturday and Sunday as non-working', () => {
    expect(isWorkingDay(d('2026-11-06'))).toBe(true); // Friday
    expect(isWorkingDay(d('2026-11-07'))).toBe(false);
    expect(isWorkingDay(d('2026-11-08'))).toBe(false);
  });

  it('adds working days across a weekend', () => {
    expect(isoDate(addWorkingDays(d('2026-11-06'), 1))).toBe('2026-11-09');
    expect(isoDate(addWorkingDays(d('2026-11-02'), 15))).toBe('2026-11-23');
    expect(isoDate(addWorkingDays(d('2026-11-09'), -1))).toBe('2026-11-06');
    expect(isoDate(addWorkingDays(d('2026-11-07'), 0))).toBe('2026-11-07');
  });

  it('skips holidays', () => {
    setHolidays(['2026-11-24']);
    expect(isWorkingDay(d('2026-11-24'))).toBe(false);
    expect(isoDate(addWorkingDays(d('2026-11-23'), 1))).toBe('2026-11-25');
    expect(workingDaysBetween(d('2026-11-23'), d('2026-11-25'))).toBe(1);
  });

  it('counts signed working days', () => {
    expect(workingDaysBetween(d('2026-11-02'), d('2026-11-02'))).toBe(0);
    expect(workingDaysBetween(d('2026-11-06'), d('2026-11-09'))).toBe(1);
    expect(workingDaysBetween(d('2026-11-09'), d('2026-11-06'))).toBe(-1);
    expect(workingDaysBetween(d('2026-11-02'), d('2026-11-16'))).toBe(10);
    expect(workingDaysBetween(d('2026-11-16'), d('2026-11-02'))).toBe(-10);
  });

  it('round-trips addWorkingDays and workingDaysBetween', () => {
    setHolidays(['2026-12-25', '2027-01-26']);
    const start = d('2026-12-14');
    for (let n = 0; n < 40; n++) {
      expect(workingDaysBetween(start, addWorkingDays(start, n))).toBe(n);
    }
  });
});
