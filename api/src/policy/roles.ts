import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { forbidden } from '../lib/errors.js';
import { appendAuditStandalone } from '../lib/audit.js';
import type { AuthUser } from '../auth/middleware.js';

export const MANAGER_ROLES: Role[] = ['SENIOR', 'SUPER_SENIOR', 'HOD'];

/** Record a refusal (403 or out-of-scope 404). */
export async function logAccessDenied(
  user: AuthUser,
  what: { applicationId?: string | null; path?: string; action?: string; reason: string },
): Promise<void> {
  await appendAuditStandalone({
    actorId: user.id,
    actorRole: user.role,
    action: 'ACCESS_DENIED',
    reason: what.reason,
    meta: { applicationId: what.applicationId ?? null, path: what.path ?? null, attempted: what.action ?? null },
  });
}

/** Route guard by role; a refusal is a 403 with the reason and an ACCESS_DENIED row. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (user && roles.includes(user.role)) return next();
    const reason = `This page is for ${roles.map((r) => r.toLowerCase().replace('_', ' ')).join(', ')} users.`;
    const done = () => next(forbidden(reason));
    if (user) {
      logAccessDenied(user, { path: req.originalUrl, reason }).then(done, done);
    } else {
      done();
    }
  };
}
