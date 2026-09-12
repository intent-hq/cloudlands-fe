import { defineConfig, devices } from '@playwright/experimental-ct-svelte';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import os from 'os';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { resolveCtWorkers } from './playwright/ct-workers';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Bound local workers on the shared daemon host (intent-hq/cloudlands-fe#2373;
// the vitest precedent is intent-hq/monorepo#545). Playwright's default of 50%
// of cores means 16 Chromium-backed workers on the 32-logical-core box, and
// under external load (builds, other agents) component mounts time out in
// full runs while passing in isolation. Local runs use
// min(4, max(1, floor(availableParallelism / 4))); PW_WORKERS=N raises or
// lowers it and the CLI `--workers=N` still wins over the config value.
// CI keeps its single worker per shard (see .github/workflows/intent-pr.yml).
const workers = resolveCtWorkers({ env: process.env, cpus: os.availableParallelism() });
// The config is re-evaluated inside every worker process (which Playwright
// marks with TEST_WORKER_INDEX); print the resolved count from the runner
// process only, and never on CI where the count is fixed.
if (!process.env.CI && !process.env.TEST_WORKER_INDEX) {
  console.error(`[playwright-ct] workers: ${workers} (override with --workers=N or PW_WORKERS=N)`);
}

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
  /* Retry twice on CI. Locally, retry once so a single load-induced mount
     timeout on the shared host (intent-hq/cloudlands-fe#2373) reports as
     flaky instead of failing the run; `trace: 'on-first-retry'` below then
     captures a trace for it. */
  retries: process.env.CI ? 2 : 1,
  /* 1 on CI; bounded locally — see `workers` above. */
  workers,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters
     `list` streams results to the terminal; the html report is still written
     to playwright-report/ but never served automatically — a run that stayed
     alive on :9323 after a failure blocked chained automation
     (intent-hq/intent#4652). Opt in to viewing via the launcher
     (`CT_HTML_REPORT=open` / `--open-report`, see scripts/run-ct-tests.mjs). */
  reporter: [['list'], ['html', { open: 'never' }]],

  expect: {
    /* Screenshot baselines are generated on the GH-hosted runner image, but
       the CI shards can also route to the self-hosted tinybox runners, which
       rasterize the odd pixel differently (a 1-pixel diff at 200% zoom
       failed a shard deterministically). Tolerate sub-percent rasterization
       drift so baselines stay portable across runner environments — do NOT
       regenerate baselines on tinybox instead, that just flips the failure
       onto the GH-hosted burst path. Ratio-based rather than maxDiffPixels:
       config- and assertion-level options merge per key and ALL set bounds
       must hold, so a pixel-count default here would tighten (not loosen)
       assertions that only set maxDiffPixelRatio. */
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Port to use for Playwright component endpoint. CT_PORT overrides the
       default for CI shards on the shared self-hosted host, where a fixed
       port would collide across co-tenant runner slots. */
    ctPort: process.env.CT_PORT ? Number(process.env.CT_PORT) : 3100,

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
      worker: {
        format: 'es',
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
