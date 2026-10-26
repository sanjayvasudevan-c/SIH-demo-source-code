import type { Role } from '@prisma/client';
import { clearRulesCache } from '../src/rules/service.js';
import { prisma, reconnect } from '../src/lib/db.js';
import * as clock from '../src/lib/clock.js';
import { loadHolidays } from '../src/lib/workdays.js';
import { recreateFromTemplate } from '../src/lib/demoReset.js';
import { parseDateOnly, addDays } from '../src/lib/dates.js';
import { signToken } from '../src/auth/token.js';
import type { AuthUser } from '../src/auth/middleware.js';

export const TEST_TODAY = process.env.TEST_TODAY ?? '2026-11-02';

/** Pin the clock to 10:00 UTC on the given date (default: the test "today", a Monday). */
export function setToday(date: string | Date = TEST_TODAY): Date {
  const d = typeof date === 'string' ? parseDateOnly(date) : date;
  clock.setOverride(new Date(d.getTime() + 10 * 3_600_000));
  return d;
}

export function shiftDays(n: number): Date {
  const next = addDays(clock.today(), n);
  setToday(next);
  return next;
}

/** Recreate the test database from its template and pin the clock. */
export async function resetDb(): Promise<void> {
  await prisma.$disconnect().catch(() => undefined);
  await recreateFromTemplate();
  await reconnect();
  clearRulesCache();
  await loadHolidays(prisma);
  setToday();
}

export async function userByEmail(email: string): Promise<AuthUser> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, name: true, email: true, role: true, regionId: true, institutionId: true, reportsToId: true, title: true },
  });
  return u;
}

export async function firstUser(role: Role, where: Record<string, unknown> = {}): Promise<AuthUser> {
  const u = await prisma.user.findFirstOrThrow({
    where: { role, ...where },
    orderBy: { email: 'asc' },
    select: { id: true, name: true, email: true, role: true, regionId: true, institutionId: true, reportsToId: true, title: true },
  });
  return u;
}

export function tokenFor(user: { id: string; role: string }): string {
  return signToken({ sub: user.id, role: user.role });
}

export function bearer(user: { id: string; role: string }): [string, string] {
  return ['Authorization', `Bearer ${tokenFor(user)}`];
}
