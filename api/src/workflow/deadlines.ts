// Deadline items: created, paused, resumed and closed inside the case transaction (section 2.4 / 7.1).
import type { ItemType, Stage, Unit } from '@prisma/client';
import type { Tx } from '../lib/db.js';
import { rulesForApp } from '../rules/service.js';
import { now, today } from '../lib/clock.js';
import { toDateOnly } from '../lib/dates.js';
import { addWorkingDays, workingDaysBetween } from '../lib/workdays.js';
import { regionAuthority, regionHod } from '../policy/subtree.js';

const STAGE_TASKS: Record<Stage, string[]> = {
  SCRUTINY: ['SCRUTINY', 'RE_SCRUTINY'],
  EVC: ['EVC_DESK'],
  SAC_SHC: ['SAC_SHC_FORWARD'],
  DECISION: [],
};

/** Who answers for an item right now (section 7.1 responsibleUserId). Falls back to the region HoD. */
export async function computeResponsible(tx: Tx, applicationId: string, type: ItemType, sourceId: string): Promise<string> {
  const app = await tx.application.findUniqueOrThrow({
    where: { id: applicationId },
    select: { regionId: true, stage: true, status: true, previousOfficerId: true, institution: { select: { portfolioOfficerId: true } }, evcVisit: true },
  });
  const hod = async () => (await regionHod(app.regionId, tx)) ?? '';
  const openTask = async (taskTypes: string[], ref?: string) =>
    (
      await tx.assignment.findFirst({
        where: { applicationId, releasedAt: null, taskType: { in: taskTypes as never[] }, ...(ref !== undefined ? { taskRefId: ref } : {}) },
        orderBy: { assignedAt: 'desc' },
      })
    )?.officerId ?? null;

  switch (type) {
    case 'STAGE_SLA': {
      if (app.stage === 'DECISION') return (await regionAuthority(app.regionId, tx)) ?? (await hod());
      if (app.status === 'RETURNED' && app.previousOfficerId) return app.previousOfficerId;
      return (await openTask(STAGE_TASKS[app.stage])) ?? (await hod());
    }
    case 'VERIFICATION':
      return (await openTask(['VERIFY'], sourceId)) ?? (await hod());
    case 'EVC_SCHEDULE':
      return (await openTask(['EVC_DESK'])) ?? (await hod());
    case 'EVC_REPORT': {
      const members = (app.evcVisit?.memberIds as string[] | undefined) ?? [];
      return members[0] ?? (await hod());
    }
    case 'UNDERTAKING':
    case 'DOC_EXPIRY':
      return app.institution.portfolioOfficerId ?? (await hod());
  }
}

/** Keep responsibleUserId in step after assignment changes. */
export async function syncResponsible(tx: Tx, applicationId: string): Promise<void> {
  const items = await tx.deadlineItem.findMany({ where: { applicationId, status: { in: ['OPEN', 'PAUSED'] } } });
  for (const it of items) {
    const r = await computeResponsible(tx, applicationId, it.type, it.sourceId);
    if (r && r !== it.responsibleUserId) await tx.deadlineItem.update({ where: { id: it.id }, data: { responsibleUserId: r } });
  }
}

export async function openItem(
  tx: Tx,
  input: { applicationId: string; type: ItemType; sourceId?: string; dueDate: Date; unit: Unit; totalDays?: number | null },
) {
  const sourceId = input.sourceId ?? '';
  const responsibleUserId = await computeResponsible(tx, input.applicationId, input.type, sourceId);
  return tx.deadlineItem.create({
    data: {
      applicationId: input.applicationId,
      type: input.type,
      sourceId,
      responsibleUserId,
      dueDate: toDateOnly(input.dueDate),
      unit: input.unit,
      totalDays: input.totalDays ?? null,
      status: 'OPEN',
      createdAt: now(),
    },
  });
}

/** Stage clock on entering a stage: STAGE_SLA for SCRUTINY, SAC_SHC, DECISION; EVC_SCHEDULE for EVC. */
export async function startStageClock(tx: Tx, applicationId: string, stage: Stage) {
  const sla = (await rulesForApp(applicationId, tx)).timelines;
  if (stage === 'EVC') {
    const days = sla.EVC_SCHEDULE;
    return openItem(tx, { applicationId, type: 'EVC_SCHEDULE', dueDate: addWorkingDays(today(), days), unit: 'WORKING', totalDays: days });
  }
  const days = sla[stage];
  return openItem(tx, { applicationId, type: 'STAGE_SLA', sourceId: stage, dueDate: addWorkingDays(today(), days), unit: 'WORKING', totalDays: days });
}

/** Close open (or paused) items: MET when on time, MISSED when late; or CLOSED when the stage is abandoned. */
export async function closeItems(tx: Tx, applicationId: string, types: ItemType[], mode: 'outcome' | 'closed', sourceId?: string) {
  const items = await tx.deadlineItem.findMany({
    where: { applicationId, type: { in: types }, status: { in: ['OPEN', 'PAUSED'] }, ...(sourceId !== undefined ? { sourceId } : {}) },
  });
  const t = today();
  for (const it of items) {
    const status = mode === 'closed' ? 'CLOSED' : toDateOnly(it.dueDate) >= t ? 'MET' : 'MISSED';
    await tx.deadlineItem.update({ where: { id: it.id }, data: { status, closedAt: now() } });
  }
  return items.length;
}

/** RETURN: pause the stage clock and store the remaining working days. */
export async function pauseStageItem(tx: Tx, applicationId: string) {
  const it = await tx.deadlineItem.findFirst({ where: { applicationId, type: 'STAGE_SLA', status: 'OPEN' }, orderBy: { id: 'desc' } });
  if (!it) return null;
  const remaining = Math.max(0, workingDaysBetween(today(), it.dueDate));
  return tx.deadlineItem.update({ where: { id: it.id }, data: { status: 'PAUSED', pausedRemaining: remaining } });
}

/** REPLY: resume with due = addWorkingDays(today, remaining). */
export async function resumeStageItem(tx: Tx, applicationId: string) {
  const it = await tx.deadlineItem.findFirst({ where: { applicationId, type: 'STAGE_SLA', status: 'PAUSED' }, orderBy: { id: 'desc' } });
  if (!it) return null;
  const remaining = it.pausedRemaining ?? 0;
  return tx.deadlineItem.update({
    where: { id: it.id },
    data: { status: 'OPEN', dueDate: addWorkingDays(today(), remaining), pausedRemaining: null },
  });
}
