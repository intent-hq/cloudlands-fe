import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for browser-based unit tests
 * These tests render components in a real browser to verify DOM measurements
 */
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  testIgnore: [
    '**/catalog-manual-review.capture.spec.ts',
    '**/current-main-baseline.spec.ts',
    '**/electron-browser-lifetime.spec.ts',
  ],

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Each worker starts its own Vite module graph; bound concurrent cold compilation locally.
  workers: process.env.CI ? 1 : 2,

  // Reporter to use
  reporter: 'html',

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
