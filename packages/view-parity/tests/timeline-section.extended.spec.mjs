import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('timeline disclosure honors controlled state, independent actions and child retirement', async ({
  page,
}, info) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto(`${base}/sandbox/timeline-section?example=interactive`);
  const demo = page.getByTestId('timeline-section-demo');
  const disclosure = demo.getByRole('button', { name: /^Review \/ / });
  const action = demo.getByRole('button', { name: 'Mark reviewed', exact: true });
  const lock = demo.getByRole('button', { name: 'Lock expansion', exact: true });
  const draft = demo.getByRole('textbox', { name: 'Review draft', exact: true });
  await expect(draft).toBeVisible();
  await draft.fill('Keep this draft while expansion is locked');
  const original = await draft.elementHandle();
  await lock.click();
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(draft).toHaveValue('Keep this draft while expansion is locked');
  expect(await draft.evaluate((node, first) => node === first, original)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(action).toBeFocused();
  await page.keyboard.press('Space');
  await expect(action).toHaveAttribute('aria-pressed', 'true');
  await expect(disclosure).toHaveAccessibleName('Review / Complete');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(draft).toBeFocused();
  await lock.click();
  await disclosure.focus();
  await page.keyboard.press('Space');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure).toBeFocused();
  await expect(draft).toHaveCount(0);
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  await page.keyboard.press('Tab');
  await expect(action).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAccessibleName('Review / In progress');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Tab');
  await expect(lock).toBeFocused();
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(draft).toHaveValue('');
  expect(await draft.evaluate((node, first) => node === first, original)).toBe(false);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
  await stableLocatorScreenshot(page, demo, async ({ png, attempt }) => {
    if (png)
      await info.attach(`timeline-section-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await original.dispose();
  expect(errors).toEqual([]);
});
