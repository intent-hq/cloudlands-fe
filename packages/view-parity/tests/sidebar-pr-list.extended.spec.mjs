import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page, width = 800) {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width, height: 1100 });
  await page.goto(`${base}/sandbox/popovers?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('sidebar-pr-list-demo');
  const trigger = demo.getByRole('button', { name: 'Choose pull request', exact: true });
  await expect(trigger).toBeVisible();
  return {
    errors,
    demo,
    trigger,
    menu: page.getByRole('menu', { name: 'Pull-request preview' }),
    callbacks: demo.getByRole('status', { name: 'Pull-request callbacks' }),
  };
}

test('pull-request menu selects once, skips a missing link and uses current rows after replacement', async ({
  page,
}) => {
  const { errors, trigger, menu, callbacks } = await openDemo(page);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const first = menu.locator('[data-pr-identity="intent/desktop#42"]');
  const missing = menu.locator('[data-pr-identity="43"]');
  await expect(first).toBeFocused();
  await expect(missing).toHaveAttribute('aria-disabled', 'true');
  await expect(first).toHaveAccessibleName(
    /intent\/desktop.*42.*Keep the workspace navigation.*Checks passed/s,
  );
  const bounds = await missing.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(callbacks).toHaveText('[]');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Replace rows and callback' })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(callbacks).toHaveText(
    '[{"identity":"intent/desktop#42","title":"Keep the workspace navigation readable on narrow screens","revision":"original"}]',
  );
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  const current = await first.elementHandle();
  await menu.getByRole('menuitem', { name: 'Replace rows and callback' }).click();
  expect(await current.evaluate((node) => node.isConnected)).toBe(true);
  await expect(first).toHaveAccessibleName(/Updated pull request.*Current details/s);
  await first.click();
  await expect(callbacks).toHaveText(
    '[{"identity":"intent/desktop#42","title":"Keep the workspace navigation readable on narrow screens","revision":"original"},{"identity":"intent/desktop#42","title":"Updated pull request","revision":"updated"}]',
  );
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test('pull-request static rows remain inert and menu retirement removes listeners before reopening', async ({
  page,
}) => {
  const { errors, demo, trigger, menu, callbacks } = await openDemo(page);
  const staticRows = demo.getByTestId('static-pr-list');
  await staticRows.locator('[data-pr-identity="intent/desktop#42"]').click();
  await expect(callbacks).toHaveText('[]');
  await expect(staticRows.getByRole('menuitem')).toHaveCount(0);
  await trigger.click();
  await menu.getByRole('menuitem', { name: 'Toggle empty rows' }).click();
  await expect(menu.locator('[data-sidebar-pr-link]')).toHaveCount(0);
  await expect(staticRows.locator('[data-sidebar-pr-link]')).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Toggle empty rows' }).click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await demo.getByRole('button', { name: 'Retire on selection' }).click();
  await trigger.click();
  const retiring = await menu.elementHandle();
  await menu.locator('[data-pr-identity="intent/desktop#42"]').click();
  await expect(trigger).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  expect(await retiring.evaluate((node) => node.isConnected)).toBe(false);
  await demo.getByRole('button', { name: 'Show pull-request menu' }).click();
  await expect(trigger).toBeVisible();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(callbacks).toHaveText(
    '[{"identity":"intent/desktop#42","title":"Keep the workspace navigation readable on narrow screens","revision":"original"}]',
  );
  expect(errors).toEqual([]);
});

test('pull-request menu keeps its number and selection target reachable at narrow width', async ({
  page,
}, info) => {
  const { errors, trigger, menu, callbacks } = await openDemo(page, 280);
  await trigger.click();
  const row = menu.locator('[data-pr-identity="intent/desktop#42"]');
  await expect(row).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await row.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const number = node.lastElementChild.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      bounds: rect.toJSON(),
      number: number.toJSON(),
      viewport: document.documentElement.clientWidth,
      client: node.clientWidth,
      scroll: node.scrollWidth,
      hit: node === hit || node.contains(hit),
    };
  });
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.number.right).toBeLessThanOrEqual(geometry.bounds.right);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.hit).toBe(true);
  await info.attach('sidebar-pr-list-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, menu, async ({ png, attempt }) => {
    if (png)
      await info.attach(`sidebar-pr-list-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await row.click();
  await expect(menu).toHaveCount(0);
  await expect(callbacks).toHaveText(
    '[{"identity":"intent/desktop#42","title":"Keep the workspace navigation readable on narrow screens","revision":"original"}]',
  );
  expect(errors).toEqual([]);
});
