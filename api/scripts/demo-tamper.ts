// Stands in for someone with server access: as the postgres superuser, disable the audit trigger,
// change one audit row's reason, re-enable the trigger. Verify integrity then names the broken row.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withAdminClient } from '../src/lib/demoReset.js';

export async function tamperOneRow(): Promise<{ id: string; chainKey: string; action: string }> {
  return withAdminClient(async (c) => {
    const pick = await c.query<{ id: string; chainKey: string; action: string }>(
      `SELECT id::text, "chainKey", action FROM "AuditLog"
       WHERE "applicationId" IS NOT NULL ORDER BY id DESC LIMIT 1 OFFSET 2`,
    );
    const row =
      pick.rows[0] ??
      (await c.query<{ id: string; chainKey: string; action: string }>(`SELECT id::text, "chainKey", action FROM "AuditLog" ORDER BY id DESC LIMIT 1`)).rows[0];
    if (!row) throw new Error('No audit rows to tamper with');
    await c.query('BEGIN');
    await c.query('ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_append_only');
    await c.query(`UPDATE "AuditLog" SET reason = COALESCE(reason, '') || ' (edited directly in the database)' WHERE id = $1::bigint`, [row.id]);
    await c.query('ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_append_only');
    await c.query('COMMIT');
    return row;
  }, process.env.APP_DB_NAME ?? 'aicte');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  tamperOneRow()
    .then((row) => console.log(`[demo:tamper] changed the reason on audit row ${row.id} (chain ${row.chainKey}, action ${row.action}).`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
