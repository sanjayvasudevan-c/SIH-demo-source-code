// The no-eligible-officer queue: tasks the engine could not place (open BLOCKED flags with an assign: source).
import type { Prisma, TaskType } from '@prisma/client';
import { prisma, type Db } from '../lib/db.js';
import { taskLabel } from './engine.js';

export function parseAssignSource(sourceItemId: string): { taskType: TaskType; taskRefId: string } | null {
  const m = /^assign:([A-Z_]+):(.*)$/.exec(sourceItemId);
  return m ? { taskType: m[1] as TaskType, taskRefId: m[2] ?? '' } : null;
}

export async function listUnassigned(where: Prisma.ApplicationWhereInput, db: Db = prisma) {
  const flags = await db.exceptionFlag.findMany({
    where: { reasonCode: 'BLOCKED', resolvedAt: null, sourceItemId: { startsWith: 'assign:' }, application: where },
    include: { application: { include: { institution: { select: { name: true } }, region: { select: { code: true } } } } },
    orderBy: { raisedAt: 'asc' },
  });
  const out = [];
  for (const f of flags) {
    const src = parseAssignSource(f.sourceItemId);
    if (!src) continue;
    const open = await db.assignment.count({ where: { applicationId: f.applicationId, taskType: src.taskType, taskRefId: src.taskRefId, releasedAt: null } });
    if (open) continue;
    out.push({
      flagId: f.id,
      applicationId: f.applicationId,
      applicationNo: f.application.applicationNo,
      institutionName: f.application.institution.name,
      region: f.application.region.code,
      stage: f.application.stage,
      taskType: src.taskType,
      taskLabel: taskLabel(src.taskType),
      taskRefId: src.taskRefId,
      since: f.raisedAt.toISOString(),
      reasonText: f.reasonText,
    });
  }
  return out;
}
