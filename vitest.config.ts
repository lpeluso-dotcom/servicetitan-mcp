import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Single fork: all suites share one worker. Avoids the multi-worker
    // teardown race that can trip a "timeout terminating forks worker" on exit.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    teardownTimeout: 20000,
  },
});
