import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/sidebar?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('divider-button-demo');
  const button = demo.getByRole('button', { name: 'Toggle saved section', exact: true });
  await expect(button).toBeVisible();
  await demo.scrollIntoViewIfNeeded();
  return {
    demo,
    button,
    errors,
    state: async () => JSON.parse(await demo.locator('output').textContent()),
  };
}

test('divider uses current callbacks and keeps loading, disabled and form behavior distinct', async ({
  page,
}, info) => {
  const { demo, button, errors, state } = await openDemo(page);
  const frame = page.getByTestId('divider-button-frame');
  const before = await button.boundingBox();
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png) await info.attach(`divider-plain-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await button.click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  expect(await state()).toEqual({ events: [1, 1, 1], submissions: 0 });
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Alt+u');
  await expect(button).toHaveText('Updated saved section');
  await page.keyboard.press('Enter');
  expect(await state()).toEqual({ events: [1, 1, 1, 2], submissions: 0 });
  await demo.getByRole('button', { name: 'Loading content', exact: true }).click();
  await expect(button).toBeEnabled();
  await expect(button).not.toContainText('Updated saved section');
  await button.click();
  expect((await state()).events).toEqual([1, 1, 1, 2, 2]);
  await demo.getByRole('button', { name: 'Disable divider', exact: true }).click();
  await expect(button).toBeDisabled();
  const bounds = await button.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await demo.getByRole('button', { name: 'Before divider', exact: true }).click();
  await page.keyboard.press('Tab');
  await expect(demo.getByRole('button', { name: 'After divider', exact: true })).toBeFocused();
  expect((await state()).events).toEqual([1, 1, 1, 2, 2]);
  await demo.getByRole('button', { name: 'Disable divider', exact: true }).click();
  await demo.getByRole('button', { name: 'Loading content', exact: true }).click();
  await demo.getByRole('button', { name: 'Use submit type', exact: true }).click();
  await button.click();
  expect(await state()).toEqual({ events: [1, 1, 1, 2, 2, 2], submissions: 1 });
  const after = await button.boundingBox();
  expect(after.x).toBeGreaterThanOrEqual(0);
  expect(after.x + after.width).toBeLessThanOrEqual(420);
  await info.attach('divider-geometry.json', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('divider tooltip preserves native activation and removes its portal on unmount', async ({
  page,
}, info) => {
  const { demo, button, errors, state } = await openDemo(page);
  await demo.getByRole('button', { name: 'Show divider tooltip', exact: true }).click();
  await button.hover();
  const popup = page
    .locator('[data-slot="tooltip-content"]')
    .filter({ hasText: 'Saved section help' });
  await expect(popup).toBeVisible();
  await page.keyboard.press('Alt+u');
  await expect(popup).toContainText('Saved section help 2');
  await expect(button).toHaveText('Updated saved section');
  await button.hover();
  await stableLocatorScreenshot(page, popup, async ({ png, attempt }) => {
    if (png)
      await info.attach(`divider-tooltip-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await button.click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  expect((await state()).events).toEqual([2, 2, 2]);
  await page.mouse.move(0, 0);
  await button.hover();
  await expect(popup).toBeVisible();
  const original = await popup.elementHandle();
  await demo.getByRole('button', { name: 'Mount divider', exact: true }).click();
  await expect(button).toHaveCount(0);
  await expect(popup).toHaveCount(0);
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  await demo.getByRole('button', { name: 'Mount divider', exact: true }).click();
  await button.click();
  expect((await state()).events).toEqual([2, 2, 2, 2]);
  expect(errors).toEqual([]);
});
