// Rule pack version state machine (add-on A1/A5): DRAFT → IN_REVIEW → APPROVED → PUBLISHED → SUPERSEDED, plus
// REJECTED (back to the maker). One transaction per change; every change is audited on the "rules" chain.
// The database trigger (prisma/sql/002_rulepack_guard.sql) enforces immutability and the transition list again.
import type { Prisma, RulePackVersion, AmendmentKind } from '@prisma/client';
import { prisma, TX_OPTIONS, type Tx } from '../lib/db.js';
import { appendAudit } from '../lib/audit.js';
import { advisoryXactLock } from '../lib/locks.js';
import { now, today } from '../lib/clock.js';
import { isoDate, parseDateOnly } from '../lib/dates.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { contentHash } from './hash.js';
import { validatePack, type PackContent } from './schema.js';
import type { ExprError } from './expr.js';
import { onPublished, syncHolidays } from './service.js';
import { checkApplyScope, type ApplyScope } from './diff.js';
import { diffForPublish, rebaseAfterPublish } from './rebase.js';

export interface RulesActor {
  id: string;
  role: string;
  name?: string;
}

export interface AmendmentInput {
  kind: AmendmentKind;
  refNo: string;
  issuedOn: string;
  title: string;
  summary: string;
  applyScope?: Record<string, 'NEW_CASES' | 'LIVE'>;
  sourceDocId?: string | null;
}

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

function need(actor: RulesActor, role: 'RULE_EDITOR' | 'RULE_APPROVER', what: string) {
  if (actor.role !== role) throw forbidden(`${what} needs the ${role === 'RULE_EDITOR' ? 'rule editor' : 'rule approver'} role.`);
}

async function load(tx: Tx, id: string) {
  const v = await tx.rulePackVersion.findUnique({ where: { id }, include: { amendment: true, cycle: true } });
  if (!v) throw notFound('That rule pack version does not exist.');
  return v;
}

async function audit(tx: Tx, actor: RulesActor, action: string, v: Pick<RulePackVersion, 'id' | 'cycleId' | 'version'>, meta: Record<string, unknown> = {}, reason: string | null = null) {
  await appendAudit(tx, { chainKey: 'rules', actorId: actor.id, actorRole: actor.role, action, reason, meta: { versionId: v.id, cycleId: v.cycleId, version: v.version, ...meta } });
}

/** Users who created or edited a version (separation of duties). */
export async function makersOf(versionId: string, db: Tx | typeof prisma = prisma): Promise<string[]> {
  const rows = await db.auditLog.findMany({
    where: { chainKey: 'rules', action: { in: ['RULES_DRAFTED', 'RULES_EDITED', 'RULES_IMPORTED'] }, meta: { path: ['versionId'], equals: versionId } },
    select: { actorId: true },
  });
  return [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
}

/** Content with meta set to the row it is stored in. */
function withMeta(content: PackContent, cycleCode: string, version: number): PackContent {
  return { ...content, meta: { ...content.meta, cycle: cycleCode, version } };
}

// ---------------------------------------------------------------- create

export async function createCycle(actor: RulesActor, input: { code: string; label?: string; baseRef?: string; copyFromVersionId: string; amendment: AmendmentInput; effectiveFrom: string }) {
  need(actor, 'RULE_EDITOR', 'Creating a cycle');
  if (!/^\d{4}-\d{2}$/.test(input.code)) throw badRequest('Use a cycle code like 2027-28.');
  return prisma.$transaction(async (tx) => {
    if (await tx.approvalCycle.findUnique({ where: { code: input.code } })) throw conflict(`Cycle ${input.code} already exists.`);
    const src = await load(tx, input.copyFromVersionId);
    if (!['PUBLISHED', 'SUPERSEDED'].includes(src.status)) throw badRequest('Copy from a published version.');
    const cycle = await tx.approvalCycle.create({
      data: { code: input.code, label: input.label ?? `Approval cycle ${input.code.replace('-', '–')}`, baseRef: input.baseRef ?? src.cycle.baseRef, createdAt: now() },
    });
    const content = withMeta(src.content as unknown as PackContent, cycle.code, 1);
    const v = await insertDraft(tx, actor, { cycleId: cycle.id, version: 1, parentVersionId: null, content, amendment: input.amendment, effectiveFrom: input.effectiveFrom });
    await appendAudit(tx, { chainKey: 'rules', actorId: actor.id, actorRole: actor.role, action: 'RULES_CYCLE_CREATED', meta: { cycleId: cycle.id, code: cycle.code, copyFromVersionId: src.id } });
    return { cycle, version: v };
  }, TX_OPTIONS);
}

/** A new DRAFT from a parent version (its content is copied; the editor then changes it). */
export async function createDraft(actor: RulesActor, input: { parentVersionId: string; amendment: AmendmentInput; effectiveFrom: string; content?: PackContent; action?: 'RULES_DRAFTED' | 'RULES_IMPORTED' }) {
  need(actor, 'RULE_EDITOR', 'Drafting an amendment');
  return prisma.$transaction(async (tx) => {
    const parent = await load(tx, input.parentVersionId);
    await advisoryXactLock(tx, `rules:cycle:${parent.cycleId}`);
    const max = await tx.rulePackVersion.aggregate({ where: { cycleId: parent.cycleId }, _max: { version: true } });
    const version = (max._max.version ?? 0) + 1;
    const content = withMeta(input.content ?? (parent.content as unknown as PackContent), parent.cycle.code, version);
    return insertDraft(tx, actor, { cycleId: parent.cycleId, version, parentVersionId: parent.id, content, amendment: input.amendment, effectiveFrom: input.effectiveFrom, action: input.action });
  }, TX_OPTIONS);
}

/** First version of a brand-new cycle (seed and migration only). */
export async function createBaseVersion(tx: Tx, actor: RulesActor, input: { cycle: { code: string; label: string; baseRef: string }; content: PackContent; amendment: AmendmentInput; effectiveFrom: string }) {
  const cycle = await tx.approvalCycle.create({ data: { ...input.cycle, createdAt: now() } });
  return insertDraft(tx, actor, { cycleId: cycle.id, version: 1, parentVersionId: null, content: withMeta(input.content, cycle.code, 1), amendment: input.amendment, effectiveFrom: input.effectiveFrom });
}

async function insertDraft(
  tx: Tx,
  actor: RulesActor,
  d: { cycleId: string; version: number; parentVersionId: string | null; content: PackContent; amendment: AmendmentInput; effectiveFrom: string; action?: 'RULES_DRAFTED' | 'RULES_IMPORTED' },
) {
  const content = { ...d.content, meta: { ...d.content.meta, title: d.amendment.title } };
  const v = await tx.rulePackVersion.create({
    data: {
      cycleId: d.cycleId,
      version: d.version,
      status: 'DRAFT',
      content: asJson(content),
      contentHash: contentHash(content),
      parentVersionId: d.parentVersionId,
      createdById: actor.id,
      createdAt: now(),
      effectiveFrom: parseDateOnly(d.effectiveFrom),
      amendment: {
        create: {
          kind: d.amendment.kind,
          refNo: d.amendment.refNo,
          issuedOn: parseDateOnly(d.amendment.issuedOn),
          title: d.amendment.title,
          summary: d.amendment.summary,
          applyScope: asJson(d.amendment.applyScope ?? {}),
          sourceDocId: d.amendment.sourceDocId ?? null,
        },
      },
    },
  });
  await audit(tx, actor, d.action ?? 'RULES_DRAFTED', v, { parentVersionId: d.parentVersionId, contentHash: v.contentHash });
  return v;
}

// ---------------------------------------------------------------- edit

/** Replace a DRAFT's content (a REJECTED version goes back to DRAFT first). Saves even when invalid; returns the errors. */
export async function saveDraft(
  actor: RulesActor,
  id: string,
  input: { content?: unknown; amendment?: Partial<AmendmentInput>; effectiveFrom?: string; paths?: string[] },
): Promise<{ version: RulePackVersion; errors: ExprError[] }> {
  need(actor, 'RULE_EDITOR', 'Editing rules');
  return prisma.$transaction(async (tx) => {
    let v = await load(tx, id);
    if (v.status === 'REJECTED') v = { ...v, ...(await tx.rulePackVersion.update({ where: { id }, data: { status: 'DRAFT' } })) };
    if (v.status !== 'DRAFT') throw conflict(`Version ${v.version} is ${v.status.toLowerCase().replace('_', ' ')}; its content cannot change.`);
    const raw = input.content ?? v.content;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw badRequest('Rule pack content must be a JSON object.');
    const content = { ...(raw as Record<string, unknown>), meta: { ...((raw as { meta?: object }).meta ?? {}), cycle: v.cycle.code, version: v.version } };
    const check = validatePack(content);
    const updated = await tx.rulePackVersion.update({
      where: { id },
      data: { content: asJson(content), contentHash: contentHash(content), ...(input.effectiveFrom ? { effectiveFrom: parseDateOnly(input.effectiveFrom) } : {}) },
    });
    if (input.amendment) {
      const a = input.amendment;
      await tx.amendment.update({
        where: { versionId: id },
        data: {
          ...(a.kind ? { kind: a.kind } : {}),
          ...(a.refNo ? { refNo: a.refNo } : {}),
          ...(a.issuedOn ? { issuedOn: parseDateOnly(a.issuedOn) } : {}),
          ...(a.title ? { title: a.title } : {}),
          ...(a.summary ? { summary: a.summary } : {}),
          ...(a.applyScope ? { applyScope: asJson(a.applyScope) } : {}),
          ...(a.sourceDocId !== undefined ? { sourceDocId: a.sourceDocId } : {}),
        },
      });
    }
    await audit(tx, actor, 'RULES_EDITED', v, { paths: input.paths ?? [], contentHash: updated.contentHash, valid: check.ok });
    return { version: updated, errors: check.ok ? [] : check.errors };
  }, TX_OPTIONS);
}

/** Only drafts can be deleted. */
export async function deleteDraft(actor: RulesActor, id: string) {
  need(actor, 'RULE_EDITOR', 'Deleting a draft');
  await prisma.$transaction(async (tx) => {
    const v = await load(tx, id);
    if (v.status !== 'DRAFT') throw conflict('Only drafts can be deleted.');
    await tx.rulePackVersion.delete({ where: { id } });
    await audit(tx, actor, 'RULES_DELETED', v);
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------- review

/** Apply-scope check against the version it would replace (the cycle's published version, else its parent). */
async function scopeErrors(tx: Tx, v: RulePackVersion & { amendment: { applyScope: unknown } | null }): Promise<ExprError[]> {
  const base = (await tx.rulePackVersion.findFirst({ where: { cycleId: v.cycleId, status: 'PUBLISHED' } })) ?? (v.parentVersionId ? await tx.rulePackVersion.findUnique({ where: { id: v.parentVersionId } }) : null);
  if (!base) return [];
  const diff = await diffForPublish(tx, base, v);
  return checkApplyScope(diff, (v.amendment?.applyScope ?? {}) as ApplyScope);
}

export async function submitVersion(actor: RulesActor, id: string) {
  need(actor, 'RULE_EDITOR', 'Submitting for review');
  return prisma.$transaction(async (tx) => {
    const v = await load(tx, id);
    if (v.status !== 'DRAFT') throw conflict(`Version ${v.version} is not a draft.`);
    const check = validatePack(v.content);
    if (!check.ok) throw badRequest('Fix the errors before you submit for review.', { errors: check.errors });
    const extra = await scopeErrors(tx, v);
    if (extra.length) throw badRequest(extra[0]!.message, { errors: extra });
    const updated = await tx.rulePackVersion.update({ where: { id }, data: { status: 'IN_REVIEW', submittedById: actor.id, submittedAt: now(), rejectedRemarks: null } });
    await audit(tx, actor, 'RULES_SUBMITTED', v, { contentHash: v.contentHash });
    return updated;
  }, TX_OPTIONS);
}

/** Why `actor` may not check this version, or null. */
export async function approverConflict(actor: RulesActor, v: Pick<RulePackVersion, 'id' | 'createdById'>, db: Tx | typeof prisma = prisma): Promise<string | null> {
  if (v.createdById === actor.id) return 'You drafted this version, so another approver must review it.';
  if ((await makersOf(v.id, db)).includes(actor.id)) return 'You edited this version, so another approver must review it.';
  return null;
}

export async function approveVersion(actor: RulesActor, id: string, remarks?: string) {
  need(actor, 'RULE_APPROVER', 'Approving rules');
  return prisma.$transaction(async (tx) => {
    const v = await load(tx, id);
    if (v.status !== 'IN_REVIEW') throw conflict(`Version ${v.version} is not in review.`);
    const sod = await approverConflict(actor, v, tx);
    if (sod) throw forbidden(sod);
    const updated = await tx.rulePackVersion.update({ where: { id }, data: { status: 'APPROVED', approvedById: actor.id, approvedAt: now() } });
    await audit(tx, actor, 'RULES_APPROVED', v, { contentHash: v.contentHash }, remarks ?? null);
    return updated;
  }, TX_OPTIONS);
}

export async function rejectVersion(actor: RulesActor, id: string, remarks: string) {
  need(actor, 'RULE_APPROVER', 'Rejecting rules');
  if (!remarks?.trim()) throw badRequest('Give the maker your remarks.');
  return prisma.$transaction(async (tx) => {
    const v = await load(tx, id);
    if (v.status !== 'IN_REVIEW') throw conflict(`Version ${v.version} is not in review.`);
    const sod = await approverConflict(actor, v, tx);
    if (sod) throw forbidden(sod);
    const updated = await tx.rulePackVersion.update({ where: { id }, data: { status: 'REJECTED', rejectedRemarks: remarks.trim() } });
    await audit(tx, actor, 'RULES_REJECTED', v, {}, remarks.trim());
    return updated;
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------- publish

/**
 * Publish an APPROVED version: the cycle's current version becomes SUPERSEDED. Refused while effectiveFrom is in
 * the future, unless `scheduled`; then it is marked for the engine to publish on that date.
 */
export async function publishVersion(actor: RulesActor, id: string, opts: { scheduled?: boolean } = {}) {
  if (actor.role !== 'RULE_APPROVER' && actor.role !== 'SYSTEM') throw forbidden('Publishing needs the rule approver role.');
  const result = await prisma.$transaction(async (tx) => {
    const v = await load(tx, id);
    await advisoryXactLock(tx, `rules:cycle:${v.cycleId}`);
    if (v.status !== 'APPROVED') throw conflict(`Version ${v.version} must be approved before it is published.`);
    if (isoDate(v.effectiveFrom) > isoDate(today())) {
      if (!opts.scheduled) throw conflict(`Version ${v.version} takes effect on ${isoDate(v.effectiveFrom)}. Schedule the publication instead.`);
      const updated = await tx.rulePackVersion.update({ where: { id }, data: { scheduledPublish: true } });
      await audit(tx, actor, 'RULES_PUBLISH_SCHEDULED', v, { effectiveFrom: isoDate(v.effectiveFrom) });
      return { version: updated, previous: null, scheduled: true };
    }
    const previous = await tx.rulePackVersion.findFirst({ where: { cycleId: v.cycleId, status: 'PUBLISHED' } });
    if (previous) await tx.rulePackVersion.update({ where: { id: previous.id }, data: { status: 'SUPERSEDED' } });
    const updated = await tx.rulePackVersion.update({ where: { id }, data: { status: 'PUBLISHED', publishedById: actor.id, publishedAt: now(), scheduledPublish: false } });
    const current = await tx.rulePackVersion.findMany({ where: { status: 'PUBLISHED' }, select: { content: true } });
    await syncHolidays(tx, current.map((c) => c.content as unknown as PackContent));
    const rollbackOf = (v.content as unknown as PackContent).meta.rollbackOfVersionId ?? null;
    await audit(tx, actor, rollbackOf ? 'RULES_ROLLED_BACK' : 'RULES_PUBLISHED', v, { previousVersionId: previous?.id ?? null, contentHash: v.contentHash, ...(rollbackOf ? { rollbackOfVersionId: rollbackOf } : {}) });
    return { version: updated, previous, scheduled: false };
  }, TX_OPTIONS);
  if (result.scheduled) return { version: result.version, scheduled: true, rebased: 0, movedItems: 0 };
  await onPublished();
  // Live amendments move open cases forward, one transaction per case.
  const r = await rebaseAfterPublish(actor, result.version, result.previous ?? null);
  return { version: result.version, scheduled: false, ...r };
}

/** Engine: publish APPROVED versions marked as scheduled once their effectiveFrom has arrived. */
export async function publishScheduled(): Promise<number> {
  const due = await prisma.rulePackVersion.findMany({ where: { status: 'APPROVED', scheduledPublish: true, effectiveFrom: { lte: today() } }, select: { id: true, publishedById: true, approvedById: true } });
  for (const d of due) await publishVersion({ id: d.approvedById ?? 'system', role: 'SYSTEM' }, d.id);
  return due.length;
}

// ---------------------------------------------------------------- rollback, export, import

/** A new DRAFT whose content equals an older version of the same cycle. History is never edited. */
export async function draftRollback(actor: RulesActor, olderId: string, input: { effectiveFrom: string; summary?: string }) {
  need(actor, 'RULE_EDITOR', 'Drafting a rollback');
  const older = await prisma.rulePackVersion.findUnique({ where: { id: olderId }, include: { cycle: true } });
  if (!older) throw notFound('That version does not exist.');
  if (!['PUBLISHED', 'SUPERSEDED'].includes(older.status)) throw badRequest('Roll back only to a version that was published.');
  const current = await prisma.rulePackVersion.findFirst({ where: { cycleId: older.cycleId, status: 'PUBLISHED' } });
  if (!current) throw conflict('The cycle has no published version.');
  if (current.id === older.id) throw badRequest('That version is already the published one.');
  const content = older.content as unknown as PackContent;
  return createDraft(actor, {
    parentVersionId: current.id,
    effectiveFrom: input.effectiveFrom,
    content: { ...content, meta: { ...content.meta, rollbackOfVersionId: older.id } },
    amendment: {
      kind: 'CORRIGENDUM',
      refNo: `Rollback to ${older.cycle.code} v${older.version}`,
      issuedOn: isoDate(today()),
      title: `Rollback to ${older.cycle.code} v${older.version}`,
      summary: input.summary ?? `The rules return to those of version ${older.version}.`,
    },
  });
}

export const EXPORT_SCHEMA_VERSION = 1;

export async function exportVersion(actor: RulesActor, id: string) {
  const v = await prisma.rulePackVersion.findUnique({ where: { id }, include: { amendment: true, cycle: true } });
  if (!v) throw notFound('That rule pack version does not exist.');
  await prisma.$transaction((tx) => audit(tx, actor, 'RULES_EXPORTED', v, { contentHash: v.contentHash }));
  const a = v.amendment;
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    cycle: v.cycle.code,
    version: v.version,
    status: v.status,
    effectiveFrom: isoDate(v.effectiveFrom),
    content: v.content,
    amendment: a ? { kind: a.kind, refNo: a.refNo, issuedOn: isoDate(a.issuedOn), title: a.title, summary: a.summary, applyScope: a.applyScope } : null,
    contentHash: v.contentHash,
  };
}

/**
 * Import an exported JSON file as a new DRAFT of its cycle (parent: the cycle's published version). The content is
 * validated against the schema, nothing in it is executed, and the hash is recomputed (a mismatch is reported).
 */
export async function importVersion(actor: RulesActor, file: unknown) {
  need(actor, 'RULE_EDITOR', 'Importing rules');
  const f = file as { schemaVersion?: unknown; cycle?: unknown; content?: unknown; amendment?: Partial<AmendmentInput> | null; effectiveFrom?: unknown; contentHash?: unknown };
  if (!f || typeof f !== 'object' || f.schemaVersion !== EXPORT_SCHEMA_VERSION) throw badRequest(`Import a file exported by this system (schemaVersion ${EXPORT_SCHEMA_VERSION}).`);
  const check = validatePack(f.content);
  if (!check.ok) throw badRequest('The imported rules are not valid.', { errors: check.errors });
  const cycleCode = String(f.cycle ?? check.pack.meta.cycle);
  const cycle = await prisma.approvalCycle.findUnique({ where: { code: cycleCode } });
  if (!cycle) throw badRequest(`Cycle ${cycleCode} does not exist here. Create it first.`);
  const parent = await prisma.rulePackVersion.findFirst({ where: { cycleId: cycle.id, status: 'PUBLISHED' } });
  if (!parent) throw badRequest(`Cycle ${cycleCode} has no published version to build on.`);
  const recomputed = contentHash(check.pack);
  const a = f.amendment ?? {};
  const v = await createDraft(actor, {
    parentVersionId: parent.id,
    effectiveFrom: typeof f.effectiveFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.effectiveFrom) ? f.effectiveFrom : isoDate(today()),
    content: check.pack,
    action: 'RULES_IMPORTED',
    amendment: {
      kind: (a.kind ?? 'CIRCULAR') as AmendmentKind,
      refNo: String(a.refNo ?? 'Imported'),
      issuedOn: typeof a.issuedOn === 'string' ? a.issuedOn : isoDate(today()),
      title: String(a.title ?? 'Imported rules'),
      summary: String(a.summary ?? 'Imported from a JSON file.'),
      applyScope: (a.applyScope ?? {}) as AmendmentInput['applyScope'],
    },
  });
  return { version: v, hashMatched: f.contentHash === recomputed };
}
