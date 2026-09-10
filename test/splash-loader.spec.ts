import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const template = readFileSync(path.resolve('src/app.html'), 'utf8')
  .replace('%sveltekit.head%', '')
  .replace('%sveltekit.body%', '')
  .replaceAll('%sveltekit.assets%', '');

async function openSplash(page: Page, scriptEnabled = true) {
  await page.route('http://splash.test/**', (route) => {
    const asset = new URL(route.request().url()).pathname;
    if (['/intent-mark/pulse.css', '/intent-mark/pulse.png'].includes(asset)) {
      return route.fulfill({
        contentType: asset.endsWith('.css') ? 'text/css' : 'image/png',
        body: readFileSync(path.resolve(`static${asset}`)),
      });
    }
    return route.fulfill({
      contentType: route.request().isNavigationRequest() ? 'text/html' : 'text/javascript',
      body: route.request().isNavigationRequest() ? template : '',
    });
  });
  await page.goto('http://splash.test/');
  if (!scriptEnabled) return;
  await page.evaluate(async () => {
    const image = new Image();
    image.src = '/intent-mark/pulse.png';
    await image.decode();
  });
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
    const sheet = node.querySelector('.intent-pulse-frames')!;
    const initial = getComputedStyle(sheet).transform;
    for (const animation of animations) {
      animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
    }
    return getComputedStyle(sheet).transform !== initial;
  });
  expect(moved).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(animationCount).toBe(0);
  await expect(mark.locator('.intent-pulse-frames')).toHaveCSS('transform', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(animationCount).toBeGreaterThan(0);
});

test('renders and animates when JavaScript is disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await openSplash(page, false);
    const mark = page.locator('#splash-mark');
    await expectCentered(page);
    expect(await mark.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(1);
    const { data } = await sharp(await mark.screenshot({ omitBackground: true }))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const visible = data.filter((alpha, index) => index % 4 === 3 && alpha > 0);
    expect(visible.length).toBeGreaterThan(300);
    expect(visible.length).toBeLessThan(2000);
  } finally {
    await context.close();
  }
});

test('startup pulse matches every supplied GIF frame before app hydration', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({
    deviceScaleFactor: 4,
    reducedMotion: 'no-preference',
  });
  try {
    const page = await context.newPage();
    await openSplash(page);
    const mark = page.locator('#splash-mark');
    const source = sharp(path.resolve('test/fixtures/intent-mark/pulse.gif'), { animated: true });
    const metadata = await source.metadata();
    const original = await source.raw().toBuffer();
    expect(metadata.pages).toBe(51);
    expect(metadata.delay!.reduce((sum, delay) => sum + delay, 0)).toBe(2040);
    for (let frame = 0; frame <= metadata.pages!; frame++) {
      await mark.evaluate(
        async (node, time) => {
          for (const animation of node.getAnimations({ subtree: true })) {
            animation.pause();
            animation.currentTime = time;
          }
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        },
        frame * 40 + 1,
      );
      const { data, info } = await sharp(await mark.screenshot({ omitBackground: true }))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([256, 256]);
      const start = (frame % metadata.pages!) * 256 * 256 * 3;
      let error = 0;
      let transparentPixels = 0;
      for (let pixel = 0; pixel < 256 * 256; pixel++) {
        const input = start + pixel * 3;
        const alpha = 255 - (original[input] + original[input + 1] + original[input + 2]) / 3;
        error += Math.abs(data[pixel * 4 + 3] - alpha);
        if (data[pixel * 4 + 3] === 0) transparentPixels++;
      }
      expect(error / (256 * 256), `GIF frame ${frame}`).toBeLessThan(1);
      expect(transparentPixels).toBeGreaterThan(40_000);
    }
  } finally {
    await context.close();
  }
});
