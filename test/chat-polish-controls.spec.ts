import { expect, type Page } from '@playwright/test';
import { test } from './root-browser-fixtures';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

let server: ViteDevServer;
let baseUrl: string;

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.beforeAll(async () => {
  test.setTimeout(360_000);
  const port = Number.parseInt(process.env.CHAT_POLISH_TEST_PORT ?? '0', 10);
  server = await createServer({
    cacheDir: viteHarnessCacheDir('chat-polish-controls'),
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

test('opens tool details and streaming groups', async ({ page }) => {
  await openSandbox(page);
  await page.locator('[data-operational-window="fixture-failed-tool"]').scrollIntoViewIfNeeded();
  const detail = page.locator(
    '[data-tool-use-id="fixture-command-failed"] [data-testid="tool-call-disclosure"]',
  );
  await detail.evaluate((element: HTMLButtonElement) => element.click());
  await expect(detail).toHaveAttribute('aria-expanded', 'true');
  const streaming = page.locator('[data-operational-window="fixture-streaming"]');
  await streaming.scrollIntoViewIfNeeded();
  const group = streaming.getByTestId('response-group-disclosure');
  await group.evaluate((element: HTMLButtonElement) => element.click());
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(streaming.locator('[data-tool-use-id="fixture-context-streaming"]')).toBeVisible();
  await expect(page.locator('[data-operational-stack]').filter({ has: streaming })).toHaveAttribute(
    'data-tool-executing',
    'true',
  );
});

test('saves and resets preview settings', async ({ page }) => {
  await openSandbox(page);
  const slider = page.getByRole('slider', { name: 'Operational row gap' });
  const originalGap = await slider.inputValue();
  await slider.fill('18');
  await page.getByRole('button', { name: 'Save tweaks' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('slider', { name: 'Operational row gap' })).toHaveValue('18');
  await page.getByRole('button', { name: 'Reset production defaults' }).click();
  await expect(page.getByRole('slider', { name: 'Operational row gap' })).toHaveValue(originalGap);
});

test('keeps customized controls within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSandbox(page);
  await page.getByRole('button', { name: 'Customize preview' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await page
    .getByRole('group', { name: 'Motion' })
    .getByRole('radio', { name: 'Reduced', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Compact mode' }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
