import { defineConfig } from '@playwright/test';

/** Explicit manual Electron fixture; ordinary browser discovery does not include it. */
export default defineConfig({
  testDir: '.',
  testMatch: 'routing.electron.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'line',
  outputDir: process.env.REPOSITORY_ROUTE_EVIDENCE_DIR ?? 'test-results/repository-route',
});
