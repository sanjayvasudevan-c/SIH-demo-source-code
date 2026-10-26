import type { Tx } from './db.js';

/** Transaction-scoped advisory lock keyed by a string. Released at commit or rollback. */
export async function advisoryXactLock(tx: Tx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

export const SCHEDULER_LOCK_ID = 727001;
