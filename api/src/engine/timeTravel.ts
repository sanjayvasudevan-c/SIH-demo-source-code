import type { AuthUser } from '../auth/middleware.js';
import * as clock from '../lib/clock.js';
import { isoDate } from '../lib/dates.js';
import { appendAuditStandalone } from '../lib/audit.js';
import { runCycleWithLock, type CycleResult } from './cycle.js';

export interface AdvanceResult {
  today: string;
  offsetDays: number;
  cycle: CycleResult;
}

/** Move the simulated clock forward and run one engine cycle synchronously (cycle lock, waits up to 10 s). */
export async function advanceTime(actor: AuthUser, days: number): Promise<AdvanceResult> {
  const offsetDays = await clock.advance(days);
  await appendAuditStandalone({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'TIME_ADVANCED',
    meta: { days, offsetDays, today: isoDate(clock.today()) },
  });
  const cycle = await runCycleWithLock({ source: 'time-travel' });
  return { today: isoDate(clock.today()), offsetDays, cycle };
}
