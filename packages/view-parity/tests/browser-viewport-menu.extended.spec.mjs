import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

test('immediate keyboard preset selection, rotation and focus return', async ({ page }, info) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL to the maintained React preview');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 760, height: 700 });
  await page.goto(
    `${base}/sandbox/browser-device-frame?example=interactive&fit=component&motion=reduced`,
  );
  const host = page.getByTestId('browser-device-frame-demo');
  const trigger = host.getByTestId('browser-viewport-trigger');
  const menu = page.getByRole('menu');
  await host.getByRole('button', { name: 'Hide frame', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => JSON.parse(await host.getAttribute('data-viewport')))
    .toEqual({ mode: 'preset', presetId: 'iphone-se', width: 375, height: 667 });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: /iPhone SE/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('menuitemradio', { name: /iPad Mini/ }).click();
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => JSON.parse(await host.getAttribute('data-viewport')))
    .toEqual({ mode: 'preset', presetId: 'ipad-mini', width: 768, height: 1024 });
  await page.evaluate(() => document.fonts.ready);
  const screenshot = info.outputPath('viewport-menu.png');
  await page.screenshot({ path: screenshot });
  await info.attach('viewport-menu', { path: screenshot, contentType: 'image/png' });
  await menu.getByRole('menuitem', { name: 'Rotate', exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await host.getAttribute('data-viewport')))
    .toEqual({ mode: 'preset', presetId: 'ipad-mini', width: 1024, height: 768 });
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});
