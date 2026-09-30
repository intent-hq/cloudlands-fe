/**
 * Playwright Configuration for Build Smoke Tests
 *
 * Runs smoke tests against the packaged Electron app.
 * Separate from the main e2e config so these can run independently.
 *
 * Usage: pnpm test:build-smoke
 */

import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const reportRoot = process.env.BUILD_SMOKE_REPORT_DIR ?? 'e2e-reports';

export default defineConfig({
  testDir: '.',

  testMatch: '**/build-smoke*.e2e.ts',

  // Sequential execution — packaged app tests are heavyweight
  fullyParallel: false,
  workers: 1,

  // 5 minutes global timeout — individual tests set their own via test.setTimeout()
  timeout: 5 * 60_000,

  expect: {
    timeout: 15_000,
  },

  retries: 1,

  reporter: [
    ['html', { outputFolder: join(reportRoot, 'build-smoke-html') }],
    ['json', { outputFile: join(reportRoot, 'results.json') }],
    ['list'],
  ],

  outputDir: join(reportRoot, 'build-smoke-results'),

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },
});
