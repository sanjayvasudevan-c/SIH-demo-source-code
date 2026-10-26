import { Router } from 'express';
import { z } from 'zod';
import { prisma, TX_OPTIONS } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { today } from '../lib/clock.js';
import { isoDate, parseDateOnly, toDateOnly } from '../lib/dates.js';
import { appendAudit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { currentUser, type AuthUser } from '../auth/middleware.js';
import { getSubtreeUserIds } from '../policy/subtree.js';
import { releaseForAvailability, taskLabel } from '../assignment/engine.js';

const MANAGERS = ['SENIOR', 'SUPER_SENIOR', 'HOD'];
const ALLOWED = ['OFFICER', 'COMMITTEE', ...MANAGERS];

async function canManageUser(actor: AuthUser, userId: string): Promise<boolean> {
  if (actor.id === userId) return true;
  if (!MANAGERS.includes(actor.role)) return false;
  return (await getSubtreeUserIds(actor.id)).includes(userId);
}

const isoDateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export function availabilityRouter(): Router {
  const r = Router();
  r.use((req, _res, next) => (ALLOWED.includes(currentUser(req).role) ? next() : next(forbidden('Availability is for officers, committee members and their managers.'))));

  // Team members the caller can manage (managers) — used by the member picker.
  r.get(
    '/team',
    h(async (req, res) => {
      const user = currentUser(req);
      const ids = MANAGERS.includes(user.role) ? await getSubtreeUserIds(user.id) : [];
      const users = await prisma.user.findMany({
        where: { id: { in: [user.id, ...ids] }, role: { in: ['OFFICER', 'COMMITTEE', 'SENIOR', 'SUPER_SENIOR', 'HOD'] } },
        select: { id: true, name: true, role: true, title: true },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      });
      res.json({ users });
    }),
  );

  r.get(
    '/',
    h(async (req, res) => {
      const user = currentUser(req);
      const { userId } = parse(z.object({ userId: z.string().uuid().optional() }), req.query);
      const target = userId ?? user.id;
      if (!(await canManageUser(user, target))) throw forbidden('You can see availability only for yourself and your team.');
      const rows = await prisma.officerAvailability.findMany({ where: { userId: target }, orderBy: { startsOn: 'desc' } });
      const t = today();
      res.json({
        userId: target,
        periods: rows.map((p) => ({
          id: p.id,
          kind: p.kind,
          startsOn: isoDate(p.startsOn),
          endsOn: isoDate(p.endsOn),
          reason: p.reason,
          current: toDateOnly(p.startsOn) <= t && toDateOnly(p.endsOn) >= t,
          future: toDateOnly(p.startsOn) > t,
        })),
      });
    }),
  );

  r.post(
    '/',
    h(async (req, res) => {
      const user = currentUser(req);
      const body = parse(
        z.object({
          userId: z.string().uuid().optional(),
          kind: z.enum(['LEAVE', 'TRAINING', 'FIELD_VISIT', 'OFFLINE']),
          startsOn: isoDateStr,
          endsOn: isoDateStr,
          reason: z.string().trim().min(1, 'Enter a reason').max(500),
        }),
        req.body,
      );
      const target = body.userId ?? user.id;
      if (!(await canManageUser(user, target))) throw forbidden('You can set availability only for yourself and your team.');
      const startsOn = parseDateOnly(body.startsOn);
      const endsOn = parseDateOnly(body.endsOn);
      if (endsOn < startsOn) throw badRequest('The end date must be on or after the start date.');
      const t = today();
      if (endsOn < t) throw badRequest('The period has already ended.');
      const coversToday = startsOn <= t && endsOn >= t;
      const result = await prisma.$transaction(async (tx) => {
        const row = await tx.officerAvailability.create({ data: { userId: target, kind: body.kind, startsOn, endsOn, reason: body.reason, createdById: user.id } });
        await appendAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: 'AVAILABILITY_SET',
          reason: body.reason,
          meta: { userId: target, kind: body.kind, startsOn: body.startsOn, endsOn: body.endsOn, coversToday },
        });
        const moved = coversToday ? await releaseForAvailability(tx, target, { id: user.id, role: user.role }) : [];
        if (target !== user.id) {
          await notify(tx, [target], { kind: 'AVAILABILITY', message: `${user.name} recorded ${body.kind.toLowerCase().replace('_', ' ')} for you from ${body.startsOn} to ${body.endsOn}.` });
        }
        return { row, moved };
      }, TX_OPTIONS);
      const apps = await prisma.application.findMany({ where: { id: { in: result.moved.map((m) => m.applicationId) } }, select: { id: true, applicationNo: true } });
      const no = new Map(apps.map((a) => [a.id, a.applicationNo]));
      res.status(201).json({
        availability: { id: result.row.id, kind: result.row.kind, startsOn: body.startsOn, endsOn: body.endsOn, reason: body.reason },
        coversToday,
        reassigned: result.moved.map((m) => ({ ...m, applicationNo: no.get(m.applicationId) ?? null, taskLabel: taskLabel(m.taskType) })),
      });
    }),
  );

  r.delete(
    '/:id',
    h(async (req, res) => {
      const user = currentUser(req);
      const id = parse(z.string().uuid(), req.params.id);
      const row = await prisma.officerAvailability.findUnique({ where: { id } });
      if (!row) throw notFound();
      if (!(await canManageUser(user, row.userId))) throw forbidden('You can change availability only for yourself and your team.');
      if (toDateOnly(row.startsOn) <= today()) throw badRequest('Only future periods can be deleted.');
      await prisma.$transaction(async (tx) => {
        await tx.officerAvailability.delete({ where: { id } });
        await appendAudit(tx, { actorId: user.id, actorRole: user.role, action: 'AVAILABILITY_SET', reason: 'Deleted a future period', meta: { userId: row.userId, deleted: id } });
      });
      res.json({ ok: true });
    }),
  );

  return r;
}
