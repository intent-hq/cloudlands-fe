import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function open(page) {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.goto(`${base}/sandbox/hud-panel?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('hud-panel-demo');
  await expect(demo).toBeVisible();
  return { demo, frame: demo.getByTestId('hud-panel-frame'), errors };
}

test('HUD frame retains child state through presentation updates and routes current callbacks', async ({
  page,
}, info) => {
  const { demo, frame, errors } = await open(page);
  const input = frame.getByRole('textbox', { name: 'HUD draft' });
  const events = demo.getByRole('status', { name: 'HUD callbacks' });
  const original = await input.elementHandle();
  await input.fill('Keep this review draft');
  await demo.getByRole('button', { name: 'Fill panel', exact: true }).click();
  await demo.getByRole('button', { name: 'Change title', exact: true }).click();
  await demo.getByRole('button', { name: 'Show metadata', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Inspect', exact: true })).toHaveCount(0);
  await expect(input).toHaveValue('Keep this review draft');
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await input.focus();
  await page.keyboard.press('Tab');
  await expect(frame.getByRole('button', { name: 'Review', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(events).toHaveText('["child:REVIEW"]');
  await demo.getByRole('button', { name: 'Show metadata', exact: true }).click();
  await frame.getByRole('button', { name: 'Inspect', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Keep this review draft');
  await expect(events).toHaveText('["child:REVIEW","meta:REVIEW"]');
  await demo.getByRole('button', { name: 'Show panel', exact: true }).click();
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  await demo.getByRole('button', { name: 'Show panel', exact: true }).click();
  await expect(input).toHaveValue('');
  await frame.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(events).toHaveText('["child:REVIEW","meta:REVIEW","meta:REVIEW"]');
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png) await info.attach(`hud-panel-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});

test('narrow HUD panel keeps metadata and child controls usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 280, height: 1000 });
  const { demo, frame, errors } = await open(page);
  await demo.getByRole('button', { name: 'Fill panel', exact: true }).click();
  const input = frame.getByRole('textbox', { name: 'HUD draft' });
  await frame.getByRole('button', { name: 'Inspect', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await input.fill('A narrow review');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(demo.getByRole('button', { name: 'After panel', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(demo.getByRole('status', { name: 'HUD callbacks' })).toHaveText(
    '["meta:ATTENTION","child:ATTENTION","after"]',
  );
  await frame.scrollIntoViewIfNeeded();
  const geometry = await frame.evaluate((root) => ({
    bounds: root.getBoundingClientRect().toJSON(),
    viewport: document.documentElement.clientWidth,
    client: root.clientWidth,
    scroll: root.scrollWidth,
    controls: [...root.querySelectorAll('input,button')].map((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { box: box.toJSON(), hit: node === hit || node.contains(hit) };
    }),
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  for (const { box, hit } of geometry.controls) {
    expect(box.left).toBeGreaterThanOrEqual(geometry.bounds.left);
    expect(box.right).toBeLessThanOrEqual(geometry.bounds.right);
    expect(hit).toBe(true);
  }
  await info.attach('hud-panel-containment.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png)
      await info.attach(`hud-panel-narrow-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});
