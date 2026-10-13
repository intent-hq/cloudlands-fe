import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openPreview(page, width = 760) {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL to the maintained React preview');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(
    `${base}/sandbox/browser-device-frame?example=interactive&fit=component&motion=reduced`,
  );
  return { host: page.getByTestId('browser-device-frame-demo'), errors };
}

test('overflow commands accept immediate typeahead and reset it on reopening', async ({ page }) => {
  const { host, errors } = await openPreview(page);
  const trigger = host.getByTestId('browser-overflow-trigger');
  await host.getByRole('button', { name: 'Compact toolbar', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('s');
  await page.keyboard.press('Enter');
  await expect(host).toHaveAttribute('data-commands', '["screenshot"]');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  await page.keyboard.press('c');
  await page.keyboard.press('Enter');
  await expect(host).toHaveAttribute('data-commands', '["screenshot","copy"]');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  await page.keyboard.press('s');
  await page.keyboard.press('o');
  await page.keyboard.press('Enter');
  await expect(host).toHaveAttribute('data-commands', '["screenshot","copy","source"]');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  await page.keyboard.press('s');
  await page.keyboard.press('s');
  await page.keyboard.press('Enter');
  await expect(host).toHaveAttribute('data-commands', '["screenshot","copy","source","source"]');
  expect(errors).toEqual([]);
});

for (const [name, width] of [
  ['wide pointer submenu', 1000],
  ['narrow collision submenu', 420],
]) {
  test(`${name} keeps preset choices and transfers focus through its custom dialog`, async ({
    page,
  }, info) => {
    const { host, errors } = await openPreview(page, width);
    await host.getByRole('button', { name: 'Compact toolbar', exact: true }).click();
    const trigger = host.getByTestId('browser-overflow-trigger');
    await trigger.click();
    const subTrigger = page.getByRole('menuitem', { name: /^Viewport mode:/ });
    await subTrigger.hover();
    const preset = page.getByRole('menuitemradio', { name: /iPhone SE/ });
    await expect(preset).toBeVisible();
    await preset.click();
    await expect
      .poll(async () => JSON.parse(await host.getAttribute('data-viewport')))
      .toEqual({
        mode: 'preset',
        presetId: 'iphone-se',
        width: 375,
        height: 667,
      });
    await expect(preset).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemradio', { name: 'Fit panel', exact: true }).click();
    await expect
      .poll(async () => JSON.parse(await host.getAttribute('data-viewport')))
      .toEqual({ mode: 'fit' });
    await page.getByRole('menuitem', { name: 'Custom…', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('600');
    await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('450');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => JSON.parse(await host.getAttribute('data-viewport')))
      .toEqual({ mode: 'custom', width: 600, height: 450 });
    await expect(trigger).toBeFocused();
    await trigger.click();
    await subTrigger.hover();
    await page.getByRole('menuitemradio', { name: /Custom…/ }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await subTrigger.hover();
    await page.getByRole('menuitemradio', { name: 'Fit panel', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: /iPhone SE/ })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const captures = [];
    // The portaled menus extend beyond the component-fit body's capture bounds.
    const png = await stableLocatorScreenshot(
      page,
      {
        evaluate: (...args) => page.locator('body').evaluate(...args),
        screenshot: (options) => page.screenshot(options),
      },
      ({ png: _png, ...attempt }) => {
        captures.push(attempt);
      },
    );
    const screenshot = info.outputPath('overflow-submenu.png');
    await writeFile(screenshot, png);
    await info.attach('overflow-submenu', { path: screenshot, contentType: 'image/png' });
    await info.attach('capture-stability', {
      body: JSON.stringify(captures),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
}
