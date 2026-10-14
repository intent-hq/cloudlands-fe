import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function open(page) {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.goto(`${base}/sandbox/proposal-card?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('bulk-proposal-demo');
  await expect(demo).toBeVisible();
  return { demo, errors, frame: demo.getByTestId('bulk-proposal-frame') };
}

test('bulk selection publishes pointer and keyboard changes and accepts parent replacement', async ({
  page,
}, info) => {
  const { demo, errors, frame } = await open(page);
  const rename = demo.getByRole('checkbox', { name: /Rename workspace/ });
  const appearance = demo.getByRole('checkbox', { name: /Change appearance/ });
  const history = demo.getByRole('checkbox', { name: /Keep repository history/ });
  const selected = demo.getByRole('status', { name: 'Selected proposal items' });
  await rename.uncheck();
  await expect(selected).toHaveText('None');
  await appearance.focus();
  await page.keyboard.press('Space');
  await expect(appearance).toBeChecked();
  await expect(selected).toHaveText('appearance');
  await rename.check();
  await expect(selected).toHaveText('appearance, rename');
  await expect(history).toBeDisabled();
  await demo.getByRole('button', { name: 'Reverse rows', exact: true }).click();
  await expect(rename).toBeChecked();
  await expect(appearance).toBeChecked();
  await expect(selected).toHaveText('appearance, rename');
  await demo.getByRole('button', { name: 'Reset selection', exact: true }).click();
  await expect(rename).toBeChecked();
  await expect(appearance).not.toBeChecked();
  await expect(selected).toHaveText('rename');
  await demo.getByRole('button', { name: 'Disable selection', exact: true }).click();
  await expect(rename).toBeDisabled();
  await expect(appearance).toBeDisabled();
  await expect(selected).toHaveText('rename');
  await demo.getByRole('button', { name: 'Disable selection', exact: true }).click();
  await appearance.check();
  await expect(selected).toHaveText('rename, appearance');
  await expect(history).toBeDisabled();
  await frame.scrollIntoViewIfNeeded();
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png)
      await info.attach(`bulk-selection-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});

test('narrow bulk rows keep enabled controls reachable without horizontal overflow', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 280, height: 1100 });
  const { demo, errors, frame } = await open(page);
  const appearance = demo.getByRole('checkbox', { name: /Change appearance/ });
  await appearance.scrollIntoViewIfNeeded();
  await appearance.focus();
  await page.keyboard.press('Space');
  await expect(appearance).toBeChecked();
  await expect(demo.getByRole('status', { name: 'Selected proposal items' })).toHaveText(
    'rename, appearance',
  );
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await frame.evaluate((node) => {
    const root = node.firstElementChild;
    return {
      bounds: root.getBoundingClientRect().toJSON(),
      viewportWidth: document.documentElement.clientWidth,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      controls: [...root.querySelectorAll('[role="checkbox"]')].map((control) =>
        control.getBoundingClientRect().toJSON(),
      ),
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewportWidth);
  for (const control of geometry.controls) {
    expect(control.left).toBeGreaterThanOrEqual(geometry.bounds.left);
    expect(control.right).toBeLessThanOrEqual(geometry.bounds.right);
  }
  await info.attach('containment.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png) await info.attach(`bulk-narrow-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});
