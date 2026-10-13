import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

for (const scenario of [
  {
    name: 'native resize and fit transitions',
    width: 760,
    dx: 60,
    dy: 30,
    expected: { mode: 'custom', width: 540, height: 390 },
  },
  {
    name: 'narrow scaled frame clamps resize without hiding controls',
    width: 320,
    dx: -200,
    dy: -100,
    expected: { mode: 'custom', width: 320, height: 320 },
  },
]) {
  test(scenario.name, async ({ page }, info) => {
    const base = process.env.REACT_BASE_URL;
    if (!base) throw new Error('Set REACT_BASE_URL to the maintained React preview');
    const errors = await observeErrors(page);
    await page.setViewportSize({ width: scenario.width, height: 700 });
    await page.goto(
      `${base}/sandbox/browser-device-frame?example=interactive&fit=component&motion=reduced`,
    );
    const host = page.getByTestId('browser-device-frame-demo');
    const input = host.getByRole('textbox', { name: 'Preview text', exact: true });
    const handle = host.getByTestId('browser-device-resize-handle');
    await expect(input).toBeVisible();
    await input.fill('Retained draft');
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + scenario.dx,
      box.y + box.height / 2 + scenario.dy,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect
      .poll(async () => JSON.parse(await host.getAttribute('data-viewport')))
      .toEqual(scenario.expected);
    await expect(input).toHaveValue('Retained draft');
    expect(
      await handle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return rect.left >= 0 && rect.right <= window.innerWidth && element.contains(hit);
      }),
    ).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    const screenshot = info.outputPath(`device-frame-${scenario.width}.png`);
    await host.screenshot({ path: screenshot });
    await info.attach('device-frame', { path: screenshot, contentType: 'image/png' });
    const trigger = host.getByTestId('browser-viewport-trigger');
    const menu = page.getByRole('menu');
    const dialog = page.getByRole('dialog');
    const width = dialog.getByRole('spinbutton', { name: 'Width', exact: true });
    const height = dialog.getByRole('spinbutton', { name: 'Height', exact: true });
    await trigger.click();
    await menu.getByRole('menuitemradio', { name: /Custom/ }).click();
    await expect(width).toBeFocused();
    await expect(width).toHaveValue(String(scenario.expected.width));
    await expect(height).toHaveValue(String(scenario.expected.height));
    await width.fill('900');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect
      .poll(async () => JSON.parse(await host.getAttribute('data-viewport')))
      .toEqual(scenario.expected);
    await page.keyboard.press('Enter');
    await menu.getByRole('menuitemradio', { name: 'Fit panel', exact: true }).click();
    await expect(handle).toHaveCount(0);
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(input).toHaveValue('Retained draft');
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(width).toBeFocused();
    await width.fill('319');
    await expect(width).toHaveAttribute('aria-invalid', 'true');
    const apply = dialog.getByRole('button', { name: 'Apply', exact: true });
    await expect(apply).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () => JSON.parse(await host.getAttribute('data-viewport')))
      .toEqual({ mode: 'fit' });
    await width.fill('480');
    await height.fill('360');
    await expect(apply).toBeEnabled();
    const dialogScreenshot = info.outputPath(`viewport-dialog-${scenario.width}.png`);
    await dialog.screenshot({ path: dialogScreenshot });
    await info.attach('viewport-dialog', { path: dialogScreenshot, contentType: 'image/png' });
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(handle).toBeVisible();
    await expect(input).toHaveValue('Retained draft');
    await host.getByRole('button', { name: 'Hide frame', exact: true }).click();
    await expect(input).toHaveCount(0);
    await host.getByRole('button', { name: 'Show frame', exact: true }).click();
    await expect(input).toHaveValue('Keep this draft while resizing');
    await expect
      .poll(async () => JSON.parse(await host.getAttribute('data-viewport')))
      .toEqual({ mode: 'custom', width: 480, height: 360 });
    expect(errors).toEqual([]);
  });
}
