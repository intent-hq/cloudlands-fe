import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page, width = 900) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/popovers?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('home-filter-demo');
  const trigger = demo.getByRole('combobox', { name: 'Workspace status' });
  await expect(trigger).toBeVisible();
  const events = async () =>
    JSON.parse(await demo.getByRole('status', { name: 'Home filter callbacks' }).textContent());
  return { errors, demo, trigger, events };
}

test('Home filter immediate native typeahead then Enter chooses the matching option', async ({
  page,
}) => {
  const { errors, trigger, events } = await openDemo(page);
  await trigger.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('Running');
  expect(await events()).toEqual([{ value: 'running', revision: 'original' }]);
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test('Home filter retains controlled values and delivers current options and callbacks', async ({
  page,
}) => {
  const { errors, demo, trigger, events } = await openDemo(page);
  await demo.getByRole('button', { name: 'Hold selection' }).click();
  await trigger.click();
  await page.getByRole('option', { name: 'Running', exact: true }).click();
  await expect(trigger).toHaveText('Any');
  await demo.getByRole('button', { name: 'Publish blocked' }).click();
  await demo.getByRole('button', { name: 'Replace options and callback' }).click();
  await expect(trigger).toHaveText('Updated Blocked');
  await trigger.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  expect(await events()).toEqual([
    { value: 'running', revision: 'original' },
    { value: 'any', revision: 'updated' },
  ]);
  await expect(trigger).toHaveText('Updated Blocked');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await demo.getByRole('button', { name: 'Disable filter' }).click();
  await expect(trigger).toBeDisabled();
  expect(await events()).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('Select typeahead skips disabled options, cycles repeated keys and resets on close', async ({
  page,
}) => {
  const { errors, demo } = await openDemo(page);
  const trigger = demo.getByRole('combobox', { name: 'Keyboard options' });
  await trigger.click();
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('Read later');
  await trigger.click();
  await page.keyboard.press('z');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('Final');
  await trigger.click();
  await page.keyboard.press('q');
  await expect(page.getByRole('option', { name: 'Final', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await trigger.click();
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('Read first');
  expect(errors).toEqual([]);
});

test('Select typeahead accepts spaces in labels and honors the caller keyboard veto', async ({
  page,
}) => {
  const { errors, demo } = await openDemo(page);
  const trigger = demo.getByRole('combobox', { name: 'Keyboard options' });
  await trigger.click();
  for (const key of ['r', 'e', 'a', 'd', 'Space', 'l', 'Enter']) await page.keyboard.press(key);
  await expect(trigger).toHaveText('Read later');
  await demo.getByRole('button', { name: 'Prevent typeahead' }).click();
  await trigger.click();
  await page.keyboard.press('z');
  await expect(page.getByRole('option', { name: 'Read later', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test('Home filter keeps a narrow portal operable and retires it with the owner', async ({
  page,
}, info) => {
  const { errors, demo, trigger, events } = await openDemo(page, 280);
  await demo.getByRole('button', { name: 'Retire on selection' }).click();
  await trigger.click();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  const oldList = await list.elementHandle();
  const geometry = await list.evaluate((root) => ({
    bounds: root.getBoundingClientRect().toJSON(),
    viewport: window.innerWidth,
    options: [...root.querySelectorAll('[role="option"]')].map((option) => {
      const bounds = option.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      return { hit: hit === option || option.contains(hit), bounds: bounds.toJSON() };
    }),
  }));
  await info.attach('home-filter-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.options.every((option) => option.hit)).toBe(true);
  await stableLocatorScreenshot(page, list, async ({ png, attempt }) => {
    if (png) await info.attach(`home-filter-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveCount(0);
  await expect(list).toHaveCount(0);
  expect(await oldList.evaluate((node) => node.isConnected)).toBe(false);
  expect(await events()).toEqual([{ value: 'blocked', revision: 'original' }]);
  await demo.getByRole('button', { name: 'Show filter' }).click();
  await expect(trigger).toHaveText('Blocked');
  expect(errors).toEqual([]);
});
