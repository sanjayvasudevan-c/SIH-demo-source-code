import { Router } from 'express';
import { z } from 'zod';
import { h, parse } from '../lib/http.js';
import { currentUser } from '../auth/middleware.js';
import { requireRole } from '../policy/roles.js';
import { reassignPortfolio } from '../assignment/engine.js';

export function institutionsRouter(): Router {
  const r = Router();
  r.post(
    '/:id/portfolio',
    requireRole('SENIOR', 'SUPER_SENIOR', 'HOD', 'BUREAU'),
    h(async (req, res) => {
      const id = parse(z.string().uuid(), req.params.id);
      const body = parse(z.object({ toOfficerId: z.string().uuid(), reason: z.string().trim().min(1, 'Enter a reason').max(1000) }), req.body);
      res.json(await reassignPortfolio(currentUser(req), id, body.toOfficerId, body.reason));
    }),
  );
  return r;
}
