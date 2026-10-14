import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/device-icons?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('device-icon-picker-demo');
  const trigger = demo.getByRole('combobox');
  await expect(trigger).toBeVisible();
  return {
    demo,
    trigger,
    errors,
    list: page.getByRole('listbox'),
    events: async () => JSON.parse(await demo.locator('output').textContent()),
  };
}

test('device picker commits immediate typeahead and replaces local choice from current props', async ({
  page,
}, info) => {
  const { demo, trigger, list, errors, events } = await openDemo(page);
  await expect(trigger).toHaveAccessibleName('Device icon: Automatic (Mac mini)');
  await trigger.click();
  await expect(list).toBeVisible();
  const geometry = await list.evaluate((node) => ({
    bounds: node.getBoundingClientRect().toJSON(),
    viewport: window.innerWidth,
    client: node.clientWidth,
    scroll: node.scrollWidth,
  }));
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  await info.attach('device-picker-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, list, async ({ png, attempt }) => {
    if (png) await info.attach(`device-picker-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  await expect(list).toHaveCount(0);
  await expect(trigger).toHaveAccessibleName('Device icon: Robot');
  await expect(trigger).toBeFocused();
  expect(await events()).toEqual([{ value: 'robot', revision: 0 }]);
  await demo.getByRole('button', { name: 'Set external cat' }).click();
  await expect(trigger).toHaveAccessibleName('Device icon: Cat');
  await demo.getByRole('button', { name: 'Clear external override' }).click();
  await expect(trigger).toHaveAccessibleName('Device icon: Automatic (Mac mini)');
  await demo.getByRole('button', { name: 'Mac mini detected' }).click();
  await expect(trigger).toHaveAccessibleName('Device icon: Automatic (Server)');
  expect(await events()).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('device picker portal restores focus and selection retires the current owner cleanly', async ({
  page,
}) => {
  const { demo, trigger, list, errors, events } = await openDemo(page);
  await demo.getByRole('button', { name: 'Use portal' }).click();
  await trigger.press('Enter');
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await demo.getByRole('button', { name: 'Disable picker' }).click();
  await expect(trigger).toBeDisabled();
  await demo.getByRole('button', { name: 'Disable picker' }).click();
  await demo.getByRole('button', { name: 'Update callback' }).click();
  await demo.getByRole('button', { name: 'Retire on selection' }).click();
  const old = await trigger.elementHandle();
  await trigger.click();
  await list.getByRole('option', { name: 'Rocket', exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(trigger).toHaveCount(0);
  expect(await old.evaluate((node) => node.isConnected)).toBe(false);
  expect(await events()).toEqual([{ value: 'rocket', revision: 1 }]);
  const after = demo.getByRole('button', { name: 'After picker' });
  await after.click();
  await page.keyboard.press('Escape');
  await expect(after).toBeFocused();
  await demo.getByRole('button', { name: 'Remount picker' }).click();
  await expect(trigger).toHaveAccessibleName('Device icon: Automatic (Mac mini)');
  await trigger.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveCount(0);
  await expect(list).toHaveCount(0);
  expect(await events()).toEqual([
    { value: 'rocket', revision: 1 },
    { value: 'pottedPlant', revision: 1 },
  ]);
  expect(errors).toEqual([]);
});
