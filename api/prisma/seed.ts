// Demo seed. Connects as aicte_migrator. Run on an empty, migrated database (scripts/setup.ts does that).
process.env.DATABASE_URL = process.env.MIGRATOR_URL ?? process.env.DATABASE_URL;

async function main() {
  const { prisma } = await import('../src/lib/db.js');
  const clock = await import('../src/lib/clock.js');
  const { seedDirectory } = await import('./seed/directory.js');
  const { seedHistory } = await import('./seed/history.js');
  const { seedRulePacks } = await import('./seed/rulepacks.js');
  const { printSummary } = await import('./seed/summary.js');

  const existing = await prisma.user.count();
  if (existing > 0) throw new Error('Database is not empty. Run `npm run setup` (it recreates the database).');

  const realToday = clock.today();
  console.log('[seed] directory');
  const dir = await seedDirectory(prisma, { today: realToday });
  console.log('[seed] rule packs');
  await seedRulePacks(prisma, { today: realToday });
  console.log('[seed] history');
  await seedHistory(dir);
  clock.setOverride(null);
  await printSummary(dir);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
