import { defineConfig } from '@playwright/test';
import browserConfig from './playwright.config';

export default defineConfig({
  ...browserConfig,
  testMatch: [
    '**/catalog-manual-review.capture.spec.ts',
    '**/current-main-baseline.spec.ts',
    '**/electron-browser-lifetime.spec.ts',
  ],
  testIgnore: [],
  // Manual review runs are interactive: keep serving the report on failure
  // rather than inheriting the gate's `open: 'never'` (cloudlands-fe#3392).
  // verify:changed never selects these specs.
  reporter: [['list'], ['html', { open: 'on-failure' }]],
});
