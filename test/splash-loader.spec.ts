import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  intentMarkMotionTiming,
  intentMarkPaths,
  intentMarkViewBox,
  pulseKeyframes,
} from '../src/lib/components/ui/indicators/intent-mark-vector';

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
    const arm = node.querySelector('path')!;
    const initial = getComputedStyle(arm).transform;
    for (const animation of animations) {
      animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
    }
    return getComputedStyle(arm).transform !== initial;
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
      await expectCentered(page);
      expect(await mark.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(4);
      const { data } = await sharp(await mark.screenshot({ omitBackground: true }))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let visible = 0;
      let brightness = 0;
      for (let pixel = 0; pixel < data.length; pixel += 4) {
        if (data[pixel + 3] < 128) continue;
        visible++;
        brightness += (data[pixel] + data[pixel + 1] + data[pixel + 2]) / 3;
      }
      expect(visible).toBeGreaterThan(300);
      expect(visible).toBeLessThan(2000);
      if (theme === 'light') expect(brightness / visible).toBeLessThan(100);
      else expect(brightness / visible).toBeGreaterThan(200);
    } finally {
      await context.close();
    }
  });
}

test('startup vectors follow all reference poses before app hydration', async ({ browser }) => {
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
    for (let frame = 0; frame < metadata.pages!; frame++) {
      await mark.evaluate(
        async (node, time) => {
          for (const animation of node.getAnimations({ subtree: true })) {
            animation.pause();
            animation.currentTime = time;
          }
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        },
        // The supplied 25fps GIF samples a 30fps source using floor(frame * 30/25).
        // Evaluate the continuous animation at that source time, not a GIF hold interval.
        (Math.floor((frame * 6) / 5) * 1000) / 30,
      );
      const { data, info } = await sharp(await mark.screenshot({ omitBackground: true }))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([256, 256]);
      const start = (frame % metadata.pages!) * 256 * 256 * 3;
      let error = 0;
      let transparentPixels = 0;
      let intersection = 0;
      let union = 0;
      for (let pixel = 0; pixel < 256 * 256; pixel++) {
        const input = start + pixel * 3;
        const alpha = 255 - (original[input] + original[input + 1] + original[input + 2]) / 3;
        error += Math.abs(data[pixel * 4 + 3] - alpha);
        if (data[pixel * 4 + 3] === 0) transparentPixels++;
        if (data[pixel * 4 + 3] > 127 && alpha > 127) intersection++;
        if (data[pixel * 4 + 3] > 127 || alpha > 127) union++;
      }
      // Chromium antialiasing and the GIF's quantized dark palette (0..8) differ.
      // Require < 1% mean alpha error AND > 98% silhouette intersection over union.
      expect(error / (256 * 256), `reference pose ${frame}`).toBeLessThan(2.5);
      expect(intersection / union, `reference silhouette ${frame}`).toBeGreaterThan(0.98);
      expect(transparentPixels).toBeGreaterThan(40_000);
    }
  } finally {
    await context.close();
  }
});

test('pulse moves continuously between source samples and returns to neutral at the loop boundary', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSplash(page);
  const poses = await page.locator('#splash-mark').evaluate((node) => {
    const animations = node.getAnimations({ subtree: true });
    const at = (time: number) => {
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = time;
      }
      return [...node.querySelectorAll('path')].map((arm) => getComputedStyle(arm).transform);
    };
    return [at(0), at(400), at(410), at(2000), at(2033.333333), at(1000)];
  });
  expect(poses[1].slice(0, 4)).not.toEqual(poses[2].slice(0, 4));
  expect(poses[0]).toEqual(poses[3]);
  expect(poses[0]).toEqual(poses[4]);
  expect(poses[0][4]).toEqual(poses[5][4]);
  expect(poses[0].slice(0, 4)).not.toEqual(poses[5].slice(0, 4));
});

test('inline startup motion stays aligned with the shared vector model', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSplash(page);
  const deviation = await page.locator('#splash-mark').evaluate(
    (startup, model) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', model.viewBox);
      svg.setAttribute('width', '64');
      svg.setAttribute('height', '64');
      document.body.append(svg);
      try {
        for (const [index, d] of model.paths.entries()) {
          const arm = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          arm.setAttribute('d', d);
          svg.append(arm);
          arm.animate(model.keyframes[index], { duration: model.duration, iterations: Infinity });
        }
        const points = (root: Element) => {
          const rect = root.getBoundingClientRect();
          return [...root.querySelectorAll('path')].flatMap((arm) =>
            [0, 0.5, 1].map((fraction) => {
              const point = arm.getPointAtLength(arm.getTotalLength() * fraction);
              const screen = point.matrixTransform(arm.getScreenCTM()!);
              return [screen.x - rect.left, screen.y - rect.top];
            }),
          );
        };
        let maxDeviation = 0;
        for (const time of [0, 400, 410, 1000, 1800, 2000, model.duration]) {
          for (const root of [startup, svg]) {
            for (const animation of root.getAnimations({ subtree: true })) {
              animation.pause();
              animation.currentTime = time;
            }
          }
          const actual = points(startup).flat();
          const expected = points(svg).flat();
          for (const [index, value] of actual.entries()) {
            maxDeviation = Math.max(maxDeviation, Math.abs(value - expected[index]));
          }
        }
        return maxDeviation;
      } finally {
        svg.remove();
      }
    },
    {
      paths: intentMarkPaths,
      viewBox: intentMarkViewBox,
      keyframes: intentMarkPaths.map((_, index) => pulseKeyframes(index)),
      duration: intentMarkMotionTiming.pulseMs,
    },
  );
  expect(deviation).toBeLessThan(0.001);
});
