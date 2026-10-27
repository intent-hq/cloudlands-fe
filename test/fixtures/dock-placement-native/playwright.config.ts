import { defineConfig } from '@playwright/test';

/** Explicit native lane: never launches the installed app or connects to a daemon. */
export default defineConfig({
  testDir: '.',
  testMatch: 'placement.electron.ts',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: process.env.DOCK_PLACEMENT_EVIDENCE_DIR
          ? `${process.env.DOCK_PLACEMENT_EVIDENCE_DIR}/results.json`
          : 'test-results/dock-placement-native/results.json',
      },
    ],
  ],
  outputDir: process.env.DOCK_PLACEMENT_EVIDENCE_DIR
    ? `${process.env.DOCK_PLACEMENT_EVIDENCE_DIR}/playwright`
    : 'test-results/dock-placement-native/playwright',
});
