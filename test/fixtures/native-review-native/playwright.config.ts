import { defineConfig } from '@playwright/test';
/** Manual owned-driver proof; not a hosted or normal-daemon provider test. */
export default defineConfig({
  testDir: '.',
  testMatch: 'review.electron.ts',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: 'line',
  outputDir: process.env.NATIVE_REVIEW_EVIDENCE_DIR
    ? `${process.env.NATIVE_REVIEW_EVIDENCE_DIR}/playwright`
    : 'test-results/native-review-native',
});
