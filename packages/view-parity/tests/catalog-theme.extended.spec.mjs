import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function readTheme(page) {
  return page.evaluate(async () => {
    const module = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname.endsWith('/src/store/index.ts'));
    if (!module) throw new Error('The running Store was not observed');
    const { store } = await import(module.name);
    return {
      name: store.state.theme.name,
      preference: store.state.theme.preference,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    };
  });
}

test('catalog theme controls publish explicit and system changes to the canonical reader', async ({
  page,
}, info) => {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.addInitScript(() => performance.setResourceTimingBufferSize(3000));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${process.env.REACT_BASE_URL}/sandbox/button?theme=light&motion=reduced`);
  await page.getByTestId('catalog-shell').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Customize preview', exact: true }).click();
  const controls = page.getByTestId('catalog-theme-control');
  await expect(controls).toBeVisible();
  const status = page.locator('#catalog-theme-status');
  await expect(status).toHaveText('Light theme selected');
  await page.evaluate(() => document.fonts.ready);
  const geometry = { before: await controls.boundingBox() };
  await expect
    .poll(() => readTheme(page))
    .toEqual({
      name: 'light',
      preference: 'system',
      colorScheme: 'light',
    });
  await controls.getByRole('radio', { name: 'Dark', exact: true }).click();
  await expect(status).toHaveText('Dark theme selected');
  await expect
    .poll(() => readTheme(page))
    .toEqual({
      name: 'dark',
      preference: 'system',
      colorScheme: 'dark',
    });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => readTheme(page)).toMatchObject({ name: 'dark', colorScheme: 'dark' });
  await controls.getByRole('radio', { name: 'System', exact: true }).click();
  await expect(status).toHaveText('System theme selected, currently light');
  await expect.poll(() => readTheme(page)).toMatchObject({ name: 'light', colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(status).toHaveText('System theme selected, currently dark');
  await expect.poll(() => readTheme(page)).toMatchObject({ name: 'dark', colorScheme: 'dark' });
  await controls.getByRole('radio', { name: 'Light', exact: true }).press('Space');
  await expect(status).toHaveText('Light theme selected');
  await expect.poll(() => readTheme(page)).toMatchObject({ name: 'light', colorScheme: 'light' });
  geometry.after = await controls.boundingBox();
  await info.attach('theme-controls-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(
    page,
    page.getByRole('complementary', { name: 'Catalog customization' }),
    async ({ png, attempt }) => {
      if (png)
        await info.attach(`theme-controls-${attempt}`, { body: png, contentType: 'image/png' });
    },
  );
  expect(errors).toEqual([]);
});
