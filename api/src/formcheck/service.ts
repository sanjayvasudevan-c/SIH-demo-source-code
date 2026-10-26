// POST /forms/validate: hard validation here, then the Python scorer with an 800 ms timeout, else Node rules.
import type { AppType, Prisma, Severity } from '@prisma/client';
import type { AuthUser } from '../auth/middleware.js';
import { prisma, type Db } from '../lib/db.js';
import { isoDate } from '../lib/dates.js';
import { now, today } from '../lib/clock.js';
import { appendAuditStandalone } from '../lib/audit.js';
import { computeFeatures, requiredMissing, type FormValues } from './features.js';
import { evaluateRules, type Warning } from './rules.js';
import { postJson } from './client.js';
import type { EvalContext, ResolvedRules } from '../rules/resolved.js';
import { filingContext } from '../rules/filing.js';

export interface ValidateResponse {
  id: string;
  modelVersion: string;
  modelAvailable: boolean;
  severity: Severity;
  score: number | null;
  threshold: number | null;
  warnings: Warning[];
  requiredMissing: { field: string; message: string }[];
  canSubmit: true;
  justificationRequired: boolean;
}

interface ScoreResponse {
  modelVersion: string;
  severity: Severity;
  score: number | null;
  threshold: number | null;
  warnings: Warning[];
}

/** Score with the case's rules: the Python service gets the pack's formCheckRules and norms; Node evaluates them on fallback. */
export async function scoreForm(rules: ResolvedRules, type: AppType, values: FormValues, ctx: EvalContext = {}) {
  const todayIso = isoDate(today());
  const requiredDocs = rules.criticalKinds(type, ctx);
  const norms = rules.norms(rules.programme(values.programme));
  try {
    const r = await postJson<ScoreResponse>('/score', { type, values, today: todayIso, requiredDocs, rules: rules.formCheckRules, norms });
    return { ...r, modelAvailable: true };
  } catch {
    const warnings = evaluateRules(computeFeatures(values, todayIso, requiredDocs), rules.formCheckRules, norms);
    return {
      modelVersion: `rules-${rules.label}`,
      modelAvailable: false,
      severity: (warnings.length ? 'HIGH' : 'NONE') as Severity,
      score: null,
      threshold: null,
      warnings,
    };
  }
}

export async function validateForm(user: AuthUser, input: { draftId: string; type: AppType; values: FormValues }, db: Db = prisma, rules?: ResolvedRules): Promise<ValidateResponse> {
  const fc = await filingContext(user.institutionId!, input.type, input.values as Record<string, unknown>, {}, db);
  const resolved = rules ?? fc.rules;
  const missing = requiredMissing(resolved, input.type, input.values, fc.facts);
  const r = await scoreForm(resolved, input.type, input.values, fc.facts);
  const row = await db.formCheckResult.create({
    data: {
      institutionId: user.institutionId!,
      draftId: input.draftId,
      modelVersion: r.modelVersion,
      modelAvailable: r.modelAvailable,
      score: r.score,
      threshold: r.threshold,
      severity: r.severity,
      warnings: r.warnings as unknown as Prisma.InputJsonValue,
      createdAt: now(),
    },
  });
  if (r.severity !== 'NONE') {
    await appendAuditStandalone(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'FORM_CHECK_WARNING',
        meta: { draftId: input.draftId, formCheckId: row.id, severity: r.severity, modelAvailable: r.modelAvailable, warnings: r.warnings.length },
      },
      db,
    );
  }
  return {
    id: row.id,
    modelVersion: r.modelVersion,
    modelAvailable: r.modelAvailable,
    severity: r.severity,
    score: r.score,
    threshold: r.threshold,
    warnings: r.warnings,
    requiredMissing: missing,
    canSubmit: true,
    justificationRequired: r.severity !== 'NONE',
  };
}
