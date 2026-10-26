// The only way to change a case (section 0.4): every action runs in one interactive transaction that does
// (1) case or record changes, (2) assignments, (3) deadline items, (4) the audit row, (5) notifications.
import type { AppType, Application, Prisma, Stage, TaskType } from '@prisma/client';
import { z } from 'zod';
import type { AuthUser } from '../auth/middleware.js';
import { prisma, TX_OPTIONS, type Tx } from '../lib/db.js';
import { now, today } from '../lib/clock.js';
import { formatDate, parseDateOnly, toDateOnly } from '../lib/dates.js';
import { addWorkingDays } from '../lib/workdays.js';
import { appendAudit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { parse } from '../lib/http.js';
import { removeStored, saveBuffer, type StoredFile } from '../lib/storage.js';
import { forApplication, rulesForApp } from '../rules/service.js';
import { filingContext } from '../rules/filing.js';
import type { EvalContext, ResolvedRules } from '../rules/resolved.js';
import { assign, release, taskLabel } from '../assignment/engine.js';
import { proposeCommittee } from '../assignment/committee.js';
import { can } from '../policy/can.js';
import { logAccessDenied } from '../policy/roles.js';
import { regionAuthority } from '../policy/subtree.js';
import { nextStage, STAGE_LABEL } from './routing.js';
import { closeItems, openItem, pauseStageItem, resumeStageItem, startStageClock, syncResponsible } from './deadlines.js';
import { nextApplicationNo } from './appno.js';
import { type CaseAction, transitionFor } from './transitions.js';
import { formValuesSchema, requiredMissing, type FormValues } from '../formcheck/features.js';
import { validateForm } from '../formcheck/service.js';

export interface UploadInput {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  kind: string;
  expiryDate?: string | null;
}

type Actor = { id: string; role: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

function snapshot(app: Pick<Application, 'stage' | 'status' | 'holderType' | 'holderUserId'>) {
  return { stage: app.stage, status: app.status, holderType: app.holderType, holderUserId: app.holderUserId };
}

async function collegeUserIds(tx: Tx, institutionId: string): Promise<string[]> {
  return (await tx.user.findMany({ where: { institutionId, role: 'COLLEGE', active: true }, select: { id: true } })).map((u) => u.id);
}

/** Latest (non-superseded) document per kind for an application. */
export async function currentDocuments(tx: Tx | typeof prisma, applicationId: string) {
  const docs = await tx.document.findMany({ where: { applicationId }, orderBy: { uploadedAt: 'asc' } });
  const superseded = new Set(docs.map((d) => d.supersedesId).filter(Boolean));
  const latest = new Map<string, (typeof docs)[number]>();
  for (const d of docs) if (!superseded.has(d.id)) latest.set(d.kind, d);
  return [...latest.values()];
}

/**
 * Enter a stage: set the pointer, assign the stage task (or hand to the authority), start the stage clock.
 * Caller has already written the case changes it owns and writes its own audit row.
 */
async function enterStage(tx: Tx, app: Application, stage: Stage, actor: Actor | null, opts: { taskType?: TaskType } = {}) {
  await tx.application.update({
    where: { id: app.id },
    data: {
      stage,
      status: 'IN_STAGE',
      stageEnteredAt: now(),
      evcScheduled: stage === 'EVC' ? false : app.evcScheduled,
      sacForwarded: stage === 'SAC_SHC' ? false : app.sacForwarded,
      holderType: 'NONE',
      holderUserId: null,
    },
  });
  const task = { applicationId: app.id, regionId: app.regionId, category: app.category };
  switch (stage) {
    case 'SCRUTINY':
      await assign(tx, { ...task, taskType: opts.taskType ?? 'SCRUTINY', previousOfficerId: app.previousOfficerId }, actor);
      break;
    case 'EVC':
      await tx.evcVisit.upsert({
        where: { applicationId: app.id },
        create: { applicationId: app.id, proposedMemberIds: [], memberIds: [], status: 'UNSCHEDULED' },
        update: { proposedMemberIds: [], memberIds: [], status: 'UNSCHEDULED', visitDate: null, mode: null, checklist: undefined, recommendation: null, reportText: null, reportedById: null, reportedAt: null },
      });
      await assign(tx, { ...task, taskType: 'EVC_DESK' }, actor);
      break;
    case 'SAC_SHC':
      await assign(tx, { ...task, taskType: 'SAC_SHC_FORWARD' }, actor);
      break;
    case 'DECISION': {
      await tx.application.update({ where: { id: app.id }, data: { holderType: 'AUTHORITY', holderUserId: null } });
      const authority = await regionAuthority(app.regionId, tx);
      if (authority) {
        await notify(tx, [authority], { applicationId: app.id, kind: 'DECISION_DUE', message: `${app.applicationNo} is ready for your decision.` });
      }
      break;
    }
  }
  await startStageClock(tx, app.id, stage);
}

/** Move to the next stage in the stored route (or nowhere if the route is exhausted — never happens before DECISION). */
async function advance(tx: Tx, app: Application, actor: Actor) {
  const route = app.route as Stage[];
  const next = nextStage(route, app.stage);
  if (!next) throw new HttpError(500, 'Route has no next stage.');
  await enterStage(tx, app, next, actor);
  return next;
}

async function releaseOpen(tx: Tx, applicationId: string, taskTypes: TaskType[], reason: string, actor: Actor) {
  const open = await tx.assignment.findMany({ where: { applicationId, releasedAt: null, taskType: { in: taskTypes } } });
  for (const a of open) await release(tx, a.id, reason, actor);
  return open;
}

function storeUploads(files: UploadInput[]): Promise<StoredFile[]> {
  return Promise.all(files.map((f) => saveBuffer(f.buffer, f.originalname, f.mimetype)));
}

// ---------------------------------------------------------------- SUBMIT

export const submitSchema = z.object({
  type: z.enum(['NEW_INSTITUTION', 'EXTENSION', 'NAME_CHANGE', 'INTAKE_INCREASE', 'CHANGE_OF_SITE', 'VERIFICATION_VISIT', 'RESTORATION']),
  formData: formValuesSchema,
  draftId: z.string().min(4).max(80),
  justification: z.string().trim().max(4000).optional(),
});

/** Server-side options (never from a request body): seed history pins to a given version. */
export interface SubmitOptions {
  pin?: { cycleId: string; rulePackVersionId: string };
  ignoreSchedule?: boolean;
}

export async function submitApplication(user: AuthUser, input: z.infer<typeof submitSchema>, files: UploadInput[], opts: SubmitOptions = {}) {
  if (user.role !== 'COLLEGE' || !user.institutionId) {
    await logAccessDenied(user, { action: 'SUBMIT', reason: 'Only colleges can submit applications.' });
    throw forbidden('Only colleges can submit applications.');
  }
  const type = input.type as AppType;
  const institution = await prisma.institution.findUniqueOrThrow({ where: { id: user.institutionId } });

  // The cycle and rule pack version this filing is pinned to for its whole life.
  const fc = await filingContext(institution.id, type, input.formData as Record<string, unknown>, { ignoreSchedule: opts.ignoreSchedule });
  let r: ResolvedRules;
  let pin = opts.pin;
  if (pin) {
    r = await forApplication(pin);
  } else {
    if (!fc.filing.ok) throw badRequest(fc.filing.message);
    r = fc.filing.rules;
    pin = { cycleId: fc.filing.cycleId, rulePackVersionId: r.pinned.id };
  }
  if (!r.hasType(type)) throw badRequest(`This application type is not accepted under rules ${r.label}.`);
  const cfg = r.type(type);
  const ctx: EvalContext = { ...fc.facts, programme: r.programme(fc.facts.programmeCode) };

  // Purview and eligibility (expressions of the pinned version).
  if (fc.facts.programmeCode) {
    const p = r.programme(fc.facts.programmeCode);
    if (!p) throw badRequest(`Programme ${fc.facts.programmeCode} is not offered under rules ${r.label}.`);
    if (!r.test(p.inPurview, ctx)) throw badRequest(`${p.label} at your institution is outside the purview of rules ${r.label}.`);
  }
  if (!r.test(cfg.eligibility, ctx)) {
    throw badRequest(
      !fc.hasPriorApproval && JSON.stringify(cfg.eligibility).includes('hasPriorApproval')
        ? `${cfg.label} needs at least one earlier approval for your institution.`
        : `Your institution is not eligible for ${cfg.label.toLowerCase()} under rules ${r.label}.`,
    );
  }
  const openSame = await prisma.application.count({ where: { institutionId: institution.id, type, status: { in: ['IN_STAGE', 'RETURNED'] } } });
  if (openSame > 0) throw conflict(`Your institution already has an open ${cfg.label.toLowerCase()} application.`);

  // Hard validation and critical documents.
  const values: FormValues = { ...input.formData, documents: files.map((f) => f.kind) };
  const missing = requiredMissing(r, type, values, ctx);
  if (missing.length) throw badRequest(missing.map((m) => m.message).join(' '), { fields: missing });
  const docRules = r.documents(type, ctx);
  const known = new Map(docRules.map((d) => [d.kind, d]));
  for (const f of files) {
    const d = known.get(f.kind);
    if (!d) throw badRequest(`${f.originalname}: ${f.kind} is not a document for this application type.`);
    if (d.hasExpiry && d.critical && !f.expiryDate) throw badRequest(`Enter the expiry date for the ${d.label.toLowerCase()}.`);
    if (f.expiryDate) parse(isoDate, f.expiryDate);
  }
  const missingCritical = docRules.filter((d) => d.critical && !files.some((f) => f.kind === d.kind));
  if (missingCritical.length) {
    throw badRequest(`Attach the missing critical documents: ${missingCritical.map((d) => d.label).join(', ')}.`, { missingDocuments: missingCritical.map((d) => d.kind) });
  }

  // Latest form check for this draft (run one now if the client never did).
  let check = await prisma.formCheckResult.findFirst({ where: { draftId: input.draftId, institutionId: institution.id }, orderBy: { createdAt: 'desc' } });
  if (!check) {
    const v = await validateForm(user, { draftId: input.draftId, type, values }, prisma, r);
    check = await prisma.formCheckResult.findUniqueOrThrow({ where: { id: v.id } });
  }
  const justification = input.justification?.trim() || null;
  if (check.severity !== 'NONE' && !justification) {
    throw badRequest('Explain the warnings from "Check my entries" before you submit.', { justificationRequired: true, formCheckId: check.id });
  }

  const stored = await storeUploads(files);
  try {
    return await prisma.$transaction(async (tx) => {
      const route = r.route(type, { ...ctx, formData: values as Record<string, unknown> }) as Stage[];
      const { category, categoryRank } = cfg;
      const at = now();
      const applicationNo = await nextApplicationNo(tx, institution.regionId);
      const { documents: _docs, ...formData } = values;
      const app = await tx.application.create({
        data: {
          applicationNo,
          institutionId: institution.id,
          regionId: institution.regionId,
          type,
          cycleId: pin.cycleId,
          rulePackVersionId: pin.rulePackVersionId,
          category,
          categoryRank,
          route,
          stage: route[0]!,
          status: 'IN_STAGE',
          holderType: 'NONE',
          submittedAt: at,
          stageEnteredAt: at,
          lastActionAt: at,
          formData: formData as Prisma.InputJsonValue,
        },
      });
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        const s = stored[i]!;
        await tx.document.create({
          data: {
            applicationId: app.id,
            institutionId: institution.id,
            kind: f.kind,
            fileName: s.fileName,
            storedName: s.storedName,
            mimeType: s.mimeType,
            size: s.size,
            uploadedById: user.id,
            uploadedAt: at,
            expiryDate: f.expiryDate ? parseDateOnly(f.expiryDate) : null,
          },
        });
      }
      await tx.formCheckResult.update({ where: { id: check!.id }, data: { applicationId: app.id, justification } });
      // Earlier checks on the same draft are linked too, so the officer sees the history.
      await tx.formCheckResult.updateMany({ where: { draftId: input.draftId, institutionId: institution.id, applicationId: null }, data: { applicationId: app.id } });
      await appendAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'SUBMIT',
        applicationId: app.id,
        fromState: null,
        toState: { stage: app.stage, status: app.status },
        meta: { applicationNo, type, route, formCheckId: check!.id, severity: check!.severity, documents: files.map((f) => f.kind), rules: r.label, rulePackVersionId: r.pinned.id },
      });
      if (justification) {
        await appendAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: 'FORM_CHECK_JUSTIFIED',
          applicationId: app.id,
          reason: justification,
          meta: { formCheckId: check!.id, severity: check!.severity },
        });
      }
      await enterStage(tx, app, route[0]!, { id: user.id, role: user.role });
      await notify(tx, await collegeUserIds(tx, institution.id), {
        applicationId: app.id,
        kind: 'SUBMITTED',
        message: `${applicationNo} submitted. It is now with ${STAGE_LABEL[route[0]!].toLowerCase()}.`,
      });
      return app.id;
    }, TX_OPTIONS);
  } catch (e) {
    await removeStored(stored.map((s) => s.storedName));
    throw e;
  }
}

// ---------------------------------------------------------------- case actions

const schemas = {
  COMPLETE_STAGE: z.object({ reason: z.string().trim().max(2000).optional() }),
  RETURN: z.object({
    reason: z.string().trim().min(1, 'Enter a reason').max(2000),
    payload: z.object({ items: z.array(z.string().trim().min(1).max(200)).min(1, 'Choose at least one deficiency item').max(20) }),
  }),
  REPLY: z.object({
    payload: z.object({ note: z.string().trim().min(1, 'Enter a reply note').max(4000), documentIds: z.array(z.string().uuid()).max(20).optional() }),
  }),
  SCHEDULE_EVC: z.object({
    payload: z.object({
      memberIds: z.array(z.string().uuid()).length(3, 'Choose three committee members'),
      visitDate: isoDate,
      mode: z.enum(['ONLINE', 'PHYSICAL']),
    }),
    reason: z.string().trim().max(2000).optional(),
  }),
  SUBMIT_EVC_REPORT: z.object({
    payload: z.object({
      checklist: z.record(z.string().max(60), z.boolean()).refine((c) => Object.keys(c).length === 5, 'Answer all five checklist items'),
      recommendation: z.enum(['RECOMMEND_APPROVAL', 'RECOMMEND_CONDITIONS', 'RECOMMEND_REJECTION']),
      reportText: z.string().trim().min(1, 'Enter the report').max(8000),
    }),
  }),
  FORWARD_SAC_SHC: z.object({ payload: z.object({ note: z.string().trim().min(1, 'Enter a note').max(4000) }) }),
  SUBMIT_RECOMMENDATION: z.object({ payload: z.object({ text: z.string().trim().min(1, 'Enter the recommendation').max(8000) }) }),
  REVERT: z.object({ reason: z.string().trim().min(1, 'Enter a reason').max(2000) }),
  DECIDE: z
    .object({
      reason: z.string().trim().min(1, 'Enter a reason').max(4000),
      payload: z.object({
        outcome: z.enum(['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED']),
        conditions: z.array(z.object({ condition: z.string().trim().min(1).max(500), dueDate: isoDate })).max(20).optional(),
      }),
    })
    .refine((v) => v.payload.outcome !== 'APPROVED_WITH_CONDITIONS' || (v.payload.conditions?.length ?? 0) > 0, {
      message: 'Add at least one condition with a due date',
      path: ['payload', 'conditions'],
    }),
} satisfies Record<CaseAction, z.ZodTypeAny>;

export const actionBodySchema = z.object({
  action: z.enum(['COMPLETE_STAGE', 'RETURN', 'REPLY', 'SCHEDULE_EVC', 'SUBMIT_EVC_REPORT', 'FORWARD_SAC_SHC', 'SUBMIT_RECOMMENDATION', 'REVERT', 'DECIDE']),
  reason: z.string().optional(),
  payload: z.unknown().optional(),
});

export async function performAction(user: AuthUser, applicationId: string, action: CaseAction, body: { reason?: string; payload?: unknown }, files: UploadInput[] = []) {
  const input = parse(schemas[action] as z.ZodTypeAny, body) as Record<string, unknown> & { reason?: string; payload?: Record<string, unknown> };
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) throw notFound();
  const decision = await can(user, action, app);
  if (!decision.ok) {
    await logAccessDenied(user, { applicationId, action, reason: decision.reason });
    throw new HttpError(decision.status, decision.status === 404 ? "You don't have access to this page." : decision.reason);
  }
  const stored = action === 'REPLY' ? await storeUploads(files) : [];
  try {
    await prisma.$transaction(async (tx) => {
      // Lock the row, re-read and re-check the state (another action may have moved the case).
      await tx.$executeRaw`SELECT id FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;
      const cur = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
      if (!transitionFor(action).from(cur)) throw conflict('This application has moved on since you opened it. Reload the page.');
      const from = snapshot(cur);
      const result = await handlers[action](tx, user, cur, input, files, stored);
      const after = await tx.application.update({ where: { id: applicationId }, data: { lastActionAt: now() } });
      await appendAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action,
        applicationId,
        fromState: from,
        toState: snapshot(after),
        reason: input.reason ?? result.reason ?? null,
        meta: result.meta ?? {},
      });
      for (const n of result.notifications ?? []) await notify(tx, n.userIds, { applicationId, kind: action, message: n.message });
    }, TX_OPTIONS);
  } catch (e) {
    await removeStored(stored.map((s) => s.storedName));
    throw e;
  }
}

interface HandlerResult {
  reason?: string;
  meta?: Record<string, unknown>;
  notifications?: { userIds: string[]; message: string }[];
}

type Handler = (tx: Tx, user: AuthUser, app: Application, input: Record<string, any>, files: UploadInput[], stored: StoredFile[]) => Promise<HandlerResult>;

const handlers: Record<CaseAction, Handler> = {
  async COMPLETE_STAGE(tx, user, app) {
    const actor = { id: user.id, role: user.role };
    await closeItems(tx, app.id, ['STAGE_SLA'], 'outcome');
    // Scrutiny verifies the documents on file.
    const docs = await currentDocuments(tx, app.id);
    await tx.document.updateMany({ where: { id: { in: docs.map((d) => d.id) }, verified: false }, data: { verified: true, verifiedById: user.id, verifiedAt: now() } });
    await releaseOpen(tx, app.id, ['SCRUTINY', 'RE_SCRUTINY'], 'COMPLETED', actor);
    const next = await advance(tx, app, actor);
    return { meta: { nextStage: next, verifiedDocuments: docs.length } };
  },

  async RETURN(tx, user, app, input) {
    const actor = { id: user.id, role: user.role };
    const items: string[] = input.payload.items;
    await tx.deficiency.create({ data: { applicationId: app.id, items, reason: input.reason, raisedById: user.id, raisedAt: now() } });
    await tx.application.update({ where: { id: app.id }, data: { status: 'RETURNED', holderType: 'COLLEGE', holderUserId: null, previousOfficerId: user.id } });
    const paused = await pauseStageItem(tx, app.id);
    await releaseOpen(tx, app.id, ['SCRUTINY', 'RE_SCRUTINY'], 'RETURNED', actor);
    if (paused) await tx.deadlineItem.update({ where: { id: paused.id }, data: { responsibleUserId: user.id } });
    return {
      meta: { items, pausedRemaining: paused?.pausedRemaining ?? null },
      notifications: [
        {
          userIds: await collegeUserIds(tx, app.institutionId),
          message: `${app.applicationNo} was returned by the scrutiny officer: ${input.reason} Reply with the items asked for; the clock is paused until you do.`,
        },
      ],
    };
  },

  async REPLY(tx, user, app, input, files, stored) {
    const actor = { id: user.id, role: user.role };
    const at = now();
    const current = await currentDocuments(tx, app.id);
    const byKind = new Map(current.map((d) => [d.kind, d]));
    const newIds: string[] = [];
    const known = new Map((await rulesForApp(app, tx)).documents(app.type, { formData: app.formData as Record<string, unknown> }).map((d) => [d.kind, d]));
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const s = stored[i]!;
      if (!known.has(f.kind)) throw badRequest(`${f.kind} is not a document for this application type.`);
      if (known.get(f.kind)!.hasExpiry && known.get(f.kind)!.critical && !f.expiryDate) throw badRequest(`Enter the expiry date for the ${known.get(f.kind)!.label.toLowerCase()}.`);
      const d = await tx.document.create({
        data: {
          applicationId: app.id,
          institutionId: app.institutionId,
          kind: f.kind,
          fileName: s.fileName,
          storedName: s.storedName,
          mimeType: s.mimeType,
          size: s.size,
          uploadedById: user.id,
          uploadedAt: at,
          expiryDate: f.expiryDate ? parseDateOnly(f.expiryDate) : null,
          supersedesId: byKind.get(f.kind)?.id ?? null,
        },
      });
      newIds.push(d.id);
    }
    const linked = input.payload.documentIds ?? [];
    if (linked.length) {
      const ok = await tx.document.count({ where: { id: { in: linked }, applicationId: app.id } });
      if (ok !== linked.length) throw badRequest('One of the documents does not belong to this application.');
    }
    const def = await tx.deficiency.findFirst({ where: { applicationId: app.id, resolvedAt: null }, orderBy: { raisedAt: 'desc' } });
    if (def) {
      await tx.deficiency.update({ where: { id: def.id }, data: { resolvedAt: at, replyNote: input.payload.note, replyDocumentIds: [...linked, ...newIds] } });
    }
    await tx.application.update({ where: { id: app.id }, data: { status: 'IN_STAGE', holderType: 'NONE', holderUserId: null } });
    const resumed = await resumeStageItem(tx, app.id);
    await assign(tx, { applicationId: app.id, regionId: app.regionId, category: app.category, taskType: 'RE_SCRUTINY', previousOfficerId: app.previousOfficerId }, actor);
    return { reason: input.payload.note, meta: { documents: [...linked, ...newIds], resumedDue: resumed?.dueDate ?? null } };
  },

  async SCHEDULE_EVC(tx, user, app, input) {
    const actor = { id: user.id, role: user.role };
    const visitDate = parseDateOnly(input.payload.visitDate);
    if (visitDate < today()) throw badRequest('The visit date cannot be in the past.');
    const memberIds: string[] = input.payload.memberIds;
    if (new Set(memberIds).size !== 3) throw badRequest('Choose three different committee members.');
    const members = await tx.user.findMany({ where: { id: { in: memberIds }, role: 'COMMITTEE', active: true } });
    if (members.length !== 3) throw badRequest('Every member must be an active committee member.');
    const away = await tx.officerAvailability.findMany({ where: { userId: { in: memberIds }, startsOn: { lte: visitDate }, endsOn: { gte: visitDate } } });
    if (away.length) {
      const names = members.filter((m) => away.some((a) => a.userId === m.id)).map((m) => m.name);
      throw badRequest(`${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} not available on ${formatDate(visitDate)}.`);
    }
    const { proposal } = await proposeCommittee(app.id, visitDate, tx);
    const r = await rulesForApp(app, tx);
    const evc = r.committee('EVC');
    const appointedUnder = `${evc?.appointingAuthority ?? 'Appointing authority not set'} · rules ${r.operational.cycleCode} v${r.operational.version}`;
    await tx.evcVisit.update({
      where: { applicationId: app.id },
      data: { proposedMemberIds: proposal.map((p) => p.userId), memberIds, visitDate, mode: input.payload.mode, status: 'SCHEDULED', appointedUnder },
    });
    await tx.application.update({ where: { id: app.id }, data: { evcScheduled: true, holderType: 'COMMITTEE', holderUserId: null } });
    await closeItems(tx, app.id, ['EVC_SCHEDULE'], 'outcome');
    await releaseOpen(tx, app.id, ['EVC_DESK'], 'COMPLETED', actor);
    const days = r.timelines.EVC_REPORT;
    await openItem(tx, { applicationId: app.id, type: 'EVC_REPORT', dueDate: addWorkingDays(visitDate, days), unit: 'WORKING', totalDays: days });
    const changed = proposal.map((p) => p.userId).join() !== memberIds.join();
    return {
      meta: { visitDate: input.payload.visitDate, mode: input.payload.mode, memberIds, proposedMemberIds: proposal.map((p) => p.userId), changedFromProposal: changed, appointedUnder },
      notifications: [
        { userIds: memberIds, message: `EVC visit for ${app.applicationNo} on ${formatDate(visitDate)} (${input.payload.mode === 'ONLINE' ? 'online' : 'physical'}). Submit the report within ${days} working days of the visit.` },
        { userIds: await collegeUserIds(tx, app.institutionId), message: `The expert visit for ${app.applicationNo} is scheduled for ${formatDate(visitDate)} (${input.payload.mode === 'ONLINE' ? 'online' : 'physical'}).` },
      ],
    };
  },

  async SUBMIT_EVC_REPORT(tx, user, app, input) {
    const actor = { id: user.id, role: user.role };
    const visit = await tx.evcVisit.findUniqueOrThrow({ where: { applicationId: app.id } });
    if (visit.visitDate && toDateOnly(visit.visitDate) > today()) throw badRequest(`The report can be submitted on or after the visit date (${formatDate(visit.visitDate)}).`);
    await tx.evcVisit.update({
      where: { applicationId: app.id },
      data: { status: 'REPORTED', checklist: input.payload.checklist, recommendation: input.payload.recommendation, reportText: input.payload.reportText, reportedById: user.id, reportedAt: now() },
    });
    await closeItems(tx, app.id, ['EVC_REPORT'], 'outcome');
    const next = await advance(tx, app, actor);
    return { reason: input.payload.recommendation, meta: { recommendation: input.payload.recommendation, nextStage: next } };
  },

  async FORWARD_SAC_SHC(tx, user, app, input) {
    const actor = { id: user.id, role: user.role };
    await tx.application.update({ where: { id: app.id }, data: { sacForwarded: true, holderType: 'COMMITTEE', holderUserId: null } });
    await releaseOpen(tx, app.id, ['SAC_SHC_FORWARD'], 'COMPLETED', actor);
    await syncResponsible(tx, app.id);
    const committee = (await tx.user.findMany({ where: { role: 'COMMITTEE', active: true }, select: { id: true } })).map((u) => u.id);
    return {
      reason: input.payload.note,
      notifications: [{ userIds: committee, message: `${app.applicationNo} was forwarded to SAC/SHC for a recommendation.` }],
    };
  },

  async SUBMIT_RECOMMENDATION(tx, user, app, input) {
    const actor = { id: user.id, role: user.role };
    await tx.recommendation.create({ data: { applicationId: app.id, committeeRole: 'SAC_SHC', memberId: user.id, text: input.payload.text, at: now() } });
    await closeItems(tx, app.id, ['STAGE_SLA'], 'outcome');
    const next = await advance(tx, app, actor);
    return { reason: input.payload.text, meta: { nextStage: next } };
  },

  async REVERT(tx, user, app) {
    const actor = { id: user.id, role: user.role };
    await closeItems(tx, app.id, ['STAGE_SLA', 'EVC_SCHEDULE', 'EVC_REPORT'], 'closed');
    await releaseOpen(tx, app.id, ['EVC_DESK', 'SAC_SHC_FORWARD', 'SCRUTINY', 'RE_SCRUTINY'], 'REVERTED', actor);
    if (app.stage === 'EVC') {
      await tx.evcVisit.updateMany({ where: { applicationId: app.id }, data: { status: 'UNSCHEDULED', memberIds: [], visitDate: null } });
    }
    await tx.application.update({ where: { id: app.id }, data: { evcScheduled: false, sacForwarded: false, previousOfficerId: null } });
    const fresh = await tx.application.findUniqueOrThrow({ where: { id: app.id } });
    await enterStage(tx, fresh, 'SCRUTINY', actor);
    return { meta: { fromStage: app.stage } };
  },

  async DECIDE(tx, user, app, input) {
    const outcome: 'APPROVED' | 'APPROVED_WITH_CONDITIONS' | 'REJECTED' = input.payload.outcome;
    const at = now();
    await tx.decision.create({ data: { applicationId: app.id, outcome, reason: input.reason, decidedById: user.id, at } });
    await tx.application.update({ where: { id: app.id }, data: { status: outcome, holderType: 'NONE', holderUserId: null } });
    await closeItems(tx, app.id, ['STAGE_SLA'], 'outcome');
    const created: { id: string; condition: string; dueDate: string }[] = [];
    if (outcome === 'APPROVED_WITH_CONDITIONS') {
      for (const c of input.payload.conditions as { condition: string; dueDate: string }[]) {
        const due = parseDateOnly(c.dueDate);
        if (due <= today()) throw badRequest(`The due date for "${c.condition}" must be in the future.`);
        const u = await tx.undertaking.create({ data: { applicationId: app.id, condition: c.condition, dueDate: due, status: 'OPEN' } });
        await openItem(tx, { applicationId: app.id, type: 'UNDERTAKING', sourceId: u.id, dueDate: due, unit: 'CALENDAR' });
        created.push({ id: u.id, condition: c.condition, dueDate: c.dueDate });
      }
    }
    if (outcome !== 'REJECTED') {
      const docs = await currentDocuments(tx, app.id);
      for (const d of docs.filter((x) => x.verified && x.expiryDate)) {
        await openItem(tx, { applicationId: app.id, type: 'DOC_EXPIRY', sourceId: d.id, dueDate: d.expiryDate!, unit: 'CALENDAR' });
      }
    }
    const label = outcome === 'APPROVED' ? 'approved' : outcome === 'APPROVED_WITH_CONDITIONS' ? 'approved with conditions' : 'rejected';
    return {
      meta: { outcome, conditions: created },
      notifications: [
        {
          userIds: await collegeUserIds(tx, app.institutionId),
          message: `${app.applicationNo} was ${label} by the competent authority.${created.length ? ` ${created.length} ${created.length === 1 ? 'undertaking is' : 'undertakings are'} due; see Compliance.` : ''}`,
        },
      ],
    };
  },
};

/** Reasons a college sees for an action label. */
export function actionLabel(a: CaseAction): string {
  return transitionFor(a).label;
}

export { taskLabel };

// ---------------------------------------------------------------- compliance actions (no stage change)

async function denied(user: AuthUser, applicationId: string, action: string, reason: string, status: 403 | 404 = 403): Promise<never> {
  await logAccessDenied(user, { applicationId, action, reason });
  throw new HttpError(status, status === 404 ? "You don't have access to this page." : reason);
}

async function holdsVerify(tx: Tx | typeof prisma, applicationId: string, userId: string, refId: string) {
  return tx.assignment.findFirst({ where: { applicationId, officerId: userId, releasedAt: null, taskType: 'VERIFY', taskRefId: refId } });
}

function single(file: UploadInput | undefined): UploadInput {
  if (!file) throw badRequest('Choose a file to upload.');
  return file;
}

/** College uploads evidence for an undertaking → SUBMITTED, VERIFY task, VERIFICATION item (5 working days). */
export async function uploadEvidence(user: AuthUser, undertakingId: string, file: UploadInput | undefined, note?: string) {
  const u = await prisma.undertaking.findUnique({ where: { id: undertakingId }, include: { application: true } });
  if (!u) throw notFound();
  const app = u.application;
  if (user.role !== 'COLLEGE' || user.institutionId !== app.institutionId) return denied(user, app.id, 'UPLOAD_EVIDENCE', 'Only the institution can upload evidence.', 404);
  if (u.status !== 'OPEN') throw conflict(u.status === 'SUBMITTED' ? 'Evidence is already waiting for verification.' : 'This undertaking is already verified.');
  const f = single(file);
  const s = await saveBuffer(f.buffer, f.originalname, f.mimetype);
  try {
    await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: { applicationId: app.id, institutionId: app.institutionId, kind: 'UNDERTAKING_EVIDENCE', ...s, uploadedById: user.id, uploadedAt: now() },
      });
      await tx.undertaking.update({ where: { id: u.id }, data: { status: 'SUBMITTED', evidenceDocId: doc.id, remarks: null } });
      await assign(tx, { applicationId: app.id, regionId: app.regionId, taskType: 'VERIFY', category: app.category, taskRefId: u.id }, user);
      const days = (await rulesForApp(app, tx)).timelines.VERIFICATION;
      await openItem(tx, { applicationId: app.id, type: 'VERIFICATION', sourceId: u.id, dueDate: addWorkingDays(today(), days), unit: 'WORKING', totalDays: days });
      await tx.application.update({ where: { id: app.id }, data: { lastActionAt: now() } });
      await appendAudit(tx, { actorId: user.id, actorRole: user.role, action: 'UPLOAD_EVIDENCE', applicationId: app.id, reason: note ?? null, meta: { undertakingId: u.id, condition: u.condition, documentId: doc.id } });
    }, TX_OPTIONS);
  } catch (e) {
    await removeStored([s.storedName]);
    throw e;
  }
}

/** Officer holding the VERIFY task accepts (VERIFIED, maybe CLOSED) or rejects (back to OPEN, college notified). */
export async function verifyEvidence(user: AuthUser, undertakingId: string, input: { accept: boolean; remarks?: string }) {
  const u = await prisma.undertaking.findUnique({ where: { id: undertakingId }, include: { application: true } });
  if (!u) throw notFound();
  const app = u.application;
  if (!(await holdsVerify(prisma, app.id, user.id, u.id))) return denied(user, app.id, 'VERIFY_EVIDENCE', 'Only the officer holding the verification task can verify this evidence.');
  if (u.status !== 'SUBMITTED') throw conflict('There is no evidence waiting for verification.');
  if (!input.accept && !input.remarks?.trim()) throw badRequest('Enter remarks that tell the college what is wrong.');
  await prisma.$transaction(async (tx) => {
    const task = (await holdsVerify(tx, app.id, user.id, u.id))!;
    await tx.undertaking.update({
      where: { id: u.id },
      data: input.accept ? { status: 'VERIFIED', verifiedById: user.id, verifiedAt: now(), remarks: input.remarks ?? null } : { status: 'OPEN', remarks: input.remarks!.trim() },
    });
    if (input.accept && u.evidenceDocId) await tx.document.update({ where: { id: u.evidenceDocId }, data: { verified: true, verifiedById: user.id, verifiedAt: now() } });
    await closeItems(tx, app.id, ['VERIFICATION'], 'outcome', u.id);
    if (input.accept) await closeItems(tx, app.id, ['UNDERTAKING'], 'outcome', u.id);
    await release(tx, task.id, 'COMPLETED', user);
    await tx.application.update({ where: { id: app.id }, data: { lastActionAt: now() } });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: 'VERIFY_EVIDENCE',
      applicationId: app.id,
      reason: input.remarks ?? null,
      meta: { undertakingId: u.id, accept: input.accept },
    });
    const colleges = await collegeUserIds(tx, app.institutionId);
    if (!input.accept) {
      await notify(tx, colleges, { applicationId: app.id, kind: 'EVIDENCE_REJECTED', message: `Evidence for "${u.condition}" on ${app.applicationNo} was not accepted: ${input.remarks!.trim()} Upload new evidence by ${formatDate(u.dueDate)}.` });
      return;
    }
    await notify(tx, colleges, { applicationId: app.id, kind: 'EVIDENCE_VERIFIED', message: `Evidence for "${u.condition}" on ${app.applicationNo} was verified.` });
    // The last undertaking verified closes an approved-with-conditions case.
    const remaining = await tx.undertaking.count({ where: { applicationId: app.id, status: { not: 'VERIFIED' } } });
    if (remaining === 0 && app.status === 'APPROVED_WITH_CONDITIONS') {
      await tx.application.update({ where: { id: app.id }, data: { status: 'CLOSED' } });
      await appendAudit(tx, {
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'CLOSED',
        applicationId: app.id,
        fromState: { stage: app.stage, status: 'APPROVED_WITH_CONDITIONS' },
        toState: { stage: app.stage, status: 'CLOSED' },
        reason: 'All undertakings verified',
      });
      await notify(tx, colleges, { applicationId: app.id, kind: 'CLOSED', message: `${app.applicationNo} is closed: every condition of the approval is met.` });
    }
  }, TX_OPTIONS);
}

/** College uploads a renewed document (new Document superseding the old one) → VERIFY task and VERIFICATION item. */
export async function uploadRenewal(user: AuthUser, documentId: string, file: UploadInput | undefined, expiryDate: string) {
  const old = await prisma.document.findUnique({ where: { id: documentId }, include: { application: true } });
  if (!old || !old.application) throw notFound();
  const app = old.application;
  if (user.role !== 'COLLEGE' || user.institutionId !== old.institutionId) return denied(user, app.id, 'UPLOAD_RENEWAL', 'Only the institution can upload a renewal.', 404);
  if (!old.expiryDate) throw badRequest('This document has no expiry date.');
  if (!['APPROVED', 'APPROVED_WITH_CONDITIONS', 'CLOSED'].includes(app.status)) throw badRequest('Renewals are uploaded after approval. Reply to the deficiency instead.');
  if (await prisma.document.count({ where: { supersedesId: old.id } })) throw conflict('A renewal of this document is already uploaded.');
  const expiry = parseDateOnly(parse(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD'), expiryDate));
  if (expiry <= today()) throw badRequest('The new expiry date must be in the future.');
  const f = single(file);
  const s = await saveBuffer(f.buffer, f.originalname, f.mimetype);
  try {
    await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: { applicationId: app.id, institutionId: old.institutionId, kind: old.kind, ...s, uploadedById: user.id, uploadedAt: now(), expiryDate: expiry, supersedesId: old.id },
      });
      await assign(tx, { applicationId: app.id, regionId: app.regionId, taskType: 'VERIFY', category: app.category, taskRefId: doc.id }, user);
      const days = (await rulesForApp(app, tx)).timelines.VERIFICATION;
      await openItem(tx, { applicationId: app.id, type: 'VERIFICATION', sourceId: doc.id, dueDate: addWorkingDays(today(), days), unit: 'WORKING', totalDays: days });
      await tx.application.update({ where: { id: app.id }, data: { lastActionAt: now() } });
      await appendAudit(tx, { actorId: user.id, actorRole: user.role, action: 'UPLOAD_RENEWAL', applicationId: app.id, meta: { documentId: doc.id, supersedesId: old.id, kind: old.kind, expiryDate } });
    }, TX_OPTIONS);
  } catch (e) {
    await removeStored([s.storedName]);
    throw e;
  }
}

/** Officer verifies a renewal: the old DOC_EXPIRY item closes and a new one starts for the new expiry. */
export async function verifyRenewal(user: AuthUser, documentId: string, input: { accept: boolean; remarks?: string }) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, include: { application: true } });
  if (!doc || !doc.application || !doc.supersedesId) throw notFound();
  const app = doc.application;
  if (!(await holdsVerify(prisma, app.id, user.id, doc.id))) return denied(user, app.id, 'VERIFY_RENEWAL', 'Only the officer holding the verification task can verify this renewal.');
  if (doc.verified) throw conflict('This renewal is already verified.');
  if (!input.accept && !input.remarks?.trim()) throw badRequest('Enter remarks that tell the college what is wrong.');
  await prisma.$transaction(async (tx) => {
    const task = (await holdsVerify(tx, app.id, user.id, doc.id))!;
    await closeItems(tx, app.id, ['VERIFICATION'], 'outcome', doc.id);
    await release(tx, task.id, 'COMPLETED', user);
    if (input.accept) {
      await tx.document.update({ where: { id: doc.id }, data: { verified: true, verifiedById: user.id, verifiedAt: now() } });
      await closeItems(tx, app.id, ['DOC_EXPIRY'], 'closed', doc.supersedesId!);
      await openItem(tx, { applicationId: app.id, type: 'DOC_EXPIRY', sourceId: doc.id, dueDate: doc.expiryDate!, unit: 'CALENDAR' });
    } else {
      // A rejected renewal is withdrawn so the college can upload a corrected one.
      await tx.document.update({ where: { id: doc.id }, data: { supersedesId: null, applicationId: null } });
    }
    await tx.application.update({ where: { id: app.id }, data: { lastActionAt: now() } });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: 'VERIFY_RENEWAL',
      applicationId: app.id,
      reason: input.remarks ?? null,
      meta: { documentId: doc.id, supersedesId: doc.supersedesId, accept: input.accept },
    });
    const label = (await rulesForApp(app, tx)).content.documents.find((d) => d.kind === doc.kind)?.label ?? doc.kind;
    await notify(tx, await collegeUserIds(tx, app.institutionId), {
      applicationId: app.id,
      kind: input.accept ? 'RENEWAL_VERIFIED' : 'RENEWAL_REJECTED',
      message: input.accept
        ? `The renewed ${label.toLowerCase()} for ${app.applicationNo} was verified; it now expires on ${formatDate(doc.expiryDate!)}.`
        : `The renewed ${label.toLowerCase()} for ${app.applicationNo} was not accepted: ${input.remarks!.trim()}`,
    });
  }, TX_OPTIONS);
}
