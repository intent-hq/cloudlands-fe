/**
 * Playwright Configuration for E2E Tests
 *
 * Comprehensive configuration for end-to-end testing of the Electron application
 */

import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  // Test directory
  testDir: './e2e',

  // Test file patterns
  testMatch: '**/*.e2e.ts',

  // Test execution settings
  fullyParallel: false, // Run tests sequentially for Electron app
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 2,

  // Timeouts
  timeout: 120000, // 2 minutes per test
  expect: {
    timeout: 10000, // 10 seconds for assertions
  },

  // Reporting
  reporter: [
    ['html', { outputFolder: 'e2e-reports/html' }],
    ['json', { outputFile: 'e2e-reports/results.json' }],
    ['junit', { outputFile: 'e2e-reports/junit.xml' }],
    ['list'],
  ],

  // Output directories
  outputDir: 'e2e-reports/test-results',

  // Global setup/teardown
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  // Shared settings
  use: {
    // Trace settings
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',

    // Screenshot settings
    screenshot: 'only-on-failure',

    // Video settings
    video: process.env.CI ? 'retain-on-failure' : 'on',

    // Viewport size
    viewport: { width: 1920, height: 1080 },

    // Action timeout
    actionTimeout: 15000,

    // Navigation timeout
    navigationTimeout: 30000,
  },

  // Projects for different test suites
  projects: [
    {
      name: 'complete-workflows',
      testMatch: '**/complete-user-workflows.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          slowMo: process.env.SLOW_MO ? parseInt(process.env.SLOW_MO) : 0,
        },
      },
    },
    {
      name: 'multi-agent',
      testMatch: '**/multi-agent-scenarios.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          slowMo: 0, // No slow motion for concurrent tests
        },
      },
    },
    {
      name: 'error-recovery',
      testMatch: '**/error-recovery.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Extra timeout for error recovery scenarios
        timeout: 180000,
      },
    },
    {
      name: 'performance',
      testMatch: '**/performance-load.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Performance tests need precise timing
        launchOptions: {
          slowMo: 0,
        },
      },
    },
    {
      name: 'ui-rendering',
      testMatch: '**/agent-ui-rendering.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        // UI tests may need visual debugging
        launchOptions: {
          slowMo: process.env.DEBUG ? 100 : 0,
        },
      },
    },
    {
      name: 'all-e2e',
      testMatch: '**/*.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  // Environment variables for tests
  metadata: {
    appPath: path.join(__dirname, '../'),
    testDataDir: path.join(__dirname, '../.test-data'),
    logsDir: path.join(__dirname, '../e2e-reports/logs'),
  },
});
