import { expect, test, type Page } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';

let server: ViteDevServer;
let baseUrl: string;

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.beforeAll(async () => {
  test.setTimeout(360_000);
  const port = Number.parseInt(process.env.CHAT_POLISH_TEST_PORT ?? '0', 10);
  server = await createServer({
    server: { host: '127.0.0.1', port, strictPort: port > 0, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
});
test.afterAll(async () => server?.close());

async function openSandbox(page: Page) {
  await page.goto(`${baseUrl}sandbox/chat-polish`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('chat-polish-conversation')).toHaveCount(1);
}

async function operationalMargins(page: Page) {
  return page
    .getByTestId('chat-polish-preview')
    .evaluate((preview) =>
      Array.from(
        preview.querySelectorAll<HTMLElement>('[data-adjacent-operational-row="true"]'),
        (row) => Number.parseFloat(getComputedStyle(row).marginTop),
      ),
    );
}

async function sectionBoundary(page: Page) {
  return page.getByTestId('chat-polish-preview').evaluate((preview) => {
    const operational = preview.querySelector<HTMLElement>(
      '[data-tool-executing] .content-block--tool_use',
    );
    const text = operational?.nextElementSibling as HTMLElement | null;
    return operational && text?.classList.contains('content-block--text')
      ? text.getBoundingClientRect().top - operational.getBoundingClientRect().bottom
      : null;
  });
}

test('opens directly to one long conversation with no scenario gallery', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSandbox(page);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.locator('[data-catalog-fixture]')).toHaveCount(1);
  await expect(
    page.locator('[data-chat-polish-conversation="comprehensive-conversation"]'),
  ).toBeVisible();
  expect(await page.locator('[data-preview-message-role]').count()).toBeGreaterThan(15);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(3000);
});

for (const zoom of [1, 2]) {
  test(`updates every visible operational seam immediately at ${zoom * 100}%`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSandbox(page);
    await page.evaluate((value) => {
      document.body.style.zoom = String(value);
    }, zoom);
    const slider = page.getByRole('slider', { name: 'Operational row gap' });
    const boundaryBefore = await sectionBoundary(page);

    for (const value of [0, 4, 32]) {
      await slider.fill(String(value));
      const margins = await operationalMargins(page);
      expect(margins.length).toBeGreaterThan(0);
      expect(margins, `operational margins at ${value}px`).toEqual(margins.map(() => value));
    }
    expect(await sectionBoundary(page)).toBe(boundaryBefore);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}

test('keeps grouped, streaming, hidden-result, and expanded-detail paths on the same gap', async ({
  page,
}) => {
  await openSandbox(page);
  const slider = page.getByRole('slider', { name: 'Operational row gap' });
  await slider.fill('18');
  const detail = page.locator(
    '[data-tool-use-id="fixture-command-failed"] [data-testid="tool-call-disclosure"]',
  );
  await detail.evaluate((element: HTMLButtonElement) => element.click());
  await expect(detail).toHaveAttribute('aria-expanded', 'true');
  const margins = await operationalMargins(page);
  expect(margins.length).toBeGreaterThan(0);
  expect(margins.every((margin) => margin === 18)).toBe(true);
  await expect(page.locator('[data-tool-executing]').first()).toBeVisible();
  expect(
    await page.locator('[data-testid="response-group-summary"]').count(),
  ).toBeGreaterThanOrEqual(4);
  await expect(page.locator('[data-tool-use-id="result-empty-hidden"]')).toHaveCount(0);
});

test('saves, restores, and resets the operational gap without leaking it', async ({ page }) => {
  await openSandbox(page);
  const slider = page.getByRole('slider', { name: 'Operational row gap' });
  await slider.fill('18');
  expect((await operationalMargins(page)).every((margin) => margin === 18)).toBe(true);
  await page.getByRole('button', { name: 'Save tweaks' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('slider', { name: 'Operational row gap' })).toHaveValue('18');
  expect((await operationalMargins(page)).every((margin) => margin === 18)).toBe(true);
  await page.getByRole('button', { name: 'Reset production defaults' }).click();
  await expect(page.getByRole('slider', { name: 'Operational row gap' })).toHaveValue('4');
  expect((await operationalMargins(page)).every((margin) => margin === 4)).toBe(true);
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--chat-operational-row-gap'),
    ),
  ).toBe('');
});

test('remains usable in narrow, dark, compact, and reduced-motion modes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSandbox(page);
  await page.getByRole('radio', { name: 'Dark' }).click();
  await page.getByRole('switch', { name: 'Reduce motion' }).click();
  await page.getByRole('checkbox', { name: 'Compact mode' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-motion', 'reduced');
  await expect(page.getByTestId('chat-polish-preview')).toHaveAttribute('data-compact', 'true');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
