import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const template = readFileSync(path.resolve('src/app.html'), 'utf8')
  .replace('%sveltekit.head%', '')
  .replace('%sveltekit.body%', '')
  .replaceAll('%sveltekit.assets%', '');

async function openSplash(page: Page) {
  await page.route('http://splash.test/**', (route) => {
    // A cold start must not need the app bundle, stylesheets, or image/media assets.
    if (!route.request().isNavigationRequest()) return route.abort();
    return route.fulfill({
      contentType: 'text/html',
      body: template,
    });
  });
  await page.goto('http://splash.test/');
}

for (const theme of ['light', 'dark'] as const) {
  test(`pre-hydration splash is transparent and visible in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openSplash(page);
    await expect(page.locator('#splash svg')).toBeInViewport({ ratio: 1 });
    for (const selector of ['html', 'body', '#app', '#splash']) {
      await expect(page.locator(selector)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    const stroke = await page
      .locator('#splash-mark')
      .first()
      .evaluate((node) => {
        const color = getComputedStyle(node).color;
        const channels = color.match(/[\d.]+/g)!.map(Number);
        return (channels[0] + channels[1] + channels[2]) / 3;
      });
    if (theme === 'light') expect(stroke).toBeLessThan(100);
    else expect(stroke).toBeGreaterThan(200);

    await page.screenshot({
      path: path.resolve(`.demo-artifacts/splash-${theme}.png`),
      omitBackground: true,
    });
    await page.setViewportSize({ width: 420, height: 700 });
    await expect(page.locator('#splash svg')).toBeInViewport({ ratio: 1 });
  });
}

test('logo motion responds to reduced-motion changes without app JavaScript', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSplash(page);
  const mark = page.locator('#splash svg');
  const animationCount = () =>
    mark.evaluate((node) => node.getAnimations({ subtree: true }).length);
  await expect.poll(animationCount).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(animationCount).toBe(0);
  for (const arm of await mark.locator('path').all()) {
    await expect(arm).toHaveCSS('transform', 'none');
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(animationCount).toBeGreaterThan(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`renders and animates in ${theme} mode without JavaScript or external assets`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      colorScheme: theme,
      reducedMotion: 'no-preference',
    });
    try {
      const page = await context.newPage();
      await openSplash(page);
      const mark = page.locator('#splash-mark');
      await expect(page.locator('#splash svg')).toBeInViewport({ ratio: 1 });
      expect(await mark.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(4);
    } finally {
      await context.close();
    }
  });
}
