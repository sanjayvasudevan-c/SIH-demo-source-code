// Date-only helpers. A "date" is a Date at 00:00 UTC; never compare business dates any other way.
export const DAY_MS = 86_400_000;

export function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isoDate(d: Date): string {
  return toDateOnly(d).toISOString().slice(0, 10);
}

export function parseDateOnly(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid date ${s}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function addDays(d: Date, n: number): Date {
  return new Date(toDateOnly(d).getTime() + n * DAY_MS);
}

/** Calendar days from a to b (positive when b is later). */
export function calendarDaysBetween(a: Date, b: Date): number {
  return Math.round((toDateOnly(b).getTime() - toDateOnly(a).getTime()) / DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Oct 2026" */
export function formatDate(d: Date): string {
  const x = toDateOnly(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}
