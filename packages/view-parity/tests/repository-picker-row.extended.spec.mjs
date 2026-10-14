import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page, width = 800) {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width, height: 1100 });
  await page.goto(`${base}/sandbox/popovers?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('repository-row-demo');
  const row = demo.getByTestId('repository-row');
  await expect(row).toBeVisible();
  return { errors, demo, row };
}

test('repository row preserves native activation, disabled behavior and current props through replacement', async ({
  page,
}) => {
  const { errors, demo, row } = await openDemo(page);
  await row.scrollIntoViewIfNeeded();
  const original = await row.elementHandle();
  await expect
    .poll(() => row.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expect(row.locator('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await row.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  const callbacks = demo.getByRole('status', { name: 'Repository row callbacks' });
  await expect(callbacks).toHaveText('["original","original"]');
  await demo.getByRole('button', { name: 'Disable row' }).click();
  await expect(row).toBeDisabled();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(callbacks).toHaveText('["original","original"]');
  await demo.getByRole('button', { name: 'Before repository' }).focus();
  await page.keyboard.press('Tab');
  await expect(demo.getByRole('button', { name: 'After repository' })).toBeFocused();
  await demo.getByRole('button', { name: 'Disable row' }).click();
  await demo.getByRole('button', { name: 'Replace repository' }).click();
  await demo.getByRole('button', { name: 'Show owner' }).click();
  await demo.getByRole('button', { name: 'Use local avatar' }).click();
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await expect(row.locator('img')).toHaveCount(0);
  await expect(row).toHaveAccessibleName(
    'long-repository-name-for-narrow-workspace-layouts GitLab',
  );
  await row.click();
  await expect(callbacks).toHaveText('["original","original","updated"]');
  await demo.getByRole('button', { name: 'Use local avatar' }).click();
  await row.scrollIntoViewIfNeeded();
  await expect
    .poll(() => row.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await demo.getByRole('button', { name: 'Show repository row' }).click();
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  await demo.getByRole('button', { name: 'Show repository row' }).click();
  await expect(row).toBeVisible();
  expect(errors).toEqual([]);
});

test('repository option stays operable with a long name in a narrow listbox', async ({
  page,
}, info) => {
  const { errors, demo, row } = await openDemo(page, 280);
  await demo.getByRole('button', { name: 'Replace repository' }).click();
  await demo.getByRole('button', { name: 'Use option role' }).click();
  const option = demo.getByRole('listbox', { name: 'Repository choices' }).getByRole('option');
  await expect(option).toHaveAttribute('aria-selected', 'false');
  await option.focus();
  await page.keyboard.press('Space');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await expect(demo.getByRole('status', { name: 'Repository row callbacks' })).toHaveText(
    '["updated"]',
  );
  await row.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await row.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const forge = node.querySelector('[role="img"]');
    return {
      bounds: rect.toJSON(),
      viewport: document.documentElement.clientWidth,
      client: node.clientWidth,
      scroll: node.scrollWidth,
      hit: node === hit || node.contains(hit),
      forge: forge.getBoundingClientRect().toJSON(),
    };
  });
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.forge.right).toBeLessThanOrEqual(geometry.bounds.right);
  expect(geometry.hit).toBe(true);
  await info.attach('repository-row-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, row, async ({ png, attempt }) => {
    if (png)
      await info.attach(`repository-row-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await demo.getByRole('button', { name: 'Show repository row' }).click();
  await expect(option).toHaveCount(0);
  expect(errors).toEqual([]);
});
