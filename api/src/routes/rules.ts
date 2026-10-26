// /api/rules (add-on A7): rule packs. Every endpoint is policy-checked and zod-validated. Read access for staff;
// RULE_EDITOR drafts, edits, submits and imports; RULE_APPROVER approves, rejects and publishes. Public notices and
// schedule are served without login by publicRulesRouter.
import { Router } from 'express';
import { z } from 'zod';
import type { Role, RulePackVersion } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { isoDate } from '../lib/dates.js';
import { now } from '../lib/clock.js';
import { badRequest, notFound } from '../lib/errors.js';
import { currentUser, type AuthUser } from '../auth/middleware.js';
import { requireRole } from '../policy/roles.js';
import { filingContext } from '../rules/filing.js';
import { AMENDMENT_KINDS, APP_TYPES, SECTIONS, exprVars, validatePack, type PackContent } from '../rules/schema.js';
import { typeLabels } from '../rules/service.js';
import type { ResolvedRules } from '../rules/resolved.js';
import { diffPacks, type DiffEntry } from '../rules/diff.js';
import { diffForPublish } from '../rules/rebase.js';
import { applyPatch, patchSchema } from '../rules/jsonpatch.js';
import { publicNotices, publicSchedule } from '../rules/notices.js';
import { impactOf } from '../rules/impact.js';
import {
  approveVersion,
  approverConflict,
  createCycle,
  createDraft,
  draftRollback,
  exportVersion,
  importVersion,
  makersOf,
  publishVersion,
  rejectVersion,
  saveDraft,
  submitVersion,
} from '../rules/versions.js';

const STAFF: Role[] = ['OFFICER', 'SENIOR', 'SUPER_SENIOR', 'HOD', 'BUREAU', 'COMMITTEE', 'AUTHORITY', 'ADMIN', 'RULE_EDITOR', 'RULE_APPROVER'];
const STAGE_NAME: Record<string, string> = { SCRUTINY: 'Scrutiny', EVC: 'EVC', SAC_SHC: 'SAC/SHC', DECISION: 'Decision' };
const OPEN = ['IN_STAGE', 'RETURNED'] as const;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const amendmentSchema = z.object({
  kind: z.enum(AMENDMENT_KINDS),
  refNo: z.string().trim().min(1).max(200),
  issuedOn: isoDay,
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
  applyScope: z.record(z.string().max(200), z.enum(['NEW_CASES', 'LIVE'])).optional(),
  sourceDocId: z.string().max(80).nullable().optional(),
});

/** Plain words for a route step's condition. */
function stepLabel(r: ResolvedRules, stage: string, when: unknown, programme: ReturnType<ResolvedRules['programme']>): string {
  if (when === undefined) return STAGE_NAME[stage] ?? stage;
  const pct = JSON.stringify(when).includes('norms.evcIntakeIncreasePct') ? r.norm('evcIntakeIncreasePct', programme) : null;
  return pct !== null ? `${STAGE_NAME[stage]} if intake rises over ${pct}%` : `${STAGE_NAME[stage]} (when its condition applies)`;
}

async function names(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function versionOr404(id: string) {
  const v = await prisma.rulePackVersion.findUnique({ where: { id }, include: { amendment: true, cycle: true } });
  if (!v) throw notFound('That rule pack version does not exist.');
  return v;
}

/** The version a draft is compared with: the cycle's published version, else its parent. */
async function baseOf(v: RulePackVersion): Promise<RulePackVersion | null> {
  if (v.status === 'PUBLISHED' || v.status === 'SUPERSEDED') return v.parentVersionId ? prisma.rulePackVersion.findUnique({ where: { id: v.parentVersionId } }) : null;
  return (await prisma.rulePackVersion.findFirst({ where: { cycleId: v.cycleId, status: 'PUBLISHED' } })) ?? (v.parentVersionId ? prisma.rulePackVersion.findUnique({ where: { id: v.parentVersionId } }) : null);
}

function amendmentView(a: { id: string; kind: string; refNo: string; issuedOn: Date; title: string; summary: string; applyScope: unknown; sourceDocId: string | null } | null) {
  return a ? { id: a.id, kind: a.kind, refNo: a.refNo, issuedOn: isoDate(a.issuedOn), title: a.title, summary: a.summary, applyScope: a.applyScope, sourceDocId: a.sourceDocId } : null;
}

/** The one primary action the viewer may take on this version, or why not. */
async function permissions(user: AuthUser, v: RulePackVersion) {
  const editable = v.status === 'DRAFT' || v.status === 'REJECTED';
  const approverBlock = user.role === 'RULE_APPROVER' && v.status === 'IN_REVIEW' ? await approverConflict(user, v) : null;
  return {
    canEdit: user.role === 'RULE_EDITOR' && editable,
    canSubmit: user.role === 'RULE_EDITOR' && v.status === 'DRAFT',
    canReview: user.role === 'RULE_APPROVER' && v.status === 'IN_REVIEW' && !approverBlock,
    reviewBlockedReason: approverBlock,
    canPublish: user.role === 'RULE_APPROVER' && v.status === 'APPROVED',
    readOnly: !['RULE_EDITOR', 'RULE_APPROVER'].includes(user.role),
  };
}

export function publicRulesRouter(): Router {
  const r = Router();
  r.get(
    '/notices',
    h(async (_req, res) => {
      res.json(await publicNotices());
    }),
  );
  r.get(
    '/schedule',
    h(async (_req, res) => {
      res.json({ schedule: await publicSchedule() });
    }),
  );
  return r;
}

export function rulesRouter(): Router {
  const r = Router();

  // ---------------------------------------------------------------- filing context (apply form)
  r.get(
    '/filing',
    requireRole('COLLEGE'),
    h(async (req, res) => {
      const user = currentUser(req);
      const q = parse(z.object({ programme: z.string().regex(/^[A-Z0-9_]{2,20}$/).optional() }), req.query);
      const fc = await filingContext(user.institutionId!, null, q.programme ? { programme: q.programme } : {});
      const rules = fc.rules;
      const programme = rules.programme(q.programme ?? null);
      const ctx = { ...fc.facts, programme };
      res.json({
        open: fc.filing.ok,
        message: fc.filing.ok ? null : fc.filing.message,
        window: fc.filing.ok ? fc.filing.window : null,
        lateFeeInr: fc.filing.ok ? fc.filing.lateFeeInr : null,
        ignoredSchedule: fc.filing.ok ? !!fc.filing.ignoredSchedule : false,
        rules: { versionId: rules.pinned.id, cycle: rules.pinned.cycleCode, version: rules.pinned.version, label: rules.label, effectiveFrom: rules.pinned.effectiveFrom },
        programmes: rules.content.programmes.map((p) => ({ code: p.code, label: p.label, level: p.level, discipline: p.discipline, inPurview: rules.test(p.inPurview, { ...ctx, programme: p }) })),
        types: rules.content.applicationTypes
          .filter((t) => (APP_TYPES as readonly string[]).includes(t.type))
          .map((t) => ({
            type: t.type,
            label: t.label,
            category: t.category,
            channel: t.channel,
            eligible: rules.test(t.eligibility, { ...ctx, application: { type: t.type } }),
            route: t.route.map((s) => stepLabel(rules, s.stage, s.when, programme)),
            documents: rules.documents(t.type, ctx).map((d) => ({ kind: d.kind, label: d.label, critical: d.critical, hasExpiry: d.hasExpiry, source: d.source ?? null })),
          })),
      });
    }),
  );

  // Variables an expression may use (shared/expr-vars.json), for the condition builder.
  r.get(
    '/vars',
    requireRole(...STAFF),
    h(async (_req, res) => {
      res.json(exprVars());
    }),
  );

  // Facts of a few seeded cases, to fill the letter preview. Only what the letter placeholders show.
  r.get(
    '/letter-samples',
    requireRole('RULE_EDITOR', 'RULE_APPROVER', 'ADMIN', 'HOD', 'BUREAU'),
    h(async (_req, res) => {
      const apps = await prisma.application.findMany({
        where: { deficiencies: { some: {} } },
        take: 8,
        orderBy: { applicationNo: 'asc' },
        include: { institution: { select: { name: true, permanentId: true } }, deficiencies: { orderBy: { raisedAt: 'desc' }, take: 1 }, decision: true, undertakings: true },
      });
      const labels = await typeLabels(apps);
      res.json({
        samples: apps.map((a) => {
          const d = a.deficiencies[0];
          const items = ((d?.items as string[] | undefined) ?? []).map((i) => `- ${i}`);
          return {
            id: a.id,
            label: `${a.applicationNo} · ${a.institution.name}`,
            values: {
              'application.no': a.applicationNo,
              'application.type': labels.get(a.id) ?? a.type,
              'institution.name': a.institution.name,
              'institution.permanentId': a.institution.permanentId,
              'deficiency.items': items.join('\n') || '- (no items recorded)',
              'deficiency.reason': d?.reason ?? '',
              'decision.outcome': a.decision?.outcome.replace(/_/g, ' ').toLowerCase() ?? 'approved with conditions',
              'decision.reason': a.decision?.reason ?? 'All norms met on the evidence submitted.',
              'decision.conditions': a.undertakings.map((u) => `- ${u.condition} (by ${isoDate(u.dueDate)})`).join('\n') || '- None',
            },
          };
        }),
      });
    }),
  );

  // College banner: rule changes published since the user last looked at the notices.
  r.get(
    '/notices/unseen',
    requireRole('COLLEGE'),
    h(async (req, res) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id }, select: { noticesSeenAt: true } });
      const fresh = await prisma.rulePackVersion.findMany({
        where: { status: { in: ['PUBLISHED', 'SUPERSEDED'] }, amendment: { isNot: null }, ...(user.noticesSeenAt ? { publishedAt: { gt: user.noticesSeenAt } } : {}) },
        select: { cycle: { select: { code: true } } },
      });
      res.json({ count: fresh.length, cycles: [...new Set(fresh.map((f) => f.cycle.code))].sort().reverse() });
    }),
  );
  r.post(
    '/notices/seen',
    requireRole('COLLEGE'),
    h(async (req, res) => {
      await prisma.user.update({ where: { id: currentUser(req).id }, data: { noticesSeenAt: now() } });
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- cycles
  r.get(
    '/cycles',
    requireRole(...STAFF),
    h(async (_req, res) => {
      const cycles = await prisma.approvalCycle.findMany({ orderBy: { code: 'desc' }, include: { versions: { include: { amendment: true }, orderBy: { version: 'desc' } } } });
      const pinned = await prisma.application.groupBy({ by: ['rulePackVersionId'], where: { status: { in: [...OPEN] } }, _count: true });
      const pinnedBy = new Map(pinned.map((p) => [p.rulePackVersionId, p._count]));
      const who = await names(cycles.flatMap((c) => c.versions.flatMap((v) => [v.createdById, v.approvedById, v.publishedById])));
      res.json({
        cycles: cycles.map((c) => {
          const pub = c.versions.find((v) => v.status === 'PUBLISHED') ?? null;
          const draft = c.versions.find((v) => ['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED'].includes(v.status)) ?? null;
          return {
            id: c.id,
            code: c.code,
            label: c.label,
            baseRef: c.baseRef,
            published: pub ? { id: pub.id, version: pub.version, effectiveFrom: isoDate(pub.effectiveFrom), publishedAt: pub.publishedAt?.toISOString() ?? null } : null,
            pinnedOpenCases: c.versions.reduce((s, v) => s + (pinnedBy.get(v.id) ?? 0), 0),
            draftInProgress: draft ? { id: draft.id, version: draft.version, status: draft.status } : null,
            versions: c.versions.map((v) => ({
              id: v.id,
              version: v.version,
              status: v.status,
              kind: v.amendment?.kind ?? null,
              refNo: v.amendment?.refNo ?? null,
              title: v.amendment?.title ?? null,
              issuedOn: v.amendment ? isoDate(v.amendment.issuedOn) : null,
              effectiveFrom: isoDate(v.effectiveFrom),
              maker: who.get(v.createdById) ?? (v.createdById === 'system' ? 'System (migration)' : null),
              checker: v.approvedById ? (who.get(v.approvedById) ?? (v.approvedById === 'system' ? 'System (migration)' : null)) : null,
              publishedAt: v.publishedAt?.toISOString() ?? null,
              scheduledPublish: v.scheduledPublish,
              pinnedOpenCases: pinnedBy.get(v.id) ?? 0,
            })),
          };
        }),
      });
    }),
  );

  r.post(
    '/cycles',
    requireRole('RULE_EDITOR'),
    h(async (req, res) => {
      const body = parse(z.object({ code: z.string().regex(/^\d{4}-\d{2}$/), label: z.string().max(120).optional(), copyFromVersionId: z.string().uuid(), effectiveFrom: isoDay, amendment: amendmentSchema }), req.body);
      const out = await createCycle(currentUser(req), body);
      res.status(201).json({ cycleId: out.cycle.id, versionId: out.version.id });
    }),
  );

  // ---------------------------------------------------------------- versions
  r.get(
    '/versions/:id',
    requireRole(...STAFF),
    h(async (req, res) => {
      const user = currentUser(req);
      const v = await versionOr404(parse(z.string().uuid(), req.params.id));
      const base = await baseOf(v);
      const content = v.content as unknown as PackContent;
      const diff = base ? diffPacks(base.content as unknown as PackContent, content) : [];
      const changedBySection = Object.fromEntries(SECTIONS.map((s) => [s, diff.filter((d) => d.section === s).length]));
      const history = await prisma.auditLog.findMany({ where: { chainKey: 'rules', meta: { path: ['versionId'], equals: v.id } }, orderBy: { id: 'asc' } });
      const makerIds = await makersOf(v.id);
      const who = await names([v.createdById, v.submittedById, v.approvedById, v.publishedById, ...makerIds, ...history.map((h) => h.actorId)]);
      const check = validatePack(v.content);
      const pinnedOpenCases = await prisma.application.count({ where: { rulePackVersionId: v.id, status: { in: [...OPEN] } } });
      const cyclePublished = await prisma.rulePackVersion.findFirst({ where: { cycleId: v.cycleId, status: 'PUBLISHED' }, select: { id: true, version: true } });
      res.json({
        id: v.id,
        cycle: { id: v.cycleId, code: v.cycle.code, label: v.cycle.label },
        version: v.version,
        status: v.status,
        content,
        contentHash: v.contentHash,
        effectiveFrom: isoDate(v.effectiveFrom),
        scheduledPublish: v.scheduledPublish,
        parentVersionId: v.parentVersionId,
        base: base ? { id: base.id, version: base.version, status: base.status } : null,
        amendment: amendmentView(v.amendment),
        maker: who.get(v.createdById) ?? v.createdById,
        submittedBy: v.submittedById ? who.get(v.submittedById) ?? null : null,
        checker: v.approvedById ? who.get(v.approvedById) ?? v.approvedById : null,
        publishedBy: v.publishedById ? who.get(v.publishedById) ?? v.publishedById : null,
        publishedAt: v.publishedAt?.toISOString() ?? null,
        rejectedRemarks: v.rejectedRemarks,
        pinnedOpenCases,
        cyclePublished,
        errors: check.ok ? [] : check.errors,
        changedBySection,
        makers: makerIds.map((id) => who.get(id) ?? id),
        permissions: await permissions(user, v),
        history: history.map((h) => ({ at: h.at.toISOString(), action: h.action, actor: h.actorId ? who.get(h.actorId) ?? h.actorRole : h.actorRole, reason: h.reason, meta: h.meta })),
      });
    }),
  );

  r.post(
    '/versions',
    requireRole('RULE_EDITOR'),
    h(async (req, res) => {
      const body = parse(z.object({ parentVersionId: z.string().uuid(), effectiveFrom: isoDay, amendment: amendmentSchema }), req.body);
      const v = await createDraft(currentUser(req), body);
      res.status(201).json({ id: v.id, version: v.version });
    }),
  );

  // JSON Patch (or a whole replacement) on DRAFT content; returns [{path, message}] errors. Audit RULES_EDITED.
  r.patch(
    '/versions/:id',
    requireRole('RULE_EDITOR'),
    h(async (req, res) => {
      const id = parse(z.string().uuid(), req.params.id);
      const body = parse(z.object({ patch: patchSchema.optional(), content: z.record(z.unknown()).optional(), amendment: amendmentSchema.partial().optional(), effectiveFrom: isoDay.optional() }), req.body);
      const v = await versionOr404(id);
      let content: unknown = body.content;
      let paths: string[] = body.content ? ['/'] : [];
      if (body.patch) {
        const out = applyPatch(v.content, body.patch);
        content = out.doc;
        paths = out.paths;
      }
      const r2 = await saveDraft(currentUser(req), id, { content, amendment: body.amendment, effectiveFrom: body.effectiveFrom, paths });
      res.json({ id, contentHash: r2.version.contentHash, status: r2.version.status, errors: r2.errors });
    }),
  );

  r.post(
    '/versions/:id/submit',
    requireRole('RULE_EDITOR'),
    h(async (req, res) => {
      const v = await submitVersion(currentUser(req), parse(z.string().uuid(), req.params.id));
      res.json({ id: v.id, status: v.status });
    }),
  );
  r.post(
    '/versions/:id/approve',
    requireRole('RULE_APPROVER'),
    h(async (req, res) => {
      const body = parse(z.object({ remarks: z.string().trim().max(2000).optional() }), req.body ?? {});
      const v = await approveVersion(currentUser(req), parse(z.string().uuid(), req.params.id), body.remarks);
      res.json({ id: v.id, status: v.status });
    }),
  );
  r.post(
    '/versions/:id/reject',
    requireRole('RULE_APPROVER'),
    h(async (req, res) => {
      const body = parse(z.object({ remarks: z.string().trim().min(1, 'Give the maker your remarks.').max(2000) }), req.body);
      const v = await rejectVersion(currentUser(req), parse(z.string().uuid(), req.params.id), body.remarks);
      res.json({ id: v.id, status: v.status });
    }),
  );
  r.post(
    '/versions/:id/publish',
    requireRole('RULE_APPROVER'),
    h(async (req, res) => {
      const body = parse(z.object({ scheduled: z.boolean().optional() }), req.body ?? {});
      const out = await publishVersion(currentUser(req), parse(z.string().uuid(), req.params.id), body);
      res.json({ id: out.version.id, status: out.version.status, scheduled: out.scheduled, rebased: out.rebased, movedItems: out.movedItems });
    }),
  );
  r.post(
    '/versions/:id/rollback-to/:olderId',
    requireRole('RULE_EDITOR'),
    h(async (req, res) => {
      const body = parse(z.object({ effectiveFrom: isoDay, summary: z.string().trim().max(2000).optional() }), req.body);
      const current = await versionOr404(parse(z.string().uuid(), req.params.id));
      if (current.status !== 'PUBLISHED') throw badRequest('Roll back from the published version of the cycle.');
      const v = await draftRollback(currentUser(req), parse(z.string().uuid(), req.params.olderId), body);
      res.status(201).json({ id: v.id, version: v.version });
    }),
  );

  r.get(
    '/versions/:id/diff',
    requireRole(...STAFF),
    h(async (req, res) => {
      const v = await versionOr404(parse(z.string().uuid(), req.params.id));
      const q = parse(z.object({ against: z.string().uuid().optional() }), req.query);
      const against = q.against ? await versionOr404(q.against) : await baseOf(v);
      if (!against) return res.json({ against: null, changes: [] as DiffEntry[] });
      if (against.cycleId !== v.cycleId && q.against === undefined) throw badRequest('Compare versions of the same cycle.');
      const changes = await diffForPublish(prisma, against, v);
      const scope = (v.amendment?.applyScope ?? {}) as Record<string, string>;
      res.json({
        against: { id: against.id, version: against.version, status: against.status },
        changes: changes.map((c) => ({ ...c, applyScope: Object.entries(scope).find(([p]) => c.path === p || c.path.startsWith(`${p}.`))?.[1] ?? 'NEW_CASES' })),
      });
    }),
  );

  r.get(
    '/versions/:id/impact',
    requireRole(...STAFF),
    h(async (req, res) => {
      res.json(await impactOf(parse(z.string().uuid(), req.params.id)));
    }),
  );

  r.get(
    '/versions/:id/export',
    requireRole(...STAFF),
    h(async (req, res) => {
      const out = await exportVersion(currentUser(req), parse(z.string().uuid(), req.params.id));
      res.setHeader('Content-Disposition', `attachment; filename="rules-${out.cycle}-v${out.version}.json"`);
      res.json(out);
    }),
  );

  r.post(
    '/import',
    requireRole('RULE_EDITOR'),
    h(async (req, res) => {
      const out = await importVersion(currentUser(req), req.body);
      res.status(201).json({ id: out.version.id, version: out.version.version, hashMatched: out.hashMatched });
    }),
  );

  return r;
}
