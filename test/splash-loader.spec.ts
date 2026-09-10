import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const template = readFileSync(path.resolve('src/app.html'), 'utf8')
  .replace('%sveltekit.head%', '')
  .replace('%sveltekit.body%', '')
  .replaceAll('%sveltekit.assets%', '');

async function openSplash(page: Page) {
  await page.route('http://splash.test/**', (route) =>
    route.fulfill({
      contentType: route.request().isNavigationRequest() ? 'text/html' : 'text/javascript',
      body: route.request().isNavigationRequest() ? template : '',
    }),
  );
  await page.goto('http://splash.test/');
}

async function expectCentered(page: Page) {
  const bounds = await page.locator('#splash svg').boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(bounds!.x + bounds!.width / 2).toBeCloseTo(viewport.width / 2, 0);
  expect(bounds!.y + bounds!.height / 2).toBeCloseTo(viewport.height / 2, 0);
  expect(bounds!.width).toBeLessThan(100);
  expect(bounds!.height).toBeLessThan(100);
}

for (const theme of ['light', 'dark'] as const) {
  test(`pre-hydration splash is transparent and centered in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openSplash(page);
    await expectCentered(page);
    for (const selector of ['html', 'body', '#app', '#splash']) {
      await expect(page.locator(selector)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    const stroke = await page
      .locator('#splash path')
      .first()
      .evaluate((node) => {
        const color = getComputedStyle(node).stroke;
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
    await expectCentered(page);
  });
}

test('logo motion responds to reduced-motion changes without app JavaScript', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSplash(page);
  const mark = page.locator('#splash svg');
  const animationCount = () =>
    mark.evaluate((node) => node.getAnimations({ subtree: true }).length);
  await expect.poll(animationCount).toBeGreaterThan(0);
  const moved = await mark.evaluate((node) => {
    const animations = node.getAnimations({ subtree: true });
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 0;
    }
    const initial = Array.from(
      node.querySelectorAll('path'),
      (arm) => getComputedStyle(arm).transform,
    );
    for (const animation of animations) {
      animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
    }
    return Array.from(node.querySelectorAll('path')).some(
      (arm, index) => getComputedStyle(arm).transform !== initial[index],
    );
  });
  expect(moved).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(animationCount).toBe(0);
  for (const arm of await mark.locator('path').all()) {
    await expect(arm).toHaveCSS('transform', 'none');
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(animationCount).toBeGreaterThan(0);
});
