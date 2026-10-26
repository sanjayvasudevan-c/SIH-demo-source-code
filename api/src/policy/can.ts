// can(user, action, application): role → scope → transition table and current holder/assignment → separation of duties.
import type { Application } from '@prisma/client';
import type { AuthUser } from '../auth/middleware.js';
import { prisma, type Db } from '../lib/db.js';
import { inScope } from './scope.js';
import { getSubtreeUserIds } from './subtree.js';
import { transitionFor, type CaseAction, CASE_ACTIONS } from '../workflow/transitions.js';

export type Decision = { ok: true } | { ok: false; status: 403 | 404; reason: string };

const ok: Decision = { ok: true };
const no = (reason: string, status: 403 | 404 = 403): Decision => ({ ok: false, status, reason });

type App = Pick<Application, 'id' | 'stage' | 'status' | 'evcScheduled' | 'sacForwarded' | 'regionId' | 'institutionId'>;

async function openAssignment(db: Db, applicationId: string, userId: string, taskTypes: string[]) {
  return db.assignment.findFirst({ where: { applicationId, officerId: userId, releasedAt: null, taskType: { in: taskTypes as never[] } } });
}

export async function can(user: AuthUser, action: CaseAction, app: App, db: Db = prisma): Promise<Decision> {
  const t = transitionFor(action);
  if (!t.roles.includes(user.role)) return no(`${t.label} is not available to your role.`);
  if (!(await inScope(user, app.id, db))) return no("You don't have access to this application.", 404);
  if (!t.from(app)) return no(`${t.label} is not possible while the application is in ${app.stage.toLowerCase()} (${app.status.toLowerCase().replace(/_/g, ' ')}).`);

  switch (action) {
    case 'COMPLETE_STAGE':
    case 'RETURN': {
      if (!(await openAssignment(db, app.id, user.id, ['SCRUTINY', 'RE_SCRUTINY']))) return no('Only the officer holding the scrutiny task can do this.');
      return ok;
    }
    case 'REPLY':
      return user.institutionId === app.institutionId ? ok : no('Only the applicant institution can reply.');
    case 'SCHEDULE_EVC': {
      if (!(await openAssignment(db, app.id, user.id, ['EVC_DESK']))) return no('Only the officer holding the EVC desk task can schedule the visit.');
      if (user.role === 'OFFICER') {
        const profile = await db.officerProfile.findUnique({ where: { userId: user.id } });
        if (!((profile?.skills as string[] | undefined) ?? []).includes('EVC_DESK')) return no('Scheduling needs the EVC desk skill.');
      }
      return ok;
    }
    case 'SUBMIT_EVC_REPORT': {
      const visit = await db.evcVisit.findUnique({ where: { applicationId: app.id } });
      if (!visit || !((visit.memberIds as string[]) ?? []).includes(user.id)) return no('Only a member of the visiting committee can submit the report.');
      return ok;
    }
    case 'FORWARD_SAC_SHC':
      return (await openAssignment(db, app.id, user.id, ['SAC_SHC_FORWARD'])) ? ok : no('Only the Bureau officer holding the forwarding task can do this.');
    case 'SUBMIT_RECOMMENDATION':
      return ok;
    case 'REVERT': {
      const inst = await db.institution.findUniqueOrThrow({ where: { id: app.institutionId }, select: { portfolioOfficerId: true } });
      if (!inst.portfolioOfficerId) return no('This institution has no portfolio officer.');
      if (user.role === 'OFFICER') return inst.portfolioOfficerId === user.id ? ok : no('Only the portfolio officer or their senior can revert.');
      const subtree = await getSubtreeUserIds(user.id, db);
      return subtree.includes(inst.portfolioOfficerId) ? ok : no('Only the portfolio officer or their senior can revert.');
    }
    case 'DECIDE': {
      if (user.regionId !== app.regionId) return no('Only the competent authority of the region can decide.');
      const handled = await db.auditLog.count({
        where: { applicationId: app.id, actorId: user.id, action: { in: ['COMPLETE_STAGE', 'RETURN', 'REVERT'] } },
      });
      if (handled > 0) return no('Separation of duties: you handled this application earlier, so another authority must decide it.');
      return ok;
    }
  }
}

/** Every case action the user may take now (drives the action buttons). */
export async function permittedActions(user: AuthUser, app: App, db: Db = prisma): Promise<CaseAction[]> {
  const out: CaseAction[] = [];
  for (const a of CASE_ACTIONS) {
    const t = transitionFor(a);
    if (!t.roles.includes(user.role) || !t.from(app)) continue;
    if ((await can(user, a, app, db)).ok) out.push(a);
  }
  return out;
}
