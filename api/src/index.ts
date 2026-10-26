import { createApp } from './app.js';
import { prisma } from './lib/db.js';
import * as clock from './lib/clock.js';
import { loadHolidays } from './lib/workdays.js';
import { startRulesListener } from './rules/service.js';

async function main() {
  await clock.refresh();
  await loadHolidays(prisma);
  // Current published rules per cycle: LISTEN rules_published plus a 30-second poll.
  await startRulesListener();
  const port = Number(process.env.PORT ?? 4000);
  createApp().listen(port, () => {
    console.log(`[api] listening on ${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
