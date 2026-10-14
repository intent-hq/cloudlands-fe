import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page, width = 800) {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}/sandbox/popovers?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('home-view-options-demo');
  const trigger = demo.getByRole('button', { name: 'View options', exact: true });
  await expect(trigger).toBeVisible();
  return { errors, demo, trigger, popover: page.getByRole('dialog') };
}

test('Home view options preserves drafts and current callbacks through native keyboard and portal lifetimes', async ({
  page,
}) => {
  const { errors, demo, trigger, popover } = await openDemo(page);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const input = popover.getByRole('textbox', { name: 'View draft' });
  await expect(input).toBeFocused();
  await input.fill('draft');
  const originalInput = await input.elementHandle();
  await popover.getByRole('button', { name: 'Replace child callback' }).click();
  expect(await originalInput.evaluate((node) => node.isConnected)).toBe(true);
  await expect(input).toHaveValue('draft');
  await input.focus();
  await page.keyboard.press('End');
  await page.keyboard.type(' retained');
  const apply = popover.getByRole('button', { name: 'Apply preview' });
  const output = demo.getByRole('status', { name: 'View-option callbacks' });
  await apply.click();
  await expect(output).toHaveText('["updated:draft retained"]');
  await popover.getByRole('button', { name: 'Disable child action' }).click();
  await expect(apply).toBeDisabled();
  const box = await apply.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(output).toHaveText('["updated:draft retained"]');
  await popover.getByRole('button', { name: 'Disable child action' }).focus();
  await page.keyboard.press('Tab');
  await expect(popover.getByRole('button', { name: 'Remove view options' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Space');
  await expect(input).toHaveValue('draft retained');
  await popover.getByRole('button', { name: 'Remove view options' }).click();
  await expect(popover).toHaveCount(0);
  expect(await originalInput.evaluate((node) => node.isConnected)).toBe(false);
  await expect(trigger).toHaveCount(0);
  await demo.getByRole('button', { name: 'Show view options' }).click();
  await expect(popover).toHaveCount(0);
  await trigger.click();
  await expect(input).toHaveValue('draft retained');
  const outside = demo.getByRole('button', { name: 'Outside target' });
  await outside.click();
  await expect(popover).toHaveCount(0);
  await expect(outside).toBeFocused();
  expect(errors).toEqual([]);
});

test('Home view options keeps its portal controls operable in a narrow viewport', async ({
  page,
}, info) => {
  const { errors, trigger, popover } = await openDemo(page, 280);
  await trigger.click();
  await expect(popover.getByRole('textbox', { name: 'View draft' })).toBeFocused();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await popover.evaluate((root) => {
    const bounds = root.getBoundingClientRect().toJSON();
    return {
      bounds,
      viewport: document.documentElement.clientWidth,
      client: root.clientWidth,
      scroll: root.scrollWidth,
      controls: [...root.querySelectorAll('button,input')].map((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { bounds: rect.toJSON(), hit: node === hit || node.contains(hit) };
      }),
    };
  });
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  for (const control of geometry.controls) {
    expect(control.hit).toBe(true);
    expect(control.bounds.left).toBeGreaterThanOrEqual(geometry.bounds.left);
    expect(control.bounds.right).toBeLessThanOrEqual(geometry.bounds.right);
  }
  await info.attach('home-view-options-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, popover, async ({ png, attempt }) => {
    if (png)
      await info.attach(`home-view-options-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});
