import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;
const WARM_FIRST_VISIBLE_BUDGET_MS = 30_000;
const SERVER_PREWARM_TIMEOUT_MS = 60_000;
const LEGACY_VISIBLE_TIMEOUT_MS = 60_000;
const LEGACY_RESOURCE_BUDGET = 1_600;
const STATE_SWITCH_BUDGET_MS = 1_500;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to a running pnpm run dev:ui server.');
test.describe.configure({ mode: 'serial' });

interface LoadMetrics {
  firstVisibleMs: number;
  readyMs: number;
  resources: string[];
}

async function resourceUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
}

async function measureLoad(
  page: Page,
  path: string,
  firstVisible: Locator,
  ready = firstVisible,
  timeoutMs = WARM_FIRST_VISIBLE_BUDGET_MS,
): Promise<LoadMetrics> {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10_000));
  const startedAt = Date.now();
  await page.goto(`${baseUrl}${path}`, {
    timeout: timeoutMs,
    waitUntil: 'domcontentloaded',
  });
  await firstVisible.waitFor({ state: 'visible', timeout: timeoutMs });
  const firstVisibleMs = Date.now() - startedAt;
  await ready.waitFor({ state: 'visible', timeout: timeoutMs });
  return {
    firstVisibleMs,
    readyMs: Date.now() - startedAt,
    resources: await resourceUrls(page),
  };
}

interface DirectScene {
  slug: string;
  state: string;
  resourceBudget: number;
  product: (page: Page) => Locator;
}

const directScenes: DirectScene[] = [
  {
    slug: 'button',
    state: 'loading',
    resourceBudget: 800,
    product: (page) => page.getByRole('button', { name: 'Saving' }),
  },
  {
    slug: 'streaming-status',
    state: 'error',
    resourceBudget: 825,
    product: (page) => page.locator('[data-stream-terminal-error="true"]'),
  },
  {
    slug: 'mcp-server-form',
    state: 'empty',
    resourceBudget: 825,
    product: (page) => page.locator('[data-testid="catalog-scene-focus"] input').first(),
  },
  {
    slug: 'workspace-sidebar',
    state: 'busy',
    resourceBudget: 925,
    product: (page) => page.locator('[data-workspace-sidebar-preview]'),
  },
  {
    slug: 'panel-tab-strip',
    state: 'many-tabs',
    resourceBudget: 925,
    product: (page) => page.locator('[data-panel-tab-strip-preview]'),
  },
];

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(directScenes.length * SERVER_PREWARM_TIMEOUT_MS + 5_000);
  const serverPrewarmLoads: Record<string, unknown> = {};
  for (const direct of directScenes) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const metrics = await measureLoad(
      page,
      `/sandbox/${direct.slug}?state=${direct.state}`,
      direct.product(page),
      page.locator('[data-preview-ready=true]'),
      SERVER_PREWARM_TIMEOUT_MS,
    );
    const prewarmMetrics = {
      requests: metrics.resources.length,
      firstVisibleMs: metrics.firstVisibleMs,
      readyMs: metrics.readyMs,
    };
    serverPrewarmLoads[direct.slug] = prewarmMetrics;
    console.info(
      `ui-preview-load-budget ${JSON.stringify({
        serverPrewarmLoad: {
          slug: direct.slug,
          ...prewarmMetrics,
        },
      })}`,
    );
    await context.close();
  }
  console.info(`ui-preview-load-budget ${JSON.stringify({ serverPrewarmLoads })}`);
});

async function newMeasuredPage(
  browser: Browser,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  return { page: await context.newPage(), close: () => context.close() };
}

test('keeps warm-server direct scenes inside fresh-browser load budgets', async ({ browser }) => {
  test.setTimeout(directScenes.length * WARM_FIRST_VISIBLE_BUDGET_MS + 15_000);
  for (const direct of directScenes) {
    const measured = await newMeasuredPage(browser);
    const scene = measured.page.locator('[data-preview-ready=true]');
    const metrics = await measureLoad(
      measured.page,
      `/sandbox/${direct.slug}?state=${direct.state}`,
      direct.product(measured.page),
      scene,
    );

    expect(metrics.firstVisibleMs).toBeLessThan(WARM_FIRST_VISIBLE_BUDGET_MS);
    expect(metrics.readyMs).toBeLessThan(WARM_FIRST_VISIBLE_BUDGET_MS);
    expect(metrics.resources.length).toBeLessThanOrEqual(direct.resourceBudget);
    expect(
      metrics.resources.filter((url) =>
        /CatalogFixtureList\.svelte|catalog-renderers\.ts|CatalogGallery\.svelte/.test(url),
      ),
    ).toEqual([]);
    expect(
      metrics.resources.filter(
        (url) => url.includes('.preview.') && !url.includes(`/${direct.slug}.preview.`),
      ),
    ).toEqual([]);

    const result: Record<string, unknown> = {
      requests: metrics.resources.length,
      firstVisibleMs: metrics.firstVisibleMs,
      readyMs: metrics.readyMs,
    };
    if (direct.slug === 'button') {
      const beforeSwitchResources = metrics.resources.length;
      const switchStartedAt = Date.now();
      await measured.page.getByRole('link', { name: 'destructive' }).click();
      await expect(scene).toHaveAttribute('data-preview-state', 'destructive', {
        timeout: STATE_SWITCH_BUDGET_MS,
      });
      await expect(measured.page.getByRole('button', { name: 'Delete workspace' })).toBeVisible();
      const switchMs = Date.now() - switchStartedAt;
      const switchResources = (await resourceUrls(measured.page)).length - beforeSwitchResources;
      expect(switchMs).toBeLessThan(STATE_SWITCH_BUDGET_MS);
      expect(switchResources).toBe(0);
      result.stateSwitch = { requests: switchResources, firstVisibleMs: switchMs };
    }
    console.info(`ui-preview-load-budget ${JSON.stringify({ [direct.slug]: result })}`);
    await measured.close();
  }
});

test('preserves the legacy detail route behind its lazy boundary', async ({ page }) => {
  test.setTimeout(LEGACY_VISIBLE_TIMEOUT_MS + 10_000);
  const metrics = await measureLoad(
    page,
    '/sandbox/button',
    page.locator('[data-catalog-preview="button"]').first(),
    undefined,
    LEGACY_VISIBLE_TIMEOUT_MS,
  );

  expect(metrics.firstVisibleMs).toBeLessThan(LEGACY_VISIBLE_TIMEOUT_MS);
  expect(metrics.resources.length).toBeLessThanOrEqual(LEGACY_RESOURCE_BUDGET);
  await expect(page.getByTestId('catalog-scene')).toHaveCount(0);
  console.info(
    `ui-preview-load-budget ${JSON.stringify({
      legacyDetail: {
        requests: metrics.resources.length,
        firstVisibleMs: metrics.firstVisibleMs,
      },
    })}`,
  );
});

test('preserves the complete gallery behind its lazy boundary', async ({ page }) => {
  test.setTimeout(LEGACY_VISIBLE_TIMEOUT_MS + 10_000);
  const metrics = await measureLoad(
    page,
    '/sandbox',
    page.locator('[data-catalog-gallery-entry] [data-catalog-preview]').first(),
    undefined,
    LEGACY_VISIBLE_TIMEOUT_MS,
  );

  expect(metrics.firstVisibleMs).toBeLessThan(LEGACY_VISIBLE_TIMEOUT_MS);
  expect(metrics.resources.length).toBeLessThanOrEqual(LEGACY_RESOURCE_BUDGET);
  await expect(page.getByTestId('catalog-gallery')).toBeVisible();
  expect(await page.locator('[data-catalog-gallery-entry]').count()).toBeGreaterThan(20);
  console.info(
    `ui-preview-load-budget ${JSON.stringify({
      gallery: { requests: metrics.resources.length, firstVisibleMs: metrics.firstVisibleMs },
    })}`,
  );
});
