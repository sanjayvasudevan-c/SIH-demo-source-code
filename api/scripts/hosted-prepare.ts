// Vercel build step (hosted demo): make the Neon database ready for this deployment.
// - creates or updates the aicte_app role (password derived in src/lib/hosted.ts);
// - applies migrations and the guard SQL;
// - seeds and snapshots only when the schema or seed code changed since the last snapshot (or there is none), so
//   ordinary redeploys keep the demo's current state. Preview and production share the database, so concurrent
//   builds take an advisory lock.
// Does nothing outside the hosted environment.
import '../src/lib/hosted.js';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { derive, hosted } from '../src/lib/hosted.js';
import { CYCLE_LOCK_ID } from '../src/engine/cycle.js';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = 7_310_001;

function seedVersion(): string {
  const h = crypto.createHash('sha256');
  const walk = (p: string) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p).sort()) walk(path.join(p, f));
    else h.update(path.relative(apiDir, p)).update(fs.readFileSync(p));
  };
  for (const p of ['prisma/schema.prisma', 'prisma/migrations', 'prisma/sql', 'prisma/seed', 'prisma/seed.ts']) walk(path.join(apiDir, p));
  return h.digest('hex').slice(0, 16);
}

async function main() {
  if (!hosted) {
    console.log('[hosted] no Neon connection in the environment; skipping database preparation');
    return;
  }
  const owner = process.env.MIGRATOR_URL!;
  const version = seedVersion();
  const c = new pg.Client({ connectionString: owner });
  await c.connect();
  try {
    await c.query('SELECT pg_advisory_lock($1)', [LOCK]);
    // A function instance frozen mid-cycle may still hold the engine lock; end such idle sessions.
    const stale = await c.query(
      `SELECT pg_terminate_backend(l.pid) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE l.locktype = 'advisory' AND l.objid = $1 AND a.state = 'idle' AND a.state_change < now() - interval '2 minutes'`,
      [CYCLE_LOCK_ID],
    );
    if (stale.rowCount) console.log(`[hosted] released ${stale.rowCount} stale engine lock(s)`);
    const pw = derive(owner, 'app-role');
    const role = await c.query(`SELECT 1 FROM pg_roles WHERE rolname = 'aicte_app'`);
    await c.query(`${role.rowCount ? 'ALTER' : 'CREATE'} ROLE aicte_app LOGIN PASSWORD '${pw}'`);

    const meta = await c
      .query<{ version: string }>(`SELECT version FROM demo_seed._meta LIMIT 1`)
      .then((r) => r.rows[0]?.version ?? null)
      .catch(() => null);
    const env = { ...process.env, DATABASE_URL: owner };
    if (meta === version) {
      execSync('npx tsx scripts/migrate.ts', { cwd: apiDir, stdio: 'inherit', env: { ...env, MIGRATOR_URL: owner } });
      console.log(`[hosted] seed ${version} already in place; demo state kept`);
      return;
    }
    console.log(`[hosted] seeding (snapshot ${meta ?? 'none'} → ${version})`);
    await c.query('DROP SCHEMA IF EXISTS demo_seed CASCADE');
    await c.query('DROP SCHEMA IF EXISTS public CASCADE');
    await c.query('CREATE SCHEMA public');
    execSync('npx tsx scripts/migrate.ts', { cwd: apiDir, stdio: 'inherit', env: { ...env, MIGRATOR_URL: owner } });
    execSync('npx tsx prisma/seed.ts', { cwd: apiDir, stdio: 'inherit', env });
    const { buildSnapshot } = await import('../src/lib/demoReset.js');
    await buildSnapshot();
    await c.query('CREATE TABLE demo_seed._meta (version text NOT NULL)');
    await c.query('INSERT INTO demo_seed._meta VALUES ($1)', [version]);
    console.log(`[hosted] seeded and snapshotted (${version})`);
  } finally {
    await c.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => undefined);
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
