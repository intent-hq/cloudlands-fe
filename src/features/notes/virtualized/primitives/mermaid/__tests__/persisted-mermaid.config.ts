import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'persisted-mermaid.native.ts',
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: [['list']],
  outputDir: process.env.MERMAID_PERSISTED_EVIDENCE,
});
