import { prisma } from '../../src/lib/db.js';
import { NAMED_DEMO_EMAILS, DEMO_PASSWORD } from '../../src/auth/demoUsers.js';
import type { Directory } from './directory.js';

export async function printSummary(dir: Directory): Promise<void> {
  const byStage = await prisma.application.groupBy({ by: ['stage', 'status'], _count: true, orderBy: [{ stage: 'asc' }, { status: 'asc' }] });
  console.log(`\nApplications: ${await prisma.application.count()}`);
  console.table(byStage.map((r) => ({ stage: r.stage, status: r.status, count: r._count })));

  const flags = await prisma.exceptionFlag.findMany({ where: { resolvedAt: null }, include: { application: { select: { regionId: true } } } });
  const counts = new Map<string, { south: number; west: number; levels: Set<number> }>();
  for (const f of flags) {
    const e = counts.get(f.reasonCode) ?? { south: 0, west: 0, levels: new Set<number>() };
    if (f.application.regionId === dir.regions.SOUTH) e.south++;
    else e.west++;
    if (f.reasonCode === 'ESCALATED') e.levels.add(f.escalationLevel);
    counts.set(f.reasonCode, e);
  }
  console.log('\nOpen flags by reason code');
  console.table([...counts.entries()].sort().map(([code, e]) => ({ reasonCode: code, south: e.south, west: e.west, levels: e.levels.size ? [...e.levels].sort().join(',') : '' })));

  const officers = await prisma.user.findMany({
    where: { role: 'OFFICER', regionId: dir.regions.SOUTH },
    include: { profile: true, reportsTo: { select: { name: true } }, assignments: { where: { releasedAt: null } } },
    orderBy: [{ reportsToId: 'asc' }, { name: 'asc' }],
  });
  const rows = officers.map((o) => {
    const pts = o.assignments.reduce((s, a) => s + Number(a.weight), 0);
    const cap = Number(o.profile?.capacityPoints ?? 10);
    return { officer: o.name, senior: o.reportsTo?.name ?? '', tasks: o.assignments.length, points: Math.round(pts * 100) / 100, capacity: cap, utilisation: Math.round((pts / cap) * 100) / 100 };
  });
  console.log('\nUtilisation per South officer (Kumar Sharma\'s team first)');
  console.table([...rows.filter((r) => r.senior === 'Kumar Sharma'), ...rows.filter((r) => r.senior !== 'Kumar Sharma')]);

  const users = await prisma.user.findMany({
    where: { email: { in: [...NAMED_DEMO_EMAILS] } },
    select: { email: true, name: true, role: true, region: { select: { code: true } } },
  });
  const order = new Map<string, number>(NAMED_DEMO_EMAILS.map((e, i) => [e, i]));
  users.sort((a, b) => (order.get(a.email) ?? 0) - (order.get(b.email) ?? 0));
  console.log(`\nDemo users (password for all: ${DEMO_PASSWORD})`);
  console.table(users.map((u) => ({ email: u.email, name: u.name, role: u.role, region: u.region?.code ?? '' })));

  const westApp = await prisma.application.findFirst({ where: { regionId: dir.regions.WEST, status: 'IN_STAGE' }, orderBy: { applicationNo: 'asc' } });
  if (westApp) console.log(`\nWEST application for the access-denied demo: ${westApp.applicationNo}  /cases/${westApp.id}`);
  const fc = await prisma.formCheckResult.groupBy({ by: ['severity'], _count: true });
  console.log(`Form check results: ${fc.map((f) => `${f.severity} ${f._count}`).join(', ')}`);
}
