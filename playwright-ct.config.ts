import { defineConfig, devices } from '@playwright/experimental-ct-svelte';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * NOTE: run this config via `pnpm run test:ct` (scripts/run-ct-tests.mjs), not
 * bare `npx playwright test -c playwright-ct.config.ts`. The experimental CT
 * packages stopped at 1.58.x while the repo's @playwright/test is newer, and a
 * mismatched runner crashes in ct-core's babel transform before discovery
 * (intent-hq/monorepo#1586). The launcher resolves the runner from ct-core's
 * own dependency tree so the versions always align.
 */
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.ct.spec.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Port to use for Playwright component endpoint. */
    ctPort: 3100,

    /* Vite configuration for component testing */
    ctViteConfig: {
      resolve: {
        alias: [
          { find: '$lib', replacement: resolve(__dirname, './src/lib') },
          { find: '$store', replacement: resolve(__dirname, './src/store') },
          { find: '$features', replacement: resolve(__dirname, './src/features') },
          { find: '$shared', replacement: resolve(__dirname, './src/shared') },
          // SvelteKit runtime modules don't exist outside the kit plugin;
          // resolve them to browser-safe stubs (the vitest mocks in
          // src/__mocks__/$app depend on `vi` and can't run in this bundle).
          { find: '$app', replacement: resolve(__dirname, './playwright/app-stubs') },
          // Icon compatibility aliases (mirrors vite.config.mjs): legacy
          // svelte-fa / fontawesome identifiers resolve to the Phosphor-backed
          // catalog and renderer.
          {
            find: /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
            replacement: resolve(__dirname, './src/lib/icons/phosphor-icons.ts'),
          },
          {
            find: /^svelte-fa$/,
            replacement: resolve(__dirname, './src/lib/components/shared/icons/fa-proxy.ts'),
          },
        ],
      },
      css: {
        postcss: {
          plugins: [tailwindcss, autoprefixer],
        },
      },
    },
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
