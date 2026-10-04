import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'persisted-mermaid.native.ts',
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: [['list']],
  // Keep build inputs, source manifests and captures outside Playwright's cleared directory.
  outputDir: process.env.MERMAID_PERSISTED_EVIDENCE
    ? join(process.env.MERMAID_PERSISTED_EVIDENCE, 'test-results')
    : undefined,
});
