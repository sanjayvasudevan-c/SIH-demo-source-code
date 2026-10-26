// The only source of "now" and "today" for business logic (server and scheduler).
import { prisma } from './db.js';
import { DAY_MS, toDateOnly } from './dates.js';

let offsetDays = 0;
let override: Date | null = null;
let loadedAt = 0;

const REFRESH_MS = 5_000;

/** Real time plus the simulated offset (or the seed override). */
export function now(): Date {
  if (override) return new Date(override.getTime());
  return new Date(Date.now() + offsetDays * DAY_MS);
}

/** Today as a date-only value (00:00 UTC). */
export function today(): Date {
  return toDateOnly(now());
}

export function getOffsetDays(): number {
  return offsetDays;
}

/** Seed and tests only: pin the clock to a fixed instant (null to release). */
export function setOverride(date: Date | null): void {
  override = date ? new Date(date.getTime()) : null;
}

export function hasOverride(): boolean {
  return override !== null;
}

/** Re-read SimClock.offsetDays from the database. */
export async function refresh(): Promise<number> {
  const row = await prisma.simClock.findUnique({ where: { id: 1 } });
  offsetDays = row?.offsetDays ?? 0;
  loadedAt = Date.now();
  return offsetDays;
}

/** Refresh if the cached offset is older than a few seconds (API middleware). */
export async function refreshIfStale(): Promise<void> {
  if (Date.now() - loadedAt > REFRESH_MS) await refresh();
}

/** Move the simulated clock forward. The caller runs the engine cycle afterwards (engine/timeTravel.ts). */
export async function advance(days: number): Promise<number> {
  const row = await prisma.simClock.upsert({
    where: { id: 1 },
    create: { id: 1, offsetDays: days },
    update: { offsetDays: { increment: days } },
  });
  offsetDays = row.offsetDays;
  loadedAt = Date.now();
  return offsetDays;
}
