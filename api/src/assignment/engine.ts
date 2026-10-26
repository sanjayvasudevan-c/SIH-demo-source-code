// Assignment engine (section 6.2). Picks an eligible officer by projected utilisation, explains the pick,
// and is the only place (with workflow/actions.ts) that creates or releases assignments.
import { Prisma, type AvailabilityKind, type Category, type Role, type TaskType } from '@prisma/client';
import { prisma, TX_OPTIONS, type Db, type Tx } from '../lib/db.js';
import { rulesForApp } from '../rules/service.js';
import type { PackContent } from '../rules/schema.js';
import { now, today } from '../lib/clock.js';
import { addDays, formatDate, toDateOnly } from '../lib/dates.js';
import { addWorkingDays, nextWorkingDayFrom, workingDaysBetween } from '../lib/workdays.js';
import { advisoryXactLock } from '../lib/locks.js';
import { appendAudit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { getSubtreeUserIds, regionHod } from '../policy/subtree.js';
import type { AuthUser } from '../auth/middleware.js';
import { syncResponsible } from '../workflow/deadlines.js';

export interface Task {
  applicationId: string;
  regionId: string;
  taskType: TaskType;
  category: Category;
  taskRefId?: string;
  urgent?: boolean;
  previousOfficerId?: string | null;
  excludeOfficerIds?: string[];
  /** Resolved on first use from the case's rules (policyFor). */
  p?: TaskPolicy;
}

/** The assignment policy for a case: operational section of its cycle's published version, category from its pinned type. */
export interface TaskPolicy {
  policy: PackContent['assignment'];
  categoryWeight: number;
  categoryRank: number;
  urgentDays: number;
  /** The published version whose policy applied (stored on the assignment). */
  versionId: string;
  label: string;
}

export async function policyFor(db: Db, applicationId: string): Promise<TaskPolicy> {
  const app = await db.application.findUniqueOrThrow({ where: { id: applicationId }, select: { type: true, cycleId: true, rulePackVersionId: true } });
  const r = await rulesForApp(app, db);
  const t = r.type(app.type);
  return {
    policy: r.assignment,
    categoryWeight: t.categoryWeight,
    categoryRank: t.categoryRank,
    urgentDays: r.reminders.urgentDays,
    versionId: r.operational.id,
    label: `${r.operational.cycleCode} v${r.operational.version}`,
  };
}

async function pol(db: Db, task: Task): Promise<TaskPolicy> {
  task.p ??= await policyFor(db, task.applicationId);
  return task.p;
}

export interface Candidate {
  id: string;
  name: string;
  role: Role;
  regionCode: string | null;
  capacity: number;
  maxUtil: number;
  skills: string[];
  barred: string[];
  openPoints: number;
  recent: number;
  mismatch: 0 | 1;
  lastAssignedAt: Date | null;
  unavailable: { kind: AvailabilityKind; until: Date } | null;
  recused: boolean;
}

export interface Pick {
  officer: Candidate;
  tier: number;
  projectedUtil: number;
  reasonText: string;
  eligibleCount: number;
}

const TASK_LABEL: Record<TaskType, string> = {
  SCRUTINY: 'Scrutiny',
  RE_SCRUTINY: 'Re-scrutiny',
  EVC_DESK: 'EVC desk',
  VERIFY: 'Verification',
  SAC_SHC_FORWARD: 'SAC/SHC forwarding',
};

export function taskLabel(t: TaskType): string {
  return TASK_LABEL[t];
}

const ROLE_LABEL: Partial<Record<Role, string>> = { OFFICER: 'Officer', BUREAU: 'Bureau' };
const KIND_LABEL: Record<AvailabilityKind, string> = { LEAVE: 'on leave', TRAINING: 'in training', FIELD_VISIT: 'on a field visit', OFFLINE: 'offline' };

export function taskWeight(p: TaskPolicy, taskType: TaskType): number {
  return round2(p.policy.stageWeight[taskType] * p.categoryWeight);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function regionName(code: string | null): string {
  if (!code) return 'all regions';
  return code === 'SOUTH' ? 'South' : code === 'WEST' ? 'West' : code;
}

/** Load tier candidates with live load (from the Assignment table, never a cached counter). */
export async function loadCandidates(db: Db, task: Task, tier: number, institutionId: string): Promise<Candidate[]> {
  const { policy } = await pol(db, task);
  const rule = policy.eligibility[task.taskType].find((r) => r.tier === tier);
  if (!rule) return [];
  const exclude = new Set(task.excludeOfficerIds ?? []);
  const users = await db.user.findMany({
    where: {
      role: rule.role,
      active: true,
      ...(rule.region === 'HOME' ? { regionId: task.regionId } : {}),
    },
    select: { id: true, name: true, role: true, region: { select: { code: true } }, profile: true },
    orderBy: { id: 'asc' },
  });
  const eligible = users.filter((u) => {
    if (exclude.has(u.id) || !u.profile) return false;
    const skills = (u.profile.skills as string[]) ?? [];
    return !rule.skill || skills.includes(rule.skill);
  });
  if (eligible.length === 0) return [];
  const ids = eligible.map((u) => u.id);
  const t = today();
  const recentFrom = addWorkingDays(t, -policy.recentWorkingDays);
  const categoryFrom = addDays(t, -policy.specialisationLookbackDays);
  const nextDay = nextWorkingDayFrom(addDays(t, 1));

  const [open, recent, last, sameCategory, avail, recusals] = await Promise.all([
    db.assignment.groupBy({ by: ['officerId'], where: { officerId: { in: ids }, releasedAt: null }, _sum: { weight: true } }),
    db.assignment.groupBy({ by: ['officerId'], where: { officerId: { in: ids }, assignedAt: { gte: recentFrom } }, _count: true }),
    db.assignment.groupBy({ by: ['officerId'], where: { officerId: { in: ids } }, _max: { assignedAt: true } }),
    db.assignment.findMany({
      where: { officerId: { in: ids }, assignedAt: { gte: categoryFrom }, application: { category: task.category } },
      select: { officerId: true },
      distinct: ['officerId'],
    }),
    db.officerAvailability.findMany({
      where: { userId: { in: ids }, startsOn: { lte: nextDay }, endsOn: { gte: t } },
      orderBy: { endsOn: 'desc' },
    }),
    db.assignment.findMany({
      where: { applicationId: task.applicationId, officerId: { in: ids }, releasedReason: 'RECUSED' },
      select: { officerId: true },
    }),
  ]);
  const openMap = new Map(open.map((o) => [o.officerId, Number(o._sum.weight ?? 0)]));
  const recentMap = new Map(recent.map((r) => [r.officerId, r._count]));
  const lastMap = new Map(last.map((r) => [r.officerId, r._max.assignedAt]));
  const catSet = new Set(sameCategory.map((r) => r.officerId));
  const recusedSet = new Set(recusals.map((r) => r.officerId));
  const skill = policy.taskSkill[task.taskType];

  return eligible.map((u) => {
    const profile = u.profile!;
    const skills = (profile.skills as string[]) ?? [];
    const mine = avail.filter((a) => a.userId === u.id);
    const coversToday = mine.find((a) => toDateOnly(a.startsOn) <= t && toDateOnly(a.endsOn) >= t);
    const coversNext = mine.find((a) => toDateOnly(a.startsOn) <= nextDay && toDateOnly(a.endsOn) >= nextDay);
    // Non-urgent tasks accept an officer available today or on the next working day; urgent tasks need today.
    const blocking = task.urgent ? coversToday : coversToday && coversNext ? coversToday : undefined;
    const hasSkill = !!skill && skills.includes(skill);
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      regionCode: u.region?.code ?? null,
      capacity: Number(profile.capacityPoints),
      maxUtil: Number(profile.maxUtil),
      skills,
      barred: (profile.barredInstitutionIds as string[]) ?? [],
      openPoints: openMap.get(u.id) ?? 0,
      recent: recentMap.get(u.id) ?? 0,
      mismatch: hasSkill || catSet.has(u.id) ? 0 : 1,
      lastAssignedAt: lastMap.get(u.id) ?? null,
      unavailable: blocking ? { kind: blocking.kind, until: blocking.endsOn } : null,
      recused: recusedSet.has(u.id),
    };
  });
}

interface Exclusions {
  unavailable: Candidate[];
  overCapacity: { c: Candidate; util: number }[];
  barred: number;
  recused: number;
}

function filterCandidates(cands: Candidate[], task: Task, weight: number, institutionId: string, capFor: (c: Candidate) => number) {
  const ex: Exclusions = { unavailable: [], overCapacity: [], barred: 0, recused: 0 };
  const pass: Candidate[] = [];
  for (const c of cands) {
    const util = (c.openPoints + weight) / c.capacity;
    if (c.unavailable) ex.unavailable.push(c);
    else if (c.barred.includes(institutionId)) ex.barred++;
    else if (c.recused) ex.recused++;
    else if (util > capFor(c) + 1e-9) ex.overCapacity.push({ c, util });
    else pass.push(c);
  }
  return { pass, ex };
}

function passesWithCap(c: Candidate, weight: number, institutionId: string, cap: number): boolean {
  if (c.unavailable || c.barred.includes(institutionId) || c.recused) return false;
  return (c.openPoints + weight) / c.capacity <= cap + 1e-9;
}

export function score(p: TaskPolicy, c: Candidate, weight: number): number {
  const w = p.policy.scoreWeights;
  return w.projectedUtil * ((c.openPoints + weight) / c.capacity) + w.recent * (c.recent / c.capacity) + w.mismatch * c.mismatch;
}

function byScore(p: TaskPolicy, weight: number) {
  return (a: Candidate, b: Candidate) => {
    const d = score(p, a, weight) - score(p, b, weight);
    if (Math.abs(d) > 1e-9) return d;
    const la = a.lastAssignedAt?.getTime() ?? 0;
    const lb = b.lastAssignedAt?.getTime() ?? 0;
    if (la !== lb) return la - lb;
    return a.id < b.id ? -1 : 1;
  };
}

function exclusionText(ex: Exclusions): string {
  const parts: string[] = [];
  const byKind = new Map<AvailabilityKind, Date[]>();
  for (const c of ex.unavailable) {
    const list = byKind.get(c.unavailable!.kind) ?? [];
    list.push(c.unavailable!.until);
    byKind.set(c.unavailable!.kind, list);
  }
  for (const [kind, untils] of byKind) {
    const dates = [...new Set(untils.map((d) => formatDate(d).replace(/ \d{4}$/, '')))].slice(0, 3).join(', ');
    parts.push(`${untils.length} ${KIND_LABEL[kind]} until ${dates}`);
  }
  if (ex.overCapacity.length) {
    const utils = ex.overCapacity
      .map((o) => o.util)
      .sort((a, b) => a - b)
      .slice(0, 3)
      .map((u) => u.toFixed(2))
      .join(', ');
    parts.push(`${ex.overCapacity.length} over capacity (${utils}${ex.overCapacity.length > 3 ? ', …' : ''})`);
  }
  if (ex.barred) parts.push(`${ex.barred} barred for this institution`);
  if (ex.recused) parts.push(`${ex.recused} recused`);
  return parts.length ? `excluded ${parts.join(', ')}` : 'none excluded';
}

/** Run the selection without writing anything. Returns the pick and the exclusion summary per tier. */
export async function selectOfficer(
  db: Db,
  task: Task,
  ctx: { institutionId: string; institutionName: string; portfolioOfficerId: string | null; regionCode?: string | null },
) {
  const p = await pol(db, task);
  const { policy } = p;
  const weight = taskWeight(p, task.taskType);
  const tiers = [...new Set(policy.eligibility[task.taskType].map((r) => r.tier))].sort();
  const maxUtilFor = (c: Candidate) => (task.urgent ? Math.max(policy.urgentMaxUtil, c.maxUtil) : c.maxUtil);
  const exclusionsByTier: { tier: number; total: number; ex: Exclusions }[] = [];

  let preferredId: string | null = null;
  let preferredWhy = '';
  if (task.taskType === 'RE_SCRUTINY' && task.previousOfficerId) {
    preferredId = task.previousOfficerId;
    preferredWhy = `returned this application earlier (continuity)`;
  } else if ((task.taskType === 'SCRUTINY' || task.taskType === 'VERIFY') && ctx.portfolioOfficerId) {
    preferredId = ctx.portfolioOfficerId;
    preferredWhy = `portfolio officer for ${ctx.institutionName}`;
  }

  for (const tier of tiers) {
    const cands = await loadCandidates(db, task, tier, ctx.institutionId);
    const { pass, ex } = filterCandidates(cands, task, weight, ctx.institutionId, maxUtilFor);
    exclusionsByTier.push({ tier, total: cands.length, ex });

    let chosen: Candidate | null = null;
    let why = '';
    const preferred = preferredId ? cands.find((c) => c.id === preferredId) : undefined;
    if (preferred && passesWithCap(preferred, weight, ctx.institutionId, policy.continuityUtilCap)) {
      chosen = preferred;
      why = preferredWhy;
    } else if (pass.length) {
      chosen = [...pass].sort(byScore(p, weight))[0]!;
      why = `lowest load score (${score(p, chosen, weight).toFixed(2)}) among eligible ${tier === 0 ? 'officers' : 'Bureau officers'}`;
    }
    if (chosen) {
      const eligibleCount = new Set([...pass.map((p) => p.id), chosen.id]).size;
      const util = (chosen.openPoints + weight) / chosen.capacity;
      const tierNote =
        tier === 0 || task.taskType === 'SAC_SHC_FORWARD'
          ? `Tier ${tier}.`
          : `Tier ${tier} (Bureau overflow: no eligible officer in ${regionName(ctx.regionCode ?? null)}).`;
      const reasonText =
        `Assigned to ${chosen.name} (${ROLE_LABEL[chosen.role] ?? chosen.role}, ${regionName(chosen.regionCode)}): ${why}; ` +
        `utilisation ${util.toFixed(2)} after this task. ${eligibleCount} eligible; ${exclusionText(ex)}. ${tierNote} Rules ${p.label}.`;
      return { pick: { officer: chosen, tier, projectedUtil: util, reasonText, eligibleCount } as Pick, weight, exclusionsByTier };
    }
  }
  return { pick: null, weight, exclusionsByTier };
}

async function institutionCtx(db: Db, applicationId: string) {
  const app = await db.application.findUniqueOrThrow({
    where: { id: applicationId },
    select: { applicationNo: true, cycleId: true, region: { select: { code: true } }, institution: { select: { id: true, name: true, portfolioOfficerId: true } } },
  });
  return {
    cycleId: app.cycleId,
    regionCode: app.region.code,
    applicationNo: app.applicationNo,
    institutionId: app.institution.id,
    institutionName: app.institution.name,
    portfolioOfficerId: app.institution.portfolioOfficerId,
  };
}

function lockKey(task: Task): string {
  return task.taskType === 'SAC_SHC_FORWARD' ? 'assign:bureau' : `assign:${task.regionId}`;
}

/** Holder change applies to stage tasks; VERIFY tasks never move the case holder (decided cases are held by nobody). */
function movesHolder(t: TaskType): boolean {
  return t !== 'VERIFY';
}

export async function assign(tx: Tx, task: Task, actor?: { id: string; role: string } | null): Promise<Pick | null> {
  await advisoryXactLock(tx, lockKey(task));
  const p = await pol(tx, task);
  // The Bureau pool is shared across regions; overflow tiers take its lock as well.
  if (task.taskType !== 'SAC_SHC_FORWARD' && p.policy.eligibility[task.taskType].some((r) => r.role === 'BUREAU')) {
    await advisoryXactLock(tx, 'assign:bureau');
  }
  const ctx = await institutionCtx(tx, task.applicationId);
  const { pick, weight, exclusionsByTier } = await selectOfficer(tx, task, ctx);
  const taskRefId = task.taskRefId ?? '';

  if (!pick) {
    const counts = exclusionsByTier.map((e) => ({
      tier: e.tier,
      candidates: e.total,
      unavailable: e.ex.unavailable.length,
      overCapacity: e.ex.overCapacity.length,
      barred: e.ex.barred,
      recused: e.ex.recused,
    }));
    const hod = await regionHod(task.regionId, tx);
    const detail = counts
      .map((c) => `tier ${c.tier}: ${c.candidates} candidates, ${c.unavailable} unavailable, ${c.overCapacity} over capacity${c.barred ? `, ${c.barred} barred` : ''}`)
      .join('; ');
    if (movesHolder(task.taskType)) {
      await tx.application.update({ where: { id: task.applicationId }, data: { holderType: 'NONE', holderUserId: null } });
    }
    await tx.exceptionFlag.upsert({
      where: { applicationId_reasonCode_sourceItemId: { applicationId: task.applicationId, reasonCode: 'BLOCKED', sourceItemId: `assign:${task.taskType}:${taskRefId}` } },
      create: {
        applicationId: task.applicationId,
        reasonCode: 'BLOCKED',
        sourceItemId: `assign:${task.taskType}:${taskRefId}`,
        ownerRole: 'HOD',
        ownerUserId: hod,
        reasonText: `Blocked — no eligible officer for ${TASK_LABEL[task.taskType].toLowerCase()} (${detail}); owner: head of department; next: assign by hand from the no-eligible-officer queue`,
        nextAction: `Supply or assign: ${TASK_LABEL[task.taskType].toLowerCase()} officer`,
        escalationLevel: 0,
        sortKeys: { escalationLevel: 0, daysOverdue: 0, categoryRank: p.categoryRank, daysToDue: 0, submittedAt: now().toISOString() },
        raisedAt: now(),
      },
      update: { resolvedAt: null },
    });
    await appendAudit(tx, {
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? 'SYSTEM',
      action: 'ASSIGN_FAILED',
      applicationId: task.applicationId,
      reason: `NO_ELIGIBLE_OFFICER for ${task.taskType}`,
      meta: { taskType: task.taskType, taskRefId, exclusions: counts },
    });
    if (hod) {
      await notify(tx, [hod], {
        applicationId: task.applicationId,
        kind: 'ASSIGN_FAILED',
        message: `No eligible officer for ${TASK_LABEL[task.taskType].toLowerCase()} on ${ctx.applicationNo}. Assign it from the no-eligible-officer queue.`,
      });
    }
    return null;
  }

  const at = now();
  const created = await tx.assignment.create({
    data: {
      applicationId: task.applicationId,
      taskType: task.taskType,
      taskRefId,
      officerId: pick.officer.id,
      weight: new Prisma.Decimal(weight),
      tier: pick.tier,
      reasonText: pick.reasonText,
      rulePackVersionId: p.versionId,
      recommendedOfficerId: pick.officer.id,
      assignedAt: at,
    },
  });
  if (movesHolder(task.taskType)) {
    await tx.application.update({ where: { id: task.applicationId }, data: { holderType: 'USER', holderUserId: pick.officer.id } });
  }
  // A successful assignment resolves any earlier no-eligible-officer block for this task.
  await tx.exceptionFlag.updateMany({
    where: { applicationId: task.applicationId, reasonCode: 'BLOCKED', sourceItemId: `assign:${task.taskType}:${taskRefId}`, resolvedAt: null },
    data: { resolvedAt: at },
  });
  await syncResponsible(tx, task.applicationId);
  await appendAudit(tx, {
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? 'SYSTEM',
    action: 'ASSIGN',
    applicationId: task.applicationId,
    reason: pick.reasonText,
    meta: { assignmentId: created.id, taskType: task.taskType, taskRefId, officerId: pick.officer.id, tier: pick.tier, weight, rulePackVersionId: created.rulePackVersionId },
  });
  await notify(tx, [pick.officer.id], {
    applicationId: task.applicationId,
    kind: 'ASSIGNED',
    message: `New task: ${TASK_LABEL[task.taskType].toLowerCase()} for ${ctx.applicationNo} (${ctx.institutionName}).`,
  });
  return pick;
}

export async function release(tx: Tx, assignmentId: string, reason: string, actor?: { id: string; role: string } | null): Promise<void> {
  const a = await tx.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
  if (a.releasedAt) return;
  await tx.assignment.update({ where: { id: assignmentId }, data: { releasedAt: now(), releasedReason: reason } });
  await appendAudit(tx, {
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? 'SYSTEM',
    action: 'RELEASE',
    applicationId: a.applicationId,
    reason,
    meta: { assignmentId, taskType: a.taskType, taskRefId: a.taskRefId, officerId: a.officerId },
  });
}

/** Is this task urgent? Its deadline item is due within the urgent window (or overdue). */
export async function isTaskUrgent(db: Db, applicationId: string, taskType: TaskType, taskRefId: string): Promise<boolean> {
  const itemType = taskType === 'EVC_DESK' ? 'EVC_SCHEDULE' : taskType === 'VERIFY' ? 'VERIFICATION' : 'STAGE_SLA';
  const item = await db.deadlineItem.findFirst({
    where: { applicationId, type: itemType, status: 'OPEN', ...(taskType === 'VERIFY' ? { sourceId: taskRefId } : {}) },
    orderBy: { id: 'desc' },
  });
  if (!item) return false;
  return workingDaysBetween(today(), item.dueDate) <= (await rulesForApp(applicationId, db)).reminders.urgentDays;
}

async function taskFor(db: Db, assignmentId: string): Promise<{ a: Awaited<ReturnType<typeof db.assignment.findUniqueOrThrow>>; task: Task }> {
  const a = await db.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
  const app = await db.application.findUniqueOrThrow({ where: { id: a.applicationId } });
  return {
    a,
    task: {
      applicationId: a.applicationId,
      regionId: app.regionId,
      taskType: a.taskType,
      category: app.category,
      taskRefId: a.taskRefId,
      previousOfficerId: app.previousOfficerId,
    },
  };
}

/**
 * When availability covering today is created (API) or begins (engine cycle): release the officer's open
 * assignments and reassign each, excluding them. Deadline items keep their due dates.
 */
export async function releaseForAvailability(
  tx: Tx,
  userId: string,
  actor?: { id: string; role: string } | null,
  filter: (a: { id: string; taskType: TaskType }) => boolean = () => true,
) {
  const open = (await tx.assignment.findMany({ where: { officerId: userId, releasedAt: null }, orderBy: { assignedAt: 'asc' } })).filter(filter);
  const results: { applicationId: string; taskType: TaskType; toOfficerId: string | null; toOfficerName: string | null; reasonText: string | null }[] = [];
  for (const a of open) {
    const { task } = await taskFor(tx, a.id);
    task.urgent = await isTaskUrgent(tx, a.applicationId, a.taskType, a.taskRefId);
    task.excludeOfficerIds = [userId];
    // RE_SCRUTINY continuity would point back at the absent officer; exclusion handles it.
    await release(tx, a.id, 'LEAVE', actor);
    const pick = await assign(tx, task, actor);
    results.push({
      applicationId: a.applicationId,
      taskType: a.taskType,
      toOfficerId: pick?.officer.id ?? null,
      toOfficerName: pick?.officer.name ?? null,
      reasonText: pick?.reasonText ?? null,
    });
  }
  return results;
}

/** Can the actor reassign work on this application (and to this officer)? */
async function canManage(actor: AuthUser, officerIds: string[], appRegionId: string, db: Db): Promise<string | null> {
  if (actor.role === 'BUREAU') return null;
  if (actor.role === 'HOD') {
    if (appRegionId !== actor.regionId) return 'You can reassign only within your region.';
    return null;
  }
  if (actor.role === 'SENIOR' || actor.role === 'SUPER_SENIOR') {
    const subtree = new Set(await getSubtreeUserIds(actor.id, db));
    if (officerIds.some((id) => !subtree.has(id))) return 'You can reassign only between officers in your team.';
    return null;
  }
  return 'Only senior officers, heads of department and the Bureau can reassign work.';
}

export async function reassignManual(actor: AuthUser, assignmentId: string, toOfficerId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const { a, task } = await taskFor(tx, assignmentId);
    if (a.releasedAt) throw badRequest('This task has already been released.');
    const app = await tx.application.findUniqueOrThrow({ where: { id: a.applicationId }, include: { institution: true } });
    const target = await tx.user.findUnique({ where: { id: toOfficerId }, include: { region: true } });
    if (!target) throw notFound('Officer not found.');
    const deny = await canManage(actor, [a.officerId, toOfficerId], app.regionId, tx);
    if (deny) throw forbidden(deny);
    if (actor.role === 'HOD' && target.role !== 'BUREAU' && target.regionId !== actor.regionId) throw forbidden('You can reassign only within your region.');
    if (toOfficerId === a.officerId) throw badRequest('The task is already with this officer.');

    await advisoryXactLock(tx, lockKey(task));
    task.urgent = await isTaskUrgent(tx, a.applicationId, a.taskType, a.taskRefId);
    const region = await tx.region.findUniqueOrThrow({ where: { id: app.regionId } });
    const ctx = { institutionId: app.institutionId, institutionName: app.institution.name, portfolioOfficerId: app.institution.portfolioOfficerId, regionCode: region.code };
    // The engine's own pick (excluding the current holder) is stored as the recommendation.
    const rec = await selectOfficer(tx, { ...task, excludeOfficerIds: [a.officerId] }, ctx);
    const recommendedId = rec.pick?.officer.id ?? null;

    // Target must be eligible for the task and pass every hard filter.
    const p = await pol(tx, task);
    const { policy } = p;
    const weight = taskWeight(p, a.taskType);
    let targetCand: Candidate | undefined;
    for (const tier of [...new Set(policy.eligibility[a.taskType].map((r) => r.tier))]) {
      targetCand = (await loadCandidates(tx, task, tier, app.institutionId)).find((c) => c.id === toOfficerId);
      if (targetCand) break;
    }
    if (!targetCand) throw badRequest(`${target.name} is not eligible for ${TASK_LABEL[a.taskType].toLowerCase()} tasks.`);
    const cap = task.urgent ? Math.max(policy.urgentMaxUtil, targetCand.maxUtil) : targetCand.maxUtil;
    if (targetCand.unavailable) throw badRequest(`${target.name} is ${KIND_LABEL[targetCand.unavailable.kind]} until ${formatDate(targetCand.unavailable.until)}.`);
    if (targetCand.barred.includes(app.institutionId)) throw badRequest(`${target.name} is barred from this institution.`);
    if (targetCand.recused) throw badRequest(`${target.name} has recused from this application.`);
    const util = (targetCand.openPoints + weight) / targetCand.capacity;
    if (util > cap + 1e-9) throw badRequest(`${target.name} would be over capacity (${util.toFixed(2)}).`);

    await release(tx, a.id, 'REASSIGNED', actor);
    const recName = recommendedId ? (await tx.user.findUnique({ where: { id: recommendedId }, select: { name: true } }))?.name : null;
    const reasonText =
      `Reassigned to ${target.name} (${ROLE_LABEL[target.role] ?? target.role}, ${regionName(target.region?.code ?? null)}) by ${actor.name}: ${reason}. ` +
      `Utilisation ${util.toFixed(2)} after this task. System recommended: ${recName ?? 'no eligible officer'}. Rules ${p.label}.`;
    const created = await tx.assignment.create({
      data: {
        applicationId: a.applicationId,
        taskType: a.taskType,
        taskRefId: a.taskRefId,
        officerId: toOfficerId,
        weight: new Prisma.Decimal(weight),
        tier: target.role === 'BUREAU' && a.taskType !== 'SAC_SHC_FORWARD' ? 1 : 0,
        reasonText,
        rulePackVersionId: p.versionId,
        recommendedOfficerId: recommendedId,
        assignedAt: now(),
        overriddenById: actor.id,
      },
    });
    if (movesHolder(a.taskType)) {
      await tx.application.update({ where: { id: a.applicationId }, data: { holderType: 'USER', holderUserId: toOfficerId } });
    }
    await syncResponsible(tx, a.applicationId);
    await appendAudit(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      action: recommendedId === toOfficerId ? 'REASSIGN' : 'ASSIGN_OVERRIDE',
      applicationId: a.applicationId,
      reason,
      meta: { assignmentId: created.id, fromOfficerId: a.officerId, toOfficerId, recommendedOfficerId: recommendedId, taskType: a.taskType },
    });
    await notify(tx, [toOfficerId], {
      applicationId: a.applicationId,
      kind: 'ASSIGNED',
      message: `New task: ${TASK_LABEL[a.taskType].toLowerCase()} for ${app.applicationNo} (${app.institution.name}), reassigned by ${actor.name}.`,
    });
    await notify(tx, [a.officerId], {
      applicationId: a.applicationId,
      kind: 'REASSIGNED',
      message: `${TASK_LABEL[a.taskType]} for ${app.applicationNo} was reassigned to ${target.name} by ${actor.name}.`,
    });
    return { assignmentId: created.id, recommendedOfficerId: recommendedId, recommendedOfficerName: recName ?? null, reasonText };
  }, TX_OPTIONS);
}

/** HoD or Bureau assigns a task that the engine could not place (no-eligible-officer queue). */
export async function assignManual(actor: AuthUser, input: { applicationId: string; taskType: TaskType; taskRefId: string; toOfficerId: string; reason: string }) {
  return prisma.$transaction(async (tx) => {
    const app = await tx.application.findUniqueOrThrow({ where: { id: input.applicationId }, include: { institution: true } });
    if (actor.role === 'HOD' && app.regionId !== actor.regionId) throw forbidden('You can assign only within your region.');
    if (actor.role !== 'HOD' && actor.role !== 'BUREAU') throw forbidden('Only heads of department and the Bureau work this queue.');
    const existing = await tx.assignment.findFirst({ where: { applicationId: input.applicationId, taskType: input.taskType, taskRefId: input.taskRefId, releasedAt: null } });
    if (existing) throw badRequest('This task already has an officer.');
    const target = await tx.user.findUnique({ where: { id: input.toOfficerId }, include: { region: true, profile: true } });
    if (!target || !target.profile || (target.role !== 'OFFICER' && target.role !== 'BUREAU')) throw badRequest('Choose an officer or Bureau member.');
    const task: Task = { applicationId: app.id, regionId: app.regionId, taskType: input.taskType, category: app.category, taskRefId: input.taskRefId };
    await advisoryXactLock(tx, lockKey(task));
    const p = await pol(tx, task);
    let cand: Candidate | undefined;
    for (const tier of [...new Set(p.policy.eligibility[input.taskType].map((r) => r.tier))]) {
      cand = (await loadCandidates(tx, task, tier, app.institutionId)).find((c) => c.id === input.toOfficerId);
      if (cand) break;
    }
    if (!cand) throw badRequest(`${target.name} is not eligible for ${TASK_LABEL[input.taskType].toLowerCase()} tasks.`);
    if (cand.unavailable) throw badRequest(`${target.name} is ${KIND_LABEL[cand.unavailable.kind]} until ${formatDate(cand.unavailable.until)}.`);
    const weight = taskWeight(p, input.taskType);
    const util = (cand.openPoints + weight) / cand.capacity;
    const reasonText = `Assigned by hand to ${target.name} by ${actor.name}: ${input.reason}. Utilisation ${util.toFixed(2)} after this task. Rules ${p.label}.`;
    await tx.assignment.create({
      data: {
        applicationId: app.id,
        taskType: input.taskType,
        taskRefId: input.taskRefId,
        officerId: target.id,
        weight: new Prisma.Decimal(weight),
        tier: target.role === 'BUREAU' ? 1 : 0,
        reasonText,
        rulePackVersionId: p.versionId,
        recommendedOfficerId: null,
        assignedAt: now(),
        overriddenById: actor.id,
      },
    });
    if (movesHolder(input.taskType)) {
      await tx.application.update({ where: { id: app.id }, data: { holderType: 'USER', holderUserId: target.id } });
    }
    await tx.exceptionFlag.updateMany({
      where: { applicationId: app.id, reasonCode: 'BLOCKED', sourceItemId: `assign:${input.taskType}:${input.taskRefId}`, resolvedAt: null },
      data: { resolvedAt: now() },
    });
    await syncResponsible(tx, app.id);
    await appendAudit(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      action: 'ASSIGN_OVERRIDE',
      applicationId: app.id,
      reason: input.reason,
      meta: { taskType: input.taskType, taskRefId: input.taskRefId, toOfficerId: target.id, manualQueue: true },
    });
    await notify(tx, [target.id], {
      applicationId: app.id,
      kind: 'ASSIGNED',
      message: `New task: ${TASK_LABEL[input.taskType].toLowerCase()} for ${app.applicationNo} (${app.institution.name}), assigned by ${actor.name}.`,
    });
    return { reasonText };
  }, TX_OPTIONS);
}

export async function reassignPortfolio(actor: AuthUser, institutionId: string, toOfficerId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const inst = await tx.institution.findUnique({ where: { id: institutionId } });
    if (!inst) throw notFound();
    const target = await tx.user.findUnique({ where: { id: toOfficerId } });
    if (!target || target.role !== 'OFFICER' || target.regionId !== inst.regionId) throw badRequest('Choose an officer in the institution’s region.');
    const ids = [toOfficerId, ...(inst.portfolioOfficerId ? [inst.portfolioOfficerId] : [])];
    const deny = await canManage(actor, ids, inst.regionId, tx);
    if (deny) throw forbidden(deny);
    await tx.institution.update({ where: { id: institutionId }, data: { portfolioOfficerId: toOfficerId } });
    await tx.portfolioHistory.create({
      data: { institutionId, fromOfficerId: inst.portfolioOfficerId, toOfficerId, byUserId: actor.id, reason, at: now() },
    });
    // Compliance items follow the portfolio officer.
    const apps = await tx.application.findMany({ where: { institutionId }, select: { id: true } });
    for (const a of apps) await syncResponsible(tx, a.id);
    await appendAudit(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      action: 'REASSIGN',
      reason,
      meta: { kind: 'PORTFOLIO', institutionId, fromOfficerId: inst.portfolioOfficerId, toOfficerId },
    });
    await notify(tx, [toOfficerId], { kind: 'PORTFOLIO', message: `${inst.name} is now in your portfolio (moved by ${actor.name}).` });
    return { ok: true };
  }, TX_OPTIONS);
}
