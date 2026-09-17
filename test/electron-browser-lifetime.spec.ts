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
const fixture = resolve('test/fixtures/browser-lifetime');
/**
 * Budget for the explicit-close / archive polls. Each guestSnapshot round bounds
 * its per-guest probes to 2 s (see guestSnapshot) and probes the up-to-four
 * guests in parallel, so one round of a guest mid-destruction costs ~2-4 s;
 * 20 s guarantees at least five rounds on top of the default 5 s that already
 * covered the observed destruction latency when no probe hung.
 */
const GUEST_TEARDOWN_TIMEOUT_MS = 20_000;
test.beforeAll(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), 'intent-browser-lifetime-code-'));
  cdpBundle = join(bundleDir, 'cdp.cjs');
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
        },
        load(id) {
          if (id === '\0fixture-logger')
            return 'export class Logger { info() {} debug() {} warn() {} error() {} }';
          if (id === '\0fixture-window-routing')
            return 'export function sendToWorkspaceWindows() { throw new Error("Unexpected production window routing in isolated fixture"); }';
        },
      },
    ],
    ssr: { noExternal: true },
    build: {
      ssr: resolve('src/features/browser/main/embedded-browser-cdp-service.ts'),
      outDir: bundleDir,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: 'cdp.cjs' },
      },
    },
  });
  guestServer = createHttpServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      '<!doctype html><title>QA fixture</title><input id="draft"><button id="increment">Increment</button><script>window.documentMarker = crypto.randomUUID(); window.inMemoryCount = 0; document.querySelector("#increment").onclick = () => window.inMemoryCount++;</script>',
    );
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

async function launch(owned: boolean) {
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
        `${baseUrl}test/fixtures/browser-lifetime/index.html?owned=${owned}&guest=${encodeURIComponent(guestUrl)}`,
        cdpBundle,
      ],
      env,
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
  const result = await app.evaluate(async ({ webContents, nativeImage }, id) => {
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
      .then((image: { base64: string; width: number; height: number }) => ({
        ...image,
        pixelValues: new Set(
          nativeImage.createFromBuffer(Buffer.from(image.base64, 'base64')).toBitmap(),
        ).size,
      }))
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
            pixelValues: expect.any(Number),
          });
        if (firstCapture.addressed && 'pixelValues' in firstCapture.addressed)
          expect.soft(firstCapture.addressed.pixelValues).toBeGreaterThan(1);
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
                .soft(guest.viewport, `${observation.label}: ${tabId} viewport`)
                .toEqual(initial.viewport);
              expect
                .soft(guest.muted, `${observation.label}: ${tabId} muted`)
                .toBe(
                  !observation.label.startsWith(tabId[0]) &&
                    observation.label !== `first visible ${tabId[0]}`,
                );
            }
            const element = observation.elements.find((entry: any) => entry.id === initial.id);
            const originalElement = baseline.elements.find((entry: any) => entry.id === initial.id);
            expect
              .soft(element?.geometry, `${observation.label}: ${tabId} host geometry`)
              .toEqual(originalElement.geometry);
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
