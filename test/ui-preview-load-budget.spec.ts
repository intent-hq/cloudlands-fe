import { expect, test, type Locator, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;
const FIRST_VISIBLE_BUDGET_MS = 30_000;
const DIRECT_RESOURCE_BUDGET = 350;
const LEGACY_RESOURCE_BUDGET = 400;
const STATE_SWITCH_BUDGET_MS = 1_500;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to a running pnpm run dev:ui server.');
test.describe.configure({ mode: 'serial', timeout: 40_000 });

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
): Promise<LoadMetrics> {
  const startedAt = Date.now();
  await page.goto(`${baseUrl}${path}`, {
    timeout: FIRST_VISIBLE_BUDGET_MS,
    waitUntil: 'domcontentloaded',
  });
  await firstVisible.waitFor({ state: 'visible', timeout: FIRST_VISIBLE_BUDGET_MS });
  const firstVisibleMs = Date.now() - startedAt;
  await ready.waitFor({ state: 'visible', timeout: FIRST_VISIBLE_BUDGET_MS });
  return {
    firstVisibleMs,
    readyMs: Date.now() - startedAt,
    resources: await resourceUrls(page),
  };
}

test('keeps a cold direct scene inside its browser load budget', async ({ page }) => {
  const scene = page.locator('[data-preview-ready=true]');
  const metrics = await measureLoad(
    page,
    '/sandbox/button?state=loading&theme=dark&width=420&motion=reduced',
    page.getByRole('button', { name: 'Saving' }),
    scene,
  );

  expect(metrics.firstVisibleMs).toBeLessThan(FIRST_VISIBLE_BUDGET_MS);
  expect(metrics.readyMs).toBeLessThan(FIRST_VISIBLE_BUDGET_MS);
  expect(metrics.resources.length).toBeLessThanOrEqual(DIRECT_RESOURCE_BUDGET);
  expect(
    metrics.resources.filter((url) =>
      /CatalogFixtureList\.svelte|catalog-renderers\.ts|CatalogGallery\.svelte/.test(url),
    ),
  ).toEqual([]);
  expect(
    metrics.resources.filter(
      (url) => url.includes('.preview.') && !url.includes('/button/button.preview.ts'),
    ),
  ).toEqual([]);

  const beforeSwitchResources = metrics.resources.length;
  const switchStartedAt = Date.now();
  await page.getByRole('link', { name: 'destructive' }).click();
  await expect(scene).toHaveAttribute('data-preview-state', 'destructive', {
    timeout: STATE_SWITCH_BUDGET_MS,
  });
  await expect(page.getByRole('button', { name: 'Delete workspace' })).toBeVisible();
  const switchMs = Date.now() - switchStartedAt;
  const switchResources = (await resourceUrls(page)).length - beforeSwitchResources;

  expect(switchMs).toBeLessThan(STATE_SWITCH_BUDGET_MS);
  expect(switchResources).toBe(0);
  console.info(
    `ui-preview-load-budget ${JSON.stringify({
      direct: {
        requests: metrics.resources.length,
        firstVisibleMs: metrics.firstVisibleMs,
        readyMs: metrics.readyMs,
      },
      stateSwitch: { requests: switchResources, firstVisibleMs: switchMs },
    })}`,
  );
});

test('preserves the legacy detail route behind its lazy boundary', async ({ page }) => {
  const metrics = await measureLoad(
    page,
    '/sandbox/button',
    page.locator('[data-catalog-preview="button"]').first(),
  );

  expect(metrics.firstVisibleMs).toBeLessThan(FIRST_VISIBLE_BUDGET_MS);
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

test('preserves the complete gallery behind its own load budget', async ({ page }) => {
  const metrics = await measureLoad(
    page,
    '/sandbox',
    page.locator('[data-catalog-gallery-entry] [data-catalog-preview]').first(),
  );

  expect(metrics.firstVisibleMs).toBeLessThan(FIRST_VISIBLE_BUDGET_MS);
  expect(metrics.resources.length).toBeLessThanOrEqual(LEGACY_RESOURCE_BUDGET);
  await expect(page.getByTestId('catalog-gallery')).toBeVisible();
  expect(await page.locator('[data-catalog-gallery-entry]').count()).toBeGreaterThan(20);
  console.info(
    `ui-preview-load-budget ${JSON.stringify({
      gallery: { requests: metrics.resources.length, firstVisibleMs: metrics.firstVisibleMs },
    })}`,
  );
});
