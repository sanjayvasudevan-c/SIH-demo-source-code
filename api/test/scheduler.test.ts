import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import * as clock from '../src/lib/clock.js';
import { addDays, toDateOnly } from '../src/lib/dates.js';
import { resetDb, userByEmail } from './helpers.js';
import { submitApp } from './fixtures.js';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const procs: ChildProcess[] = [];
let app: Express;

function startScheduler(): ChildProcess {
  const p = spawn(process.execPath, ['--import', 'tsx', 'src/scheduler.ts'], {
    cwd: apiDir,
    env: { ...process.env, CYCLE_MS: '1000', LOCK_RETRY_MS: '500', NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  procs.push(p);
  return p;
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const until = performance.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (performance.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Fixture: an extra open item that is already overdue at real time, so a cycle has something to send. */
async function overdueItem(applicationId: string, responsibleUserId: string) {
  const realToday = toDateOnly(new Date());
  return prisma.deadlineItem.create({
    data: { applicationId, type: 'VERIFICATION', sourceId: `fixture-${Math.random()}`, responsibleUserId, dueDate: addDays(realToday, -2), unit: 'CALENDAR', status: 'OPEN', createdAt: clock.now() },
  });
}

describe('scheduler leader election [31]', () => {
  beforeAll(async () => {
    await resetDb();
    app = createApp();
  });
  afterAll(() => {
    for (const p of procs) p.kill('SIGKILL');
  });

  it('runs cycles on the leader only and hands over within a cycle when the leader stops', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    clock.setOverride(null);
    await overdueItem(id, priya.id);

    const a = startScheduler();
    const b = startScheduler();
    const beats = await waitFor(async () => {
      const rows = await prisma.schedulerHeartbeat.findMany();
      return rows.length === 2 && rows.filter((r) => r.isLeader).length === 1 ? rows : null;
    });
    const leader = beats.find((r) => r.isLeader)!;
    const sent = await waitFor(() => prisma.auditLog.findMany({ where: { action: 'ALERTS_SENT' } }).then((r) => (r.length ? r : null)));
    expect(sent.every((r) => (r.meta as { instanceId: string }).instanceId === leader.instanceId)).toBe(true);
    // Repeated leader cycles send nothing new.
    await new Promise((r) => setTimeout(r, 2500));
    expect(await prisma.alertLog.count({ where: { kind: 'OVERDUE' } })).toBe(1);

    // Stop the leader: the standby takes over and runs the next cycle.
    const leaderProc = [a, b].find((p) => leader.instanceId.endsWith(`-${p.pid}`))!;
    const standbyProc = leaderProc === a ? b : a;
    leaderProc.kill('SIGKILL');
    const newLeader = await waitFor(async () => {
      const row = await prisma.schedulerHeartbeat.findFirst({ where: { isLeader: true, instanceId: { endsWith: `-${standbyProc.pid}` } } });
      return row;
    });
    await overdueItem(id, priya.id);
    const later = await waitFor(() =>
      prisma.auditLog.findMany({ where: { action: 'ALERTS_SENT' }, orderBy: { id: 'asc' } }).then((r) => (r.length >= 2 ? r : null)),
    );
    expect((later.at(-1)!.meta as { instanceId: string }).instanceId).toBe(newLeader.instanceId);
  }, 60_000);
});
