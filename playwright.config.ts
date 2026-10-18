import { defineConfig, devices } from '@playwright/test';
import {
  ROOT_TEST_DIR,
  ROOT_TEST_IGNORE,
  ROOT_TEST_MATCH,
} from './playwright/root-spec-pattern.mjs';

/**
 * Playwright configuration for browser-based unit tests
 * These tests render components in a real browser to verify DOM measurements
 */
export default defineConfig({
  /* Discovery is defined once in playwright/root-spec-pattern.mjs so the
     scripts that classify root specs cannot drift from what runs here. */
  testDir: `./${ROOT_TEST_DIR}`,
  testMatch: ROOT_TEST_MATCH,
  testIgnore: ROOT_TEST_IGNORE,

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Each worker starts its own Vite module graph; bound concurrent cold compilation locally.
  workers: process.env.CI ? 1 : 2,

  // `list` streams results; the html report is still written to
  // playwright-report/ (CI uploads it) but never served. The default
  // `open: 'on-failure'` served it on :9323 after a local failure and kept the
  // run alive for ~2 h waiting for Ctrl+C (cloudlands-fe#3392), the same hang
  // playwright-ct.config.ts already avoids (intent-hq/intent#4652). View a
  // report with `pnpm exec playwright show-report`.
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // Base URL for file:// protocol tests
    trace: 'on-first-retry',
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
