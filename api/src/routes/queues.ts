import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { today } from '../lib/clock.js';
import { addDays, parseDateOnly, toDateOnly } from '../lib/dates.js';
import { nextWorkingDayFrom, workingDaysBetween } from '../lib/workdays.js';
import { currentUser } from '../auth/middleware.js';
import { requireRole } from '../policy/roles.js';
import { inScope } from '../policy/scope.js';
import { proposeCommittee } from '../assignment/committee.js';
import { listRows } from '../workflow/present.js';

const include = { institution: { select: { name: true, permanentId: true } }, region: { select: { code: true } } } as const;

async function flagsFor(ids: string[]) {
  const flags = await prisma.exceptionFlag.findMany({ where: { applicationId: { in: ids }, resolvedAt: null }, select: { applicationId: true, reasonCode: true, escalationLevel: true } });
  return (id: string) => flags.filter((f) => f.applicationId === id).map((f) => ({ reasonCode: f.reasonCode, escalationLevel: f.escalationLevel }));
}

export function queuesRouter(): Router {
  const r = Router();

  r.get(
    '/evc/queue',
    requireRole('OFFICER', 'BUREAU'),
    h(async (req, res) => {
      const user = currentUser(req);
      const apps = await prisma.application.findMany({
        where: { stage: 'EVC', status: 'IN_STAGE', evcScheduled: false, assignments: { some: { officerId: user.id, releasedAt: null, taskType: 'EVC_DESK' } } },
        include,
      });
      const t = today();
      apps.sort((a, b) => a.categoryRank - b.categoryRank || a.stageEnteredAt.getTime() - b.stageEnteredAt.getTime());
      const rows = await listRows(user, apps);
      const flags = await flagsFor(apps.map((a) => a.id));
      res.json({
        rows: rows.map((row) => {
          const a = apps.find((x) => x.id === row.id)!;
          return { ...row, daysWaiting: Math.max(0, workingDaysBetween(toDateOnly(a.stageEnteredAt), t)), flags: flags(row.id) };
        }),
      });
    }),
  );

  r.get(
    '/evc/:applicationId/proposal',
    requireRole('OFFICER', 'BUREAU', 'HOD'),
    h(async (req, res) => {
      const user = currentUser(req);
      const id = parse(z.string().uuid(), req.params.applicationId);
      const { date } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
      if (!(await inScope(user, id))) throw notFound();
      const visitDate = date ? parseDateOnly(date) : nextWorkingDayFrom(addDays(today(), 1));
      const members = await prisma.user.findMany({ where: { role: 'COMMITTEE', active: true }, select: { id: true, name: true, title: true }, orderBy: { name: 'asc' } });
      res.json({ visitDate: visitDate.toISOString().slice(0, 10), ...(await proposeCommittee(id, visitDate)), members });
    }),
  );

  r.get(
    '/committee/queue',
    requireRole('COMMITTEE'),
    h(async (req, res) => {
      const user = currentUser(req);
      const visits = await prisma.application.findMany({
        where: { stage: 'EVC', status: 'IN_STAGE', evcScheduled: true, evcVisit: { memberIds: { array_contains: [user.id] } } },
        include: { ...include, evcVisit: true },
      });
      const sac = await prisma.application.findMany({ where: { stage: 'SAC_SHC', status: 'IN_STAGE', sacForwarded: true }, include });
      const visitRows = await listRows(user, visits);
      res.json({
        visits: visitRows.map((row) => {
          const v = visits.find((x) => x.id === row.id)!.evcVisit!;
          return { ...row, visitDate: v.visitDate?.toISOString().slice(0, 10) ?? null, mode: v.mode, reportDue: !!v.visitDate && toDateOnly(v.visitDate) <= today() };
        }),
        sacShc: await listRows(user, sac),
      });
    }),
  );

  r.get(
    '/authority/queue',
    requireRole('AUTHORITY'),
    h(async (req, res) => {
      const user = currentUser(req);
      const apps = await prisma.application.findMany({ where: { regionId: user.regionId ?? '-', stage: 'DECISION', status: 'IN_STAGE' }, include, orderBy: { stageEnteredAt: 'asc' } });
      res.json({ rows: await listRows(user, apps) });
    }),
  );

  r.get(
    '/bureau/queue',
    requireRole('BUREAU'),
    h(async (req, res) => {
      const user = currentUser(req);
      const mine = await prisma.assignment.findMany({ where: { officerId: user.id, releasedAt: null }, select: { applicationId: true, taskType: true } });
      const overflowIds = mine.filter((m) => m.taskType !== 'SAC_SHC_FORWARD').map((m) => m.applicationId);
      const sacIds = mine.filter((m) => m.taskType === 'SAC_SHC_FORWARD').map((m) => m.applicationId);
      const [overflow, sac] = await Promise.all([
        prisma.application.findMany({ where: { id: { in: overflowIds } }, include }),
        prisma.application.findMany({ where: { id: { in: sacIds } }, include }),
      ]);
      res.json({ overflow: await listRows(user, overflow), sacShc: await listRows(user, sac) });
    }),
  );

  return r;
}
