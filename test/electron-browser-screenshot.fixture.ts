/** Production CDP screenshots of real, zoomed <webview> guests; no Intent app or daemon. */
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

// Page.captureScreenshot cannot resize a <webview> guest: when it asks for
// more pixels than the guest's surface holds, Chromium repeats the surface to
// fill the image (intent-hq/intent#4627, #8359). Guests inherit the app's
// zoom, which broke that balance for every tab of a zoomed-out app. One
// capture must be one image of the tab: exactly the page's viewport in device
// pixels, never more than the <webview> element draws.
interface Case {
  name: string;
  /** App zoom level; guests inherit it. -0.5 is one Cmd-minus step. */
  zoomLevel: number;
  /** Emulated size from openTab, then each resizeTab. */
  sizes: Array<{ width: number; height: number }>;
  /** Visible panel element in host CSS px; omitted = a hidden (offscreen) guest. */
  panel?: { width: number; height: number };
}

const CASES: Case[] = [
  { name: 'hidden tab', zoomLevel: 0, sizes: [{ width: 1100, height: 900 }] },
  {
    name: 'hidden tab in a zoomed-out app, then resized',
    zoomLevel: -0.5,
    sizes: [
      { width: 1100, height: 900 },
      { width: 760, height: 900 },
    ],
  },
  {
    name: 'visible tab fit to a narrower panel in a zoomed-out app',
    zoomLevel: -0.5,
    sizes: [{ width: 1100, height: 900 }],
    panel: { width: 700, height: 700 },
  },
  {
    name: 'visible tab in a wider panel in a zoomed-out app',
    zoomLevel: -0.5,
    sizes: [{ width: 760, height: 900 }],
    panel: { width: 1200, height: 1000 },
  },
];

test.describe('browser screenshots', () => {
  let bundleDir: string;
  let cdpBundle: string;
  let guestServer: Server;
  let guestUrl: string;

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    bundleDir = await mkdtemp(join(tmpdir(), 'intent-browser-screenshot-'));
    cdpBundle = join(bundleDir, 'cdp.cjs');
    const entry = join(bundleDir, 'entry.ts');
    await writeFile(
      entry,
      `export { embeddedBrowserCdp } from ${JSON.stringify(resolve('src/features/browser/main/embedded-browser-cdp-service.ts'))};`,
    );
    await build({
      configFile: false,
      logLevel: 'error',
      plugins: [
        {
          name: 'isolate-cdp-external-services',
          enforce: 'pre',
          resolveId(id) {
            if (id === '../../../shared/logger') return '\0screenshot-logger';
            if (id === '../../system/main/system.ipc') return '\0screenshot-window-routing';
          },
          load(id) {
            if (id === '\0screenshot-logger')
              return 'export class Logger { info() {} debug() {} warn() {} error() {} }';
            if (id === '\0screenshot-window-routing')
              return `export function sendToWorkspaceWindows() { return { windowCount: 0, browserClientsNotified: false, delivered: false }; }
                export function getWindowIdsForWorkspace() { return []; }`;
          },
        },
      ],
      resolve: { alias: { $shared: resolve('src/shared') } },
      ssr: { noExternal: true },
      build: {
        ssr: entry,
        outDir: bundleDir,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'cdp.cjs' },
        },
      },
    });
    guestServer = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>screenshot fixture</title><h1>Screenshot fixture</h1>');
    });
    await new Promise<void>((done) => guestServer.listen(0, '127.0.0.1', done));
    const address = guestServer.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
    guestUrl = `http://127.0.0.1:${address.port}/`;
  });

  test.afterAll(async () => {
    await new Promise<void>((done) => guestServer?.close(() => done()));
    await rm(bundleDir, { recursive: true, force: true });
  });

  // 2 is the HiDPI case from the report; Chromium's legacy layout metric
  // changes units with the display scale, so 1 is checked separately.
  for (const deviceScaleFactor of [1, 2]) {
    test(`one screenshot is one image of the tab at display scale ${deviceScaleFactor}`, async () => {
      test.setTimeout(120_000);
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) =>
            !key.startsWith('DD_') && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key),
        ),
      );
      const app = await electron.launch({
        args: [
          resolve('test/fixtures/browser-screenshot/main.cjs'),
          join(bundleDir, `profile-${deviceScaleFactor}`),
          cdpBundle,
          String(deviceScaleFactor),
        ],
        env: { ...env, DD_TRACE_ENABLED: 'false' },
      });
      try {
        await expect
          .poll(() => app.evaluate(() => !!(globalThis as any).screenshotFixture))
          .toBe(true);
        const evidence = [];
        for (const [index, testCase] of CASES.entries()) {
          const captures = await app.evaluate(
            async ({ nativeImage, webContents }, { testCase, index, url }) => {
              const win = (globalThis as any).screenshotFixtureWindow;
              const { embeddedBrowserCdp } = (globalThis as any).screenshotFixture;
              const host = win.webContents;
              host.setZoomLevel(testCase.zoomLevel);
              const zoom = host.getZoomFactor();
              // Element CSS size: a panel's, or (offscreen host contract) the
              // emulated size in DIP, i.e. CSS px × app zoom.
              const elementSize = (size: { width: number; height: number }) =>
                testCase.panel ?? { width: size.width / zoom, height: size.height / zoom };
              const [first, ...resizes] = testCase.sizes;
              const before = new Set(webContents.getAllWebContents().map((wc: any) => wc.id));
              const initial = elementSize(first);
              await host.executeJavaScript(`new Promise((done) => {
                document.body.replaceChildren();
                const view = document.createElement('webview');
                view.style.cssText = 'display:inline-flex;width:${initial.width}px;height:${initial.height}px';
                view.addEventListener('did-finish-load', () => done(), { once: true });
                view.src = ${JSON.stringify(url)};
                document.body.append(view);
              })`);
              const guest = webContents
                .getAllWebContents()
                .find((wc: any) => !before.has(wc.id) && wc.getType() === 'webview');
              if (!guest) throw new Error('No webview guest');
              const tabId = `screenshot-${index}`;
              embeddedBrowserCdp.registerTab(tabId, guest.id);
              embeddedBrowserCdp.setTabOwner(tabId, 'fixture-agent', undefined, first);
              if (testCase.panel) {
                // browser.ipc reports the element's DIP bounds (CSS × app zoom).
                embeddedBrowserCdp.reportTabViewBounds(
                  tabId,
                  testCase.panel.width * zoom,
                  testCase.panel.height * zoom,
                );
              }
              const captures = [];
              for (const size of [first, ...resizes]) {
                if (size !== first) {
                  const element = elementSize(size);
                  await host.executeJavaScript(
                    `Object.assign(document.querySelector('webview').style, { width: '${element.width}px', height: '${element.height}px' })`,
                  );
                  embeddedBrowserCdp.resizeTab(tabId, size.width, size.height);
                }
                await new Promise((done) => setTimeout(done, 300));
                const page = await guest.executeJavaScript(
                  '({ width: innerWidth, height: innerHeight, devicePixelRatio })',
                );
                const surface = await host.executeJavaScript(
                  `(() => { const r = document.querySelector('webview').getBoundingClientRect();
                    return { width: r.width * devicePixelRatio, height: r.height * devicePixelRatio }; })()`,
                );
                const shot = await embeddedBrowserCdp.screenshot(tabId);
                const image = nativeImage
                  .createFromBuffer(Buffer.from(shot.base64, 'base64'))
                  .getSize();
                captures.push({
                  size,
                  page,
                  surface,
                  reported: { width: shot.width, height: shot.height },
                  image,
                });
              }
              embeddedBrowserCdp.unregisterTab(tabId);
              embeddedBrowserCdp.clearTabOwnership(tabId);
              return captures;
            },
            { testCase, index, url: guestUrl },
          );
          evidence.push({ name: testCase.name, captures });
        }
        await test.info().attach(`screenshot-geometry-scale-${deviceScaleFactor}.json`, {
          body: JSON.stringify(evidence, null, 2),
          contentType: 'application/json',
        });
        for (const { name, captures } of evidence) {
          for (const { size, page, surface, reported, image } of captures) {
            const label = `${name} at ${size.width}x${size.height}`;
            // The tab's size, not its zoomed CSS viewport (1204x985 for 1100x900).
            expect.soft(reported, `${label}: reported size`).toEqual(size);
            // Scale-to-fit draws the viewport smaller; it never upscales.
            const fit = Math.min(
              1,
              surface.width / (page.width * page.devicePixelRatio),
              surface.height / (page.height * page.devicePixelRatio),
            );
            const expected = {
              width: page.width * page.devicePixelRatio * fit,
              height: page.height * page.devicePixelRatio * fit,
            };
            // innerWidth/innerHeight are whole CSS px: allow one CSS px of rounding.
            const slack = page.devicePixelRatio + 1;
            expect
              .soft(Math.abs(image.width - expected.width), `${label}: width`)
              .toBeLessThan(slack);
            expect
              .soft(Math.abs(image.height - expected.height), `${label}: height`)
              .toBeLessThan(slack);
            // Nothing past the drawn surface, so nothing is repeated to fill it.
            expect
              .soft(image.width, `${label}: within surface`)
              .toBeLessThanOrEqual(Math.ceil(surface.width) + 1);
            expect
              .soft(image.height, `${label}: within surface`)
              .toBeLessThanOrEqual(Math.ceil(surface.height) + 1);
          }
        }
      } finally {
        await app.close();
      }
    });
  }
});
