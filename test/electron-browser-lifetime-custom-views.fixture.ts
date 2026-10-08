import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { customViewsChannels, type CustomViewsResponse } from '../src/shared/types/custom-views';
import type { attachCustomViewThemeBridge } from '../src/features/custom-views/custom-view-theme-bridge';
import type { createCustomViewTheme } from '../src/shared/custom-view-sdk/index';
import type { themeManager } from '../src/lib/utils/theme';

declare global {
  interface Window {
    customViewNativeInvoke: (channel: string, payload?: unknown) => Promise<CustomViewsResponse>;
    customViewNativeError?: string;
    customViewAttachTheme: typeof attachCustomViewThemeBridge;
    customViewThemeManager: typeof themeManager;
    customViewTheme: ReturnType<typeof createCustomViewTheme>;
    customViewDocumentId: string;
    customViewReadyCount: number;
    customViewDisposeTheme: () => void;
  }
}

test.describe('custom homepage views in Electron', () => {
  test('starts a local view, syncs its theme, isolates its frame, and persists its registration', async ({}, testInfo) => {
    test.setTimeout(120_000);
    const directory = await mkdtemp(join(tmpdir(), 'intent-custom-views-'));
    const profile = join(directory, 'profile');
    await mkdir(profile);
    const entry = join(directory, 'entry.ts');
    await writeFile(
      entry,
      `export { setupCustomViewsIPC, disposeCustomViews } from ${JSON.stringify(resolve('src/features/custom-views/main/custom-views.ipc.ts'))};`,
    );
    await build({
      configFile: false,
      logLevel: 'error',
      ssr: { noExternal: true },
      build: {
        ssr: entry,
        outDir: directory,
        emptyOutDir: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'main-bundle.cjs' },
        },
      },
    });
    await build({
      configFile: false,
      logLevel: 'error',
      build: {
        ssr: resolve('src/preload/index.ts'),
        outDir: directory,
        emptyOutDir: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'preload.cjs' },
        },
      },
    });
    const rendererEntry = join(directory, 'renderer.ts');
    await writeFile(
      rendererEntry,
      [
        `import { invoke } from ${JSON.stringify(resolve('src/shared/generated/ipc-client.ts'))};`,
        `import { registerCustomViewsBridge } from ${JSON.stringify(resolve('src/store/renderer/seeders/custom-views-bridge-seeder.ts'))};`,
        `import { attachCustomViewThemeBridge } from ${JSON.stringify(resolve('src/features/custom-views/custom-view-theme-bridge.ts'))};`,
        `import { themeManager } from ${JSON.stringify(resolve('src/lib/utils/theme.ts'))};`,
        'registerCustomViewsBridge();',
        'themeManager.setTheme("dark", { persist: false });',
        'Object.assign(window, { customViewNativeInvoke: invoke, customViewAttachTheme: attachCustomViewThemeBridge, customViewThemeManager: themeManager });',
      ].join('\n'),
    );
    await build({
      configFile: false,
      logLevel: 'error',
      // ThemeManager stays real; this fixture has no Monaco editor to recolor.
      plugins: [
        {
          name: 'omit-custom-view-fixture-editor',
          resolveId(id) {
            if (id === './monaco-theme') return '\0custom-view-fixture-editor';
          },
          load(id) {
            if (id === '\0custom-view-fixture-editor')
              return 'export function applyCustomMonacoTheme() {} export function revertMonacoTheme() {}';
          },
        },
      ],
      resolve: { alias: { $shared: resolve('src/shared'), $lib: resolve('src/lib') } },
      define: {
        'process.env.INTENT_BUILD_TARGET': JSON.stringify('electron'),
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify('false'),
      },
      build: {
        outDir: directory,
        emptyOutDir: false,
        lib: {
          entry: rendererEntry,
          name: 'CustomViewsFixture',
          formats: ['iife'],
          fileName: () => 'renderer.js',
        },
      },
    });
    const rendererBundle = await readFile(join(directory, 'renderer.js'));
    const tokensCss = await readFile(resolve('src/lib/styles/tokens.css'));
    const renderer = createServer((request, response) => {
      if (request.url === '/tokens.css') {
        response.setHeader('Content-Type', 'text/css');
        response.end(tokensCss);
        return;
      }
      if (request.url === '/renderer.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(
          "window.addEventListener('error', (event) => { window.customViewNativeError = event.message; });\n" +
            rendererBundle.toString(),
        );
        return;
      }
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; frame-src http://127.0.0.1:*;"><title>Custom view native fixture</title><link rel="stylesheet" href="/tokens.css"><main id="view"></main><script src="/renderer.js"></script>',
      );
    });
    await new Promise<void>((done) => renderer.listen(0, '127.0.0.1', done));
    const rendererAddress = renderer.address();
    if (!rendererAddress || typeof rendererAddress === 'string')
      throw new Error('Missing renderer port');
    const url = `http://127.0.0.1:${rendererAddress.port}/`;
    const childEntry = join(directory, 'child.ts');
    await writeFile(
      childEntry,
      [
        `import { createCustomViewTheme } from ${JSON.stringify(resolve('src/shared/custom-view-sdk/index.ts'))};`,
        'const theme = createCustomViewTheme();',
        'Object.assign(window, { customViewTheme: theme, customViewDocumentId: crypto.randomUUID() });',
        'theme.subscribe((snapshot) => { document.getElementById("theme-json").textContent = JSON.stringify(snapshot); });',
        'window.addEventListener("pagehide", () => theme.dispose());',
      ].join('\n'),
    );
    await build({
      configFile: false,
      logLevel: 'error',
      build: {
        outDir: directory,
        emptyOutDir: false,
        lib: {
          entry: childEntry,
          name: 'CustomViewClientFixture',
          formats: ['iife'],
          fileName: () => 'child.js',
        },
      },
    });
    const reservation = createTcpServer();
    await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Missing server port');
    const port = address.port;
    await new Promise<void>((done) => reservation.close(() => done()));
    await writeFile(
      join(directory, 'server.cjs'),
      [
        "const http = require('node:http');",
        "const fs = require('node:fs');",
        "const child = fs.readFileSync(require('node:path').join(__dirname, 'child.js'));",
        "http.createServer((req, res) => { res.setHeader('Cache-Control', 'no-store'); if (req.url === '/child.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(child); return; } res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><style>body{background:hsl(var(--background));color:hsl(var(--foreground));font-family:system-ui;padding:1rem}input{background:hsl(var(--card));color:inherit;border:2px solid hsl(var(--primary));border-radius:var(--radius-medium);padding:.5rem}pre{white-space:pre-wrap;overflow:auto;max-height:360px}</style><h1>Custom view is running</h1><label>Draft <input id=\"draft\"></label><pre id=\"theme-json\"></pre><script src=\"/child.js\"></script>'); }).listen(Number(process.env.PORT), process.env.HOST);",
      ].join('\n'),
    );
    const env = Object.fromEntries(
      ['PATH', 'TMPDIR', 'DISPLAY', 'XAUTHORITY', 'SYSTEMROOT'].flatMap((key) =>
        process.env[key] ? [[key, process.env[key]!]] : [],
      ),
    );
    let app: ElectronApplication | undefined;
    const launch = () =>
      electron.launch({
        args: [
          resolve('test/fixtures/custom-views/main.cjs'),
          profile,
          url,
          join(directory, 'main-bundle.cjs'),
          join(directory, 'preload.cjs'),
        ],
        env: {
          ...env,
          NODE_ENV: 'development',
          DEV_PORT: String(rendererAddress.port),
          DD_TRACE_ENABLED: 'false',
        },
      });
    try {
      app = await launch();
      let page = await app.firstWindow();
      await page.waitForFunction(
        () => !!window.customViewNativeInvoke || !!window.customViewNativeError,
      );
      expect(await page.evaluate(() => window.customViewNativeError)).toBeUndefined();
      expect(page.url()).toBe('app://workspaces/');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const invoke = (channel: string, payload?: unknown) =>
        page.evaluate(
          ({ channel, payload }) =>
            payload === undefined
              ? window.customViewNativeInvoke(channel)
              : window.customViewNativeInvoke(channel, payload),
          { channel, payload },
        ) as Promise<CustomViewsResponse>;
      const saved = await invoke(customViewsChannels.save, {
        name: 'Native custom view',
        directory,
        command: 'node server.cjs',
        port,
        icon: 'globe',
      });
      expect(saved.success).toBe(true);
      if (!saved.success) throw new Error(saved.error.message);
      const id = saved.data.views[0].id;
      const runningUrl = `http://127.0.0.1:${port}/`;
      expect((await invoke(customViewsChannels.start, { id })).success).toBe(true);
      await expect
        .poll(async () => {
          const response = await invoke(customViewsChannels.list);
          return response.success ? response.data.runtimes[0].status : response.error.code;
        })
        .toBe('running');
      await page.evaluate((src) => {
        document.documentElement.style.setProperty('--custom-view-private-check', 'private');
        const frame = document.createElement('iframe');
        frame.title = 'Native custom view';
        frame.style.width = '100%';
        frame.style.height = '600px';
        frame.sandbox.add('allow-scripts', 'allow-forms', 'allow-same-origin');
        frame.src = src;
        document.getElementById('view')!.append(frame);
        window.customViewReadyCount = 0;
        window.addEventListener('message', (event) => {
          if (
            event.source === frame.contentWindow &&
            event.origin === new URL(src).origin &&
            event.data?.type === 'intent:theme:ready'
          )
            window.customViewReadyCount++;
        });
        window.customViewDisposeTheme = window.customViewAttachTheme(frame, src);
      }, runningUrl);
      const frame = page.frameLocator('iframe');
      await expect(frame.getByRole('heading', { name: 'Custom view is running' })).toBeVisible();
      const child = page.frames().find((candidate) => candidate.url() === runningUrl)!;
      // Compare transported values to the actual host cascade, not SDK fallback data.
      const tokenNames = [
        '--background',
        '--foreground',
        '--primary',
        '--radius-medium',
        '--spring-fast',
      ];
      const expectTheme = async (mode: 'dark' | 'light', reducedMotion = false) => {
        const cssVariables = await page.evaluate((names) => {
          const style = getComputedStyle(document.documentElement);
          return Object.fromEntries(
            names.map((name) => [name, style.getPropertyValue(name).trim()]),
          );
        }, tokenNames);
        for (const value of Object.values(cssVariables)) expect(value).not.toBe('');
        const expected = { version: 1, mode, reducedMotion, cssVariables };
        await expect
          .poll(() => child.evaluate(() => window.customViewTheme?.getSnapshot()))
          .toMatchObject(expected);
        const delivered = await child.evaluate((names) => {
          const root = document.documentElement;
          const computed = getComputedStyle(root);
          return {
            snapshot: window.customViewTheme.getSnapshot(),
            subscribed: JSON.parse(document.getElementById('theme-json')?.textContent || 'null'),
            inline: Object.fromEntries(
              names.map((name) => [name, root.style.getPropertyValue(name).trim()]),
            ),
            computed: Object.fromEntries(
              names.map((name) => [name, computed.getPropertyValue(name).trim()]),
            ),
            colorScheme: computed.colorScheme,
            privateToken: computed.getPropertyValue('--custom-view-private-check'),
          };
        }, tokenNames);
        expect(delivered.subscribed).toEqual(delivered.snapshot);
        expect(delivered.inline).toEqual(cssVariables);
        expect(delivered.computed).toEqual(cssVariables);
        expect(delivered.colorScheme).toBe(mode);
        expect(delivered.privateToken).toBe('');
        expect(delivered.snapshot?.cssVariables).not.toHaveProperty('--custom-view-private-check');
        return cssVariables;
      };
      const expectIsolation = async () => {
        expect(await child.evaluate(() => typeof window.electronAPI)).toBe('undefined');
        expect(
          await child.evaluate(() => {
            try {
              return !!window.parent.document;
            } catch {
              return false;
            }
          }),
        ).toBe(false);
      };
      const initialDark = await expectTheme('dark');
      await expectIsolation();
      await expect.poll(() => page.evaluate(() => window.customViewReadyCount)).toBeGreaterThan(0);
      const initialDocument = await child.evaluate(() => window.customViewDocumentId);
      await frame.getByLabel('Draft').fill('Keep this draft during theme changes');

      await page.evaluate(() =>
        window.customViewThemeManager.setTheme('light', { persist: false }),
      );
      const light = await expectTheme('light');
      expect(light['--background']).not.toBe(initialDark['--background']);
      await page.evaluate(() => window.customViewThemeManager.setTheme('dark', { persist: false }));
      expect(await expectTheme('dark')).toEqual(initialDark);

      await page.evaluate(() =>
        window.customViewThemeManager.setCustomTheme({
          name: 'Native custom view theme',
          type: 'dark',
          colors: {
            'editor.background': '#14283c',
            'editor.foreground': '#e8edf2',
            'button.background': '#79b8ff',
          },
        }),
      );
      const custom = await expectTheme('dark');
      expect(custom['--background']).not.toBe(initialDark['--background']);
      expect(custom['--primary']).not.toBe(initialDark['--primary']);

      // Both system preference and the app's battery-saver policy reach the child.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expectTheme('dark', true);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expectTheme('dark', false);
      await page.evaluate(() => document.documentElement.setAttribute('data-reduce-motion', ''));
      await expectTheme('dark', true);
      await page.evaluate(() => document.documentElement.removeAttribute('data-reduce-motion'));
      await expectTheme('dark', false);
      expect(await child.evaluate(() => window.customViewDocumentId)).toBe(initialDocument);
      await expect(frame.getByLabel('Draft')).toHaveValue('Keep this draft during theme changes');
      await testInfo.attach('custom-view-custom-theme-in-electron', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      const readyBeforeReload = await page.evaluate(() => window.customViewReadyCount);
      await child.evaluate(() => window.location.reload());
      await child.waitForFunction(
        (previous) =>
          typeof window.customViewDocumentId === 'string' &&
          window.customViewDocumentId !== previous,
        initialDocument,
      );
      await expect
        .poll(() => page.evaluate(() => window.customViewReadyCount))
        .toBeGreaterThan(readyBeforeReload);
      expect(await expectTheme('dark')).toEqual(custom);
      await expect(frame.getByLabel('Draft')).toHaveValue('');
      await expectIsolation();
      await page.evaluate(() => window.customViewThemeManager.clearCustomTheme());
      expect(await expectTheme('dark')).toEqual(initialDark);
      await testInfo.attach('custom-view-theme-snapshot', {
        body: JSON.stringify(
          await child.evaluate(() => window.customViewTheme.getSnapshot()),
          null,
          2,
        ),
        contentType: 'application/json',
      });
      await testInfo.attach('custom-view-in-electron', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await page.evaluate(() => window.customViewDisposeTheme());
      expect((await invoke(customViewsChannels.stop, { id })).success).toBe(true);
      await expect
        .poll(() =>
          fetch(runningUrl).then(
            () => true,
            () => false,
          ),
        )
        .toBe(false);
      await app.close();
      app = await launch();
      page = await app.firstWindow();
      await page.waitForFunction(() => !!window.customViewNativeInvoke);
      const restored = await invoke(customViewsChannels.list);
      expect(restored.success).toBe(true);
      if (!restored.success) throw new Error(restored.error.message);
      expect(restored.data.views[0]).toMatchObject({
        id,
        name: 'Native custom view',
        port,
        icon: 'globe',
      });
      expect(restored.data.runtimes[0].status).toBe('stopped');
      await invoke(customViewsChannels.start, { id });
      await expect
        .poll(async () => {
          const response = await invoke(customViewsChannels.list);
          return response.success ? response.data.runtimes[0].status : response.error.code;
        })
        .toBe('running');
      const removed = await invoke(customViewsChannels.remove, { id });
      expect(removed.success && removed.data.views).toEqual([]);
      await expect
        .poll(() =>
          fetch(runningUrl).then(
            () => true,
            () => false,
          ),
        )
        .toBe(false);
      const forQuit = await invoke(customViewsChannels.save, {
        name: 'Quit cleanup',
        directory,
        command: 'node server.cjs',
        port,
        icon: 'terminal',
      });
      if (!forQuit.success) throw new Error(forQuit.error.message);
      await invoke(customViewsChannels.start, { id: forQuit.data.views[0].id });
      await expect
        .poll(async () => {
          const response = await invoke(customViewsChannels.list);
          return response.success ? response.data.runtimes[0].status : response.error.code;
        })
        .toBe('running');
      await app.close();
      app = undefined;
      await expect
        .poll(() =>
          fetch(runningUrl).then(
            () => true,
            () => false,
          ),
        )
        .toBe(false);
    } finally {
      await app?.close();
      await new Promise<void>((done) => renderer.close(() => done()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
