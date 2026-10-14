import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('phase presentation leaves caller keyboard access and current actions intact', async ({
  page,
}, info) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  await page.setViewportSize({ width: 280, height: 1100 });
  const errors = await observeErrors(page);
  await page.goto(`${base}/sandbox/badge?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('workspace-phase-demo');
  const gallery = demo.getByTestId('workspace-phase-gallery');
  const selected = demo.getByTestId('workspace-phase-selected');
  const output = demo.getByRole('status', { name: 'Phase callbacks' });
  const events = [];
  for (const phase of ['planning', 'building', 'reviewing', 'shipped']) {
    const option = gallery.getByRole('button', { name: phase, exact: true });
    await option.focus();
    await page.keyboard.press('Enter');
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await demo.getByRole('button', { name: 'Before phase', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(demo.getByRole('button', { name: 'Open phase', exact: true })).toBeFocused();
    await page.keyboard.press('Space');
    events.push(phase);
    await expect(output).toHaveText(JSON.stringify(events));
  }
  await gallery.getByRole('button', { name: 'building', exact: true }).click();
  await demo.getByRole('spinbutton', { name: 'Build progress' }).fill('1.5');
  await demo.getByRole('button', { name: 'Open phase', exact: true }).click();
  events.push('building');
  await expect(output).toHaveText(JSON.stringify(events));
  const old = await selected.locator(':scope > div').elementHandle();
  await demo.getByRole('button', { name: 'Show phase', exact: true }).click();
  expect(await old.evaluate((node) => node.isConnected)).toBe(false);
  await gallery.getByRole('button', { name: 'shipped', exact: true }).click();
  await demo.getByRole('button', { name: 'Show phase', exact: true }).click();
  await demo.getByRole('button', { name: 'Open phase', exact: true }).click();
  events.push('shipped');
  await expect(output).toHaveText(JSON.stringify(events));
  await demo.getByRole('spinbutton', { name: 'Build progress' }).fill('0.65');
  await gallery.scrollIntoViewIfNeeded();
  const geometry = await gallery.evaluate((root) => ({
    bounds: root.getBoundingClientRect().toJSON(),
    viewport: document.documentElement.clientWidth,
    client: root.clientWidth,
    scroll: root.scrollWidth,
    controls: [...root.querySelectorAll('button')].map((button) => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { box: box.toJSON(), hit: button === hit || button.contains(hit) };
    }),
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.controls.every((control) => control.hit)).toBe(true);
  await info.attach('phase-controls.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await stableLocatorScreenshot(page, gallery, async ({ png, attempt }) => {
    if (png)
      await info.attach(`workspace-phases-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});
