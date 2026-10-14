import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function open(page) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/editor-icons?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('context-provider-demo');
  await demo.waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await demo.scrollIntoViewIfNeeded();
  return { demo, errors };
}

async function capture(page, info, name) {
  const frame = page.getByTestId('context-provider-frame');
  await frame.scrollIntoViewIfNeeded();
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png) await info.attach(`${name}-${attempt}`, { body: png, contentType: 'image/png' });
  });
}

test('context icons retain provider precedence, explicit sizes and current native callers', async ({
  page,
}, info) => {
  const { demo, errors } = await open(page);
  const providers = demo.locator('[aria-label="Explicit provider"]');
  const types = demo.locator('[aria-label="Context item type"]');
  const current = page.getByTestId('context-provider-current');
  const icon = current.locator(':scope > *');
  const before = await icon.boundingBox();
  await expect(current.getByRole('img', { name: 'Linear' })).toBeVisible();
  await types.getByRole('button', { name: 'browser-url', exact: true }).click();
  await expect(current.getByRole('img', { name: 'Linear' })).toBeVisible();
  await providers.getByRole('button', { name: 'Derive from item', exact: true }).click();
  await expect(current.getByRole('img', { name: 'Linear' })).toHaveCount(0);
  await types.getByRole('button', { name: 'linear-issue', exact: true }).click();
  await expect(current.getByRole('img', { name: 'Linear' })).toBeVisible();
  await demo.getByRole('button', { name: 'Activate current context', exact: true }).press('Enter');
  expect(JSON.parse(await demo.locator('output').textContent())).toEqual(['derived:linear-issue']);

  const measured = [];
  for (const provider of ['internal', 'browser', 'linear', 'github', 'sentry']) {
    await providers.getByRole('button', { name: provider, exact: true }).click();
    for (const size of [0, 24, 47.5, 16]) {
      await demo.getByRole('button', { name: 'Next size', exact: true }).click();
      await expect
        .poll(async () => {
          const rect = await icon.boundingBox();
          return { width: rect?.width, height: rect?.height };
        })
        .toEqual({ width: size, height: size });
      measured.push({ provider, size, bounds: await icon.boundingBox() });
    }
  }
  await demo.getByRole('button', { name: 'Activate current context', exact: true }).press('Space');
  expect(JSON.parse(await demo.locator('output').textContent())).toEqual([
    'derived:linear-issue',
    'sentry:linear-issue',
  ]);
  const previous = await icon.elementHandle();
  await demo.getByRole('button', { name: 'Mount icon', exact: true }).click();
  await expect(current).toHaveCount(0);
  expect(await previous.evaluate((node) => node.isConnected)).toBe(false);
  await providers.getByRole('button', { name: 'github', exact: true }).click();
  await demo.getByRole('button', { name: 'Mount icon', exact: true }).click();
  await expect(icon).toBeVisible();
  await info.attach('provider-sizes.json', {
    body: JSON.stringify({ before, after: await icon.boundingBox(), measured }),
    contentType: 'application/json',
  });
  await capture(page, info, 'context-github');
  expect(errors).toEqual([]);
});

test('Linear follows native explicit and system theme changes through the shared reader', async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { demo, errors } = await open(page);
  const linear = page.getByTestId('context-provider-current').getByRole('img', { name: 'Linear' });
  const decodedSource = () =>
    linear.evaluate(async (node) => {
      await node.decode();
      return node.currentSrc;
    });
  const lightSource = await decodedSource();
  const original = await linear.elementHandle();
  const before = await linear.boundingBox();
  await page.getByRole('button', { name: 'Customize preview', exact: true }).click();
  const themes = page.getByTestId('catalog-theme-control');
  await themes.getByRole('radio', { name: 'Dark', exact: true }).click();
  await expect.poll(decodedSource).not.toBe(lightSource);
  const darkSource = await decodedSource();
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await capture(page, info, 'context-linear-dark');
  await themes.getByRole('radio', { name: 'System', exact: true }).click();
  await expect.poll(decodedSource).toBe(lightSource);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(decodedSource).toBe(darkSource);
  await demo.getByRole('button', { name: 'Mount icon', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await demo.getByRole('button', { name: 'Mount icon', exact: true }).click();
  await expect.poll(decodedSource).toBe(lightSource);
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  await info.attach('linear-theme-geometry.json', {
    body: JSON.stringify({ before, after: await linear.boundingBox() }),
    contentType: 'application/json',
  });
  await capture(page, info, 'context-linear-light');
  expect(errors).toEqual([]);
});
