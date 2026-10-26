import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type Db, type Tx } from './db.js';
import { advisoryXactLock } from './locks.js';
import { now } from './clock.js';

export const GENESIS = '0'.repeat(64);

export interface AuditEntry {
  /** Defaults to the application id, else "global". Rule pack events use "rules". */
  chainKey?: string;
  actorId?: string | null;
  actorRole: string;
  action: string;
  applicationId?: string | null;
  fromState?: unknown;
  toState?: unknown;
  reason?: string | null;
  meta?: Record<string, unknown>;
}

/** JSON with object keys sorted at every level, so jsonb round trips hash identically. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

export function computeRowHash(
  prevHash: string,
  row: {
    at: Date;
    chainKey: string;
    actorId: string | null;
    actorRole: string;
    action: string;
    applicationId: string | null;
    fromState: unknown;
    toState: unknown;
    reason: string | null;
    meta: unknown;
  },
): string {
  const payload = canonicalJSON([
    row.at.toISOString(),
    row.chainKey,
    row.actorId,
    row.actorRole,
    row.action,
    row.applicationId,
    row.fromState ?? null,
    row.toState ?? null,
    row.reason,
    row.meta ?? {},
  ]);
  return crypto.createHash('sha256').update(prevHash + payload).digest('hex');
}

/** Normalise through JSON so what we hash is exactly what jsonb stores and returns. */
function jsonValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  return JSON.parse(JSON.stringify(v));
}

export async function appendAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  const chainKey = entry.chainKey ?? entry.applicationId ?? 'global';
  await advisoryXactLock(tx, `audit:${chainKey}`);
  const last = await tx.auditLog.findFirst({
    where: { chainKey },
    orderBy: { id: 'desc' },
    select: { rowHash: true },
  });
  const prevHash = last?.rowHash ?? GENESIS;
  const row = {
    at: now(),
    chainKey,
    actorId: entry.actorId ?? null,
    actorRole: entry.actorRole,
    action: entry.action,
    applicationId: entry.applicationId ?? null,
    fromState: jsonValue(entry.fromState),
    toState: jsonValue(entry.toState),
    reason: entry.reason ?? null,
    meta: (jsonValue(entry.meta) ?? {}) as Record<string, unknown>,
  };
  const rowHash = computeRowHash(prevHash, row);
  await tx.auditLog.create({
    data: {
      ...row,
      fromState: (row.fromState ?? undefined) as Prisma.InputJsonValue | undefined,
      toState: (row.toState ?? undefined) as Prisma.InputJsonValue | undefined,
      meta: row.meta as Prisma.InputJsonValue,
      prevHash,
      rowHash,
    },
  });
}

/** Append an audit row in its own transaction (for events outside a case transaction). */
export async function appendAuditStandalone(entry: AuditEntry, db: Db = prisma): Promise<void> {
  if ('$transaction' in db) {
    await db.$transaction((tx) => appendAudit(tx, entry));
  } else {
    await appendAudit(db, entry);
  }
}

export interface VerifyResult {
  ok: boolean;
  chainsChecked: number;
  rowsChecked: number;
  firstBroken?: { chainKey: string; id: string };
  /** Every chain with a mismatch (each chain is checked to its end or its first broken row). */
  brokenChains: string[];
}

export async function verifyChains(db: Db = prisma): Promise<VerifyResult> {
  const rows = await db.auditLog.findMany({ orderBy: [{ chainKey: 'asc' }, { id: 'asc' }] });
  const lastHash = new Map<string, string>();
  const broken = new Map<string, string>();
  let rowsChecked = 0;
  let firstBroken: VerifyResult['firstBroken'];
  for (const r of rows) {
    if (broken.has(r.chainKey)) continue;
    const prev = lastHash.get(r.chainKey) ?? GENESIS;
    const expected = computeRowHash(prev, {
      at: r.at,
      chainKey: r.chainKey,
      actorId: r.actorId,
      actorRole: r.actorRole,
      action: r.action,
      applicationId: r.applicationId,
      fromState: r.fromState,
      toState: r.toState,
      reason: r.reason,
      meta: r.meta,
    });
    rowsChecked++;
    if (r.prevHash !== prev || r.rowHash !== expected) {
      broken.set(r.chainKey, r.id.toString());
      firstBroken ??= { chainKey: r.chainKey, id: r.id.toString() };
      lastHash.set(r.chainKey, r.rowHash);
      continue;
    }
    lastHash.set(r.chainKey, r.rowHash);
  }
  return { ok: broken.size === 0, chainsChecked: lastHash.size, rowsChecked, ...(firstBroken ? { firstBroken } : {}), brokenChains: [...broken.keys()] };
}
