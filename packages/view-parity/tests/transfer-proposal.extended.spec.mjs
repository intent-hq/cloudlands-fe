import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function open(page) {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.goto(`${base}/sandbox/proposal-card?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('transfer-proposal-demo');
  await expect(demo).toBeVisible();
  return { demo, errors, card: demo.getByTestId('transfer-proposal') };
}

async function state(page, demo, value) {
  await demo.getByRole('combobox', { name: 'Preview transfer state' }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}

test('transfer destination and lifecycle states gate real callbacks', async ({ page }, info) => {
  const { demo, card, errors } = await open(page);
  const destination = card.getByRole('combobox', { name: 'Destination device' });
  const approve = card.getByRole('button', { name: 'Approve transfer' });
  const cancel = card.getByRole('button', { name: 'Cancel', exact: true });
  const calls = demo.getByRole('status', { name: 'Transfer preview callbacks' });
  await expect(approve).toBeDisabled();
  await destination.focus();
  await page.keyboard.press('Space');
  await page.getByRole('option', { name: 'Development laptop', exact: true }).press('Enter');
  await expect(destination).toBeFocused();
  await approve.click();
  await expect(calls).toHaveText('["approve:laptop"]');
  await cancel.click();
  await expect(calls).toHaveText('["approve:laptop","cancel"]');
  await demo.getByRole('button', { name: 'Use office desktop' }).click();
  await approve.click();
  await expect(calls).toHaveText('["approve:laptop","cancel","approve:desktop"]');
  await demo.getByRole('button', { name: 'Non-desktop mode' }).click();
  await expect(approve).toBeDisabled();
  await expect(card.getByRole('alert')).toBeVisible();
  await expect(cancel).toBeEnabled();
  await demo.getByRole('button', { name: 'Non-desktop mode' }).click();
  await demo.getByRole('button', { name: 'Disable actions' }).click();
  await expect(destination).toBeDisabled();
  await expect(approve).toBeDisabled();
  await expect(cancel).toBeDisabled();
  await demo.getByRole('button', { name: 'Disable actions' }).click();
  await state(page, demo, 'applying');
  await expect(destination).toBeDisabled();
  await expect(approve).toBeDisabled();
  await expect(cancel).toBeDisabled();
  await state(page, demo, 'failed');
  await expect(destination).toBeEnabled();
  await card.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(calls).toHaveText('["approve:laptop","cancel","approve:desktop","approve:desktop"]');
  await state(page, demo, 'imported');
  await expect(destination).toBeDisabled();
  await expect(cancel).toBeDisabled();
  await card.getByRole('button', { name: 'Finish transfer' }).click();
  await expect(calls).toHaveText(
    '["approve:laptop","cancel","approve:desktop","approve:desktop","approve:desktop"]',
  );
  for (const terminal of ['applied', 'dismissed']) {
    await state(page, demo, terminal);
    await expect(destination).toBeDisabled();
    await expect(card.getByRole('button')).toHaveCount(0);
  }
  await state(page, demo, 'idle');
  await expect(destination).toBeEnabled();
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  expect(await card.evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await stableLocatorScreenshot(page, card, async ({ png, attempt }) => {
    if (png)
      await info.attach(`transfer-ready-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});

test('narrow transfer actions stay contained and keyboard accessible', async ({ page }, info) => {
  await page.setViewportSize({ width: 280, height: 1100 });
  const { demo, card, errors } = await open(page);
  await demo.getByRole('button', { name: 'Use office desktop' }).click();
  const approve = card.getByRole('button', { name: 'Approve transfer' });
  await approve.focus();
  await page.keyboard.press('Enter');
  await expect(demo.getByRole('status', { name: 'Transfer preview callbacks' })).toHaveText(
    '["approve:desktop"]',
  );
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await card.evaluate((root) => ({
    bounds: root.getBoundingClientRect().toJSON(),
    viewportWidth: document.documentElement.clientWidth,
    clientWidth: root.clientWidth,
    scrollWidth: root.scrollWidth,
    controls: [...root.querySelectorAll('button')].map((button) => {
      const bounds = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      return { bounds: bounds.toJSON(), hit: hit === button || button.contains(hit) };
    }),
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewportWidth);
  for (const control of geometry.controls) {
    expect(control.bounds.left).toBeGreaterThanOrEqual(geometry.bounds.left);
    expect(control.bounds.right).toBeLessThanOrEqual(geometry.bounds.right);
    expect(control.hit).toBe(true);
  }
  await info.attach('transfer-containment.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, card, async ({ png, attempt }) => {
    if (png)
      await info.attach(`transfer-narrow-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});
