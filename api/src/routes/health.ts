import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { h } from '../lib/http.js';
import * as clock from '../lib/clock.js';
import { formcheckHealthy } from '../formcheck/client.js';

export function healthRouter(): Router {
  const r = Router();
  r.get(
    '/health',
    h(async (_req, res) => {
      let db = 'ok';
      let schedulerLeader: string | null = null;
      let lastRunAt: string | null = null;
      let lagSeconds: number | null = null;
      try {
        await prisma.$queryRaw`SELECT 1`;
        const leader = await prisma.schedulerHeartbeat.findFirst({ where: { isLeader: true }, orderBy: { lastRunAt: 'desc' } });
        if (leader) {
          schedulerLeader = leader.instanceId;
          lastRunAt = leader.lastRunAt.toISOString();
          lagSeconds = Math.max(0, Math.round((clock.now().getTime() - leader.lastRunAt.getTime()) / 1000));
        }
      } catch {
        db = 'down';
      }
      const formcheck = (await formcheckHealthy()) ? 'ok' : 'down';
      res.status(db === 'ok' ? 200 : 503).json({ db, schedulerLeader, lastRunAt, lagSeconds, formcheck });
    }),
  );
  return r;
}
