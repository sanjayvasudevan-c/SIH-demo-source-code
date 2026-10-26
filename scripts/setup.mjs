// npm run setup: start the compose database (unless SETUP_NO_DOCKER=1), then migrate, seed and build the template.
// With Docker, the seed scores its form checks with the real form check container (published on localhost for the
// duration of the seed only); without it, the seed uses whatever FORMCHECK_URL points at, else the rules fallback.
import { execSync } from 'node:child_process';

const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
const tryRun = (cmd) => {
  try {
    execSync(cmd, { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
};

const docker = process.env.SETUP_NO_DOCKER !== '1';
let env = {};
if (docker) {
  run('docker compose up -d db');
  tryRun('docker rm -f aicte-formcheck-seed');
  if (tryRun('docker compose run -d --rm --name aicte-formcheck-seed -p 127.0.0.1:8001:8000 formcheck')) {
    env = { FORMCHECK_URL: 'http://127.0.0.1:8001' };
    await new Promise((r) => setTimeout(r, 5000));
  } else {
    console.warn('[setup] form check container did not start; seed form checks will use the rules fallback.');
  }
}
run('npm --workspace api run prisma:generate');
try {
  run('npm --workspace api run setup:db', env);
} finally {
  if (docker) tryRun('docker rm -f aicte-formcheck-seed');
}
