import { defineConfig } from 'vitest/config';

// RefactorIt's own tests. Run with `npm test`. DeepTest measures this
// project with exactly this config.
export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
