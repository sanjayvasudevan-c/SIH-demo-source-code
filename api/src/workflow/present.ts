// Read models for the application list and the case view.
import type { Application, DeadlineItem, Prisma, Stage } from '@prisma/client';
import type { AuthUser } from '../auth/middleware.js';
import { prisma } from '../lib/db.js';
import { today } from '../lib/clock.js';
import { calendarDaysBetween, isoDate, toDateOnly } from '../lib/dates.js';
import { workingDaysBetween } from '../lib/workdays.js';
import { rulesForApp, typeLabels } from '../rules/service.js';
import { permittedActions } from '../policy/can.js';
import { STAGE_LABEL } from './routing.js';
import { taskLabel } from '../assignment/engine.js';
import { currentDocuments } from './actions.js';

const REGION_NAME: Record<string, string> = { SOUTH: 'South', WEST: 'West' };

export function daysToDue(item: Pick<DeadlineItem, 'dueDate' | 'unit'>): number {
  return item.unit === 'WORKING' ? workingDaysBetween(today(), item.dueDate) : calendarDaysBetween(today(), item.dueDate);
}

export function presentItem(it: DeadlineItem & { responsibleName?: string | null }) {
  const d = it.status === 'OPEN' ? daysToDue(it) : null;
  return {
    id: it.id.toString(),
    type: it.type,
    sourceId: it.sourceId,
    status: it.status,
    dueDate: isoDate(it.dueDate),
    unit: it.unit,
    totalDays: it.totalDays,
    pausedRemaining: it.pausedRemaining,
    escalationLevel: it.escalationLevel,
    daysToDue: d,
    overdue: d !== null && d < 0,
    responsibleUserId: it.responsibleUserId,
    responsibleName: it.responsibleName ?? null,
  };
}

/** What the holder looks like to this viewer. Colleges see a desk (role and region), officers see a name. */
function holderLabel(
  app: Pick<Application, 'holderType' | 'stage' | 'status'>,
  holder: { name: string; role: string } | null,
  regionCode: string,
  viewer: AuthUser,
): string {
  const region = REGION_NAME[regionCode] ?? regionCode;
  switch (app.holderType) {
    case 'COLLEGE':
      return 'Your institution';
    case 'COMMITTEE':
      return app.stage === 'SAC_SHC' ? 'SAC/SHC committee' : 'Expert visit committee';
    case 'AUTHORITY':
      return `Competent authority, ${region}`;
    case 'NONE':
      return app.status === 'IN_STAGE' ? 'Awaiting assignment' : 'No one (decided)';
    case 'USER': {
      const desk = app.stage === 'SCRUTINY' ? 'Scrutiny officer' : app.stage === 'EVC' ? 'EVC desk officer' : app.stage === 'SAC_SHC' ? 'Bureau officer' : 'Officer';
      if (viewer.role === 'COLLEGE' || !holder) return `${desk}, ${holder?.role === 'BUREAU' ? 'Bureau' : region}`;
      return holder.name;
    }
  }
}

function decided(status: string) {
  return ['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'CLOSED'].includes(status);
}

/** Per-stage state for the tracker: done / current / upcoming / returned / overdue, with dates. */
export function routeSteps(
  app: Pick<Application, 'route' | 'stage' | 'status' | 'submittedAt'>,
  audit: { at: Date; action: string; toState: Prisma.JsonValue }[],
  openStageItem: DeadlineItem | null,
) {
  const route = app.route as Stage[];
  const entered = new Map<Stage, Date>();
  const completed = new Map<Stage, Date>();
  let prev: Stage | null = null;
  for (const r of audit) {
    const st = (r.toState as { stage?: Stage } | null)?.stage;
    if (!st) continue;
    if (st !== prev) {
      if (prev && route.indexOf(st) > route.indexOf(prev)) completed.set(prev, r.at);
      entered.set(st, r.at);
      prev = st;
    }
    if (r.action === 'DECIDE') completed.set('DECISION', r.at);
  }
  const cur = route.indexOf(app.stage);
  const steps = route.map((stage, i) => {
    let state: 'done' | 'current' | 'upcoming' | 'returned' | 'overdue';
    if (decided(app.status) || i < cur) state = 'done';
    else if (i === cur) {
      if (app.status === 'RETURNED') state = 'returned';
      else if (openStageItem && daysToDue(openStageItem) < 0) state = 'overdue';
      else state = 'current';
    } else state = 'upcoming';
    return {
      stage,
      label: STAGE_LABEL[stage],
      state,
      enteredAt: entered.get(stage)?.toISOString() ?? null,
      completedAt: state === 'done' ? completed.get(stage)?.toISOString() ?? null : null,
      dueDate: i === cur && openStageItem ? isoDate(openStageItem.dueDate) : null,
    };
  });
  return [{ stage: 'SUBMITTED', label: 'Submitted', state: 'done' as const, enteredAt: app.submittedAt.toISOString(), completedAt: app.submittedAt.toISOString(), dueDate: null }, ...steps];
}

const STAGE_ITEM_TYPES = ['STAGE_SLA', 'EVC_SCHEDULE', 'EVC_REPORT'] as const;
/** Internal workload events a college does not see in its case history. */
const INTERNAL_ACTIONS = ['ASSIGN', 'RELEASE', 'ASSIGN_OVERRIDE', 'REASSIGN', 'ASSIGN_FAILED', 'ESCALATED', 'FORM_CHECK_LABEL', 'ACCESS_DENIED'];

export async function listRows(user: AuthUser, apps: (Application & { institution: { name: string; permanentId: string }; region: { code: string } })[]) {
  const ids = apps.map((a) => a.id);
  const [assignments, items, holders, audits] = await Promise.all([
    prisma.assignment.findMany({ where: { applicationId: { in: ids }, releasedAt: null }, include: { officer: { select: { name: true, role: true } } } }),
    prisma.deadlineItem.findMany({ where: { applicationId: { in: ids }, status: { in: ['OPEN', 'PAUSED'] }, type: { in: [...STAGE_ITEM_TYPES] } }, orderBy: { id: 'desc' } }),
    prisma.user.findMany({ where: { id: { in: apps.map((a) => a.holderUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true, role: true } }),
    prisma.auditLog.findMany({
      where: { applicationId: { in: ids }, NOT: { toState: { equals: null as unknown as Prisma.InputJsonValue } } },
      select: { applicationId: true, at: true, action: true, toState: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  const holderMap = new Map(holders.map((h) => [h.id, h]));
  const labels = await typeLabels(apps);
  const t = today();
  return apps.map((a) => {
    const mine = assignments.filter((x) => x.applicationId === a.id);
    const myTask = mine.find((x) => x.officerId === user.id) ?? mine.find((x) => x.taskType !== 'VERIFY') ?? mine[0] ?? null;
    const item = items.find((i) => i.applicationId === a.id) ?? null;
    const steps = routeSteps(a, audits.filter((r) => r.applicationId === a.id), item && item.status === 'OPEN' ? item : null);
    return {
      id: a.id,
      applicationNo: a.applicationNo,
      institutionName: a.institution.name,
      permanentId: a.institution.permanentId,
      type: a.type,
      typeLabel: labels.get(a.id) ?? a.type,
      category: a.category,
      stage: a.stage,
      stageLabel: STAGE_LABEL[a.stage],
      status: a.status,
      holderType: a.holderType,
      holderLabel: holderLabel(a, a.holderUserId ? holderMap.get(a.holderUserId) ?? null : null, a.region.code, user),
      daysInStage: Math.max(0, workingDaysBetween(toDateOnly(a.stageEnteredAt), t)),
      submittedAt: a.submittedAt.toISOString(),
      routeSteps: steps,
      dueDate: item ? isoDate(item.dueDate) : null,
      daysToDue: item && item.status === 'OPEN' ? daysToDue(item) : null,
      currentTask:
        myTask && user.role !== 'COLLEGE'
          ? { taskType: myTask.taskType, label: taskLabel(myTask.taskType), officerName: myTask.officer.name, reasonText: myTask.reasonText, mine: myTask.officerId === user.id }
          : null,
    };
  });
}

/** DECIDE's default undertaking due date: today plus norms.deficiencyCompliancePeriod (months) of the pinned rules. */
function undertakingDefault(r: Awaited<ReturnType<typeof rulesForApp>>, formData: Record<string, unknown>): string {
  const months = r.norm('deficiencyCompliancePeriod', r.programme(formData.programme as string | undefined)) ?? 3;
  const t = today();
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + months, t.getUTCDate()));
  return isoDate(d);
}

export async function caseDetail(user: AuthUser, applicationId: string) {
  const app = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      institution: { include: { portfolioOfficer: { select: { id: true, name: true } } } },
      region: true,
      deficiencies: { orderBy: { raisedAt: 'asc' } },
      evcVisit: true,
      recommendations: { orderBy: { at: 'asc' } },
      decision: true,
      undertakings: { orderBy: { dueDate: 'asc' } },
      deadlineItems: { orderBy: { id: 'asc' } },
      flags: { where: { resolvedAt: null } },
      formChecks: { orderBy: { createdAt: 'desc' } },
      assignments: { orderBy: { assignedAt: 'asc' }, include: { officer: { select: { id: true, name: true, role: true, region: { select: { code: true } } } } } },
    },
  });
  const isCollege = user.role === 'COLLEGE';
  const audit = await prisma.auditLog.findMany({ where: { applicationId }, orderBy: { id: 'asc' } });
  const userIds = new Set<string>();
  for (const r of audit) if (r.actorId) userIds.add(r.actorId);
  for (const i of app.deadlineItems) userIds.add(i.responsibleUserId);
  for (const d of app.deficiencies) userIds.add(d.raisedById);
  if (app.holderUserId) userIds.add(app.holderUserId);
  const visitMembers = [...((app.evcVisit?.memberIds as string[]) ?? []), ...((app.evcVisit?.proposedMemberIds as string[]) ?? [])];
  visitMembers.forEach((id) => userIds.add(id));
  for (const r of app.recommendations) userIds.add(r.memberId);
  if (app.decision) userIds.add(app.decision.decidedById);
  const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true, role: true, title: true } });
  const u = new Map(users.map((x) => [x.id, x]));
  const name = (id: string | null | undefined) => (id ? u.get(id)?.name ?? null : null);

  const docs = await prisma.document.findMany({ where: { applicationId }, orderBy: { uploadedAt: 'asc' } });
  const current = new Set((await currentDocuments(prisma, applicationId)).map((d) => d.id));
  const r = await rulesForApp(app);
  const cfg = r.type(app.type);
  const requiredDocuments = r.documents(app.type, { formData: app.formData as Record<string, unknown>, institution: { isTechnical: app.institution.isTechnical, kind: app.institution.kind } });
  const docCfg = new Map(requiredDocuments.map((d) => [d.kind, d]));
  const openStageItem = app.deadlineItems.filter((i) => i.status === 'OPEN' && (STAGE_ITEM_TYPES as readonly string[]).includes(i.type)).pop() ?? null;
  const openAssignments = app.assignments.filter((a) => !a.releasedAt);
  const currentAssignment = openAssignments.find((a) => a.taskType !== 'VERIFY') ?? openAssignments[0] ?? null;
  const holder = app.holderUserId ? u.get(app.holderUserId) ?? null : null;

  return {
    application: {
      id: app.id,
      applicationNo: app.applicationNo,
      type: app.type,
      typeLabel: cfg.label,
      category: app.category,
      stage: app.stage,
      stageLabel: STAGE_LABEL[app.stage],
      status: app.status,
      holderType: app.holderType,
      holderUserId: isCollege ? null : app.holderUserId,
      holderLabel: holderLabel(app, holder, app.region.code, user),
      evcScheduled: app.evcScheduled,
      sacForwarded: app.sacForwarded,
      submittedAt: app.submittedAt.toISOString(),
      stageEnteredAt: app.stageEnteredAt.toISOString(),
      lastActionAt: app.lastActionAt.toISOString(),
      formData: app.formData,
      route: app.route,
      daysInStage: Math.max(0, workingDaysBetween(toDateOnly(app.stageEnteredAt), today())),
    },
    institution: {
      id: app.institution.id,
      name: app.institution.name,
      permanentId: app.institution.permanentId,
      regionCode: app.region.code,
      regionName: REGION_NAME[app.region.code] ?? app.region.code,
      portfolioOfficer: isCollege ? null : app.institution.portfolioOfficer,
    },
    routeSteps: routeSteps(app, audit, openStageItem),
    requiredDocuments: requiredDocuments.map((d) => ({ kind: d.kind, label: d.label, critical: d.critical, hasExpiry: d.hasExpiry, source: d.source ?? null })),
    ruleDefaults: { undertakingDueDate: undertakingDefault(r, app.formData as Record<string, unknown>) },
    rules: { versionId: r.pinned.id, cycle: r.pinned.cycleCode, version: r.pinned.version, label: r.label, effectiveFrom: r.pinned.effectiveFrom, contentHash: r.pinned.contentHash },
    documents: docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      label: docCfg.get(d.kind)?.label ?? (d.kind === 'UNDERTAKING_EVIDENCE' ? 'Undertaking evidence' : d.kind),
      critical: docCfg.get(d.kind)?.critical ?? false,
      fileName: d.fileName,
      mimeType: d.mimeType,
      size: d.size,
      uploadedAt: d.uploadedAt.toISOString(),
      expiryDate: d.expiryDate ? isoDate(d.expiryDate) : null,
      verified: d.verified,
      verifiedAt: d.verifiedAt?.toISOString() ?? null,
      supersedesId: d.supersedesId,
      current: current.has(d.id),
    })),
    deficiencies: app.deficiencies.map((d) => ({
      id: d.id,
      items: d.items,
      reason: d.reason,
      raisedBy: isCollege ? 'Scrutiny officer' : name(d.raisedById),
      raisedAt: d.raisedAt.toISOString(),
      resolvedAt: d.resolvedAt?.toISOString() ?? null,
      replyNote: d.replyNote,
      replyDocumentIds: d.replyDocumentIds,
    })),
    evcVisit: app.evcVisit
      ? {
          status: app.evcVisit.status,
          visitDate: app.evcVisit.visitDate ? isoDate(app.evcVisit.visitDate) : null,
          mode: app.evcVisit.mode,
          members: ((app.evcVisit.memberIds as string[]) ?? []).map((id) => ({ id, name: name(id) })),
          proposed: isCollege ? [] : ((app.evcVisit.proposedMemberIds as string[]) ?? []).map((id) => ({ id, name: name(id) })),
          checklist: isCollege ? null : app.evcVisit.checklist,
          recommendation: isCollege ? null : app.evcVisit.recommendation,
          reportText: isCollege ? null : app.evcVisit.reportText,
          reportedAt: app.evcVisit.reportedAt?.toISOString() ?? null,
        }
      : null,
    recommendations: isCollege ? [] : app.recommendations.map((r) => ({ id: r.id, text: r.text, by: name(r.memberId), at: r.at.toISOString() })),
    decision: app.decision ? { outcome: app.decision.outcome, reason: app.decision.reason, by: isCollege ? 'Competent authority' : name(app.decision.decidedById), at: app.decision.at.toISOString() } : null,
    undertakings: app.undertakings.map((x) => ({
      id: x.id,
      condition: x.condition,
      dueDate: isoDate(x.dueDate),
      daysToDue: calendarDaysBetween(today(), x.dueDate),
      status: x.status,
      evidenceDocId: x.evidenceDocId,
      verifiedAt: x.verifiedAt?.toISOString() ?? null,
      remarks: x.remarks,
    })),
    deadlineItems: app.deadlineItems.map((i) => presentItem({ ...i, responsibleName: isCollege ? null : name(i.responsibleUserId) })),
    flags: app.flags
      .filter((f) => !isCollege || f.ownerRole === 'COLLEGE')
      .map((f) => ({
        id: f.id,
        reasonCode: f.reasonCode,
        reasonText: f.reasonText,
        nextAction: f.nextAction,
        ownerRole: f.ownerRole,
        escalationLevel: f.escalationLevel,
        nextEscalationAt: f.nextEscalationAt ? isoDate(f.nextEscalationAt) : null,
      })),
    currentAssignment:
      currentAssignment && !isCollege
        ? {
            id: currentAssignment.id,
            taskType: currentAssignment.taskType,
            label: taskLabel(currentAssignment.taskType),
            officer: { id: currentAssignment.officer.id, name: currentAssignment.officer.name, role: currentAssignment.officer.role, region: currentAssignment.officer.region?.code ?? null },
            reasonText: currentAssignment.reasonText,
            assignedAt: currentAssignment.assignedAt.toISOString(),
            tier: currentAssignment.tier,
          }
        : null,
    assignments: isCollege
      ? []
      : app.assignments.map((a) => ({
          id: a.id,
          taskType: a.taskType,
          label: taskLabel(a.taskType),
          officerName: a.officer.name,
          reasonText: a.reasonText,
          assignedAt: a.assignedAt.toISOString(),
          releasedAt: a.releasedAt?.toISOString() ?? null,
          releasedReason: a.releasedReason,
          tier: a.tier,
        })),
    formChecks: app.formChecks.map((f) => ({
      id: f.id,
      modelVersion: f.modelVersion,
      modelAvailable: f.modelAvailable,
      score: f.score,
      threshold: f.threshold,
      severity: f.severity,
      warnings: f.warnings,
      justification: f.justification,
      officerLabels: isCollege ? {} : f.officerLabels,
      createdAt: f.createdAt.toISOString(),
    })),
    history: audit
      .filter((r) => !isCollege || !INTERNAL_ACTIONS.includes(r.action))
      .map((r) => ({
      id: r.id.toString(),
      at: r.at.toISOString(),
      action: r.action,
      actorName: isCollege ? null : name(r.actorId),
      actorRole: r.actorRole,
      reason: r.reason,
      fromState: r.fromState,
      toState: r.toState,
    })),
    permittedActions: await permittedActions(user, app),
    verifyTasks: isCollege
      ? []
      : openAssignments
          .filter((a) => a.taskType === 'VERIFY' && a.officerId === user.id)
          .map((a) => {
            const u = app.undertakings.find((x) => x.id === a.taskRefId);
            const d = docs.find((x) => x.id === a.taskRefId);
            const old = d?.supersedesId ? docs.find((x) => x.id === d.supersedesId) : undefined;
            return u
              ? { kind: 'EVIDENCE' as const, refId: u.id, title: `Evidence for "${u.condition}"`, documentId: u.evidenceDocId, detail: `Due ${isoDate(u.dueDate)}`, reasonText: a.reasonText }
              : {
                  kind: 'RENEWAL' as const,
                  refId: a.taskRefId,
                  title: `Renewed ${(docCfg.get(d?.kind ?? '')?.label ?? d?.kind ?? 'document').toLowerCase()}`,
                  documentId: d?.id ?? null,
                  detail: `New expiry ${d?.expiryDate ? isoDate(d.expiryDate) : '—'}${old?.expiryDate ? `, replaces one expiring ${isoDate(old.expiryDate)}` : ''}`,
                  reasonText: a.reasonText,
                };
          }),
  };
}
