import { Router } from 'express';
import { z } from 'zod';
import type { ExceptionFlag, Prisma, ReasonCode } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { today } from '../lib/clock.js';
import { addWorkingDays, workingDaysBetween } from '../lib/workdays.js';
import { toDateOnly } from '../lib/dates.js';
import { typeLabels } from '../rules/service.js';
import { currentUser, type AuthUser } from '../auth/middleware.js';
import { scopeWhere } from '../policy/scope.js';
import { compareSortKeys, REASON_LABEL, type SortKeys } from '../engine/flags.js';
import { STAGE_LABEL } from '../workflow/routing.js';
import { taskLabel } from '../assignment/engine.js';

const OVERDUE_CODES: ReasonCode[] = ['STAGE_OVERDUE', 'EVC_NOT_SCHEDULED', 'EVC_OVERDUE', 'EVIDENCE_PENDING_VERIFICATION'];

const query = z.object({
  filter: z.enum(['mine', 'waitingOnCollege', 'escalatedToMe']).default('mine'),
  reason: z.string().max(40).optional(),
  stage: z.enum(['SCRUTINY', 'EVC', 'SAC_SHC', 'DECISION']).optional(),
  ageing: z.enum(['0-7', '8-15', '16+']).optional(),
});

/** Which open flags this user sees in a filter. Owner-aware: college-owned flags only under "Waiting on college". */
async function flagWhere(user: AuthUser, filter: 'mine' | 'waitingOnCollege' | 'escalatedToMe'): Promise<Prisma.ExceptionFlagWhereInput> {
  if (user.role === 'COLLEGE') return { resolvedAt: null, ownerRole: 'COLLEGE', application: { institutionId: user.institutionId ?? '-' } };
  if (filter === 'escalatedToMe') return { resolvedAt: null, reasonCode: 'ESCALATED', ownerUserId: user.id };
  if (filter === 'waitingOnCollege') return { resolvedAt: null, ownerRole: 'COLLEGE', application: await scopeWhere(user) };
  return { resolvedAt: null, ownerUserId: user.id, NOT: { ownerRole: 'COLLEGE' } };
}

function ageingBucket(days: number): '0-7' | '8-15' | '16+' {
  return days <= 7 ? '0-7' : days <= 15 ? '8-15' : '16+';
}

export function actionCenterRouter(): Router {
  const r = Router();

  r.get(
    '/',
    h(async (req, res) => {
      const user = currentUser(req);
      const q = parse(query, req.query);
      const flags = await prisma.exceptionFlag.findMany({
        where: await flagWhere(user, q.filter),
        include: {
          application: {
            include: {
              institution: { select: { name: true, permanentId: true } },
              assignments: { where: { releasedAt: null }, include: { officer: { select: { name: true } } } },
            },
          },
        },
      });
      const t = today();
      const byApp = new Map<string, (ExceptionFlag & { application: (typeof flags)[number]['application'] })[]>();
      for (const f of flags) byApp.set(f.applicationId, [...(byApp.get(f.applicationId) ?? []), f]);
      const labels = await typeLabels([...byApp.values()].map((fs) => fs[0]!.application));
      let rows = [...byApp.values()].map((fs) => {
        fs.sort((a, b) => compareSortKeys(a.sortKeys as unknown as SortKeys, b.sortKeys as unknown as SortKeys));
        const p = fs[0]!;
        const a = p.application;
        const mine = a.assignments.find((x) => x.officerId === user.id) ?? a.assignments.find((x) => x.taskType !== 'VERIFY') ?? null;
        const daysInStage = Math.max(0, workingDaysBetween(toDateOnly(a.stageEnteredAt), t));
        return {
          applicationId: a.id,
          applicationNo: a.applicationNo,
          institutionName: a.institution.name,
          typeLabel: labels.get(a.id) ?? a.type,
          stage: a.stage,
          stageLabel: STAGE_LABEL[a.stage],
          status: a.status,
          daysInStage,
          ageing: ageingBucket(daysInStage),
          task: mine ? { label: taskLabel(mine.taskType), reasonText: mine.reasonText, officerName: mine.officer.name } : null,
          primary: { reasonCode: p.reasonCode, label: REASON_LABEL[p.reasonCode], reasonText: p.reasonText, nextAction: p.nextAction, escalationLevel: p.escalationLevel, ownerRole: p.ownerRole },
          reasons: [...new Set(fs.map((f) => f.reasonCode))],
          escalationLevel: Math.max(...fs.map((f) => f.escalationLevel)),
          nextEscalationAt: p.nextEscalationAt ? p.nextEscalationAt.toISOString().slice(0, 10) : null,
          sortKeys: p.sortKeys as unknown as SortKeys,
        };
      });
      if (q.reason) rows = rows.filter((x) => x.reasons.includes(q.reason as ReasonCode));
      if (q.stage) rows = rows.filter((x) => x.stage === q.stage);
      if (q.ageing) rows = rows.filter((x) => x.ageing === q.ageing);
      rows.sort((a, b) => compareSortKeys(a.sortKeys, b.sortKeys));
      res.json({ rows });
    }),
  );

  r.get(
    '/summary',
    h(async (req, res) => {
      const user = currentUser(req);
      const t = today();
      const weekEnd = addWorkingDays(t, 5);
      const [held, dueItems, overdue, waiting, escalated, load, profile] = await Promise.all([
        prisma.assignment.count({ where: { officerId: user.id, releasedAt: null } }),
        prisma.deadlineItem.findMany({ where: { responsibleUserId: user.id, status: 'OPEN', type: { in: ['STAGE_SLA', 'EVC_SCHEDULE', 'EVC_REPORT', 'VERIFICATION'] }, dueDate: { gte: t, lte: weekEnd } }, select: { id: true } }),
        prisma.exceptionFlag.count({ where: { resolvedAt: null, ownerUserId: user.id, reasonCode: { in: OVERDUE_CODES }, NOT: { ownerRole: 'COLLEGE' } } }),
        prisma.exceptionFlag.findMany({ where: await flagWhere(user, 'waitingOnCollege'), select: { applicationId: true } }),
        prisma.exceptionFlag.count({ where: { resolvedAt: null, reasonCode: 'ESCALATED', ownerUserId: user.id } }),
        prisma.assignment.aggregate({ where: { officerId: user.id, releasedAt: null }, _sum: { weight: true } }),
        prisma.officerProfile.findUnique({ where: { userId: user.id } }),
      ]);
      res.json({
        held,
        dueThisWeek: dueItems.length,
        overdue,
        waitingOnCollege: new Set(waiting.map((w) => w.applicationId)).size,
        escalatedToMe: escalated,
        openPoints: Math.round(Number(load._sum.weight ?? 0) * 100) / 100,
        capacity: Number(profile?.capacityPoints ?? 0),
      });
    }),
  );

  return r;
}
