import {
  expect,
  test,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
} from '@playwright/test';
import tailwindcss from '@tailwindcss/postcss';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import autoprefixer from 'autoprefixer';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const artifactDir = path.resolve('.demo-artifacts/20260722-012e-overlays');
const harnessPath = 'src/lib/components/ui/card/operate-patterns.visual.html';

test.use(existsSync(systemChrome) ? { channel: 'chrome' } : {});
test.describe.configure({ mode: 'serial' });

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async () => {
  mkdirSync(artifactDir, { recursive: true });
  server = await createServer({
    configFile: false,
    appType: 'mpa',
    plugins: [svelte()],
    resolve: {
      alias: {
        $lib: path.resolve('src/lib'),
        $features: path.resolve('src/features'),
        $shared: path.resolve('src/shared'),
      },
    },
    css: { postcss: { plugins: [tailwindcss, autoprefixer] } },
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => {
  await server?.close();
});

test('captures contained, host-independent Operate pattern contact sheets', async ({
  browser,
  context,
  page,
}) => {
  test.setTimeout(180_000);
  const states = [
    { name: 'light-desktop', theme: 'light', width: 1280, height: 800, scale: 1 },
    { name: 'dark-desktop', theme: 'dark', width: 1280, height: 800, scale: 1 },
    { name: 'light-compact', theme: 'light', width: 390, height: 844, scale: 1 },
    { name: 'dark-compact', theme: 'dark', width: 390, height: 844, scale: 1 },
    { name: 'light-zoom-200', theme: 'light', width: 640, height: 400, scale: 2 },
    { name: 'dark-zoom-200', theme: 'dark', width: 640, height: 400, scale: 2 },
  ] as const;
  const errors: string[] = [];
  let zoomContext: BrowserContext | undefined;
  let capturePage = page;
  const cdp = await context.newCDPSession(capturePage);

  const prepareCapturePage = async (target: Page) => {
    target.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    target.on('pageerror', (error) => errors.push(error.message));
    await target.addInitScript(() => {
      delete (window as Window & { electronAPI?: unknown }).electronAPI;
    });
  };
  await prepareCapturePage(capturePage);

  for (const state of states) {
    if (state.name === 'light-zoom-200') {
      zoomContext = await browser.newContext({
        viewport: { width: state.width, height: state.height },
        deviceScaleFactor: state.scale,
      });
      capturePage = await zoomContext.newPage();
      await prepareCapturePage(capturePage);
    }
    await capturePage.emulateMedia({
      reducedMotion: state.theme === 'dark' ? 'reduce' : 'no-preference',
    });
    if (state.scale === 1) {
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await capturePage.setViewportSize({ width: state.width, height: state.height });
    }

    const captures: Array<{ label: string; data: string }> = [];
    for (const view of ['patterns', 'menu', 'dialog', 'sheet'] as const) {
      await capturePage.goto(`${baseUrl}${harnessPath}?theme=${state.theme}&view=${view}`, {
        waitUntil: 'networkidle',
      });
      expect(
        await capturePage.evaluate(() => ({
          devicePixelRatio: window.devicePixelRatio,
          height: window.innerHeight,
          width: window.innerWidth,
        })),
      ).toEqual({ devicePixelRatio: state.scale, height: state.height, width: state.width });
      await expect(capturePage.locator(`[data-visual-view="${view}"]`)).toBeVisible();
      if (view === 'menu') await expect(capturePage.getByRole('menu')).toBeVisible();
      if (view === 'dialog')
        await expect(capturePage.getByRole('dialog', { name: 'Delete workspace?' })).toBeVisible();
      if (view === 'sheet')
        await expect(capturePage.getByRole('dialog', { name: 'Workspace details' })).toBeVisible();
      expect(
        await capturePage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
      ).toBe(state.theme === 'dark');
      expect(
        await capturePage.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      const image = await capturePage.screenshot({ fullPage: true });
      captures.push({ label: view, data: image.toString('base64') });
    }

    const contactPage = await context.newPage();
    await contactPage.setViewportSize({ width: 1280, height: 800 });
    await contactPage.setContent(
      `<main><h1>012-E ${state.name}</h1><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">${captures
        .map(
          ({ label, data }) =>
            `<figure style="margin:0;min-width:0"><figcaption>${label}</figcaption><img alt="${label}" style="display:block;width:100%;border:1px solid currentColor" src="data:image/png;base64,${data}"></figure>`,
        )
        .join('')}</div></main>`,
    );
    await contactPage.screenshot({
      path: path.join(artifactDir, `${state.name}-contact-sheet.png`),
      fullPage: true,
    });
    await contactPage.close();
  }

  const bridgeType = await capturePage.evaluate(
    () => typeof (window as Window & { electronAPI?: unknown }).electronAPI,
  );
  expect(bridgeType).toBe('undefined');
  expect(errors).toEqual([]);
  await zoomContext?.close();
});
