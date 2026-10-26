import { beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { prisma } from '../src/lib/db.js';
import { appendAudit, verifyChains } from '../src/lib/audit.js';
import { resetDb } from './helpers.js';
import { tamperOneRow } from '../scripts/demo-tamper.js';

describe('audit chain [31]', () => {
  beforeAll(async () => {
    await resetDb();
    const app = await prisma.institution.findFirstOrThrow();
    // Two chains: a global one and a per-application one (a fake application id is fine for the chain key).
    await prisma.$transaction(async (tx) => {
      await appendAudit(tx, { actorRole: 'ADMIN', action: 'LOGIN' });
      await appendAudit(tx, { actorRole: 'ADMIN', action: 'TIME_ADVANCED', meta: { days: 1, nested: { b: 2, a: 1 } } });
    });
    for (let i = 0; i < 5; i++) {
      await prisma.$transaction((tx) =>
        appendAudit(tx, {
          actorRole: 'OFFICER',
          action: 'COMPLETE_STAGE',
          applicationId: `app-${app.id}`,
          fromState: { stage: 'SCRUTINY', status: 'IN_STAGE' },
          toState: { stage: 'EVC', status: 'IN_STAGE' },
          reason: `step ${i}`,
        }),
      );
    }
  });

  it('verifies every chain', async () => {
    const r = await verifyChains();
    expect(r.ok).toBe(true);
    const seeded = await prisma.auditLog.count({ where: { chainKey: 'rules' } });
    expect(r.chainsChecked).toBe(3); // the application chain, global and the seeded rules chain
    expect(r.rowsChecked).toBe(7 + seeded);
  });

  it('rejects an UPDATE by the app role', async () => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await expect(c.query(`UPDATE "AuditLog" SET reason = 'x'`)).rejects.toThrow(/permission denied/);
      await expect(c.query(`DELETE FROM "AuditLog"`)).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });

  it('rejects an UPDATE by the table owner through the trigger', async () => {
    const c = new pg.Client({ connectionString: process.env.MIGRATOR_URL });
    await c.connect();
    try {
      await expect(c.query(`UPDATE "AuditLog" SET reason = 'x'`)).rejects.toThrow(/append-only/);
    } finally {
      await c.end();
    }
  });

  it('names the broken row after demo:tamper', async () => {
    const row = await tamperOneRow();
    const r = await verifyChains();
    expect(r.ok).toBe(false);
    expect(r.firstBroken).toEqual({ chainKey: row.chainKey, id: row.id });
  });
});
