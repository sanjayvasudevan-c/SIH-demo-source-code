// Test database: recreate aicte_test, migrate, seed the directory with a fixed "today", build the template.
process.env.DATABASE_URL = process.env.MIGRATOR_URL;

async function main() {
  const { withAdminClient, buildTemplate } = await import('../src/lib/demoReset.js');
  const { migrate } = await import('../scripts/migrate.js');
  await withAdminClient(async (c) => {
    await c.query('DROP DATABASE IF EXISTS aicte_test WITH (FORCE)');
    await c.query('DROP DATABASE IF EXISTS aicte_test_seed WITH (FORCE)');
    await c.query('CREATE DATABASE aicte_test OWNER aicte_migrator');
  });
  await migrate(process.env.MIGRATOR_URL!);
  const { prisma } = await import('../src/lib/db.js');
  const { seedDirectory } = await import('../prisma/seed/directory.js');
  const { parseDateOnly } = await import('../src/lib/dates.js');
  const { seedRulePacks } = await import('../prisma/seed/rulepacks.js');
  await seedDirectory(prisma, { today: parseDateOnly(process.env.TEST_TODAY!) });
  await seedRulePacks(prisma, { today: parseDateOnly(process.env.TEST_TODAY!) });
  await prisma.$disconnect();
  await buildTemplate();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
