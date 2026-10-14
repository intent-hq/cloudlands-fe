import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page, width = 800) {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`${base}/sandbox/popovers?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('specialist-options-demo');
  const trigger = demo.getByRole('button', { name: 'Choose specialist', exact: true });
  await expect(trigger).toBeVisible();
  return { errors, demo, trigger, menu: page.getByRole('menu', { name: 'Specialist preview' }) };
}

test('specialist immediate Home-v-Enter chooses Verifier once and General retains null identity', async ({
  page,
}) => {
  const { errors, demo, trigger, menu } = await openDemo(page);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('v');
  await page.keyboard.press('Enter');
  const callbacks = demo.getByRole('status', { name: 'Specialist callbacks' });
  await expect(callbacks).toHaveText('[{"id":"verifier","revision":"original"}]');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitemradio', { name: /^Verifier/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(callbacks).toHaveText(
    '[{"id":"verifier","revision":"original"},{"id":null,"revision":"original"}]',
  );
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await menu.getByRole('menuitemradio', { name: /^Literal null/ }).click();
  await expect(demo.getByRole('status', { name: 'Selected specialist' })).toHaveText('"null"');
  await trigger.click();
  await expect(menu.getByRole('menuitemradio', { name: /^General/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(menu.getByRole('menuitemradio', { name: /^Literal null/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test('specialist options obey refused selection and current child updates and retire with their menu', async ({
  page,
}) => {
  const { errors, demo, trigger, menu } = await openDemo(page);
  await demo.getByRole('button', { name: 'Hold selected value' }).click();
  await trigger.click();
  await menu.getByRole('menuitemradio', { name: /^Builder/ }).click();
  await expect(demo.getByRole('status', { name: 'Selected specialist' })).toHaveText('null');
  await expect(demo.getByRole('status', { name: 'Specialist callbacks' })).toHaveText(
    '[{"id":"builder","revision":"original"}]',
  );
  await demo.getByRole('button', { name: 'Hold selected value' }).click();
  await demo.getByRole('button', { name: 'Unknown saved value' }).click();
  await trigger.click();
  await expect(menu.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveCount(0);
  const originalMenu = await menu.elementHandle();
  await menu.getByRole('menuitem', { name: 'Replace options and callback' }).click();
  expect(await originalMenu.evaluate((node) => node.isConnected)).toBe(true);
  await expect(menu.getByRole('menuitemradio', { name: /^Builder/ })).toHaveCount(0);
  await menu.getByRole('menuitemradio', { name: /^Verifier/ }).click();
  await expect(demo.getByRole('status', { name: 'Specialist callbacks' })).toHaveText(
    '[{"id":"builder","revision":"original"},{"id":"verifier","revision":"updated"}]',
  );
  await trigger.click();
  await menu.getByRole('menuitem', { name: 'Toggle empty options' }).click();
  await expect(menu.getByRole('menuitemradio')).toHaveCount(1);
  await expect(menu.getByRole('menuitemradio', { name: /^General/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.keyboard.press('Escape');
  await demo.getByRole('button', { name: 'Retire on selection' }).click();
  await trigger.click();
  const retiringMenu = await menu.elementHandle();
  await menu.getByRole('menuitemradio', { name: /^General/ }).click();
  await expect(trigger).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  expect(await retiringMenu.evaluate((node) => node.isConnected)).toBe(false);
  await demo.getByRole('button', { name: 'Show specialist picker' }).click();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await expect(menu.getByRole('menuitemradio', { name: /^General/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test('specialist menu keeps long descriptions and native selection inside a narrow viewport', async ({
  page,
}, info) => {
  const { errors, demo, trigger, menu } = await openDemo(page, 280);
  await trigger.click();
  await expect(menu.getByRole('menuitemradio', { name: /^Verifier/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await menu.evaluate((root) => ({
    bounds: root.getBoundingClientRect().toJSON(),
    viewport: document.documentElement.clientWidth,
    client: root.clientWidth,
    scroll: root.scrollWidth,
    rows: [...root.querySelectorAll('[role="menuitemradio"]')].map((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        bounds: rect.toJSON(),
        hit: node === hit || node.contains(hit),
        name: node.textContent,
      };
    }),
  }));
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.rows.every((row) => row.hit)).toBe(true);
  await info.attach('specialist-options-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, menu, async ({ png, attempt }) => {
    if (png)
      await info.attach(`specialist-options-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await menu.getByRole('menuitemradio', { name: /^Verifier/ }).click();
  await expect(demo.getByRole('status', { name: 'Selected specialist' })).toHaveText('"verifier"');
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});
