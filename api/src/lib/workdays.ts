import type { Db } from './db.js';
import { addDays, isoDate, toDateOnly } from './dates.js';

let holidays = new Set<string>();
let holidayNames = new Map<string, string>();

export async function loadHolidays(db: Db): Promise<void> {
  const rows = await db.holiday.findMany();
  holidays = new Set(rows.map((r) => isoDate(r.date)));
  holidayNames = new Map(rows.map((r) => [isoDate(r.date), r.name]));
}

/** Tests: set the holiday list directly. */
export function setHolidays(dates: string[]): void {
  holidays = new Set(dates);
}

export function holidayName(d: Date): string | undefined {
  return holidayNames.get(isoDate(d));
}

export function isWorkingDay(d: Date): boolean {
  const day = toDateOnly(d).getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidays.has(isoDate(d));
}

/** Move n working days from d (n may be negative). n = 0 returns d unchanged. */
export function addWorkingDays(d: Date, n: number): Date {
  let cur = toDateOnly(d);
  const step = n >= 0 ? 1 : -1;
  let left = Math.abs(n);
  while (left > 0) {
    cur = addDays(cur, step);
    if (isWorkingDay(cur)) left--;
  }
  return cur;
}

/** Signed working days from a to b: working days in (a, b] when b > a, negative count of (b, a] when b < a. */
export function workingDaysBetween(a: Date, b: Date): number {
  const from = toDateOnly(a);
  const to = toDateOnly(b);
  if (from.getTime() === to.getTime()) return 0;
  const sign = to > from ? 1 : -1;
  let cur = from;
  let count = 0;
  while (cur.getTime() !== to.getTime()) {
    cur = addDays(cur, sign);
    if (isWorkingDay(cur)) count++;
  }
  return sign * count;
}

/** Next working day on or after d. */
export function nextWorkingDayFrom(d: Date): Date {
  let cur = toDateOnly(d);
  while (!isWorkingDay(cur)) cur = addDays(cur, 1);
  return cur;
}
