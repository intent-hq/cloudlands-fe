import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('content skeleton normalizes caller counts and follows explicit layouts without trapping focus', async ({
  page,
}, info) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  await page.setViewportSize({ width: 280, height: 1100 });
  const errors = await observeErrors(page);
  await page.goto(`${base}/sandbox/skeleton?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('content-skeleton-demo');
  const frame = demo.getByTestId('content-skeleton-frame');
  const panels = frame.locator('[data-loading-panel]');
  const count = demo.getByRole('textbox', { name: 'Loading panel count' });
  await expect(panels).toHaveCount(1);
  const original = await frame.locator('[data-workspace-content-skeleton]').elementHandle();
  for (const [input, expected] of [
    ['3.9', 3],
    ['0', 1],
    ['-2', 1],
    ['NaN', 1],
    ['Infinity', 1],
  ]) {
    await count.fill(input);
    await expect(panels).toHaveCount(expected);
  }
  await count.fill('2');
  await expect(panels).toHaveCount(2);
  await demo.getByRole('button', { name: 'Nested layout', exact: true }).click();
  await expect(panels).toHaveCount(3);
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await frame.scrollIntoViewIfNeeded();
  const nested = await panels.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().toJSON()),
  );
  expect(nested[0].right).toBeLessThanOrEqual(nested[1].left);
  expect(nested[1].bottom).toBeLessThanOrEqual(nested[2].top);
  await demo.getByRole('button', { name: 'Single panel', exact: true }).click();
  await expect(panels).toHaveCount(1);
  await demo.getByRole('button', { name: 'Empty layout', exact: true }).click();
  await expect(panels).toHaveCount(0);
  await demo.getByRole('button', { name: 'Use panel count', exact: true }).click();
  await expect(panels).toHaveCount(2);
  await demo.getByRole('button', { name: 'Before loading', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(demo.getByRole('button', { name: 'After loading', exact: true })).toBeFocused();
  await demo.getByRole('button', { name: 'Show loading', exact: true }).click();
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  await demo.getByRole('button', { name: 'Show loading', exact: true }).click();
  await expect(panels).toHaveCount(2);
  await count.fill('1');
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await frame.evaluate((root) => ({
    bounds: root.getBoundingClientRect().toJSON(),
    viewport: document.documentElement.clientWidth,
    client: root.clientWidth,
    scroll: root.scrollWidth,
    animations: root.getAnimations({ subtree: true }).length,
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.animations).toBe(0);
  await info.attach('content-skeleton-geometry.json', {
    body: JSON.stringify({ geometry, nested }),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png)
      await info.attach(`content-skeleton-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});

test('content skeleton disposes active loading animations when removed', async ({ page }) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.goto(`${base}/sandbox/skeleton?example=interactive&motion=full`);
  const demo = page.getByTestId('content-skeleton-demo');
  const frame = demo.getByTestId('content-skeleton-frame');
  await expect
    .poll(() => frame.evaluate((root) => root.getAnimations({ subtree: true }).length))
    .toBeGreaterThan(0);
  const animations = await frame.evaluateHandle((root) => root.getAnimations({ subtree: true }));
  await demo.getByRole('button', { name: 'Show loading', exact: true }).click();
  await expect
    .poll(() => animations.evaluate((items) => items.every((item) => item.playState === 'idle')))
    .toBe(true);
  await demo.getByRole('button', { name: 'Show loading', exact: true }).click();
  await expect
    .poll(() => frame.evaluate((root) => root.getAnimations({ subtree: true }).length))
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
