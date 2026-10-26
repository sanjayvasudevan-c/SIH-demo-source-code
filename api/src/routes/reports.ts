import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { forbidden, notFound } from '../lib/errors.js';
import { currentUser } from '../auth/middleware.js';
import { requireRole } from '../policy/roles.js';
import { getSubtreeUserIds } from '../policy/subtree.js';
import { teamReport } from '../reports/team.js';

export function reportsRouter(): Router {
  const r = Router();
  r.get(
    '/team',
    requireRole('SENIOR', 'SUPER_SENIOR', 'HOD'),
    h(async (req, res) => {
      const user = currentUser(req);
      const q = parse(z.object({ period: z.enum(['7', '30', '90']).default('30'), drill: z.string().uuid().optional() }), req.query);
      let base = { id: user.id, name: user.name, role: user.role as string };
      if (q.drill && q.drill !== user.id) {
        if (!(await getSubtreeUserIds(user.id)).includes(q.drill)) throw forbidden('You can drill down only into your own team.');
        const u = await prisma.user.findUnique({ where: { id: q.drill }, select: { id: true, name: true, role: true } });
        if (!u) throw notFound();
        base = u;
      }
      res.json(await teamReport(user, base, Number(q.period)));
    }),
  );
  return r;
}
