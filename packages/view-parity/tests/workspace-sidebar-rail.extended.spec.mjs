import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('workspace rail keeps expand reachable and uses the current caller after replacement', async ({
  page,
}, info) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  await page.setViewportSize({ width: 280, height: 1000 });
  const errors = await observeErrors(page);
  await page.goto(`${base}/sandbox/sidebar?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('workspace-rail-demo');
  const frame = demo.getByTestId('workspace-rail-frame');
  const expand = frame.getByRole('button');
  const events = demo.getByRole('status', { name: 'Rail callbacks' });
  await demo.getByRole('button', { name: 'Before rail', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAccessibleName(/\S/);
  await page.keyboard.press('Enter');
  await expect(events).toHaveText('["original"]');
  await page.keyboard.press('Tab');
  await expect(demo.getByRole('button', { name: 'After rail', exact: true })).toBeFocused();
  await demo.getByRole('button', { name: 'Replace expand callback', exact: true }).click();
  await expand.focus();
  await page.keyboard.press('Space');
  await expect(events).toHaveText('["original","updated"]');
  const old = await expand.elementHandle();
  await demo.getByRole('button', { name: 'Show rail', exact: true }).click();
  expect(await old.evaluate((node) => node.isConnected)).toBe(false);
  await demo.getByRole('button', { name: 'Show rail', exact: true }).click();
  await expand.click();
  await expect(events).toHaveText('["original","updated","updated"]');
  await frame.scrollIntoViewIfNeeded();
  const geometry = await expand.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      box: box.toJSON(),
      viewport: document.documentElement.clientWidth,
      hit: button === hit || button.contains(hit),
    };
  });
  expect(geometry.box.left).toBeGreaterThanOrEqual(0);
  expect(geometry.box.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.hit).toBe(true);
  await info.attach('rail-hit-target.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png)
      await info.attach(`workspace-rail-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});
