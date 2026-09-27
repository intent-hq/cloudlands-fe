/** Opt-in artifact control. Uses the normal pinned browser and trace policy. */
import { defineConfig } from '@playwright/experimental-ct-svelte';
import { resolve } from 'node:path';
import base from './playwright-ct.config';

const output = process.env.CT_EVIDENCE_OUTPUT;
if (!output)
  throw new Error('Set a fresh CT_EVIDENCE_OUTPUT directory for the intentional-red control');

export default defineConfig(base, {
  testDir: './playwright/ct-evidence',
  outputDir: resolve(output, 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(output, 'results.json') }],
    ['html', { outputFolder: resolve(output, 'html'), open: 'never' }],
  ],
});
