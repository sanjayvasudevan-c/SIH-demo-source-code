import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { currentUser } from '../auth/middleware.js';

export function notificationsRouter(): Router {
  const r = Router();

  r.get(
    '/',
    h(async (req, res) => {
      const user = currentUser(req);
      const [items, unread] = await Promise.all([
        prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
        prisma.notification.count({ where: { userId: user.id, read: false } }),
      ]);
      const appIds = [...new Set(items.map((n) => n.applicationId).filter((x): x is string => !!x))];
      const apps = await prisma.application.findMany({ where: { id: { in: appIds } }, select: { id: true, applicationNo: true } });
      const no = new Map(apps.map((a) => [a.id, a.applicationNo]));
      res.json({
        unread,
        items: items.map((n) => ({
          id: n.id,
          kind: n.kind,
          message: n.message,
          read: n.read,
          createdAt: n.createdAt.toISOString(),
          applicationId: n.applicationId,
          applicationNo: n.applicationId ? no.get(n.applicationId) ?? null : null,
        })),
      });
    }),
  );

  r.post(
    '/read',
    h(async (req, res) => {
      const user = currentUser(req);
      const body = parse(z.object({ ids: z.array(z.string().uuid()).max(200).optional() }), req.body ?? {});
      const result = await prisma.notification.updateMany({
        where: { userId: user.id, read: false, ...(body.ids ? { id: { in: body.ids } } : {}) },
        data: { read: true },
      });
      res.json({ updated: result.count });
    }),
  );

  return r;
}
