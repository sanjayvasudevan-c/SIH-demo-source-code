import pg from 'pg';
import { prisma, reconnect } from './db.js';
import * as clock from './clock.js';
import { loadHolidays } from './workdays.js';
import { clearRulesCache } from '../rules/service.js';

function adminUrl(): string {
  const url = process.env.DEMO_ADMIN_URL;
  if (!url) throw new Error('DEMO_ADMIN_URL is not set');
  return url;
}

const APP_DB = () => process.env.APP_DB_NAME ?? 'aicte';
const SEED_DB = () => process.env.TEMPLATE_DB_NAME ?? 'aicte_seed';

export async function withAdminClient<T>(fn: (c: pg.Client) => Promise<T>, database?: string): Promise<T> {
  const url = new URL(adminUrl());
  if (database) url.pathname = `/${database}`;
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Recreate the working database from the template. Returns elapsed milliseconds. */
export async function recreateFromTemplate(): Promise<number> {
  const started = process.hrtime.bigint();
  await withAdminClient(async (c) => {
    await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [SEED_DB()]);
    await c.query(`DROP DATABASE IF EXISTS "${APP_DB()}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${APP_DB()}" TEMPLATE "${SEED_DB()}" OWNER aicte_migrator`);
    await c.query(`GRANT CONNECT ON DATABASE "${APP_DB()}" TO aicte_app`);
  });
  return Number((process.hrtime.bigint() - started) / 1_000_000n);
}

/** Copy the working database into the template (end of seed). */
export async function buildTemplate(): Promise<void> {
  await withAdminClient(async (c) => {
    await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ($1, $2) AND pid <> pg_backend_pid()`, [APP_DB(), SEED_DB()]);
    await c.query(`DROP DATABASE IF EXISTS "${SEED_DB()}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${SEED_DB()}" TEMPLATE "${APP_DB()}" OWNER aicte_migrator`);
  });
}

// Snapshot mode (DEMO_RESET_MODE=snapshot, hosted demo): managed Postgres cannot drop and recreate databases from
// a template, so the seeded rows are copied once into the demo_seed schema and a reset copies them back in one
// transaction, as the table owner (DEMO_ADMIN_URL points at the working database itself in this mode).
const SNAPSHOT = 'demo_seed';
export const snapshotMode = () => process.env.DEMO_RESET_MODE === 'snapshot';

async function userTables(c: pg.Client): Promise<string[]> {
  const r = await c.query<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`);
  return r.rows.map((x) => x.t);
}

/** End of a hosted seed: copy every table into demo_seed. */
export async function buildSnapshot(): Promise<void> {
  await withAdminClient(async (c) => {
    const tables = await userTables(c);
    await c.query('BEGIN');
    await c.query(`DROP SCHEMA IF EXISTS ${SNAPSHOT} CASCADE`);
    await c.query(`CREATE SCHEMA ${SNAPSHOT}`);
    for (const t of tables) await c.query(`CREATE TABLE ${SNAPSHOT}."${t}" AS TABLE public."${t}"`);
    await c.query('COMMIT');
  });
}

export async function snapshotExists(): Promise<boolean> {
  return withAdminClient(async (c) => (await c.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [SNAPSHOT])).rowCount === 1);
}

/** Replace every row with the snapshot. Returns elapsed milliseconds. */
export async function restoreSnapshot(): Promise<number> {
  const started = process.hrtime.bigint();
  await withAdminClient(async (c) => {
    const tables = await userTables(c);
    const list = tables.map((t) => `public."${t}"`).join(', ');
    await c.query('BEGIN');
    await c.query(`SET LOCAL lock_timeout = '20s'`);
    // Row triggers (audit append-only, rule pack guards) would refuse the copy; the owner may switch them off
    // inside this transaction. TRUNCATE does not fire them.
    for (const t of tables) await c.query(`ALTER TABLE public."${t}" DISABLE TRIGGER USER`);
    // Some foreign keys form cycles, so no insert order satisfies them: drop them for the copy and add them back
    // (which re-checks every row) before committing.
    const fks = await c.query<{ tbl: string; name: string; def: string }>(`
      SELECT cl.relname AS tbl, k.conname AS name, pg_get_constraintdef(k.oid) AS def FROM pg_constraint k
      JOIN pg_class cl ON cl.oid = k.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE k.contype = 'f' AND n.nspname = 'public'`);
    for (const f of fks.rows) await c.query(`ALTER TABLE public."${f.tbl}" DROP CONSTRAINT "${f.name}"`);
    await c.query(`TRUNCATE ${list} RESTART IDENTITY`);
    for (const t of tables) {
      const cols = await c.query<{ c: string }>(
        `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [SNAPSHOT, t],
      );
      const names = cols.rows.map((x) => `"${x.c}"`).join(', ');
      if (names) await c.query(`INSERT INTO public."${t}" (${names}) SELECT ${names} FROM ${SNAPSHOT}."${t}"`);
    }
    // Serial columns continue after the restored rows.
    const seqs = await c.query<{ tbl: string; col: string; seq: string }>(`
      SELECT c.table_name AS tbl, c.column_name AS col, pg_get_serial_sequence('public."' || c.table_name || '"', c.column_name) AS seq
      FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.column_default LIKE 'nextval(%'`);
    for (const s of seqs.rows) {
      if (s.seq) await c.query(`SELECT setval($1, GREATEST((SELECT COALESCE(MAX("${s.col}"), 0) FROM public."${s.tbl}"), 1), (SELECT COUNT(*) > 0 FROM public."${s.tbl}"))`, [s.seq]);
    }
    for (const f of fks.rows) await c.query(`ALTER TABLE public."${f.tbl}" ADD CONSTRAINT "${f.name}" ${f.def}`);
    for (const t of tables) await c.query(`ALTER TABLE public."${t}" ENABLE TRIGGER USER`);
    await c.query('COMMIT');
  });
  return Number((process.hrtime.bigint() - started) / 1_000_000n);
}

/** Used by the API: drop its own connections, recreate, reconnect, reload cached state. */
export async function resetDemoInProcess(): Promise<number> {
  if (snapshotMode()) {
    const ms = await restoreSnapshot();
    await clock.refresh();
    clearRulesCache();
    await loadHolidays(prisma);
    return ms;
  }
  await prisma.$disconnect().catch(() => undefined);
  const ms = await recreateFromTemplate();
  await reconnect();
  await clock.refresh();
  clearRulesCache();
  await loadHolidays(prisma);
  return ms;
}
