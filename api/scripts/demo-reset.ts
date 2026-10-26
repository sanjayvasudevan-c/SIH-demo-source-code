import { recreateFromTemplate } from '../src/lib/demoReset.js';

if (process.env.DEMO_MODE !== 'true') {
  console.error('Demo reset is disabled unless DEMO_MODE=true');
  process.exit(1);
}
recreateFromTemplate()
  .then((ms) => {
    console.log(`[demo:reset] aicte recreated from aicte_seed in ${ms} ms. Schedulers reconnect on their own; the API reconnects on its next request.`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
