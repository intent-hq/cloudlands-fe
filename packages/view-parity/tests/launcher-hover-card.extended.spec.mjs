import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/tooltip-rich?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('launcher-hover-demo');
  const trigger = demo.getByRole('button', { name: 'Launcher preview', exact: true });
  const popup = page
    .locator('[data-tooltip-content]')
    .filter({ has: page.locator('[data-sidebar-hover-card]') });
  await expect(trigger).toBeVisible();
  return {
    demo,
    trigger,
    popup,
    errors,
    events: async () => JSON.parse(await demo.locator('output').textContent()),
  };
}

test('launcher hover remains continuous into content and uses updated props and callbacks', async ({
  page,
}, info) => {
  const { trigger, popup, events, errors } = await openDemo(page);
  await expect(popup).toHaveCount(0);
  await trigger.hover();
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Review current work');
  await expect(popup).not.toContainText('Blank row');
  expect(await events()).toEqual([{ open: true, revision: 1 }]);
  await popup.hover();
  await expect(popup).toBeVisible();
  const original = await popup.elementHandle();
  await page.keyboard.press('Alt+u');
  await expect(popup).toContainText('Updated task summary');
  await expect(popup).toContainText('Updated content from the current caller.');
  await expect(popup).toContainText('Waiting');
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  const geometry = await popup.evaluate((node) => ({
    bounds: node.getBoundingClientRect().toJSON(),
    viewport: window.innerWidth,
    client: node.clientWidth,
    scroll: node.scrollWidth,
  }));
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  await info.attach('launcher-hover-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, popup, async ({ png, attempt }) => {
    if (png)
      await info.attach(`launcher-hover-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  expect(await events()).toEqual([
    { open: true, revision: 1 },
    { open: false, revision: 2 },
  ]);
  expect(errors).toEqual([]);
});

test('launcher parent visibility and blank rows preserve the empty-state contract', async ({
  page,
}) => {
  const { demo, popup, events, errors } = await openDemo(page);
  await demo.getByRole('button', { name: 'Only blank rows', exact: true }).click();
  await demo.getByRole('button', { name: 'Open from parent', exact: true }).click();
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('No summary is available.');
  await expect(popup).not.toContainText('Blank row');
  expect(await events()).toEqual([]);
  await demo.getByRole('button', { name: 'Close from parent', exact: true }).click();
  await expect(popup).toHaveCount(0);
  await demo.getByRole('button', { name: 'Open from parent', exact: true }).click();
  await expect(popup).toBeVisible();
  await page.keyboard.press('Alt+u');
  await expect(popup).toContainText('Updated task summary');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  expect((await events()).at(-1)).toEqual({ open: false, revision: 2 });
  expect(errors).toEqual([]);
});

test('launcher keyboard dismissal retires the portal and remount starts a fresh lifetime', async ({
  page,
}) => {
  const { demo, trigger, popup, events, errors } = await openDemo(page);
  await demo.getByRole('button', { name: 'Retire after dismiss', exact: true }).click();
  await demo.scrollIntoViewIfNeeded();
  await demo.getByRole('button', { name: 'Before launcher', exact: true }).click();
  await page.keyboard.press('Tab');
  await expect(popup).toBeVisible();
  const oldTrigger = await trigger.elementHandle();
  const oldPopup = await popup.elementHandle();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(trigger).toHaveCount(0);
  expect(await oldTrigger.evaluate((node) => node.isConnected)).toBe(false);
  expect(await oldPopup.evaluate((node) => node.isConnected)).toBe(false);
  expect(await events()).toEqual([
    { open: true, revision: 1 },
    { open: false, revision: 1 },
  ]);
  await demo.getByRole('button', { name: 'Remount launcher', exact: true }).click();
  await trigger.hover();
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveCount(0);
  expect(await events()).toEqual([
    { open: true, revision: 1 },
    { open: false, revision: 1 },
    { open: true, revision: 1 },
    { open: false, revision: 1 },
  ]);
  expect(errors).toEqual([]);
});
