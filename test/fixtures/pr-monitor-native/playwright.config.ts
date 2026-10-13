import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
/** Explicit real Electron lane; never counted as Chromium component coverage. */
export default defineConfig({
  testDir: '.',
  testMatch: 'monitor.electron.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [
    ['list'],
    ['json', { outputFile: resolve('test-results/pr-monitor-native/results.json') }],
  ],
  outputDir: resolve('test-results/pr-monitor-native/attachments'),
});
