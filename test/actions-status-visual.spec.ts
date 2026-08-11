import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const artifactDir = path.resolve('.demo-artifacts/20260722-actions-status');
let server: ViteDevServer;
let baseUrl: string;

test.use(existsSync(systemChrome) ? { channel: 'chrome' } : {});

test.beforeAll(async () => {
  mkdirSync(artifactDir, { recursive: true });
  server = await createServer({
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => {
  await server?.close();
});

test('captures Actions & status at genuine 200% device scale with reduced motion', async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  const physical = { width: 1280, height: 800 };
  const css = { width: 640, height: 400 };
  const cdp = await context.newCDPSession(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: css.width,
    height: css.height,
    deviceScaleFactor: 2,
    mobile: false,
    screenWidth: physical.width,
    screenHeight: physical.height,
  });

  try {
    await page.goto(`${baseUrl}sandbox`, { waitUntil: 'networkidle' });
    const reduceMotion = page.getByRole('switch', { name: 'Reduce motion' });
    if (!(await reduceMotion.isChecked())) await reduceMotion.click();
    await expect(reduceMotion).toBeChecked();
    await page.getByTestId('catalog-group-filter').click();
    await page.getByRole('option', { name: 'Actions & status' }).click();

    const gallery = page.getByTestId('catalog-gallery');
    const actionEntries = gallery.locator('[data-catalog-gallery-entry]');
    await expect(actionEntries).toHaveCount(5);
    for (const slug of ['badge', 'button', 'button-group', 'toggle', 'toggle-group']) {
      await expect(gallery.locator(`[data-catalog-gallery-entry="${slug}"]`)).toBeVisible();
    }

    const runAction = page.getByRole('button', { name: 'Run action' });
    const heading = page.getByRole('heading', { name: 'Actions & status', exact: true });
    const [headingBox, motion] = await Promise.all([
      heading.boundingBox(),
      runAction.evaluate((element) => {
        const duration = getComputedStyle(element).transitionDuration;
        const milliseconds = Math.max(
          ...duration.split(',').map((value) => {
            const number = Number.parseFloat(value);
            return value.trim().endsWith('ms') ? number : number * 1000;
          }),
        );
        return {
          duration,
          milliseconds,
          mediaReduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          classReduced: document.documentElement.classList.contains('catalog-reduced-motion'),
        };
      }),
    ]);
    const metrics = await page.evaluate(() => ({
      dpr: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(metrics).toEqual({ dpr: 2, innerWidth: 640, innerHeight: 400, overflow: 0 });
    expect((headingBox?.height ?? 0) * metrics.dpr).toBeGreaterThanOrEqual(32);
    expect(motion.mediaReduced).toBe(true);
    expect(motion.classReduced).toBe(true);
    expect(motion.milliseconds, motion.duration).toBeLessThanOrEqual(0.01);

    const capture = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      fromSurface: true,
    });
    const screenshot = Buffer.from(capture.data, 'base64');
    expect(pngDimensions(screenshot).width).toBe(physical.width);
    expect(pngDimensions(screenshot).height).toBeGreaterThan(physical.height);
    writeFileSync(path.join(artifactDir, 'actions-status-zoom-200.png'), screenshot);
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  }
});

function pngDimensions(buffer: Buffer) {
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
