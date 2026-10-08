import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { customViewsChannels, type CustomViewsResponse } from '../src/shared/types/custom-views';

declare global {
  interface Window {
    customViewNativeInvoke: (channel: string, payload?: unknown) => Promise<CustomViewsResponse>;
    customViewNativeError?: string;
  }
}

test.describe('custom homepage views in Electron', () => {
  test('starts a local view, isolates its frame, and persists its registration', async ({}, testInfo) => {
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
        'registerCustomViewsBridge();',
        'Object.assign(window, { customViewNativeInvoke: invoke });',
      ].join('\n'),
    );
    await build({
      configFile: false,
      logLevel: 'error',
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
    const renderer = createServer((request, response) => {
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
        '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; frame-src http://127.0.0.1:*;"><title>Custom view native fixture</title><main id="view"></main><script src="/renderer.js"></script>',
      );
    });
    await new Promise<void>((done) => renderer.listen(0, '127.0.0.1', done));
    const rendererAddress = renderer.address();
    if (!rendererAddress || typeof rendererAddress === 'string')
      throw new Error('Missing renderer port');
    const url = `http://127.0.0.1:${rendererAddress.port}/`;
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
        "http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><h1>Custom view is running</h1>'); }).listen(Number(process.env.PORT), process.env.HOST);",
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
        const frame = document.createElement('iframe');
        frame.title = 'Native custom view';
        frame.sandbox.add('allow-scripts', 'allow-forms', 'allow-same-origin');
        frame.src = src;
        document.getElementById('view')!.append(frame);
      }, runningUrl);
      const frame = page.frameLocator('iframe');
      await expect(frame.getByRole('heading', { name: 'Custom view is running' })).toBeVisible();
      const child = page.frames().find((candidate) => candidate.url() === runningUrl)!;
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
      await testInfo.attach('custom-view-in-electron', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
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
