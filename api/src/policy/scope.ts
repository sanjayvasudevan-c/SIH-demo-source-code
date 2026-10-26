import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/middleware.js';
import { prisma, type Db } from '../lib/db.js';
import { getSubtreeUserIds } from './subtree.js';

const NOTHING: Prisma.ApplicationWhereInput = { id: '00000000-0000-0000-0000-000000000000' };

/** Prisma `where` for Application implementing the read scopes in section 2.1. */
export async function scopeWhere(user: AuthUser, db: Db = prisma): Promise<Prisma.ApplicationWhereInput> {
  switch (user.role) {
    case 'COLLEGE':
      return user.institutionId ? { institutionId: user.institutionId } : NOTHING;
    case 'OFFICER':
      return {
        OR: [
          { assignments: { some: { officerId: user.id, releasedAt: null } } },
          { institution: { portfolioOfficerId: user.id } },
          // The officer who returned a case keeps sight of it while the college replies.
          { status: 'RETURNED', previousOfficerId: user.id },
        ],
      };
    case 'SENIOR':
    case 'SUPER_SENIOR': {
      const ids = await getSubtreeUserIds(user.id, db);
      return {
        OR: [
          { assignments: { some: { officerId: { in: ids } } } },
          { institution: { portfolioOfficerId: { in: ids } } },
        ],
      };
    }
    case 'HOD':
      return user.regionId ? { regionId: user.regionId } : NOTHING;
    case 'BUREAU':
      return {};
    case 'COMMITTEE':
      return {
        OR: [
          { evcVisit: { memberIds: { array_contains: [user.id] } } },
          { stage: 'SAC_SHC', sacForwarded: true },
          { recommendations: { some: { memberId: user.id } } },
        ],
      };
    case 'AUTHORITY':
      return user.regionId
        ? {
            regionId: user.regionId,
            OR: [
              { stage: 'DECISION' },
              { status: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'CLOSED'] } },
            ],
          }
        : NOTHING;
    case 'ADMIN':
    default:
      return NOTHING;
  }
}

export async function inScope(user: AuthUser, applicationId: string, db: Db = prisma): Promise<boolean> {
  const where = await scopeWhere(user, db);
  const n = await db.application.count({ where: { AND: [{ id: applicationId }, where] } });
  return n > 0;
}
