import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnv } from './env.js';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Builds aicte_test (migrated, directory seeded) and copies it to the aicte_test_seed template.
export default function setup(): void {
  execSync('npx tsx test/setupDb.ts', { cwd: apiDir, stdio: 'inherit', env: { ...process.env, ...testEnv } });
}
