// Workforce view (section 8): load, capacity, availability, open tasks and portfolio per officer, with
// OVERLOADED (utilisation > 1.0) and IDLE (more than 0.35 below the team average) flags.
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import * as clock from '../lib/clock.js';
import { isoDate } from '../lib/dates.js';
import { newestRules } from '../rules/service.js';
import { getSubtreeUserIds } from '../policy/subtree.js';
import type { AuthUser } from '../auth/middleware.js';
import { taskLabel } from '../assignment/engine.js';

export async function workloadFor(user: AuthUser) {
  let where: Prisma.UserWhereInput;
  if (user.role === 'BUREAU') where = { role: { in: ['OFFICER', 'BUREAU'] } };
  else if (user.role === 'HOD') where = { role: 'OFFICER', regionId: user.regionId ?? '-' };
  else where = { role: 'OFFICER', id: { in: await getSubtreeUserIds(user.id) } };
  const t = clock.today();
  const officers = await prisma.user.findMany({
    where: { ...where, active: true },
    include: {
      profile: true,
      reportsTo: { select: { id: true, name: true } },
      region: { select: { code: true } },
      assignments: { where: { releasedAt: null }, include: { application: { select: { id: true, applicationNo: true, stage: true, institution: { select: { name: true } } } } }, orderBy: { assignedAt: 'asc' } },
      portfolio: { select: { id: true, name: true, permanentId: true }, orderBy: { name: 'asc' } },
      availability: { where: { startsOn: { lte: t }, endsOn: { gte: t } }, orderBy: { endsOn: 'desc' } },
    },
    orderBy: [{ reportsToId: 'asc' }, { name: 'asc' }],
  });
  // Team-level thresholds are not tied to one case: the newest cycle's published assignment policy.
  const policy = (await newestRules()).assignment;
  const rows = officers.map((o) => {
    const capacity = Number(o.profile?.capacityPoints ?? policy.defaultCapacityPoints);
    const openPoints = Math.round(o.assignments.reduce((s, a) => s + Number(a.weight), 0) * 100) / 100;
    const away = o.availability[0];
    return {
      id: o.id,
      name: o.name,
      role: o.role,
      region: o.region?.code ?? null,
      senior: o.reportsTo,
      capacity,
      openPoints,
      utilisation: Math.round((openPoints / capacity) * 100) / 100,
      availability: away ? { kind: away.kind, until: isoDate(away.endsOn), reason: away.reason } : null,
      openTasks: o.assignments.map((a) => ({
        assignmentId: a.id,
        applicationId: a.application.id,
        applicationNo: a.application.applicationNo,
        institutionName: a.application.institution.name,
        stage: a.application.stage,
        taskType: a.taskType,
        taskLabel: taskLabel(a.taskType),
        weight: Number(a.weight),
        assignedAt: a.assignedAt.toISOString(),
        reasonText: a.reasonText,
      })),
      portfolio: o.portfolio,
      portfolioSize: o.portfolio.length,
      flag: 'OK' as 'OK' | 'OVERLOADED' | 'IDLE',
      teamAverage: 0,
    };
  });
  // Team = officers with the same senior.
  const teams = new Map<string, typeof rows>();
  for (const r of rows) teams.set(r.senior?.id ?? '-', [...(teams.get(r.senior?.id ?? '-') ?? []), r]);
  for (const team of teams.values()) {
    const avg = team.reduce((s, r) => s + r.utilisation, 0) / team.length;
    for (const r of team) {
      r.teamAverage = Math.round(avg * 100) / 100;
      r.flag = r.utilisation > policy.overloadedAbove ? 'OVERLOADED' : r.utilisation < avg - policy.idleBelowTeamAverage ? 'IDLE' : 'OK';
    }
  }
  return rows;
}
