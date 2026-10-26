import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';
import { now } from '../lib/clock.js';
import { appendAuditStandalone } from '../lib/audit.js';
import { currentUser } from '../auth/middleware.js';
import { requireRole } from '../policy/roles.js';
import { inScope } from '../policy/scope.js';
import { formValuesSchema } from '../formcheck/features.js';
import { validateForm } from '../formcheck/service.js';

export function formsRouter(): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many checks in a minute. Wait a moment and try again.' } });

  r.post(
    '/forms/validate',
    limiter,
    requireRole('COLLEGE'),
    h(async (req, res) => {
      const user = currentUser(req);
      const body = parse(
        z.object({
          draftId: z.string().min(4).max(80),
          type: z.enum(['NEW_INSTITUTION', 'EXTENSION', 'NAME_CHANGE', 'INTAKE_INCREASE', 'CHANGE_OF_SITE', 'VERIFICATION_VISIT', 'RESTORATION']),
          values: formValuesSchema,
        }),
        req.body,
      );
      res.json(await validateForm(user, body));
    }),
  );

  r.post(
    '/form-checks/:id/label',
    requireRole('OFFICER', 'BUREAU'),
    h(async (req, res) => {
      const user = currentUser(req);
      const id = parse(z.string().uuid(), req.params.id);
      const body = parse(z.object({ warningIndex: z.number().int().min(0).max(50), useful: z.boolean() }), req.body);
      const fc = await prisma.formCheckResult.findUnique({ where: { id } });
      if (!fc || !fc.applicationId || !(await inScope(user, fc.applicationId))) throw notFound();
      const warnings = (fc.warnings as unknown[]) ?? [];
      if (body.warningIndex >= warnings.length) throw badRequest('No such warning.');
      const labels = { ...((fc.officerLabels as Record<string, unknown>) ?? {}) };
      labels[String(body.warningIndex)] = { useful: body.useful, by: user.id, byName: user.name, at: now().toISOString(), modelVersion: fc.modelVersion };
      const updated = await prisma.formCheckResult.update({ where: { id }, data: { officerLabels: labels as Prisma.InputJsonValue } });
      await appendAuditStandalone({
        actorId: user.id,
        actorRole: user.role,
        action: 'FORM_CHECK_LABEL',
        applicationId: fc.applicationId,
        meta: { formCheckId: id, warningIndex: body.warningIndex, useful: body.useful, modelVersion: fc.modelVersion },
      });
      res.json({ id, officerLabels: updated.officerLabels });
    }),
  );

  return r;
}
