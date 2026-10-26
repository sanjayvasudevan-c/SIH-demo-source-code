import { Router } from 'express';
import { z } from 'zod';
import { h, parse } from '../lib/http.js';
import * as clock from '../lib/clock.js';
import { isoDate } from '../lib/dates.js';
import { currentUser } from '../auth/middleware.js';
import { requireRole } from '../policy/roles.js';
import { demoMode } from '../auth/demoUsers.js';
import { forbidden } from '../lib/errors.js';
import { resetDemoInProcess } from '../lib/demoReset.js';
import { appendAudit, appendAuditStandalone } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { ignoreScheduleSetting } from '../rules/filing.js';
import { advanceTime } from '../engine/timeTravel.js';

export function demoRouter(): Router {
  const r = Router();

  r.get(
    '/clock',
    h(async (_req, res) => {
      await clock.refresh();
      res.json({
        now: clock.now().toISOString(),
        today: isoDate(clock.today()),
        offsetDays: clock.getOffsetDays(),
        simulated: clock.getOffsetDays() !== 0,
      });
    }),
  );

  r.post(
    '/advance-time',
    requireRole('ADMIN'),
    h(async (req, res) => {
      if (!demoMode()) throw forbidden('Time travel is only available in demo mode.');
      const { days } = parse(z.object({ days: z.number().int().min(1).max(400) }), req.body);
      const result = await advanceTime(currentUser(req), days);
      res.json(result);
    }),
  );

  // Demo admin: let colleges file outside the application windows. Audited; refused outside demo mode.
  r.get(
    '/ignore-schedule',
    requireRole('ADMIN'),
    h(async (_req, res) => {
      res.json({ on: demoMode() && (await ignoreScheduleSetting()) });
    }),
  );
  r.post(
    '/ignore-schedule',
    requireRole('ADMIN'),
    h(async (req, res) => {
      if (!demoMode()) throw forbidden('Ignoring the schedule is only available in demo mode.');
      const { on } = parse(z.object({ on: z.boolean() }), req.body);
      const user = currentUser(req);
      await prisma.$transaction(async (tx) => {
        await tx.simClock.upsert({ where: { id: 1 }, create: { id: 1, ignoreSchedule: on }, update: { ignoreSchedule: on } });
        await appendAudit(tx, { actorId: user.id, actorRole: user.role, action: 'DEMO_IGNORE_SCHEDULE', meta: { on } });
      });
      res.json({ on });
    }),
  );

  r.post(
    '/reset',
    requireRole('ADMIN'),
    h(async (req, res) => {
      if (!demoMode()) throw forbidden('Reset is only available in demo mode.');
      const user = currentUser(req);
      const ms = await resetDemoInProcess();
      await appendAuditStandalone({ actorId: user.id, actorRole: user.role, action: 'DEMO_RESET', meta: { ms } });
      res.json({ ok: true, ms, today: isoDate(clock.today()) });
    }),
  );

  return r;
}
