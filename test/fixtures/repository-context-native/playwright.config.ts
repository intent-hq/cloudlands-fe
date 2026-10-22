import { defineConfig } from '@playwright/test';
/** Explicit disposable actual-daemon/Electron proof; no ordinary browser discovery. */
export default defineConfig({
  testDir: '.',
  testMatch: 'context.electron.ts',
  workers: 1,
  retries: 0,
  timeout: 150_000,
  reporter: 'line',
  outputDir: process.env.REPOSITORY_CONTEXT_EVIDENCE_DIR
    ? `${process.env.REPOSITORY_CONTEXT_EVIDENCE_DIR}/playwright`
    : 'test-results/repository-context-native',
});
