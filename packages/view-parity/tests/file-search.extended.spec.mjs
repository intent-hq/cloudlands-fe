import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/sidebar-actions?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('file-search-demo');
  const frame = demo.getByTestId('file-search-frame');
  const input = frame.getByRole('searchbox', { name: 'Search files...', exact: true });
  const trigger = frame.getByRole('button', { name: 'Search files...', exact: true });
  await expect(trigger).toBeVisible();
  return {
    demo,
    frame,
    input,
    trigger,
    errors,
    events: async () => JSON.parse(await demo.locator('output').textContent()),
  };
}

test('file search preserves native typing, clear, blur, and Escape focus', async ({
  page,
}, info) => {
  const { demo, frame, input, trigger, errors, events } = await openDemo(page);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await input.pressSequentially('file');
  await expect(input).toHaveValue('file');
  expect((await events()).filter((event) => 'query' in event)).toEqual(
    ['f', 'fi', 'fil', 'file'].map((query) => ({ query, revision: 0 })),
  );
  const after = demo.getByRole('button', { name: 'After file search' });
  await after.click();
  await expect(input).toHaveValue('file');
  await expect(after).toBeFocused();
  await frame.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await after.click();
  await expect(input).toHaveCount(0);
  await expect(after).toBeFocused();
  await trigger.press('Enter');
  await input.pressSequentially('src');
  await frame.scrollIntoViewIfNeeded();
  const geometry = await frame.evaluate((root) => {
    const field = root.querySelector('input');
    return {
      frame: root.getBoundingClientRect().toJSON(),
      input: field.getBoundingClientRect().toJSON(),
      client: root.clientWidth,
      scroll: root.scrollWidth,
    };
  });
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  await info.attach('file-search-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png) await info.attach(`file-search-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect((await events()).filter((event) => event.key === 'Escape')).toEqual([]);
  expect(errors).toEqual([]);
});

test('file search uses current native callbacks and clears listeners on owner removal', async ({
  page,
}) => {
  const { demo, input, trigger, events, errors } = await openDemo(page);
  const seed = demo.getByRole('button', { name: 'Set external query' });
  await seed.click();
  await expect(input).toHaveValue('external.ts');
  await expect(seed).toBeFocused();
  await demo.getByRole('button', { name: 'Update callback' }).click();
  await input.press('Enter');
  expect((await events()).filter((event) => event.key === 'Enter')).toEqual([
    { key: 'Enter', revision: 1, native: true, target: true, prevented: true },
  ]);
  expect((await events()).filter((event) => event.bubble === 'Enter')).toEqual([]);
  const old = await input.elementHandle();
  await demo.getByRole('button', { name: 'Remove search', exact: true }).click();
  await expect(input).toHaveCount(0);
  expect(await old.evaluate((node) => node.isConnected)).toBe(false);
  const retiredEvents = await events();
  await page.keyboard.press('Escape');
  expect(await events()).toEqual(retiredEvents);
  await demo.getByRole('button', { name: 'Remount search' }).click();
  await expect(input).toHaveValue('external.ts');
  await input.press('Escape');
  await expect(trigger).toBeFocused();
  await demo.getByRole('button', { name: 'Omit callbacks' }).click();
  const withoutCallbacks = await events();
  await trigger.click();
  await input.fill('local only');
  await expect(input).toHaveValue('local only');
  await input.press('Escape');
  await expect(trigger).toBeFocused();
  expect(await events()).toEqual(withoutCallbacks);
  expect(errors).toEqual([]);
});
