import { defineConfig } from 'vitest/config';
import { testEnv } from './test/env.js';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: testEnv,
  },
});
