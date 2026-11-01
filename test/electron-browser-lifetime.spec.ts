// Native diagnostic windows share this display-backed Electron verification lane.
import './electron-browser-lifetime-dev-console.fixture';
import './electron-browser-lifetime-dev-console-ui.fixture';
import './electron-browser-capture.fixture';
import './electron-inline-html-preview.fixture';
/** Real Electron guest identity evidence; never launches Intent or a daemon. */
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import { build, createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

let server: ViteDevServer;
let guestServer: Server;
let guestUrl: string;
let baseUrl: string;
let cdpBundle: string;
let bundleDir: string;
let heldNavigationResponses: Array<() => void> | undefined;
const fixture = resolve('test/fixtures/browser-lifetime');
/**
 * Budget for the explicit-close / archive polls. Each guestSnapshot round bounds
 * its per-guest probes to 2 s (see guestSnapshot) and probes the up-to-four
 * guests in parallel, so one round of a guest mid-destruction costs ~2-4 s;
 * 20 s guarantees at least five rounds on top of the default 5 s that already
 * covered the observed destruction latency when no probe hung.
 */
const GUEST_TEARDOWN_TIMEOUT_MS = 20_000;
/**
 * Agent drawing idle window for the isolated main-process bundle, replacing
 * production's 30 s so the frame-rate test can observe a hold end promptly.
 */
const FIXTURE_AGENT_DRAWING_IDLE_MS = 500;
const CDP_SERVICE = resolve('src/features/browser/main/embedded-browser-cdp-service.ts');
test.beforeAll(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), 'intent-browser-lifetime-code-'));
  cdpBundle = join(bundleDir, 'cdp.cjs');
  const entry = join(bundleDir, 'entry.ts');
  await writeFile(
    entry,
    [
      `export { embeddedBrowserCdp } from ${JSON.stringify(CDP_SERVICE)};`,
      `export { executeActions } from ${JSON.stringify(resolve('src/features/browser/main/browser-action-executor.ts'))};`,
    ].join('\n'),
  );
  await build({
    configFile: false,
    logLevel: 'error',
    plugins: [
      {
        name: 'isolate-cdp-external-services',
        enforce: 'pre',
        resolveId(id) {
          if (id === '../../../shared/logger') return '\0fixture-logger';
          if (id === '../../system/main/system.ipc') return '\0fixture-window-routing';
          if (id === './browser-capture-service') return '\0fixture-capture';
          if (id === '../../backend/main/backend.ipc') return '\0fixture-backend';
          if (id === '../../backend/main/tunnel-manager') return '\0fixture-tunnel';
        },
        load(id) {
          if (id === '\0fixture-logger')
            return 'export class Logger { info() {} debug() {} warn() {} error() {} }';
          if (id === '\0fixture-window-routing')
            return `import { BrowserWindow } from 'electron';
              export function sendToWorkspaceWindows(workspaceId, channel, payload) {
                if (channel === 'browser:list-tabs-request') {
                  globalThis.lifetimeEvidence.tabListRequests.push({ workspaceId, payload });
                }
                const windows = BrowserWindow.getAllWindows();
                for (const window of windows) window.webContents.send(channel, payload);
                return { windowCount: windows.length, browserClientsNotified: false, delivered: windows.length > 0 };
              }
              export function getWindowIdForWorkspace(workspaceId) {
                return workspaceId === globalThis.lifetimeActiveWorkspaceId ? BrowserWindow.getAllWindows()[0]?.id : undefined;
              }
              export function getWindowIdsForWorkspace() { return BrowserWindow.getAllWindows().map(w => w.id); }`;
          if (id === '\0fixture-capture') return 'export const browserCapture = {};';
          if (id === '\0fixture-backend')
            return 'export function getBackendClient() { throw new Error("No daemon in isolated fixture"); }';
          if (id === '\0fixture-tunnel')
            return 'export class TunnelForbiddenError extends Error {}';
        },
        transform(code, id) {
          if (id !== CDP_SERVICE) return;
          const declaration = /export const AGENT_DRAWING_IDLE_MS = [\d_]+;/;
          // Fail the build, not the frame-rate assertion, if the constant moves.
          if (!declaration.test(code))
            throw new Error('AGENT_DRAWING_IDLE_MS declaration not found');
          return code.replace(
            declaration,
            `export const AGENT_DRAWING_IDLE_MS = ${FIXTURE_AGENT_DRAWING_IDLE_MS};`,
          );
        },
      },
    ],
    // This isolated main-process build bypasses the application Vite config.
    // Its production dependencies (including token redaction) use $shared.
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
  guestServer = createHttpServer((req, res) => {
    const respond = () => {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        '<!doctype html><title>QA fixture</title><input id="draft"><button id="increment">Increment</button><script>window.documentMarker = crypto.randomUUID(); window.inMemoryCount = 0; document.querySelector("#increment").onclick = () => window.inMemoryCount++;</script>',
      );
    };
    if (
      heldNavigationResponses &&
      (req.url?.startsWith('/second?') || req.url?.startsWith('/cancelled?'))
    ) {
      heldNavigationResponses.push(respond);
    } else {
      respond();
    }
  });
  await new Promise<void>((done) => guestServer.listen(0, '127.0.0.1', done));
  const address = guestServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
  guestUrl = `http://127.0.0.1:${address.port}`;
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: viteHarnessCacheDir('electron-browser-lifetime', {
      override: join(bundleDir, 'vite-cache'),
    }),
    optimizeDeps: { include: ['bits-ui', 'svelte', 'flatstr', 'redux-saga', 'typed-redux-saga'] },
    plugins: [svelte({ configFile: resolve('svelte.config.js') })],
    css: { postcss: { plugins: [tailwindcss, autoprefixer] } },
    resolve: {
      alias: [
        {
          find: /^\.\/PanelContentRenderer\.svelte$/,
          replacement: join(fixture, 'BrowserContent.svelte'),
        },
        {
          find: /^\.\/Panel(TabBar|EmptyState)\.svelte$/,
          replacement: join(fixture, 'Empty.svelte'),
        },
        ...['lib', 'store', 'features', 'shared'].map((name) => ({
          find: `$${name}`,
          replacement: resolve(`src/${name}`),
        })),
        { find: '$app', replacement: resolve('playwright/app-stubs') },
        {
          find: /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
          replacement: resolve('src/lib/icons/phosphor-icons.ts'),
        },
        {
          find: /^svelte-fa$/,
          replacement: resolve('src/lib/components/shared/icons/fa-proxy.ts'),
        },
      ],
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      watch: { ignored: ['**/*'] },
      fs: {
        allow: await Promise.all([
          realpath(process.cwd()),
          realpath(resolve('node_modules')),
          realpath(resolve('src/shared/paraglide')),
          realpath(bundleDir),
        ]),
      },
    },
  });
  console.log('Electron harness cache:', server.config.cacheDir);
  await server.listen();
  baseUrl = server.resolvedUrls!.local[0];
});
test.afterAll(async () => {
  try {
    await server?.close();
  } finally {
    try {
      if (guestServer) await new Promise<void>((done) => guestServer.close(() => done()));
    } finally {
      if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
    }
  }
});

async function launch(owned: boolean, blank?: { tabId: string; hidden: boolean }) {
  const env = Object.fromEntries(
    ['PATH', 'TMPDIR', 'DISPLAY', 'XAUTHORITY', 'SYSTEMROOT'].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]!]] : [],
    ),
  );
  let profile: string | undefined;
  let app: ElectronApplication | undefined;
  try {
    profile = await mkdtemp(join(tmpdir(), 'intent-browser-lifetime-'));
    app = await electron.launch({
      args: [
        join(fixture, 'main.cjs'),
        profile,
        `${baseUrl}test/fixtures/browser-lifetime/index.html?owned=${owned}&guest=${encodeURIComponent(guestUrl)}${blank ? `&blankTab=${blank.tabId}&hiddenBlank=${blank.hidden}` : ''}`,
        cdpBundle,
      ],
      // Host-injected tracing wraps BrowserWindow and breaks native window lookup.
      env: { ...env, DD_TRACE_ENABLED: 'false' },
    });
    const page = await app.firstWindow();
    page.on('pageerror', (error) => console.error('Fixture renderer:', error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text());
    });
    await page.waitForFunction(() => 'lifetimeFixture' in window);
    return { app, page, profile };
  } catch (error) {
    try {
      if (app) await app.close();
    } finally {
      if (profile) await rm(profile, { recursive: true, force: true });
    }
    throw error;
  }
}

async function guestSnapshot(app: ElectronApplication) {
  return app.evaluate(async ({ webContents }) => {
    const evidence = (globalThis as any).lifetimeEvidence;
    // executeJavaScript on a guest that is mid-destruction never settles, which
    // hung the explicit-close poll's predicate until its budget expired even
    // though the guest was already gone; bound every probe.
    const probe = (wc: { executeJavaScript(code: string): Promise<unknown> }, script: string) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([
        wc.executeJavaScript(script),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 2000);
        }),
      ])
        .catch(() => null)
        .finally(() => clearTimeout(timer));
    };
    const live = await Promise.all(
      webContents
        .getAllWebContents()
        .filter((wc) => wc.getType() === 'webview' && !wc.isDestroyed())
        .map(async (wc) => ({
          id: wc.id,
          url: wc.getURL(),
          muted: wc.isAudioMuted(),
          viewport: await probe(
            wc,
            '({ width: innerWidth, height: innerHeight, visualWidth: visualViewport?.width, visualHeight: visualViewport?.height, devicePixelRatio })',
          ),
          state: await probe(
            wc,
            '({ marker: window.documentMarker, draft: document.querySelector("#draft")?.value, count: window.inMemoryCount })',
          ),
        })),
    );
    const cdp = (globalThis as any).lifetimeCdp;
    const registered = cdp.listTabs();
    const addressed = await Promise.all(
      ['A-1', 'B-1'].map(async (tabId) => ({
        tabId,
        state: await cdp
          .evaluate(
            tabId,
            '({ marker: window.documentMarker, draft: document.querySelector("#draft")?.value, count: window.inMemoryCount })',
            { deadline: Date.now() + 2000 },
          )
          .catch((error: Error) => ({ error: error.message })),
      })),
    );
    return { ...evidence, live, registered, addressed };
  });
}

async function ready(app: ElectronApplication, tabId: string) {
  await expect
    .poll(
      async () =>
        (await guestSnapshot(app)).live.filter(
          (guest) => guest.url.endsWith(`tab=${tabId}`) && guest.state?.marker,
        ).length,
    )
    .toBeGreaterThan(0);
}

async function seed(app: ElectronApplication, tabId?: string) {
  await app.evaluate(async ({ webContents }, selectedTab) => {
    for (const wc of webContents.getAllWebContents().filter((wc) => wc.getType() === 'webview')) {
      if (selectedTab && !wc.getURL().endsWith(`tab=${selectedTab}`)) continue;
      await wc.executeJavaScript(
        'document.querySelector("#draft").value = "unsaved QA draft"; document.querySelector("#increment").click();',
      );
    }
  }, tabId);
}

async function readyPanel(app: ElectronApplication, page: Page, tabId: string) {
  await expect(page.locator(`[data-tab-id="${tabId}"]`)).toHaveAttribute('aria-hidden', 'false');
  await expect
    .poll(async () => {
      const id = await page.locator(`[data-tab-id="${tabId}"] webview`).evaluate((element) => {
        try {
          return (element as any).getWebContentsId();
        } catch {
          return undefined;
        }
      });
      return (await guestSnapshot(app)).live.some(
        (guest) => guest.id === id && guest.state?.marker && !guest.muted,
      );
    })
    .toBe(true);
}

async function record(app: ElectronApplication, page: Page, label: string) {
  return {
    label,
    ...(await guestSnapshot(app)),
    records: await page.evaluate(() => (window as any).lifetimeFixture.records()),
    urls: await page.evaluate(() => (window as any).lifetimeFixture.urls()),
    elements: await page.evaluate(() =>
      Array.from(document.querySelectorAll('webview')).map((element) => {
        const measure = (node: Element) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            x: rect.x,
            y: rect.y,
            display: style.display,
            opacity: style.opacity,
            inert: node.hasAttribute('inert'),
            hidden: node.getAttribute('aria-hidden'),
          };
        };
        const ancestors = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          ancestors.push(measure(node));
        }
        return {
          id: (element as any).getWebContentsId(),
          offscreenTab: element.getAttribute('data-offscreen-webview-tab'),
          panelTab: element.closest('[data-tab-id]')?.getAttribute('data-tab-id'),
          surface: element
            .closest('[data-retained-workspace-surface]')
            ?.getAttribute('data-retained-workspace-surface'),
          geometry: measure(element),
          ancestors,
        };
      }),
    ),
  };
}

async function captureOriginal(
  app: ElectronApplication,
  originalId: number,
  testInfo: TestInfo,
  label = 'original-A-addressed-while-B-active',
) {
  const result = await app.evaluate(async ({ webContents }, id) => {
    const cdp = (globalThis as any).lifetimeCdp;
    const original = webContents.fromId(id);
    if (!original) throw new Error(`Original guest ${id} was destroyed`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const direct = await Promise.race([
      original.capturePage(undefined, { stayHidden: true, stayAwake: true }).then((image) => ({
        width: image.getSize().width,
        height: image.getSize().height,
        bytes: image.toPNG().length,
        empty: image.isEmpty(),
        base64: image.toPNG().toString('base64'),
      })),
      new Promise<{ error: string }>((resolve) => {
        timer = setTimeout(() => resolve({ error: 'Original guest capture timed out' }), 3000);
      }),
    ]).finally(() => clearTimeout(timer));
    const addressed = await cdp
      .screenshot('A-1', { deadline: Date.now() + 3000 })
      .catch((error: Error) => ({ error: error.message }));
    return { originalId: id, direct, addressed };
  }, originalId);
  const saved: Record<string, object> = {};
  for (const [kind, image] of Object.entries({
    direct: result.direct,
    addressed: result.addressed,
  })) {
    if ('base64' in image) {
      const imagePath = testInfo.outputPath(`${label}-${kind}.png`);
      await writeFile(imagePath, Buffer.from(image.base64, 'base64'));
      await testInfo.attach(`${label}-${kind}`, { path: imagePath, contentType: 'image/png' });
      const { base64: _base64, ...metadata } = image;
      saved[kind] = metadata;
    } else {
      saved[kind] = image;
    }
  }
  return { originalId, direct: saved.direct, addressed: saved.addressed };
}

function navigationCount(observation: any, tabId: string) {
  return observation.guests
    .flatMap((guest: any) => guest.navigations)
    .filter((url: string) => url.endsWith(`tab=${tabId}`)).length;
}

/** Writes evidence (including one final guest snapshot), then always closes Electron and removes the profile. */
async function teardown(
  app: ElectronApplication,
  page: Page,
  profile: string,
  observations: any[],
  testInfo: TestInfo,
) {
  try {
    if (observations.length === 0) {
      console.log(JSON.stringify(await record(app, page, 'startup failure')));
    }
    observations.push({
      label: 'teardown',
      ...(await guestSnapshot(app).catch((error: Error) => ({ error: error.message }))),
    });
    const evidencePath = testInfo.outputPath('electron-lifetime-evidence.json');
    await writeFile(evidencePath, JSON.stringify({ profile, observations }, null, 2));
    await testInfo.attach('electron-lifetime-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    try {
      await app.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
}

for (const { tabId, hidden, context } of [
  { tabId: 'A-1', hidden: true, context: 'foreground hidden' },
  { tabId: 'B-1', hidden: true, context: 'background hidden' },
  { tabId: 'A-1', hidden: false, context: 'visible panel control' },
]) {
  test(`explicit navigation recovers an owned blank tab: ${context}`, async ({}, testInfo) => {
    test.setTimeout(120_000);
    const { app, page, profile } = await launch(true, { tabId, hidden });
    const observations: any[] = [];
    try {
      await ready(app, 'B-2');
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
        1,
      );
      await page.evaluate(() => {
        document.body.tabIndex = -1;
        document.body.focus();
      });
      const initial = await record(app, page, 'before blank navigation');
      observations.push(initial);
      expect(initial.urls[tabId]).toBe('about:blank');
      expect(initial.records[tabId[0]].hidden.includes(tabId)).toBe(hidden);
      const focus = await app.evaluate(({ BrowserWindow, webContents }) => ({
        window: BrowserWindow.getFocusedWindow()?.id,
        contents: webContents.getFocusedWebContents()?.id,
      }));
      const url = `${guestUrl}/recovered-blank?tab=${tabId}`;
      const result = await app.evaluate(
        (_electron, { tabId, url }) =>
          (globalThis as any).lifetimeNavigate(tabId, url, 'fixture-agent'),
        { tabId, url },
      );
      observations.push({ label: 'production navigation result', result });
      expect(result).toMatchObject({
        success: true,
        results: [{ action: 'navigate', success: true, result: { tabId, url } }],
      });
      await expect
        .poll(() =>
          app.evaluate(
            (_electron, tabId) =>
              (globalThis as any).lifetimeExecute(
                {
                  actions: [
                    {
                      action: 'evaluate',
                      tabId,
                      expression:
                        '({ url: location.href, marker: window.documentMarker, count: window.inMemoryCount })',
                    },
                  ],
                },
                undefined,
                'fixture-agent',
                tabId[0],
              ),
            tabId,
          ),
        )
        .toMatchObject({
          success: true,
          results: [
            {
              action: 'evaluate',
              success: true,
              result: { url, marker: expect.any(String), count: 0 },
            },
          ],
        });
      await expect
        .poll(() => page.evaluate((tabId) => (window as any).lifetimeFixture.urls()[tabId], tabId))
        .toBe(url);
      const recovered = await record(app, page, 'after blank navigation');
      observations.push(recovered);
      expect(recovered.records).toEqual(initial.records);
      expect(recovered.records[tabId[0]].owners[tabId]).toBe('fixture-agent');
      expect(recovered.records[tabId[0]].hosts[tabId]).toBe('fixture-client');
      const registrations = recovered.registrations.filter((entry: any) => entry.tabId === tabId);
      expect(registrations).toHaveLength(1);
      expect(
        recovered.live.filter((guest: any) => guest.url === url).map((guest: any) => guest.id),
      ).toEqual([registrations[0].webContentsId]);
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
      expect(
        await app.evaluate(({ BrowserWindow, webContents }) => ({
          window: BrowserWindow.getFocusedWindow()?.id,
          contents: webContents.getFocusedWebContents()?.id,
        })),
      ).toEqual(focus);
      expect(await page.locator(`[data-offscreen-webview-tab="${tabId}"]`).count()).toBe(
        hidden ? 1 : 0,
      );
      expect(await page.evaluate(() => (window as any).lifetimeFixture.errors())).toEqual([]);
    } finally {
      await teardown(app, page, profile, observations, testInfo);
    }
  });
}

test('background open waits beyond Electron registration for the daemon acknowledgement', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch(true);
  const observations: any[] = [];
  try {
    await readyPanel(app, page, 'A-1');
    await app.evaluate(({ BrowserWindow }, url) => {
      const g = globalThis as any;
      g.registryOpenResult = null;
      g.registryAcknowledgementRequested = false;
      g.registryOpen = g
        .lifetimeExecute(
          { actions: [{ action: 'openTab', url }] },
          (url: string) => {
            BrowserWindow.getAllWindows()[0].webContents.send('browser:open-tab', {
              workspaceId: 'B',
              tabId: 'B-new',
              url,
              ownerAgentId: 'fixture-agent',
              allowDuplicate: true,
              visible: false,
            });
            return { success: true, message: 'Opening tab', tabId: 'B-new' };
          },
          'fixture-agent',
          'B',
          undefined,
          undefined,
          Date.now() + 20_000,
          () => {
            g.registryAcknowledgementRequested = true;
            return new Promise<boolean>((resolve) => {
              g.acknowledgeRegistry = resolve;
            });
          },
        )
        .then((result: unknown) => {
          g.registryOpenResult = result;
          return result;
        });
    }, `${guestUrl}/registration?tab=B-new`);
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).registryAcknowledgementRequested))
      .toBe(true);
    expect(await app.evaluate(() => (globalThis as any).lifetimeCdp.isTabMounted('B-new'))).toBe(
      true,
    );
    expect(await app.evaluate(() => (globalThis as any).registryOpenResult)).toBeNull();
    expect(
      (await page.evaluate(() => (window as any).lifetimeFixture.records())).activeWorkspaceId,
    ).toBe('A');
    observations.push(await record(app, page, 'webview mounted, daemon acknowledgement pending'));
    const result = await app.evaluate(async () => {
      const g = globalThis as any;
      g.acknowledgeRegistry(true);
      return g.registryOpen;
    });
    expect(result).toMatchObject({
      success: true,
      results: [{ success: true, result: { tabId: 'B-new' } }],
    });
    await ready(app, 'B-new');
    expect(
      await app.evaluate(() => (globalThis as any).lifetimeCdp.evaluate('B-new', 'location.href')),
    ).toBe(`${guestUrl}/registration?tab=B-new`);
    await page.evaluate(() => (window as any).lifetimeFixture.close('B-new', true));
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).lifetimeCdp.isTabMounted('B-new')))
      .toBe(false);
  } finally {
    await teardown(app, page, profile, observations, testInfo);
  }
});

test('explicit navigation mounts a cap-evicted background tab without focus changes', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const { app, page, profile } = await launch(false);
  const observations: any[] = [];
  try {
    await readyPanel(app, page, 'A-1');
    await ready(app, 'B-1');
    await ready(app, 'B-2');
    await page.evaluate(() => (window as any).lifetimeFixture.setOffscreenLimit(1));
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).lifetimeCdp.isTabMounted('B-2')))
      .toBe(false);
    observations.push(await record(app, page, 'after cap eviction'));
    const initial = await page.evaluate(() => (window as any).lifetimeFixture.records());
    const url = `${guestUrl}/after-eviction?tab=B-2`;
    const result = await app.evaluate(
      (_electron, url) => (globalThis as any).lifetimeNavigate('B-2', url),
      url,
    );
    expect(result).toMatchObject({
      success: true,
      results: [{ action: 'navigate', success: true, result: { tabId: 'B-2', url } }],
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).lifetimeFixture.urls()['B-2']))
      .toBe(url);
    await expect
      .poll(async () => (await guestSnapshot(app)).live.some((guest) => guest.url === url))
      .toBe(true);
    expect(await page.evaluate(() => (window as any).lifetimeFixture.records())).toEqual(initial);
    expect(await page.locator('[data-offscreen-webview-tab]').count()).toBe(1);
    observations.push(await record(app, page, 'after explicit navigation'));
  } finally {
    await teardown(app, page, profile, observations, testInfo);
  }
});

for (const hidden of [false, true]) {
  test(`explicit navigation recovers a self-closed offscreen ${hidden ? 'hidden' : 'background'} guest without focus changes`, async ({}, testInfo) => {
    test.setTimeout(120_000);
    const { app, page, profile } = await launch(true);
    const observations: any[] = [];
    try {
      await ready(app, 'B-1');
      if (hidden) await page.evaluate(() => (window as any).lifetimeFixture.close('B-1'));
      observations.push(await record(app, page, 'before guest self-close'));
      const initial = await page.evaluate(() => (window as any).lifetimeFixture.records());
      await app.evaluate(async ({ webContents }) => {
        const guest = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('tab=B-1'));
        if (!guest) throw new Error('Missing B-1 guest');
        await guest.executeJavaScript('setTimeout(() => window.close(), 0); true');
      });
      await expect
        .poll(() => app.evaluate(() => (globalThis as any).lifetimeCdp.isTabMounted('B-1')))
        .toBe(false);
      const closedGuests = await app.evaluate(
        () => (globalThis as any).lifetimeEvidence.guests.length,
      );
      const passiveList = await app.evaluate(() =>
        (globalThis as any).lifetimeCdp.listAllTabs('B'),
      );
      expect(passiveList.stale).toBe(false);
      expect(passiveList.tabs).toContainEqual(
        expect.objectContaining({ tabId: 'B-1', mounted: false }),
      );
      expect(
        await app.evaluate(() => (globalThis as any).lifetimeEvidence.tabListRequests),
      ).toEqual([
        { workspaceId: 'B', payload: { workspaceId: 'B', requestId: expect.any(String) } },
      ]);
      // Observe the registration event over the same budget used for explicit
      // recovery, rather than sampling once after an arbitrary short sleep.
      expect(
        await app.evaluate(() =>
          (globalThis as any).lifetimeCdp.waitForTabRegistration('B-1', 3000),
        ),
      ).toBe(false);
      expect(await app.evaluate(() => (globalThis as any).lifetimeEvidence.guests.length)).toBe(
        closedGuests,
      );
      const url = `${guestUrl}/recovered?tab=B-1`;
      const result = await app.evaluate(
        (_electron, url) => (globalThis as any).lifetimeNavigate('B-1', url),
        url,
      );
      expect(result).toMatchObject({
        success: true,
        results: [{ action: 'navigate', success: true, result: { tabId: 'B-1', url } }],
      });
      expect(
        await app.evaluate(() => (globalThis as any).lifetimeEvidence.tabListRequests.at(-1)),
      ).toEqual({
        workspaceId: 'B',
        payload: { workspaceId: 'B', requestId: expect.any(String), recoverTabId: 'B-1' },
      });
      const registered = await app.evaluate(() =>
        (globalThis as any).lifetimeCdp.waitForTabRegistration('B-1', 3000),
      );
      expect(registered, 'explicit navigation must replace the dead guest').toBe(true);
      await expect
        .poll(async () => (await guestSnapshot(app)).live.some((guest) => guest.url === url))
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => (window as any).lifetimeFixture.urls()['B-1']))
        .toBe(url);
      expect(await page.evaluate(() => (window as any).lifetimeFixture.records())).toEqual(initial);
      expect(await page.evaluate(() => (window as any).lifetimeFixture.errors())).toEqual([]);
      observations.push(await record(app, page, 'after explicit recovery'));
      const recovered = observations.at(-1).live.find((guest: any) => guest.url === url);
      const original = observations[0].live.find((guest: any) => guest.url.endsWith('tab=B-1'));
      expect(recovered.id).not.toBe(original.id);
      const nextUrl = `${guestUrl}/second?tab=B-1`;
      // Hold the response so the persisted-URL notification arrives while
      // getURL still reports the recovered document. It must not initiate a
      // second renderer load, regardless of when native commit events arrive.
      const responses: Array<() => void> = [];
      heldNavigationResponses = responses;
      await page.evaluate(() => (window as any).lifetimeFixture.monitorLoads('B-1'));
      try {
        const nextResult = await app.evaluate(
          (_electron, url) => (globalThis as any).lifetimeNavigate('B-1', url),
          nextUrl,
        );
        expect(nextResult.success).toBe(true);
        await expect
          .poll(() => page.evaluate(() => (window as any).lifetimeFixture.urls()['B-1']))
          .toBe(nextUrl);
        await page.evaluate(() => (window as any).lifetimeFixture.flush());
        const loads = await page.evaluate(() => (window as any).lifetimeFixture.loads());
        observations.push({ label: 'renderer loads before second navigation commits', loads });
        expect(loads).toEqual([]);
      } finally {
        heldNavigationResponses = undefined;
        for (const respond of responses) respond();
      }
      await expect
        .poll(async () => (await guestSnapshot(app)).live.some((guest) => guest.url === nextUrl))
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => (window as any).lifetimeFixture.urls()['B-1']))
        .toBe(nextUrl);
      await expect
        .poll(() =>
          app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isLoading(), recovered.id),
        )
        .toBe(false);
      observations.push(await record(app, page, 'after second navigation settles'));
      const settled = observations.at(-1);
      expect(settled.guests).toHaveLength(closedGuests + 1);
      expect(settled.live.find((guest: any) => guest.id === recovered.id)?.url).toBe(nextUrl);
      expect(settled.urls['B-1']).toBe(nextUrl);
      expect(settled.records).toEqual(initial);
      expect(
        settled.guests
          .find((guest: any) => guest.id === recovered.id)
          .navigations.filter((url: string) => url !== 'about:blank'),
      ).toEqual([url, nextUrl]);

      // A deliberate navigation to the current URL is still a real reload.
      const marker = settled.live.find((guest: any) => guest.id === recovered.id)?.state.marker;
      const reload = await app.evaluate(
        (_electron, url) => (globalThis as any).lifetimeNavigate('B-1', url),
        nextUrl,
      );
      expect(reload.success).toBe(true);
      await expect
        .poll(async () => {
          const state = (await guestSnapshot(app)).live.find(
            (guest) => guest.id === recovered.id,
          )?.state;
          return Boolean(state?.marker && state.marker !== marker);
        })
        .toBe(true);
      observations.push(await record(app, page, 'after deliberate same-URL navigation'));
      expect(
        observations
          .at(-1)
          .guests.find((guest: any) => guest.id === recovered.id)
          .navigations.filter((target: string) => target !== 'about:blank'),
      ).toEqual([url, nextUrl, nextUrl]);

      // Abort an in-flight main navigation, then explicitly retry the same
      // persisted URL. Consuming the earlier echo must not prevent recovery.
      const expectedLoads: string[] = [];
      for (const retryKind of ['navigate', 'replace'] as const) {
        const retryUrl = `${guestUrl}/cancelled?tab=B-1&via=${retryKind}`;
        const cancelledResponses: Array<() => void> = [];
        heldNavigationResponses = cancelledResponses;
        try {
          const attempt = await app.evaluate(
            (_electron, url) => (globalThis as any).lifetimeNavigate('B-1', url),
            retryUrl,
          );
          expect(attempt.success).toBe(true);
          await expect.poll(() => cancelledResponses.length).toBeGreaterThan(0);
          await expect
            .poll(() => page.evaluate(() => (window as any).lifetimeFixture.urls()['B-1']))
            .toBe(retryUrl);
          await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.stop(), recovered.id);
          await expect
            .poll(() =>
              app.evaluate(
                ({ webContents }, id) => webContents.fromId(id)?.isLoading(),
                recovered.id,
              ),
            )
            .toBe(false);
          observations.push(await record(app, page, 'after cancelled navigation'));
        } finally {
          heldNavigationResponses = undefined;
          for (const respond of cancelledResponses) respond();
        }
        if (retryKind === 'navigate') {
          const retry = await app.evaluate(
            (_electron, url) => (globalThis as any).lifetimeNavigate('B-1', url),
            retryUrl,
          );
          expect(retry.success).toBe(true);
        } else {
          // Exercise the real renderer replacement command after main's URL
          // observation was consumed, with the same persisted URL still pending.
          await app.evaluate(({ BrowserWindow }, url) => {
            BrowserWindow.getAllWindows()[0].webContents.send('browser:open-tab', {
              workspaceId: 'B',
              url,
              position: 'replace',
              replaceTabId: 'B-1',
              ownerAgentId: 'fixture-agent',
              visible: false,
            });
          }, retryUrl);
          observations.push(await record(app, page, 'after same-URL replacement command'));
          expectedLoads.push(retryUrl);
          await expect
            .poll(() => page.evaluate(() => (window as any).lifetimeFixture.loads()))
            .toEqual(expectedLoads);
        }
        await expect
          .poll(
            async () =>
              (await guestSnapshot(app)).live.find((guest) => guest.id === recovered.id)?.url,
          )
          .toBe(retryUrl);
        expect(await page.evaluate(() => (window as any).lifetimeFixture.loads())).toEqual(
          expectedLoads,
        );
      }

      // A store-driven external URL change is still an actual renderer command.
      const externalUrl = `${guestUrl}/external?tab=B-1`;
      await page.evaluate((url) => (window as any).lifetimeFixture.setUrl('B-1', url), externalUrl);
      await expect
        .poll(
          async () =>
            (await guestSnapshot(app)).live.find((guest) => guest.id === recovered.id)?.url,
        )
        .toBe(externalUrl);
      expect(await page.evaluate(() => (window as any).lifetimeFixture.loads())).toEqual([
        ...expectedLoads,
        externalUrl,
      ]);
      expect(await page.evaluate(() => (window as any).lifetimeFixture.records())).toEqual(initial);
      expect(await app.evaluate(() => (globalThis as any).lifetimeEvidence.guests.length)).toBe(
        closedGuests + 1,
      );
      observations.push(await record(app, page, 'after retry and external navigation'));
      await page.evaluate(() => (window as any).lifetimeFixture.close('B-1', true));
      await expect
        .poll(() => app.evaluate(() => (globalThis as any).lifetimeCdp.isTabMounted('B-1')))
        .toBe(false);
      const removedLayout = await page.evaluate(() => (window as any).lifetimeFixture.records().B);
      expect(removedLayout.visible).not.toContain('B-1');
      expect(removedLayout.hidden).not.toContain('B-1');
      expect(removedLayout.owners).not.toHaveProperty('B-1');
      const removedList = await app.evaluate(() =>
        (globalThis as any).lifetimeCdp.listAllTabs('B'),
      );
      expect(removedList.stale).toBe(false);
      expect(removedList.tabs.map((tab: { tabId: string }) => tab.tabId)).not.toContain('B-1');
      const removedResult = await app.evaluate(
        (_electron, url) => (globalThis as any).lifetimeNavigate('B-1', url),
        nextUrl,
      );
      expect(removedResult).toMatchObject({
        success: false,
        results: [
          {
            action: 'navigate',
            success: false,
            error: expect.stringMatching(/B-1.*not found.*workspace B/),
          },
        ],
      });
      expect(await page.evaluate(() => (window as any).lifetimeFixture.records().B)).toEqual(
        removedLayout,
      );
      expect(await app.evaluate(() => (globalThis as any).lifetimeCdp.isTabMounted('B-1'))).toBe(
        false,
      );
      await page.evaluate(() => (window as any).lifetimeFixture.archive('B'));
      await expect
        .poll(async () =>
          (await guestSnapshot(app)).live.some((guest) => guest.url.includes('tab=B-')),
        )
        .toBe(false);
      expect(await app.evaluate(() => (globalThis as any).lifetimeEvidence.guests.length)).toBe(
        closedGuests + 1,
      );
    } finally {
      await teardown(app, page, profile, observations, testInfo);
    }
  });
}

for (const owned of [false, true]) {
  for (const rapid of [false, true]) {
    test(`workspace A/B preserves ${owned ? 'agent-owned' : 'user'} guests (${rapid ? 'rapid' : 'ordinary'})`, async ({}, testInfo) => {
      test.setTimeout(120_000);
      const { app, page, profile } = await launch(owned);
      const observations: any[] = [];
      try {
        await readyPanel(app, page, 'A-1');
        await ready(app, 'B-1');
        await ready(app, 'B-2');
        await seed(app);
        observations.push(await record(app, page, 'initial A'));
        const initialA = observations[0].live.find((guest: any) => guest.url.endsWith('tab=A-1'));
        observations[0].capture = await captureOriginal(
          app,
          initialA.id,
          testInfo,
          'visible-A-control',
        );
        expect(observations[0].capture.direct, 'visible A capture control').toMatchObject({
          empty: false,
        });
        await page.evaluate(() => (window as any).lifetimeFixture.switchWorkspace('B'));
        await readyPanel(app, page, 'B-1');
        await seed(app, 'B-1');
        observations.push(await record(app, page, 'first visible B'));
        const initialB = observations[1].live.find((guest: any) => guest.url.endsWith('tab=B-1'));
        const firstCapture = await captureOriginal(app, initialA.id, testInfo);
        observations[1].capture = firstCapture;
        expect
          .soft(firstCapture.direct, 'original A paints while B active')
          .toMatchObject({ empty: false });
        expect
          .soft(firstCapture.addressed, 'production A screenshot while B active')
          .toMatchObject({
            width: expect.any(Number),
            height: expect.any(Number),
          });
        await page.evaluate(() => (window as any).lifetimeFixture.switchWorkspace('A'));
        for (let i = 0; i < 3; i++) {
          if (rapid) {
            await page.evaluate(async () => {
              for (const workspace of ['B', 'A', 'B', 'A']) {
                await (window as any).lifetimeFixture.switchWorkspace(workspace);
              }
            });
          }
          await page.evaluate(() => (window as any).lifetimeFixture.switchWorkspace('B'));
          if (!rapid) await readyPanel(app, page, 'B-1');
          observations.push(await record(app, page, `B ${i}`));
          await page.evaluate(() => (window as any).lifetimeFixture.switchWorkspace('A'));
          await readyPanel(app, page, 'A-1');
          observations.push(await record(app, page, `A ${i}`));
        }
        for (const observation of observations.slice(1)) {
          for (const [tabId, initial, baseline] of [
            ['A-1', initialA, observations[0]],
            ['B-1', initialB, observations[1]],
          ] as const) {
            expect.soft(observation.records[tabId[0]].visible, observation.label).toContain(tabId);
            const guests = observation.live.filter((guest: any) =>
              guest.url.endsWith(`tab=${tabId}`),
            );
            expect
              .soft(
                guests.map((guest: any) => guest.id),
                `${observation.label}: ${tabId} identity`,
              )
              .toEqual([initial.id]);
            for (const guest of guests) {
              expect.soft(guest.state, observation.label).toEqual(initial.state);
              expect
                .soft(guest.muted, `${observation.label}: ${tabId} muted`)
                .toBe(
                  !observation.label.startsWith(tabId[0]) &&
                    observation.label !== `first visible ${tabId[0]}`,
                );
            }
            const element = observation.elements.find((entry: any) => entry.id === initial.id);
            const background =
              !observation.label.startsWith(tabId[0]) &&
              observation.label !== `first visible ${tabId[0]}`;
            expect
              .soft(
                element?.ancestors.some((entry: any) => entry.inert),
                `${observation.label}: ${tabId} inert`,
              )
              .toBe(background);
            expect
              .soft(
                element?.ancestors.some((entry: any) => entry.opacity === '0'),
                `${observation.label}: ${tabId} concealed`,
              )
              .toBe(background);
            expect
              .soft(
                element?.ancestors.some((entry: any) => entry.hidden === 'true'),
                `${observation.label}: ${tabId} aria-hidden`,
              )
              .toBe(background);
            expect
              .soft(
                element?.ancestors.some((entry: any) => entry.display === 'none'),
                `${observation.label}: ${tabId} rendered`,
              )
              .toBe(false);
            expect
              .soft(
                observation.registered.find((entry: any) => entry.tabId === tabId)?.webContentsId,
                `${observation.label}: ${tabId} registered identity`,
              )
              .toBe(initial.id);
            expect
              .soft(
                observation.addressed.find((entry: any) => entry.tabId === tabId).state,
                `${observation.label}: production CDP ${tabId}`,
              )
              .toEqual(initial.state);
            expect
              .soft(
                navigationCount(observation, tabId),
                `${observation.label}: ${tabId} top-level navigations`,
              )
              .toBe(navigationCount(baseline, tabId));
          }
        }
      } finally {
        await teardown(app, page, profile, observations, testInfo);
      }
    });
  }

  test(`cold offscreen-to-visible ${owned ? 'agent-owned' : 'user'} handoff diagnostic (not repaired)`, async ({}, testInfo) => {
    const { app, page, profile } = await launch(owned);
    const observations: any[] = [];
    try {
      await ready(app, 'B-1');
      await ready(app, 'B-2');
      await seed(app, 'B-1');
      observations.push(await record(app, page, 'cold B offscreen'));
      await page.evaluate(() => (window as any).lifetimeFixture.switchWorkspace('B'));
      await readyPanel(app, page, 'B-1');
      observations.push(await record(app, page, 'first visible B'));
      expect(observations[1].records.B.visible).toContain('B-1');
      const before = observations[0].live.find((guest: any) => guest.url.endsWith('tab=B-1'));
      const after = observations[1].live.find((guest: any) => guest.url.endsWith('tab=B-1'));
      testInfo.annotations.push({
        type: 'diagnostic',
        description: JSON.stringify({
          preserved: before.id === after.id && before.state.marker === after.state.marker,
          before,
          after,
        }),
      });
    } finally {
      await teardown(app, page, profile, observations, testInfo);
    }
  });

  test(`panel tabs retain ${owned ? 'agent-owned' : 'user'} guests; explicit cleanup destroys them`, async ({}, testInfo) => {
    test.setTimeout(120_000);
    const { app, page, profile } = await launch(owned);
    const observations: any[] = [];
    try {
      await readyPanel(app, page, 'A-1');
      await ready(app, 'B-1');
      await ready(app, 'B-2');
      await seed(app);
      observations.push(await record(app, page, 'initial'));
      const initial = observations[0].live.find((guest: any) => guest.url.endsWith('tab=A-1'));
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => (window as any).lifetimeFixture.switchPanelTab('A-2'));
        await readyPanel(app, page, 'A-2');
        observations.push(await record(app, page, `panel background ${i}`));
        expect(observations.at(-1).live.find((guest: any) => guest.id === initial.id)).toEqual({
          ...initial,
          muted: true,
        });
        if (i === 0) {
          const capture = await captureOriginal(app, initial.id, testInfo, 'A1-while-A2-active');
          observations.at(-1).capture = capture;
          expect.soft(capture.direct).toMatchObject({ empty: false });
          expect
            .soft(capture.addressed)
            .toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
        }
        await page.evaluate(() => (window as any).lifetimeFixture.switchPanelTab('A-1'));
        await readyPanel(app, page, 'A-1');
        observations.push(await record(app, page, `panel return ${i}`));
        const returned = observations
          .at(-1)
          .live.filter((guest: any) => guest.url.endsWith('tab=A-1'));
        expect(
          returned.map((guest: any) => guest.id),
          'original panel guest identity',
        ).toEqual([initial.id]);
        expect(returned[0].url, 'original panel URL').toBe(initial.url);
        expect(returned[0].state, 'original panel in-memory state').toEqual(initial.state);
        expect(returned[0].viewport, 'original panel viewport').toEqual(initial.viewport);
        expect(returned[0].muted, 'active panel is unmuted').toBe(false);
        expect(
          observations.at(-1).guests.find((guest: any) => guest.id === initial.id).navigations,
        ).toHaveLength(1);
      }
      await page.evaluate(() => (window as any).lifetimeFixture.close('A-1', true));
      await expect
        .poll(
          async () =>
            (await guestSnapshot(app)).live.some((guest) => guest.url.endsWith('tab=A-1')),
          { timeout: GUEST_TEARDOWN_TIMEOUT_MS },
        )
        .toBe(false);
      observations.push(await record(app, page, 'explicit close'));
      expect(observations.at(-1).records.A.visible).not.toContain('A-1');
      await page.evaluate(() => (window as any).lifetimeFixture.archive('A'));
      await expect
        .poll(
          async () => (await guestSnapshot(app)).live.some((guest) => guest.url.includes('tab=A-')),
          { timeout: GUEST_TEARDOWN_TIMEOUT_MS },
        )
        .toBe(false);
      observations.push(await record(app, page, 'archive'));
      expect(observations.at(-1).records.A).toBeUndefined();
    } finally {
      await teardown(app, page, profile, observations, testInfo);
    }
  });
}

/**
 * Frames per second, measured on the main-process clock, for the host window
 * and one guest (each must already count requestAnimationFrame callbacks in
 * `window.__rafFrames`). The host window is visible, so its rate is the
 * display's refresh rate: the oracle the guest is compared against.
 */
async function frameRates(app: ElectronApplication, tabId: string, ms: number) {
  return app.evaluate(
    async ({ BrowserWindow, webContents }, { tabId, ms }) => {
      const guest = webContents
        .getAllWebContents()
        .find((wc) => wc.getType() === 'webview' && wc.getURL().endsWith(`tab=${tabId}`));
      if (!guest) throw new Error(`Missing ${tabId} guest`);
      const host = BrowserWindow.getAllWindows()[0].webContents;
      const read = async () => {
        const [guestFrames, hostFrames] = await Promise.all(
          [guest, host].map((wc) => wc.executeJavaScript('window.__rafFrames') as Promise<number>),
        );
        return { guestFrames, hostFrames, at: performance.now() };
      };
      const start = await read();
      await new Promise((done) => setTimeout(done, ms));
      const end = await read();
      const seconds = (end.at - start.at) / 1000;
      return {
        guest: (end.guestFrames - start.guestFrames) / seconds,
        display: (end.hostFrames - start.hostFrames) / seconds,
      };
    },
    { tabId, ms },
  );
}

/**
 * Guest frame-rate bounds as fractions of the display's own rate, so a 60 Hz
 * and a 120 Hz runner share them. Measured on macOS (60 and 120 Hz): a held
 * guest draws at the display rate; an idle guest under the host's opacity-0
 * layer mostly at 1 fps with bursts (at most ~0.25 of the display); an idle
 * guest whose own box is opacity 0 but has no transparent ancestor at ~0.5
 * (cloudlands-fe#3925, #3952).
 */
const HELD_MIN_FRACTION = 0.8;
const IDLE_MAX_FRACTION = 0.35;
/** The held tab must draw at least this many times as often as the idle one. */
const HELD_TO_IDLE_MIN_RATIO = 3;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Chromium's opacity-based frame throttling for hidden guests only happens with
// macOS compositing: under Linux Xvfb (software compositing) every guest draws
// at the display rate whatever its opacity, so there is nothing to compare.
test('agent drawing lifts a hidden tab from the idle throttle to full frame rate', async ({}, testInfo) => {
  test.skip(
    process.platform !== 'darwin',
    'Hidden-guest frame throttling only reproduces with macOS compositing',
  );
  test.setTimeout(120_000);
  const { app, page, profile } = await launch(true);
  const observations: any[] = [];
  const countFrames =
    'window.__rafFrames ??= (requestAnimationFrame(function count() { window.__rafFrames++; requestAnimationFrame(count); }), 0); true';
  async function measure(label: string) {
    const samples = [];
    for (let i = 0; i < 3; i++) samples.push(await frameRates(app, 'B-1', 2000));
    const rate = {
      guest: median(samples.map((sample) => sample.guest)),
      display: median(samples.map((sample) => sample.display)),
    };
    observations.push({ label, samples, rate });
    expect(rate.display, `${label}: the visible host window must draw`).toBeGreaterThan(20);
    return rate;
  }
  const holdState = async () => ({
    held: await app.evaluate(() => (globalThis as any).lifetimeCdp.hasAgentDrawingHold('B-1')),
    box: await page
      .locator('[data-offscreen-webview-box="B-1"]')
      .getAttribute('data-agent-drawing'),
  });
  try {
    await ready(app, 'B-1');
    // Hide B-1 so the agent-owned tab of the background workspace is drawn
    // only by the offscreen host, pinned there for the agent.
    await page.evaluate(() => (window as any).lifetimeFixture.close('B-1'));
    expect(
      (await page.evaluate(() => (window as any).lifetimeFixture.records())).B.hidden,
    ).toContain('B-1');
    await expect(page.locator('[data-offscreen-webview-tab="B-1"]')).toHaveCount(1);
    await page.evaluate(countFrames);
    await app.evaluate(async ({ webContents }, script) => {
      const guest = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('tab=B-1'));
      if (!guest) throw new Error('Missing B-1 guest');
      await guest.executeJavaScript(script);
    }, countFrames);

    await app.evaluate(() => {
      const g = globalThis as any;
      g.lifetimeEndDrawing = g.lifetimeCdp.beginAgentDrawing('B-1', 'fixture-agent');
    });
    await expect.poll(holdState).toEqual({ held: true, box: '' });
    const held = await measure('agent drawing');

    // The action ends; after the (fixture-shortened) idle window the hold
    // lapses and the tab returns to the idle throttle.
    await app.evaluate(() => (globalThis as any).lifetimeEndDrawing());
    await expect.poll(holdState).toEqual({ held: false, box: null });
    const idle = await measure('idle after agent drawing');
    console.log('Hidden tab frame rates:', JSON.stringify({ held, idle }));

    expect
      .soft(held.guest, 'held tab draws at the display rate')
      .toBeGreaterThanOrEqual(held.display * HELD_MIN_FRACTION);
    expect
      .soft(idle.guest, 'idle tab is throttled well below the display rate')
      .toBeLessThanOrEqual(idle.display * IDLE_MAX_FRACTION);
    expect(
      held.guest,
      'held tab draws several times as often as the idle one',
    ).toBeGreaterThanOrEqual(idle.guest * HELD_TO_IDLE_MIN_RATIO);
  } finally {
    await teardown(app, page, profile, observations, testInfo);
  }
});
