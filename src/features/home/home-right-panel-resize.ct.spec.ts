import { expect, test } from '../../test/ct-test';
import type { Locator, Page, TestInfo } from '@playwright/experimental-ct-svelte';
import HomePreview from './home.preview.svelte';
import AssistantPreview from './assistant-panels.preview.svelte';

async function width(panel: Locator) {
  return panel.evaluate((element) => element.getBoundingClientRect().width);
}

async function drag(page: Page, handle: Locator, delta: number) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('The resize handle is missing');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - delta, y, { steps: 10 });
  await page.mouse.up();
}

async function exerciseResize(
  page: Page,
  panel: Locator,
  container: Locator,
  reopen: () => Promise<void>,
  name: string,
  testInfo: TestInfo,
) {
  const handle = panel.locator('.resizable-panel-handle');
  await expect(handle).toBeVisible();
  const defaultWidth = await width(panel);
  const availableWidth = await width(container);
  const targetWidth = Math.floor(availableWidth * 0.8);
  const measurements: Record<string, number> = { defaultWidth, availableWidth, targetWidth };
  const capture = async (state: string) => {
    const image = await page.screenshot({
      path: `.demo-artifacts/home-right-panel-resize/${name}-${state}.png`,
      animations: 'disabled',
    });
    measurements[state] = await width(panel);
    await testInfo.attach(`${name}-${state}`, { body: image, contentType: 'image/png' });
    await testInfo.attach(`${name}-${state}-geometry`, {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    });
  };

  await drag(page, handle, targetWidth - defaultWidth);
  await capture('wide');
  await expect.poll(() => width(panel)).toBeCloseTo(targetWidth, 0);
  expect(await width(panel)).toBeGreaterThan(900);
  await reopen();
  await expect.poll(() => width(panel)).toBeCloseTo(targetWidth, 0);

  await drag(page, handle, -80);
  await expect.poll(() => width(panel)).toBeCloseTo(targetWidth - 80, 0);
  await handle.dblclick();
  await expect.poll(() => width(panel)).toBeCloseTo(defaultWidth, 0);

  await drag(page, handle, -defaultWidth);
  await expect.poll(() => width(panel)).toBeCloseTo(320, 0);
  await drag(page, handle, 80);
  await expect.poll(() => width(panel)).toBeCloseTo(400, 0);
  await handle.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => width(panel)).toBeCloseTo(420, 0);

  const box = await handle.boundingBox();
  if (!box) throw new Error('The resize handle is missing');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 100, box.y + box.height / 2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(() => width(panel)).toBeCloseTo(420, 0);

  await drag(page, handle, availableWidth);
  await expect.poll(() => width(panel)).toBeLessThanOrEqual(availableWidth);
  expect(await width(panel)).toBeGreaterThan(availableWidth * 0.9);
  await capture('maximum');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => width(panel)).toBeLessThanOrEqual(await width(container));
  const clampedWidth = await width(panel);
  await drag(page, handle, -80);
  await expect.poll(() => width(panel)).toBeCloseTo(clampedWidth - 80, 0);
  await capture('smaller-window');

  await page.setViewportSize({ width: 600, height: 900 });
  await expect(panel).toBeVisible();
  await expect(handle).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture('narrow');
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(handle).toBeVisible();
  await handle.dblclick();
  await expect.poll(() => width(panel)).toBeCloseTo(defaultWidth, 0);
  await capture('reset');
}

test('Workspaces right panel resizes across the available content width', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(HomePreview);
  const workspace = component.locator('.workspace-list').getByRole('option').first();
  await workspace.click();
  const panel = component.locator('.home-preview-resizable');
  await expect(panel).toBeVisible();
  await exerciseResize(
    page,
    panel,
    component.locator('.workspace-content'),
    async () => {
      await workspace.click();
      await expect(panel).toHaveCount(0);
      await workspace.click();
      await expect(panel).toBeVisible();
    },
    'workspaces',
    testInfo,
  );
});

test('Assistant right panel resizes across the available content width', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(AssistantPreview);
  const open = component.getByRole('link', { name: 'Open the plan', exact: true });
  await open.click();
  const panel = component.locator('.assistant-content-resizable');
  await expect(panel.getByRole('heading', { name: 'Plan for the repository' })).toBeVisible();
  await exerciseResize(
    page,
    panel,
    component.locator('[data-assistant-panels]'),
    async () => {
      await panel.getByRole('button', { name: 'Close active pane' }).click();
      await expect(panel).toHaveCount(0);
      await open.click();
      await expect(panel).toBeVisible();
    },
    'assistant',
    testInfo,
  );
});
