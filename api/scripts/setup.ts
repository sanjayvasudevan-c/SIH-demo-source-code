// Recreates the aicte database, migrates, applies the audit guard, seeds and builds the template.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';
import { buildTemplate, withAdminClient } from '../src/lib/demoReset.js';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function waitForDb(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      await withAdminClient(async (c) => {
        await c.query('SELECT 1');
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Database did not become ready');
}

export async function ensureRolesAndDatabases(fresh: boolean): Promise<void> {
  const migratorPw = process.env.MIGRATOR_PASSWORD ?? 'migrator_pw';
  const appPw = process.env.APP_PASSWORD ?? 'app_pw';
  await withAdminClient(async (c) => {
    const roles = await c.query<{ rolname: string }>(`SELECT rolname FROM pg_roles WHERE rolname IN ('aicte_migrator','aicte_app')`);
    const have = new Set(roles.rows.map((r) => r.rolname));
    if (!have.has('aicte_migrator')) await c.query(`CREATE ROLE aicte_migrator LOGIN CREATEDB PASSWORD '${migratorPw.replace(/'/g, "''")}'`);
    if (!have.has('aicte_app')) await c.query(`CREATE ROLE aicte_app LOGIN PASSWORD '${appPw.replace(/'/g, "''")}'`);
    if (fresh) await c.query('DROP DATABASE IF EXISTS aicte WITH (FORCE)');
    const dbs = await c.query<{ datname: string }>(`SELECT datname FROM pg_database WHERE datname IN ('aicte','aicte_seed')`);
    const haveDb = new Set(dbs.rows.map((r) => r.datname));
    if (!haveDb.has('aicte')) await c.query('CREATE DATABASE aicte OWNER aicte_migrator');
    if (!haveDb.has('aicte_seed')) await c.query('CREATE DATABASE aicte_seed OWNER aicte_migrator');
    await c.query('GRANT CONNECT ON DATABASE aicte TO aicte_app');
  });
}

async function main() {
  const migratorUrl = process.env.MIGRATOR_URL;
  if (!migratorUrl) throw new Error('MIGRATOR_URL is not set');
  await waitForDb();
  await ensureRolesAndDatabases(true);
  await migrate(migratorUrl);
  execSync('npx tsx prisma/seed.ts', { cwd: apiDir, stdio: 'inherit', env: { ...process.env, DATABASE_URL: migratorUrl } });
  await buildTemplate();
  console.log('[setup] template database aicte_seed built. `npm run demo:reset` restores it.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
