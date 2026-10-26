import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { h, parse } from '../lib/http.js';
import { prisma } from '../lib/db.js';
import { currentUser } from '../auth/middleware.js';
import { requireRole } from '../policy/roles.js';
import { listUnassigned } from '../assignment/unassigned.js';
import { assignManual, loadCandidates, policyFor, reassignManual, selectOfficer, taskWeight, type Task } from '../assignment/engine.js';
import { workloadFor } from '../reports/workload.js';
import { getSubtreeUserIds } from '../policy/subtree.js';
import { notFound } from '../lib/errors.js';
import { formatDate } from '../lib/dates.js';

export function assignmentsRouter(): Router {
  const r = Router();

  // The caller's own load, for the utilisation bar ("6.2 of 10 points").
  r.get(
    '/my-load',
    requireRole('OFFICER', 'BUREAU'),
    h(async (req, res) => {
      const user = currentUser(req);
      const [profile, open] = await Promise.all([
        prisma.officerProfile.findUnique({ where: { userId: user.id } }),
        prisma.assignment.aggregate({ where: { officerId: user.id, releasedAt: null }, _sum: { weight: true }, _count: true }),
      ]);
      res.json({ openPoints: Math.round(Number(open._sum.weight ?? 0) * 100) / 100, openTasks: open._count, capacity: Number(profile?.capacityPoints ?? 0) });
    }),
  );

  r.get(
    '/workload',
    requireRole('SENIOR', 'SUPER_SENIOR', 'HOD', 'BUREAU'),
    h(async (req, res) => {
      res.json({ rows: await workloadFor(currentUser(req)) });
    }),
  );

  // Options for the reassign dialog: the engine's own pick plus every officer who passes the hard filters.
  r.get(
    '/:id/options',
    requireRole('SENIOR', 'SUPER_SENIOR', 'HOD', 'BUREAU'),
    h(async (req, res) => {
      const id = parse(z.string().uuid(), req.params.id);
      const a = await prisma.assignment.findUnique({ where: { id }, include: { application: { include: { institution: true, region: true } } } });
      if (!a || a.releasedAt) throw notFound();
      const app = a.application;
      const p = await policyFor(prisma, app.id);
      const task: Task = { applicationId: app.id, regionId: app.regionId, taskType: a.taskType, category: app.category, taskRefId: a.taskRefId, previousOfficerId: app.previousOfficerId, excludeOfficerIds: [a.officerId], p };
      const ctx = { institutionId: app.institutionId, institutionName: app.institution.name, portfolioOfficerId: app.institution.portfolioOfficerId, regionCode: app.region.code };
      // Only officers this manager may reassign to: their team (senior, super senior), their region (HoD), anyone (Bureau).
      const actor = currentUser(req);
      const team = actor.role === 'SENIOR' || actor.role === 'SUPER_SENIOR' ? new Set(await getSubtreeUserIds(actor.id)) : null;
      const allowed = (c: { id: string; role: string; regionCode: string | null }) =>
        team ? team.has(c.id) : actor.role === 'HOD' ? c.role === 'BUREAU' || c.regionCode === app.region.code : true;
      const rec = await selectOfficer(prisma, task, ctx);
      const weight = taskWeight(p, a.taskType);
      const eligible = [];
      for (const tier of [...new Set(p.policy.eligibility[a.taskType].map((e) => e.tier))]) {
        for (const c of (await loadCandidates(prisma, task, tier, app.institutionId)).filter(allowed)) {
          const util = (c.openPoints + weight) / c.capacity;
          const blocked = c.unavailable
            ? `Away until ${formatDate(c.unavailable.until)}`
            : c.barred.includes(app.institutionId)
              ? 'Barred for this institution'
              : util > c.maxUtil + 1e-9
                ? `Over capacity (${util.toFixed(2)})`
                : null;
          eligible.push({ id: c.id, name: c.name, role: c.role, tier, utilisationAfter: Math.round(util * 100) / 100, blocked });
        }
      }
      res.json({
        recommended: rec.pick ? { id: rec.pick.officer.id, name: rec.pick.officer.name, reasonText: rec.pick.reasonText } : null,
        eligible: eligible.sort((x, y) => (x.blocked ? 1 : 0) - (y.blocked ? 1 : 0) || x.utilisationAfter - y.utilisationAfter),
      });
    }),
  );

  r.post(
    '/reassign',
    requireRole('SENIOR', 'SUPER_SENIOR', 'HOD', 'BUREAU'),
    h(async (req, res) => {
      const body = parse(z.object({ assignmentId: z.string().uuid(), toOfficerId: z.string().uuid(), reason: z.string().trim().min(1, 'Enter a reason').max(1000) }), req.body);
      res.json(await reassignManual(currentUser(req), body.assignmentId, body.toOfficerId, body.reason));
    }),
  );

  r.get(
    '/unassigned',
    requireRole('HOD', 'BUREAU'),
    h(async (req, res) => {
      const user = currentUser(req);
      const where: Prisma.ApplicationWhereInput = user.role === 'HOD' ? { regionId: user.regionId ?? '-' } : {};
      res.json({ rows: await listUnassigned(where) });
    }),
  );

  r.post(
    '/unassigned/assign',
    requireRole('HOD', 'BUREAU'),
    h(async (req, res) => {
      const user = currentUser(req);
      const body = parse(
        z.object({
          applicationId: z.string().uuid(),
          taskType: z.enum(['SCRUTINY', 'RE_SCRUTINY', 'EVC_DESK', 'VERIFY', 'SAC_SHC_FORWARD']),
          taskRefId: z.string().max(80).default(''),
          toOfficerId: z.string().uuid(),
          reason: z.string().trim().min(1, 'Enter a reason').max(1000),
        }),
        req.body,
      );
      res.json(await assignManual(user, body));
    }),
  );

  return r;
}
