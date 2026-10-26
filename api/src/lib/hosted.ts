// Hosted demo (Vercel + Neon). Import before anything that reads the environment.
// The Neon integration provides one owner connection string (…DATABASE_URL_UNPOOLED, possibly with a project
// prefix). From it this module derives what the self-hosted stack configures by hand:
// - DATABASE_URL: the same database as the least-privileged aicte_app role (no UPDATE/DELETE on the audit log),
//   whose password is an HMAC of the owner password, so no extra secret has to be stored anywhere;
// - MIGRATOR_URL and DEMO_ADMIN_URL: the owner (migrations, seed, snapshot reset);
// - JWT_SECRET (unless set), DEMO_MODE, STORAGE_DRIVER=db, DEMO_RESET_MODE=snapshot, a short rules poll.
// It does nothing when DATABASE_URL is already set (local, compose, tests).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function ownerUrl(): string | null {
  const key = Object.keys(process.env).find((k) => /(^|_)DATABASE_URL_UNPOOLED$/.test(k));
  return key ? process.env[key]! : null;
}

export function derive(owner: string, purpose: string): string {
  const pw = decodeURIComponent(new URL(owner).password);
  return crypto.createHmac('sha256', pw).update(`aicte-demo:${purpose}`).digest('hex');
}

/** The aicte_app connection string for an owner URL. */
export function appUrl(owner: string): string {
  const u = new URL(owner);
  u.username = 'aicte_app';
  u.password = derive(owner, 'app-role');
  u.searchParams.set('connection_limit', '5');
  u.searchParams.set('pool_timeout', '20');
  return u.toString();
}

export const hosted = !process.env.DATABASE_URL && ownerUrl() !== null;

if (hosted) {
  const owner = ownerUrl()!;
  process.env.DATABASE_URL = appUrl(owner);
  process.env.MIGRATOR_URL = owner;
  process.env.DEMO_ADMIN_URL = owner;
  process.env.JWT_SECRET ??= derive(owner, 'jwt');
  process.env.DEMO_MODE ??= 'true';
  process.env.STORAGE_DRIVER ??= 'db';
  process.env.DEMO_RESET_MODE ??= 'snapshot';
  process.env.RULES_POLL_MS ??= '5000';
  process.env.HOSTED ??= 'vercel';
  // shared/ (expression variables, form-check samples, seed inputs) is copied next to the bundled function;
  // at build time the default ../shared from api/ is used.
  if (!process.env.SHARED_DIR && fs.existsSync(path.join(process.cwd(), 'shared'))) process.env.SHARED_DIR = path.join(process.cwd(), 'shared');
}
