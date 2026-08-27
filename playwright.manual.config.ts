import { defineConfig } from '@playwright/test';
import browserConfig from './playwright.config';

export default defineConfig({
  ...browserConfig,
  testMatch: ['**/catalog-manual-review.capture.spec.ts', '**/current-main-baseline.spec.ts'],
  testIgnore: [],
});
