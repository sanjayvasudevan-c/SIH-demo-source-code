import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { unauthorized, notFound } from '../lib/errors.js';
import { appendAuditStandalone } from '../lib/audit.js';
import { signToken, TOKEN_TTL_SECONDS } from '../auth/token.js';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { NAMED_DEMO_EMAILS, demoMode } from '../auth/demoUsers.js';

const loginBody = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export function authRouter(): Router {
  const r = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    // Count failed attempts only, so a live demo can switch users freely (see DECISIONS.md).
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' },
  });

  r.post(
    '/login',
    loginLimiter,
    h(async (req, res) => {
      const body = parse(loginBody, req.body);
      const email = body.email.toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });
      const ok = user && user.active && (await bcrypt.compare(body.password, user.passwordHash));
      if (!ok || !user) {
        await appendAuditStandalone({
          actorId: user?.id ?? null,
          actorRole: user?.role ?? 'UNKNOWN',
          action: 'LOGIN_FAILED',
          meta: { email, ip: req.ip ?? null },
        });
        throw unauthorized('The email or password is not correct.');
      }
      await appendAuditStandalone({ actorId: user.id, actorRole: user.role, action: 'LOGIN', meta: { ip: req.ip ?? null } });
      const token = signToken({ sub: user.id, role: user.role });
      res.json({ token, expiresIn: TOKEN_TTL_SECONDS, user: await publicUser(user.id) });
    }),
  );

  r.get(
    '/me',
    requireAuth,
    h(async (req, res) => {
      res.json({ user: await publicUser(currentUser(req).id) });
    }),
  );

  // "Stay signed in": exchange a still-valid token for a fresh 8-hour one.
  r.post(
    '/refresh',
    requireAuth,
    h(async (req, res) => {
      const u = currentUser(req);
      res.json({ token: signToken({ sub: u.id, role: u.role }), expiresIn: TOKEN_TTL_SECONDS });
    }),
  );

  r.get(
    '/demo-users',
    h(async (_req, res) => {
      if (!demoMode()) throw notFound();
      const users = await prisma.user.findMany({
        where: { email: { in: [...NAMED_DEMO_EMAILS] } },
        select: { name: true, email: true, role: true, title: true, region: { select: { code: true } }, institution: { select: { name: true } } },
      });
      const order = new Map<string, number>(NAMED_DEMO_EMAILS.map((e, i) => [e, i]));
      users.sort((a, b) => (order.get(a.email) ?? 0) - (order.get(b.email) ?? 0));
      res.json({
        users: users.map((u) => ({
          name: u.name,
          email: u.email,
          role: u.role,
          title: u.title,
          region: u.region?.code ?? null,
          institution: u.institution?.name ?? null,
        })),
      });
    }),
  );

  return r;
}

export async function publicUser(id: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      title: true,
      regionId: true,
      institutionId: true,
      region: { select: { code: true, name: true } },
      institution: { select: { name: true, permanentId: true } },
      profile: { select: { skills: true } },
    },
  });
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    title: u.title,
    regionId: u.regionId,
    regionCode: u.region?.code ?? null,
    regionName: u.region?.name ?? null,
    institutionId: u.institutionId,
    institutionName: u.institution?.name ?? null,
    skills: (u.profile?.skills as string[] | undefined) ?? [],
  };
}
