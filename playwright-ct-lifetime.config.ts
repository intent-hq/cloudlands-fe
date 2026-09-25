/** Opt-in diagnostic overlay; the default CT lane is unchanged. */
import { defineConfig } from '@playwright/experimental-ct-svelte';
import { resolve } from 'node:path';
import base from './playwright-ct.config';

const executablePath = process.env.CT_LIFETIME_EXECUTABLE;
const output = process.env.CT_LIFETIME_OUTPUT;
if (!executablePath || !output) {
  throw new Error('Set CT_LIFETIME_EXECUTABLE and a fresh CT_LIFETIME_OUTPUT directory');
}

export default defineConfig(base, {
  ...(process.env.CT_LIFETIME_TIMEOUT_CASES === '1'
    ? { testDir: './playwright/ct-lifetime', testMatch: '**/*.ct.spec.ts' }
    : {}),
  outputDir: resolve(output, 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(output, 'results.json') }],
    ['html', { outputFolder: resolve(output, 'html'), open: 'never' }],
  ],
  use: {
    launchOptions: { executablePath },
  },
});
