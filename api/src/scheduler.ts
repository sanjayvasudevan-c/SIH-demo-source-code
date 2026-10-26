// Separate process. Two replicas run; the one holding the advisory lock is the leader and runs the engine.
import os from 'node:os';
import pg from 'pg';
import type { Prisma } from '@prisma/client';
import { prisma } from './lib/db.js';
import * as clock from './lib/clock.js';
import { loadHolidays } from './lib/workdays.js';
import { startRulesListener } from './rules/service.js';
import { SCHEDULER_LOCK_ID } from './lib/locks.js';
import { runCycleWithLock, type CycleResult } from './engine/cycle.js';

const instanceId = `${os.hostname()}-${process.pid}`;
const LOCK_RETRY_MS = Number(process.env.LOCK_RETRY_MS ?? 10_000);
const CYCLE_MS = Number(process.env.CYCLE_MS ?? 60_000);

let isLeader = false;
let lastResult: CycleResult | { error: string } = {};

async function heartbeat(): Promise<void> {
  const data = {
    isLeader,
    lastRunAt: clock.now(),
    lastResult: lastResult as Prisma.InputJsonValue,
  };
  await prisma.schedulerHeartbeat.upsert({
    where: { instanceId },
    create: { instanceId, ...data },
    update: data,
  });
}

async function cycle(): Promise<void> {
  await clock.refresh();
  await loadHolidays(prisma);
  try {
    lastResult = await runCycleWithLock({ instanceId }, 50_000);
  } catch (e) {
    lastResult = { error: (e as Error).message };
    console.error('[scheduler] cycle failed', e);
  }
}

async function main(): Promise<void> {
  const lockConn = new pg.Client({ connectionString: process.env.DATABASE_URL });
  lockConn.on('error', (e) => {
    console.error('[scheduler] lock connection lost; exiting', e.message);
    process.exit(1);
  });
  lockConn.on('end', () => {
    console.error('[scheduler] lock connection ended; exiting');
    process.exit(1);
  });
  await lockConn.connect();
  await startRulesListener();
  console.log(`[scheduler] ${instanceId} started`);

  // Standby: retry the lock every 10 s, heartbeat as non-leader.
  while (!isLeader) {
    const r = await lockConn.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [SCHEDULER_LOCK_ID]);
    if (r.rows[0]?.ok) {
      isLeader = true;
      console.log(`[scheduler] ${instanceId} is leader`);
      // A leader that was killed cannot clear its own flag; the new leader does.
      await prisma.schedulerHeartbeat.updateMany({ where: { instanceId: { not: instanceId } }, data: { isLeader: false } }).catch(() => undefined);
      break;
    }
    await clock.refresh().catch(() => undefined);
    await heartbeat().catch((e) => console.error('[scheduler] heartbeat failed', e.message));
    await new Promise((res) => setTimeout(res, LOCK_RETRY_MS));
  }

  // Leader: run a cycle every minute; check the lock connection is alive each time.
  for (;;) {
    await lockConn.query('SELECT 1');
    await cycle();
    await heartbeat().catch((e) => console.error('[scheduler] heartbeat failed', e.message));
    await new Promise((res) => setTimeout(res, CYCLE_MS));
  }
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`[scheduler] ${instanceId} stopping (${sig})`);
    prisma.schedulerHeartbeat
      .update({ where: { instanceId }, data: { isLeader: false } })
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
}

main().catch((e) => {
  console.error('[scheduler] fatal', e);
  process.exit(1);
});
