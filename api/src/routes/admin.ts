import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { verifyChains } from '../lib/audit.js';
import { requireRole } from '../policy/roles.js';
import { formcheckHealthy } from '../formcheck/client.js';

const auditQuery = z.object({
  applicationNo: z.string().max(40).optional(),
  action: z.string().max(40).optional(),
  actor: z.string().max(100).optional(),
  chain: z.enum(['rules', 'global']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});

export function adminRouter(): Router {
  const r = Router();
  r.use(requireRole('ADMIN'));

  r.get(
    '/audit',
    h(async (req, res) => {
      const q = parse(auditQuery, req.query);
      const where: Prisma.AuditLogWhereInput = {};
      if (q.applicationNo) {
        const app = await prisma.application.findUnique({ where: { applicationNo: q.applicationNo }, select: { id: true } });
        where.OR = [{ applicationId: app?.id ?? '-' }, { meta: { path: ['applicationId'], equals: app?.id ?? '-' } }];
      }
      if (q.action) where.action = q.action;
      if (q.chain) where.chainKey = q.chain;
      if (q.actor) {
        const actors = await prisma.user.findMany({
          where: { OR: [{ name: { contains: q.actor, mode: 'insensitive' } }, { email: { contains: q.actor, mode: 'insensitive' } }] },
          select: { id: true },
        });
        where.actorId = { in: actors.map((a) => a.id) };
      }
      const [total, rows] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
      const appIds = [...new Set(rows.map((r) => r.applicationId).filter((x): x is string => !!x))];
      const [actors, apps] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }),
        prisma.application.findMany({ where: { id: { in: appIds } }, select: { id: true, applicationNo: true } }),
      ]);
      const actorName = new Map(actors.map((a) => [a.id, a.name]));
      const appNo = new Map(apps.map((a) => [a.id, a.applicationNo]));
      res.json({
        total,
        page: q.page,
        pageSize: q.pageSize,
        rows: rows.map((r) => ({
          id: r.id.toString(),
          chainKey: r.chainKey,
          at: r.at.toISOString(),
          actorId: r.actorId,
          actorName: r.actorId ? actorName.get(r.actorId) ?? null : null,
          actorRole: r.actorRole,
          action: r.action,
          applicationId: r.applicationId,
          applicationNo: r.applicationId ? appNo.get(r.applicationId) ?? null : null,
          fromState: r.fromState,
          toState: r.toState,
          reason: r.reason,
          meta: r.meta,
          rowHash: r.rowHash,
        })),
      });
    }),
  );

  r.get(
    '/audit/verify',
    h(async (_req, res) => {
      res.json(await verifyChains());
    }),
  );

  r.get(
    '/directory',
    h(async (_req, res) => {
      const users = await prisma.user.findMany({
        where: { role: { not: 'COLLEGE' } },
        select: { id: true, name: true, email: true, role: true, title: true, reportsToId: true, region: { select: { code: true } } },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      });
      res.json({
        users: users.map((u) => ({ ...u, region: u.region?.code ?? null })),
      });
    }),
  );

  r.get(
    '/scheduler',
    h(async (_req, res) => {
      const beats = await prisma.schedulerHeartbeat.findMany({ orderBy: { instanceId: 'asc' } });
      res.json({
        instances: beats.map((b) => ({
          instanceId: b.instanceId,
          isLeader: b.isLeader,
          lastRunAt: b.lastRunAt.toISOString(),
          lastResult: b.lastResult,
        })),
        formcheck: (await formcheckHealthy()) ? 'ok' : 'down',
      });
    }),
  );

  return r;
}
