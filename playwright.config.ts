import { defineConfig } from '@playwright/test'

// End-to-end tests: real app instances (the production build in out/) driven
// through Playwright's Electron support. See docs/en-US/testing.md.
export default defineConfig({
  testDir: 'e2e',
  // Instances share the machine (ports, mDNS), so one test at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results'
})
