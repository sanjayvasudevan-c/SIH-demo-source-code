import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { unauthorized } from '../lib/errors.js';
import { verifyToken } from './token.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  regionId: string | null;
  institutionId: string | null;
  reportsToId: string | null;
  title: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization') ?? '';
    const m = /^Bearer (.+)$/.exec(header);
    if (!m) throw unauthorized();
    let claims;
    try {
      claims = verifyToken(m[1]);
    } catch {
      throw unauthorized('Your session has expired. Sign in again.');
    }
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        regionId: true,
        institutionId: true,
        reportsToId: true,
        title: true,
        active: true,
      },
    });
    if (!user || !user.active) throw unauthorized();
    const { active: _active, ...rest } = user;
    req.user = rest;
    next();
  } catch (e) {
    next(e);
  }
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
