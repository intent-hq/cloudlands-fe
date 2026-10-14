import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/confirm?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('protocol-advisory-demo');
  const opener = demo.getByRole('button', { name: 'Open advisory', exact: true });
  await expect(opener).toBeVisible();
  return {
    demo,
    opener,
    errors,
    dialog: page.getByRole('dialog', { name: 'Protocol version differs' }),
    events: async () => JSON.parse(await demo.locator('output').textContent()),
  };
}

test('protocol advisory keeps the local action open and uses current event and callback props', async ({
  page,
}, info) => {
  const { opener, dialog, events, errors } = await openDemo(page);
  await opener.click();
  await expect(dialog).toContainText('long-preview-remote-hostname.example.test:443');
  const original = await dialog.elementHandle();
  const local = dialog.getByRole('button', { name: 'Open This machine (local)', exact: true });
  await local.click();
  await expect(dialog).toContainText('updated-preview-remote.example.test:443');
  await expect(dialog).toContainText('2028.2.0');
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await local.click();
  expect(await events()).toEqual(['local:original', 'local:updated']);
  const geometry = await dialog.evaluate((root) => ({
    bounds: root.getBoundingClientRect().toJSON(),
    viewport: window.innerWidth,
    client: root.clientWidth,
    scroll: root.scrollWidth,
    controls: [...root.querySelectorAll('button')].map((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { bounds: rect.toJSON(), hit: node === hit || node.contains(hit) };
    }),
  }));
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.controls.every((control) => control.hit)).toBe(true);
  await info.attach('protocol-advisory-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, dialog, async ({ png, attempt }) => {
    if (png)
      await info.attach(`protocol-advisory-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await dialog.getByRole('button', { name: 'Continue anyway', exact: true }).dblclick();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await events()).toEqual(['local:original', 'local:updated', 'continue:updated']);
  await page.keyboard.press('Escape');
  expect(await events()).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('protocol advisory dismisses once per lifetime and retires its portal with the parent', async ({
  page,
}) => {
  const { demo, opener, dialog, events, errors } = await openDemo(page);
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await events()).toEqual(['continue:original']);
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await events()).toEqual(['continue:original', 'continue:original']);
  await demo.getByRole('button', { name: 'Retire on local action' }).click();
  await opener.click();
  const old = await dialog.elementHandle();
  await dialog.getByRole('button', { name: 'Open This machine (local)', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await old.evaluate((node) => node.isConnected)).toBe(false);
  expect(await events()).toEqual(['continue:original', 'continue:original', 'local:original']);
  await opener.click();
  await expect(dialog).toContainText('2028.2.0');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await events()).toEqual([
    'continue:original',
    'continue:original',
    'local:original',
    'continue:updated',
  ]);
  expect(errors).toEqual([]);
});

test('static protocol advisory remains operable when optional callbacks are absent', async ({
  page,
}) => {
  const { demo, opener, events, errors } = await openDemo(page);
  await demo.getByRole('button', { name: 'Static advisory' }).click();
  await demo.getByRole('button', { name: 'Omit callbacks' }).click();
  await opener.click();
  const frame = demo.getByTestId('protocol-advisory-frame');
  const local = frame.getByRole('button', { name: 'Open This machine (local)', exact: true });
  await local.click();
  await expect(local).toBeVisible();
  const proceed = frame.getByRole('button', { name: 'Continue anyway', exact: true });
  await proceed.focus();
  await page.keyboard.press('Enter');
  await expect(proceed).toHaveCount(0);
  expect(await events()).toEqual([]);
  expect(errors).toEqual([]);
});
