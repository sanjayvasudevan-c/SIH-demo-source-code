// Public endpoints for the portal shell (add-on B2), no login: the current cycle and rules for the header and
// footer, and "Track application" by application number plus the institution's permanent ID.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { isoDate } from '../lib/dates.js';
import * as clock from '../lib/clock.js';
import { notFound } from '../lib/errors.js';
import { newestRules, rulesForApp } from '../rules/service.js';

const STAGE: Record<string, string> = { SCRUTINY: 'Scrutiny', EVC: 'Expert visit (EVC)', SAC_SHC: 'SAC/SHC', DECISION: 'Decision' };
const STATUS: Record<string, string> = { IN_STAGE: 'In progress', RETURNED: 'Returned to the institution', APPROVED: 'Approved', APPROVED_WITH_CONDITIONS: 'Approved with conditions', REJECTED: 'Rejected', CLOSED: 'Closed' };

export function publicRouter(): Router {
  const r = Router();

  // The (possibly simulated) date, for the header's "Simulated date" chip.
  r.get(
    '/clock',
    h(async (_req, res) => {
      await clock.refresh();
      res.json({ today: isoDate(clock.today()), offsetDays: clock.getOffsetDays(), simulated: clock.getOffsetDays() !== 0 });
    }),
  );

  r.get(
    '/current',
    h(async (_req, res) => {
      const rules = await newestRules();
      res.json({
        cycle: rules.pinned.cycleCode,
        version: rules.pinned.version,
        label: rules.label,
        effectiveFrom: rules.pinned.effectiveFrom,
        // The approval process page: types, routes, critical documents and timelines of the current rules.
        process: {
          types: rules.content.applicationTypes.map((t) => ({
            type: t.type,
            label: t.label,
            route: t.route.map((r) => (r.when !== undefined ? `${STAGE[r.stage] ?? r.stage} (when it applies)` : STAGE[r.stage] ?? r.stage)),
            documents: rules.documents(t.type).filter((d) => d.critical).map((d) => d.label),
          })),
          timelines: rules.timelines,
        },
      });
    }),
  );

  // Both numbers are needed, so the endpoint cannot be used to enumerate applications; rate-limited as well.
  const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many lookups in a minute. Wait a moment and try again.' } });
  r.post(
    '/track',
    limiter,
    h(async (req, res) => {
      const body = parse(z.object({ applicationNo: z.string().trim().min(3).max(40), permanentId: z.string().trim().min(3).max(40) }), req.body);
      const app = await prisma.application.findFirst({
        where: { applicationNo: body.applicationNo.toUpperCase(), institution: { permanentId: body.permanentId } },
        select: { id: true, applicationNo: true, type: true, stage: true, status: true, submittedAt: true, lastActionAt: true, cycleId: true, rulePackVersionId: true, route: true },
      });
      if (!app) throw notFound('No application matches that number and permanent ID.');
      const rules = await rulesForApp(app);
      res.json({
        applicationNo: app.applicationNo,
        type: rules.hasType(app.type) ? rules.type(app.type).label : app.type,
        stage: STAGE[app.stage] ?? app.stage,
        status: STATUS[app.status] ?? app.status,
        route: (app.route as string[]).map((s) => STAGE[s] ?? s),
        submittedOn: isoDate(app.submittedAt),
        lastActionOn: isoDate(app.lastActionAt),
        rules: rules.label,
      });
    }),
  );
  return r;
}
