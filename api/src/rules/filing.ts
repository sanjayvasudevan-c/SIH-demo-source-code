// The filing context of a college: facts for expressions, the cycle and version a filing today falls under.
import type { AppType } from '@prisma/client';
import { prisma, type Db } from '../lib/db.js';
import { now } from '../lib/clock.js';
import { forNewFiling, newestRules, type FilingResult } from './service.js';
import type { EvalContext, ResolvedRules } from './resolved.js';

export interface FilingContext {
  facts: EvalContext & { programmeCode: string | null };
  filing: FilingResult;
  /** The filing's rules when a window is open; otherwise the newest cycle's (for drafting and checks). */
  rules: ResolvedRules;
  hasPriorApproval: boolean;
}

/** Demo setting (only honoured when DEMO_MODE=true): file outside the windows. */
export async function ignoreScheduleSetting(db: Db = prisma): Promise<boolean> {
  if (process.env.DEMO_MODE !== 'true') return false;
  return (await db.simClock.findUnique({ where: { id: 1 } }))?.ignoreSchedule ?? false;
}

export async function filingContext(
  institutionId: string,
  type: AppType | null,
  formData: Record<string, unknown>,
  opts: { ignoreSchedule?: boolean } = {},
  db: Db = prisma,
): Promise<FilingContext> {
  const inst = await db.institution.findUniqueOrThrow({ where: { id: institutionId }, include: { region: { select: { code: true } } } });
  const past = await db.application.count({ where: { institutionId, status: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS', 'CLOSED'] } } });
  const facts = {
    formData,
    institution: { isTechnical: inst.isTechnical, kind: inst.kind, regionCode: inst.region.code, hasPriorApproval: past > 0 },
    application: type ? { type } : {},
    programmeCode: typeof formData.programme === 'string' ? formData.programme : null,
  };
  const ignoreSchedule = opts.ignoreSchedule ?? (await ignoreScheduleSetting(db));
  const filing = await forNewFiling(now(), facts, { ignoreSchedule }, db);
  const rules = filing.ok ? filing.rules : await newestRules(db);
  return { facts, filing, rules, hasPriorApproval: past > 0 };
}
