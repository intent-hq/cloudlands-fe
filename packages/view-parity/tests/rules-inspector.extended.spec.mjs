import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/confirm?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('rules-inspector-demo');
  await expect(demo.getByRole('button', { name: 'Literal rules', exact: true })).toBeVisible();
  return {
    demo,
    errors,
    dialog: page.getByRole('dialog', { name: 'Applied Agent Rules', exact: true }),
    events: async () => JSON.parse(await demo.locator('output').textContent()),
  };
}

test('rules inspector distinguishes missing content from whitespace and renders markup literally', async ({
  page,
}, info) => {
  const { demo, dialog, events, errors } = await openDemo(page);
  for (const mode of ['Null', 'Empty']) {
    const opener = demo.getByRole('button', { name: `${mode} rules`, exact: true });
    await opener.click();
    await expect(dialog).toContainText('No custom rules were applied to this agent.');
    await expect(dialog.locator('pre')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  await demo.getByRole('button', { name: 'Whitespace rules', exact: true }).click();
  expect(await dialog.locator('pre').textContent()).toBe(' \n\t ');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const opener = demo.getByRole('button', { name: 'Literal rules', exact: true });
  await opener.click();
  expect(await dialog.locator('pre').textContent()).toBe(
    '<strong>Keep this literal</strong>\nUse `pnpm` & preserve drafts.',
  );
  await expect(dialog.locator('strong')).toHaveCount(0);
  const geometry = await dialog.evaluate((node) => ({
    bounds: node.getBoundingClientRect().toJSON(),
    viewport: window.innerWidth,
    client: node.clientWidth,
    scroll: node.scrollWidth,
  }));
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  await info.attach('rules-inspector-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, dialog, async ({ png, attempt }) => {
    if (png)
      await info.attach(`rules-inspector-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Close rules inspector', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await events()).toEqual([0, 0, 0, 0]);
  expect(errors).toEqual([]);
});

test('rules inspector uses the current callback and stays dismissed until a fresh mount', async ({
  page,
}) => {
  const { demo, dialog, events, errors } = await openDemo(page);
  await demo.getByRole('button', { name: 'Keep parent mounted after close' }).click();
  const opener = demo.getByRole('button', { name: 'Literal rules', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  const original = await dialog.elementHandle();
  await page.keyboard.press('Alt+u');
  await expect(dialog).toContainText('Updated rules remain literal: <em>current</em>.');
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await events()).toEqual([1]);
  await page.keyboard.press('Alt+u');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await events()).toEqual([1]);
  await opener.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close rules inspector', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await events()).toEqual([1, 2]);
  expect(errors).toEqual([]);
});

test('rules inspector keeps dismissal available while scrolling and cleans up on parent retirement', async ({
  page,
}) => {
  const { demo, dialog, events, errors } = await openDemo(page);
  const opener = demo.getByRole('button', { name: 'Long rules', exact: true });
  await opener.click();
  await expect(dialog).toBeVisible();
  const scroller = dialog.locator('[data-slot="dialog-body"]');
  await scroller.hover();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(
    dialog.getByRole('button', { name: 'Close rules inspector', exact: true }),
  ).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await events()).toEqual([0]);
  await opener.click();
  await expect(dialog).toBeVisible();
  const retired = await dialog.elementHandle();
  await page.keyboard.press('Alt+x');
  await expect(dialog).toHaveCount(0);
  expect(await retired.evaluate((node) => node.isConnected)).toBe(false);
  await page.keyboard.press('Escape');
  expect(await events()).toEqual([0]);
  await opener.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await events()).toEqual([0, 0]);
  expect(errors).toEqual([]);
});
