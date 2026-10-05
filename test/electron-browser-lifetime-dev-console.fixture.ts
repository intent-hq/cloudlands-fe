/** Real Electron + production native manager/preload; fixture traffic, no daemon connection. */
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'vite';
import { execFileSync } from 'node:child_process';

test('native console isolation, duplicate focus, reload, crash, load failure and reopen', async () => {
  test.setTimeout(60000);
  // This lane starts from a fresh checkout; exercise the real generated preload.
  execFileSync('pnpm', ['run', 'build:preload'], { cwd: process.cwd(), stdio: 'pipe' });
  const root = await mkdtemp(join(tmpdir(), 'intent-dev-console-'));
  let failConsoleRequests = false;
  const server = createServer((req, res) => {
    if (failConsoleRequests && req.url === '/dev-console') {
      res.destroy();
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Intent</title><main>Native lifecycle fixture</main>');
  });
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const base = `http://127.0.0.1:${address.port}`;
    const entry = join(root, 'entry.ts');
    await writeFile(
      entry,
      `export { DevConsoleWindows, registerDevConsoleIPC } from ${JSON.stringify(resolve('src/features/dev-console/main/dev-console-window.ts'))};\nexport { DevConsoleCaptureService } from ${JSON.stringify(resolve('src/features/dev-console/main/dev-console-capture.ts'))};\nexport { stampWindowWithBackend } from ${JSON.stringify(resolve('src/main/window-backend.ts'))};`,
    );
    await build({
      configFile: false,
      logLevel: 'error',
      resolve: { alias: { $shared: resolve('src/shared'), $features: resolve('src/features') } },
      ssr: { noExternal: true },
      build: {
        ssr: entry,
        outDir: root,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron', 'node:path', 'node:url', 'node:crypto', 'node:string_decoder'],
          output: { format: 'cjs', entryFileNames: 'console.cjs' },
        },
      },
    });
    const preload = resolve('dist/preload/index.js');
    await writeFile(
      join(root, 'main.cjs'),
      `
      const { app, BrowserWindow } = require('electron');
      const { DevConsoleWindows, DevConsoleCaptureService, registerDevConsoleIPC, stampWindowWithBackend } = require('./console.cjs');
      app.setPath('userData', ${JSON.stringify(join(root, 'profile'))});
      app.whenReady().then(async () => {
        const capture = new DevConsoleCaptureService();
        const observers = new Set();
        capture.registerClient('fixture-a', 'existing-pool', { observeTraffic(fn) { observers.add(fn); return () => observers.delete(fn); } });
        const windows = new DevConsoleWindows(capture, { preload: ${JSON.stringify(preload)}, url: ${JSON.stringify(base + '/dev-console')} });
        const stop = registerDevConsoleIPC(windows, capture);
        const opener = new BrowserWindow({ show: false, webPreferences: { preload: ${JSON.stringify(preload)}, sandbox: true, contextIsolation: true, nodeIntegration: false } });
        stampWindowWithBackend(opener, 'fixture-a');
        await opener.loadURL(${JSON.stringify(base + '/workspace/new')});
        globalThis.fixture = { capture, windows, observers, opener, stop, emit: () => { for (const fn of observers) fn({ type: 'notification', method: 'events.event', connectionGeneration: 1, payload: { event: { type: 'test:fixture', value: 'private-fixture' } } }); } };
      });`,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('DD_') && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key),
      ),
    );
    application = await electron.launch({
      args: [join(root, 'main.cjs')],
      env: { ...env, DD_TRACE_ENABLED: 'false' },
    });
    const app = application;
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).fixture)).toBe(true);
    const opener = await app.firstWindow();
    const firstId = await opener.evaluate(() => window.electronAPI.invoke('dev-console:open', {}));
    const consolePage = await expect
      .poll(async () => (await app.windows()).length)
      .toBe(2)
      .then(async () => (await app.windows()).find((page) => page !== opener)!);
    await consolePage.waitForLoadState();
    const nativeConsoleTitle = () =>
      app.evaluate(
        ({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.getTitle(),
        firstId.windowId,
      );
    await expect.poll(nativeConsoleTitle).toBe('Dev Console');
    expect(await app.evaluate(() => (globalThis as any).fixture.opener.getTitle())).toBe('Intent');
    const identity = await consolePage.evaluate(() =>
      window.electronAPI.invoke('dev-console:connect', {}),
    );
    expect(identity.backendId).toBe('fixture-a');
    expect(await opener.evaluate(() => window.electronAPI.invoke('dev-console:open', {}))).toEqual(
      firstId,
    );
    expect(await app.windows()).toHaveLength(2);
    expect(await app.evaluate(() => (globalThis as any).fixture.observers.size)).toBe(1);
    await app.evaluate(() => (globalThis as any).fixture.emit());
    const update = await consolePage.evaluate(
      (sessionId) =>
        window.electronAPI.invoke('dev-console:read', { sessionId, afterRevision: -1 }),
      identity.sessionId,
    );
    expect(update.upserts).toHaveLength(1);
    expect(JSON.stringify(update)).not.toContain('private-fixture');
    await expect(
      opener.evaluate(
        (sessionId) =>
          window.electronAPI.invoke('dev-console:read', { sessionId, afterRevision: -1 }),
        identity.sessionId,
      ),
    ).rejects.toThrow('Unauthorized');
    await consolePage.reload();
    await expect.poll(nativeConsoleTitle).toBe('Dev Console');
    const next = await consolePage.evaluate(() =>
      window.electronAPI.invoke('dev-console:connect', {}),
    );
    expect(next.sessionId).not.toBe(identity.sessionId);
    expect(
      await consolePage.evaluate(
        (sessionId) =>
          window.electronAPI.invoke('dev-console:read', { sessionId, afterRevision: -1 }),
        next.sessionId,
      ),
    ).toMatchObject({ recordIds: [], fullCapture: [] });
    expect(
      await app.evaluate(
        (_electron, oldId) => (globalThis as any).fixture.capture.getSnapshot('fixture-a', oldId),
        identity.sessionId,
      ),
    ).toBeNull();
    await app.evaluate(() =>
      (globalThis as any).fixture.windows.open('fixture-a').webContents.forcefullyCrashRenderer(),
    );
    await expect.poll(() => app.evaluate(() => (globalThis as any).fixture.observers.size)).toBe(0);
    await opener.evaluate(() => window.electronAPI.invoke('dev-console:open', {}));
    await expect.poll(() => app.evaluate(() => (globalThis as any).fixture.observers.size)).toBe(1);
    await app.evaluate(() => (globalThis as any).fixture.windows.open('fixture-a').close());
    await expect.poll(() => app.evaluate(() => (globalThis as any).fixture.observers.size)).toBe(0);
    failConsoleRequests = true;
    const failedLoad = await app.evaluate(async () => {
      const fixture = (globalThis as any).fixture;
      const window = fixture.windows.open('fixture-a');
      return await new Promise<{ url: string; isMainFrame: boolean }>((done) => {
        window.webContents.once(
          'did-fail-load',
          (
            _event: unknown,
            _code: number,
            _description: string,
            url: string,
            isMainFrame: boolean,
          ) => done({ url, isMainFrame }),
        );
      });
    });
    expect(failedLoad).toEqual({ url: `${base}/dev-console`, isMainFrame: true });
    failConsoleRequests = false;
    await expect.poll(() => app.evaluate(() => (globalThis as any).fixture.observers.size)).toBe(0);
    await app.evaluate(() => {
      const f = (globalThis as any).fixture;
      f.windows.open('fixture-a');
      f.stop();
    });
    expect(await app.evaluate(() => (globalThis as any).fixture.observers.size)).toBe(0);
  } finally {
    await application?.close();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
