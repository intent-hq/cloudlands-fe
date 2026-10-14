import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('navigation icon callers retain keyboard access and current actions through presentation changes', async ({
  page,
}, info) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  await page.setViewportSize({ width: 280, height: 1100 });
  const errors = await observeErrors(page);
  await page.goto(`${base}/sandbox/device-icons?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('navigation-icon-demo');
  const choices = demo.getByTestId('navigation-icon-choices');
  const action = demo.getByRole('button', { name: 'Activate icon', exact: true });
  const output = demo.getByRole('status', { name: 'Navigation callbacks' });
  const names = ['spaces', 'tabs', 'settings', 'dandelion', 'sidebar'];
  const events = [];
  for (const name of names) {
    await choices.getByRole('button', { name, exact: true }).click();
    await demo.getByRole('button', { name: 'Before action', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(action).toBeFocused();
    await expect(action).toHaveAccessibleName('Activate icon');
    await page.keyboard.press('Enter');
    events.push(name);
    await expect(output).toHaveText(JSON.stringify(events));
  }
  await demo.getByRole('button', { name: 'Disable action', exact: true }).click();
  await demo.getByRole('button', { name: 'Before action', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(demo.getByRole('button', { name: 'After action', exact: true })).toBeFocused();
  await expect(action).toBeDisabled();
  await expect(output).toHaveText(JSON.stringify(events));
  await demo.getByRole('button', { name: 'Disable action', exact: true }).click();
  await demo.getByRole('textbox', { name: 'Icon size' }).fill('0');
  await action.click();
  events.push('sidebar');
  await expect(output).toHaveText(JSON.stringify(events));
  const old = await action.elementHandle();
  await demo.getByRole('button', { name: 'Show action', exact: true }).click();
  expect(await old.evaluate((node) => node.isConnected)).toBe(false);
  await choices.getByRole('button', { name: 'tabs', exact: true }).click();
  await demo.getByRole('textbox', { name: 'Icon size' }).fill('16');
  await demo.getByRole('button', { name: 'Show action', exact: true }).click();
  await action.focus();
  await page.keyboard.press('Space');
  events.push('tabs');
  await expect(output).toHaveText(JSON.stringify(events));
  await choices.scrollIntoViewIfNeeded();
  const geometry = await choices.evaluate((root) => ({
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
  await info.attach('navigation-controls.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await stableLocatorScreenshot(page, choices, async ({ png, attempt }) => {
    if (png)
      await info.attach(`navigation-icons-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});
