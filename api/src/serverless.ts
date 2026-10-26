// Vercel function entry (hosted demo). hosted.js must load first: it sets the environment the database client reads.
// There is no long-running scheduler process here, so the deadline engine runs in two other ways:
// - on traffic: at most once a minute per instance, after the response, under the same advisory lock the
//   scheduler leader uses (engine runs are idempotent, so an extra run changes nothing);
// - as a daily Vercel cron (GET /api/cron/tick) for days nobody visits. Time travel already runs it immediately.
import './lib/hosted.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { waitUntil } from '@vercel/functions';
import type { Prisma } from '@prisma/client';
import { createApp } from './app.js';
import { prisma } from './lib/db.js';
import * as clock from './lib/clock.js';
import { loadHolidays } from './lib/workdays.js';
import { runCycleWithLock } from './engine/cycle.js';

const TICK_MS = 60_000;
let lastTick = -Infinity;
let ready: Promise<void> | null = null;
const app = createApp();

function init(): Promise<void> {
  ready ??= (async () => {
    await clock.refresh();
    await loadHolidays(prisma);
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

// The admin page lists scheduler instances from their heartbeats; this one stands in for the scheduler leader.
const INSTANCE = 'vercel-on-visit';

async function tick(source: string): Promise<void> {
  lastTick = performance.now();
  try {
    const result = await runCycleWithLock({ source }, 0);
    const data = { isLeader: true, lastRunAt: clock.now(), lastResult: result as unknown as Prisma.InputJsonValue };
    await prisma.schedulerHeartbeat.upsert({ where: { instanceId: INSTANCE }, create: { instanceId: INSTANCE, ...data }, update: data });
  } catch (e) {
    const msg = (e as Error).message;
    // Another instance holding the lock is the normal case when several requests arrive together.
    if (!/Another engine cycle is running/.test(msg)) console.error('[engine] tick failed:', msg);
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await init();
  } catch (e) {
    console.error('[api] init failed', e);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'The demo database is waking up. Try again in a few seconds.' }));
    return;
  }
  const url = req.url ?? '';
  if (url.startsWith('/api/cron/tick')) {
    // Vercel sends its cron requests with this bearer token when CRON_SECRET is set.
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) {
      res.statusCode = 401;
      res.end();
      return;
    }
    await tick('cron');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (performance.now() - lastTick > TICK_MS) waitUntil(tick('visit'));
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
