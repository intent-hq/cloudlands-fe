import { expect, type Page } from '@playwright/test';
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

async function leaveHover(page: Page) {
  await page.mouse.move(980, 700);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
}

async function expectNoDelayedTooltip(page: Page) {
  // Observe beyond the pane selector's 300ms hover delay.
  await page.waitForTimeout(500);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
}

test('the pictured agent selector suppresses repeated names and opens by pointer and keyboard', async ({
  page,
}, testInfo) => {
  const selector = page.getByTestId('pane-stack-selector-trigger');
  await expect(selector).toHaveAccessibleName('dev bro. Show pane list. Total panes: 2.');
  await selector.hover();
  await expect(selector).toBeEnabled();
  await expectNoDelayedTooltip(page);
  await page.screenshot({ path: testInfo.outputPath('short-name-after.png') });
  await testInfo.attach('Short name: no redundant popup', {
    path: testInfo.outputPath('short-name-after.png'),
    contentType: 'image/png',
  });
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

test('clipped names keep keyboard help and react to renaming', async ({ page }, testInfo) => {
  await page.getByRole('textbox', { name: 'Example name' }).fill(longName);
  const selector = page.getByTestId('pane-stack-selector-trigger');
  await expect(selector).toHaveAccessibleName(`${longName}. Show pane list. Total panes: 2.`);
  await selector.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(selector).toHaveAccessibleDescription(longName);
  await page.screenshot({ path: testInfo.outputPath('clipped-name-help.png') });
  await testInfo.attach('Clipped name: useful full text', {
    path: testInfo.outputPath('clipped-name-help.png'),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(selector).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await selector.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.getByRole('textbox', { name: 'Example name' }).fill('dev bro');
  await expect(selector).toHaveAccessibleName('dev bro. Show pane list. Total panes: 2.');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await selector.hover();
  await expect(selector).toBeEnabled();
  await expectNoDelayedTooltip(page);
});

test('file selectors retain hidden paths even when the visible filename fits', async ({ page }) => {
  const selector = page.getByTestId('pane-stack-selector-trigger');
  await selector.click();
  await page.getByRole('menuitem', { name: 'app.ts', exact: true }).click();
  await expect(selector).toHaveAccessibleName('app.ts. Show pane list. Total panes: 2.');
  await leaveHover(page);
  await selector.hover();
  await expect(page.getByRole('tooltip')).toContainText('/workspace/src/app.ts');
});

test('native full-text help follows clipping, text updates, multiline content, and remounts', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Example name' });
  const list = page.locator('[data-slot=list-item]');
  const media = page.getByTestId('media-loading-placeholder').locator('span').last();
  const clamped = page.getByTestId('clamped-label');
  await expect(list).not.toHaveAttribute('title');
  await expect(media).not.toHaveAttribute('title');
  await expect(page.getByTestId('abbreviated-label')).toHaveAttribute(
    'title',
    '/workspace/src/app.ts',
  );
  await input.fill(longName);
  await expect(list).toHaveAttribute('title', longName);
  await expect(media).toHaveAttribute('title', longName);
  await page.getByRole('button', { name: 'Widen labels' }).click();
  await expect(list).not.toHaveAttribute('title');
  await expect(media).not.toHaveAttribute('title');
  await page.getByRole('button', { name: 'Narrow labels' }).click();
  await input.fill(`${longName}. `.repeat(8));
  await expect(clamped).toHaveAttribute('title', /Development assistant/);
  await expect(clamped).toHaveAttribute('data-overflow', 'true');
  await page.getByRole('button', { name: 'Hide labels' }).click();
  await input.fill('dev bro');
  await page.getByRole('button', { name: 'Show labels' }).click();
  await expect(list).not.toHaveAttribute('title');
  await expect(clamped).not.toHaveAttribute('title');
  await list.click();
  await expect(page.getByRole('status', { name: 'Last action' })).toHaveText('list');
});

test('text actions stay quiet while shortcuts, disabled reasons, and icon labels remain', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: 'Save', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Last action' })).toHaveText('save');
  await page.getByRole('button', { name: 'Find', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText('Find');
  await expect(page.getByRole('tooltip')).toContainText('F');
  await leaveHover(page);
  await page
    .getByRole('button', { name: 'Publish', exact: true })
    .locator('xpath=ancestor::span[@tabindex="-1"][1]')
    .hover();
  await expect(page.getByRole('tooltip')).toHaveText('Connect an account to publish');
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  await leaveHover(page);
  await page.getByRole('button', { name: 'Copy', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Copy');
  await page.screenshot({ path: testInfo.outputPath('useful-icon-help.png') });
  await testInfo.attach('Icon action keeps its label', {
    path: testInfo.outputPath('useful-icon-help.png'),
    contentType: 'image/png',
  });
});

test('workspace status remains available to screen readers without duplicate hover help', async ({
  page,
}, testInfo) => {
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
      const description = page.locator(`[id="${id}"]`);
      if (status === shortStatus) await expect(description).not.toHaveAttribute('title');
      else await expect(description).toHaveAttribute('title', status.trim());
      await button.focus();
      await expect(button).toHaveAccessibleDescription(status.replace(/\s+/g, ' ').trim());
    }
    expect(new Set(descriptionIds).size).toBe(surfaces.length);
  }

  await page.screenshot({
    path: testInfo.outputPath('workspace-status-descriptions.png'),
    fullPage: true,
  });
  await testInfo.attach('Workspace statuses retain accessible descriptions', {
    path: testInfo.outputPath('workspace-status-descriptions.png'),
    contentType: 'image/png',
  });
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
