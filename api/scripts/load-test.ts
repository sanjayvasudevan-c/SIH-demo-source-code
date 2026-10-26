// Load test of the demo stack at the deck's assumed scale (15,000 applications in a cycle).
//   npm run load:test            (DEMO_MODE=true, a running PostgreSQL with the aicte_seed template)
// 1. Reset the demo database, then bulk-copy the seeded applications (with their deadline items and
//    assignments, due dates spread ±20 days around today) until there are LOAD_APPS applications.
// 2. Time a full deadline-engine cycle over every open item, then a second cycle (must add no alerts).
// 3. Start the API in-process and time the main read screens under concurrent requests.
// 4. Print the results as JSON and reset the demo database again.
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { recreateFromTemplate, withAdminClient } from '../src/lib/demoReset.js';
import { runEngineCycle } from '../src/engine/cycle.js';

const TARGET = Number(process.env.LOAD_APPS ?? 15000);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 20);
const REQUESTS = Number(process.env.LOAD_REQUESTS ?? 400);
const ms = (t0: bigint) => Number(process.hrtime.bigint() - t0) / 1e6;

if (process.env.DEMO_MODE !== 'true') {
  console.error('Load test runs only against the demo database (DEMO_MODE=true).');
  process.exit(1);
}

async function columns(c: import('pg').Client, table: string): Promise<string[]> {
  const r = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table]);
  return r.rows.map((x) => x.column_name as string);
}

/** Copy seeded applications (and their open work) until the database holds TARGET applications. */
async function bulkCopy(): Promise<Record<string, number>> {
  return withAdminClient(async (c) => {
    const base = Number((await c.query('SELECT count(*) FROM "Application"')).rows[0].count);
    const n = Math.max(0, TARGET - base);
    const q = (s: string) => `"${s}"`;
    const appCols = await columns(c, 'Application');
    const itemCols = (await columns(c, 'DeadlineItem')).filter((x) => x !== 'id');
    const asgCols = await columns(c, 'Assignment');
    await c.query('BEGIN');
    await c.query(`CREATE TEMP TABLE tpl AS SELECT (row_number() OVER (ORDER BY id)) - 1 AS rn, id FROM "Application"`);
    await c.query(
      `CREATE TEMP TABLE m AS SELECT g, gen_random_uuid()::text AS new_id, tpl.id AS tpl_id FROM generate_series(1, $1::int) g JOIN tpl ON tpl.rn = g % (SELECT count(*) FROM tpl)`,
      [n],
    );
    const appSel = appCols.map((col) => (col === 'id' ? 'm.new_id' : col === 'applicationNo' ? `'LT-' || lpad(m.g::text, 6, '0')` : `a.${q(col)}`));
    await c.query(`INSERT INTO "Application" (${appCols.map(q).join(', ')}) SELECT ${appSel.join(', ')} FROM m JOIN "Application" a ON a.id = m.tpl_id`);
    const itemSel = itemCols.map((col) =>
      col === 'applicationId' ? 'm.new_id' : col === 'dueDate' ? `(d."dueDate" + ((m.g % 41) - 20))::date` : col === 'escalationLevel' ? '0' : `d.${q(col)}`,
    );
    await c.query(`INSERT INTO "DeadlineItem" (${itemCols.map(q).join(', ')}) SELECT ${itemSel.join(', ')} FROM m JOIN "DeadlineItem" d ON d."applicationId" = m.tpl_id`);
    const asgSel = asgCols.map((col) => (col === 'id' ? 'gen_random_uuid()::text' : col === 'applicationId' ? 'm.new_id' : `s.${q(col)}`));
    await c.query(`INSERT INTO "Assignment" (${asgCols.map(q).join(', ')}) SELECT ${asgSel.join(', ')} FROM m JOIN "Assignment" s ON s."applicationId" = m.tpl_id`);
    await c.query('COMMIT');
    await c.query('ANALYZE');
    const count = async (sql: string) => Number((await c.query(sql)).rows[0].count);
    return {
      seededApplications: base,
      applications: await count('SELECT count(*) FROM "Application"'),
      deadlineItems: await count('SELECT count(*) FROM "DeadlineItem"'),
      openDeadlineItems: await count(`SELECT count(*) FROM "DeadlineItem" WHERE status = 'OPEN'`),
      assignments: await count('SELECT count(*) FROM "Assignment"'),
    };
  }, process.env.APP_DB_NAME ?? 'aicte');
}

async function timeCycle() {
  const before = await prisma.alertLog.count();
  const t0 = process.hrtime.bigint();
  const result = await runEngineCycle({ source: 'load-test' });
  const elapsed = ms(t0);
  return { ms: Math.round(elapsed), newAlerts: (await prisma.alertLog.count()) - before, result };
}

function pct(sorted: number[], p: number) {
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
}

async function readLoad(port: number) {
  const base = `http://127.0.0.1:${port}/api`;
  const login = async (email: string) => {
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'demo1234' }) });
    if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
    return ((await r.json()) as { token: string }).token;
  };
  const screens: { name: string; email: string; path: string }[] = [
    { name: 'Action Center (officer)', email: 'priya@demo.in', path: '/action-center?filter=mine' },
    { name: 'Action Center summary (senior)', email: 'kumar@demo.in', path: '/action-center/summary' },
    { name: 'Applications list (officer)', email: 'priya@demo.in', path: '/applications' },
    { name: 'Team report (senior)', email: 'kumar@demo.in', path: '/reports/team' },
    { name: 'Authority queue', email: 'authority.south@demo.in', path: '/authority/queue' },
  ];
  const tokens = new Map<string, string>();
  for (const s of screens) if (!tokens.has(s.email)) tokens.set(s.email, await login(s.email));
  const out = [];
  for (const s of screens) {
    const times: number[] = [];
    let errors = 0;
    let next = 0;
    const t0 = process.hrtime.bigint();
    const worker = async () => {
      while (next < REQUESTS) {
        next++;
        const t = process.hrtime.bigint();
        const r = await fetch(base + s.path, { headers: { authorization: `Bearer ${tokens.get(s.email)}` } });
        await r.arrayBuffer();
        if (!r.ok) errors++;
        times.push(ms(t));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const wall = ms(t0) / 1000;
    times.sort((a, b) => a - b);
    out.push({ screen: s.name, requests: times.length, concurrency: CONCURRENCY, errors, p50ms: pct(times, 50), p95ms: pct(times, 95), maxMs: Math.round(times[times.length - 1]), perSecond: Math.round(times.length / wall) });
  }
  return out;
}

async function main() {
  await recreateFromTemplate();
  const t0 = process.hrtime.bigint();
  const data = await bulkCopy();
  const loadMs = Math.round(ms(t0));
  const first = await timeCycle();
  const second = await timeCycle();
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const reads = await readLoad((server.address() as AddressInfo).port);
  server.close();
  const report = {
    date: new Date().toISOString(),
    machine: { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, memoryGb: Math.round(os.totalmem() / 2 ** 30), node: process.version },
    data: { ...data, bulkLoadMs: loadMs },
    engine: { firstCycle: first, secondCycle: second },
    reads,
  };
  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  await recreateFromTemplate();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
