import { expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { test } from './root-browser-fixtures';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

let server: ViteDevServer | undefined;
let baseUrl: string;
const longName = 'Development assistant for the desktop application';

test.use({ viewport: { width: 1000, height: 720 }, reducedMotion: 'reduce' });
test.beforeAll(async () => {
  test.setTimeout(180_000);
  baseUrl = process.env.TOOLTIP_AUDIT_BASE_URL ?? '';
  if (baseUrl) return;
  process.env.INTENT_UI_PREVIEW = '1';
  process.env.INTENT_BUILD_TARGET = 'web';
  server = await createServer({
    cacheDir: viteHarnessCacheDir('tooltip-audit'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
});
test.afterAll(async () => server?.close());
test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(
    `${baseUrl.replace(/\/$/, '')}/sandbox/tooltip-audit?state=default&width=900&motion=reduced`,
  );
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
});

test('agent selectors open by pointer and keyboard', async ({ page }) => {
  const selector = page.getByTestId('pane-stack-selector-trigger');
  await expect(selector).toHaveAccessibleName('dev bro. Show pane list. Total panes: 2.');
  await selector.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(selector).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(selector).toBeFocused();
});

test('agent selector accessible names follow renaming', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Example name' });
  const selector = page.getByTestId('pane-stack-selector-trigger');
  await input.fill(longName);
  await expect(selector).toHaveAccessibleName(`${longName}. Show pane list. Total panes: 2.`);
  await input.fill('dev bro');
  await expect(selector).toHaveAccessibleName('dev bro. Show pane list. Total panes: 2.');
});

test('file selectors switch the active pane', async ({ page }) => {
  const selector = page.getByTestId('pane-stack-selector-trigger');
  await selector.click();
  await page.getByRole('menuitem', { name: 'app.ts', exact: true }).click();
  await expect(selector).toHaveAccessibleName('app.ts. Show pane list. Total panes: 2.');
});

test('list actions report selection', async ({ page }) => {
  await page.locator('[data-slot=list-item]').click();
  await expect(page.getByRole('status', { name: 'Last action' })).toHaveText('list');
});

test('save actions run and unavailable publish actions stay disabled', async ({ page }) => {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Last action' })).toHaveText('save');
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
});

test('workspace status remains accessible and edits can be cancelled', async ({ page }) => {
  await page.goto(
    `${baseUrl.replace(/\/$/, '')}/sandbox/tooltip-audit?state=status&width=900&motion=reduced`,
  );
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const input = page.getByRole('textbox', { name: 'Example status' });
  const surfaces = [page.getByTestId('sidebar-status'), page.getByTestId('progress-status')];
  const shortStatus = 'Ready for review';
  const longStatus = 'Checking a long workspace status that wraps across several lines.\n'.repeat(
    8,
  );

  for (const status of [shortStatus, longStatus]) {
    await input.fill(status);
    const descriptionIds = [];
    for (const surface of surfaces) {
      const button = surface.getByRole('button', { name: 'Edit workspace status', exact: true });
      await expect(button).toHaveAccessibleDescription(status.replace(/\s+/g, ' ').trim());
      const id = await button.getAttribute('aria-describedby');
      expect(id).toBeTruthy();
      descriptionIds.push(id);
      await button.focus();
      await expect(button).toHaveAccessibleDescription(status.replace(/\s+/g, ' ').trim());
    }
    expect(new Set(descriptionIds).size).toBe(surfaces.length);
  }

  await input.fill(shortStatus);
  for (const surface of surfaces) {
    const button = surface.getByRole('button', { name: 'Edit workspace status', exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    const editor = surface.getByRole('textbox');
    await expect(editor).toHaveValue(shortStatus);
    await editor.fill('Discarded edit');
    await editor.press('Escape');
    await expect(button).toHaveAccessibleDescription(shortStatus);
  }

  for (const emptyStatus of ['', '   ']) {
    await input.fill(emptyStatus);
    await expect(
      surfaces[0].getByRole('button', { name: 'Add workspace status', exact: true }),
    ).toHaveAccessibleDescription('Click to add workspace status');
    await expect(
      surfaces[1].getByRole('button', { name: 'Edit workspace status', exact: true }),
    ).toHaveCount(0);
  }
});
