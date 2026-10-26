import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PG = process.env.TEST_PG_HOST ?? 'localhost:5432';
const here = path.dirname(fileURLToPath(import.meta.url));

export const testEnv: Record<string, string> = {
  DATABASE_URL: `postgresql://aicte_app:app_pw@${PG}/aicte_test`,
  MIGRATOR_URL: `postgresql://aicte_migrator:migrator_pw@${PG}/aicte_test`,
  DEMO_ADMIN_URL: process.env.TEST_DEMO_ADMIN_URL ?? `postgresql://postgres:postgres@${PG}/postgres`,
  APP_DB_NAME: 'aicte_test',
  TEMPLATE_DB_NAME: 'aicte_test_seed',
  JWT_SECRET: 'test-secret',
  DEMO_MODE: 'true',
  CLIENT_ORIGIN: 'http://localhost:5173',
  FORMCHECK_URL: 'http://127.0.0.1:59999',
  SHARED_DIR: path.resolve(here, '../../shared'),
  TEST_TODAY: '2026-11-02',
};
