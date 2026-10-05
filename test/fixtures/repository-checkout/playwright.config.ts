import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'checkout.electron.ts',
  timeout: 120000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: process.env.CHECKOUT_ELECTRON_RESULTS ?? 'checkout-electron-results.json' },
    ],
  ],
  outputDir: process.env.CHECKOUT_ELECTRON_OUTPUT ?? 'test-results/checkout-electron',
});
