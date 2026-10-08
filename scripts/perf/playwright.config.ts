import { defineConfig } from '@playwright/test'

// Used by `npm run perf` (scripts/perf/run.cjs), not by the end-to-end tests.
export default defineConfig({
  testDir: '.',
  testMatch: 'perf.spec.ts',
  workers: 1,
  // A run takes as long as asked (--seconds), plus starting every instance.
  timeout: 0,
  reporter: 'list',
  outputDir: '../../test-results/perf'
})
