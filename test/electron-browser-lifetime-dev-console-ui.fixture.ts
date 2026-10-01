/** Actual SvelteKit route + production preload/IPC, with synthetic transport traffic. */
import { _electron as electron, expect, test } from '@playwright/test';
import { build, createServer } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer as createPortProbe } from 'node:net';

async function availableLoopbackPort(port = 0) {
  const probe = createPortProbe();
  await new Promise<void>((done, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', done);
  });
  const address = probe.address();
  await new Promise<void>((done, reject) =>
    probe.close((error) => (error ? reject(error) : done())),
  );
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  return address.port;
}

test('Dev Console native renderer inspects traffic through authorized preload and clears on reopen', async () => {
  test.setTimeout(180000);
  execFileSync('pnpm', ['run', 'build:preload'], { stdio: 'pipe' });
  const root = await mkdtemp(join(tmpdir(), 'intent-console-ui-'));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let ownedPort: number | undefined;
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    if (!process.env.DEV_CONSOLE_TEST_URL) {
      // Vite treats port 0 as its default port, already occupied by the parent harness.
      server = await createServer({
        server: {
          host: '127.0.0.1',
          port: await availableLoopbackPort(),
          strictPort: true,
          hmr: false,
        },
        logLevel: 'error',
      });
    }
    await server?.listen();
    const address = server?.httpServer?.address();
    if (address && typeof address !== 'string') {
      ownedPort = address.port;
      expect(address.address).toBe('127.0.0.1');
      expect(address.port).not.toBe(5173);
    }
    const url =
      process.env.DEV_CONSOLE_TEST_URL ??
      (address && typeof address !== 'string'
        ? `http://127.0.0.1:${address.port}/dev-console`
        : '');
    if (!url) throw new Error('Missing native renderer URL');
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
        const capture = new DevConsoleCaptureService(); const observers = new Set();
        capture.registerClient('fixture-native', 'existing-pool', { observeTraffic(fn) { observers.add(fn); return () => observers.delete(fn); } });
        const windows = new DevConsoleWindows(capture, { preload: ${JSON.stringify(preload)}, url: ${JSON.stringify(url)} });
        const stop = registerDevConsoleIPC(windows, capture);
        const opener = new BrowserWindow({ show: false, webPreferences: { preload: ${JSON.stringify(preload)}, sandbox: true, contextIsolation: true, nodeIntegration: false } });
        stampWindowWithBackend(opener, 'fixture-native'); await opener.loadURL(${JSON.stringify(new URL('/test/fixtures/dev-console-opener.html', url).href)});
        globalThis.fixture = { capture, windows, stop, opener, observers, emit(event) { for (const fn of observers) fn(event); } };
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
    const opened = app.waitForEvent('window');
    await opener.evaluate(() => window.electronAPI.invoke('dev-console:open', {}));
    const page = await opened;
    await expect(page.locator('[data-dev-console-ready="true"]')).toBeVisible({ timeout: 90000 });
    await app.evaluate(() =>
      (globalThis as any).fixture.emit({
        type: 'request',
        direction: 'outbound',
        key: 'native-call',
        requestId: 7,
        method: 'workspace.list',
        payload: { nativeFixture: true },
        connectionGeneration: 1,
      }),
    );
    await page.getByRole('cell', { name: 'workspace.list', exact: true }).click();
    await expect(page.locator('pre').first()).toContainText('"nativeFixture": true');
    await page.getByRole('checkbox').click();
    await expect(page.getByRole('checkbox')).toBeChecked();
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as any).fixture.capture.openSession('fixture-native').fullCapture,
        ),
      )
      .toEqual([{ direction: 'outbound', kind: 'request', method: 'workspace.list' }]);
    await app.evaluate(() =>
      (globalThis as any).fixture.emit({
        type: 'response',
        key: 'native-call',
        status: 'success',
        payload: { result: 'native response' },
        connectionGeneration: 1,
      }),
    );
    await expect(page.locator('pre').nth(1)).toContainText('native response');
    await app.evaluate(() =>
      (globalThis as any).fixture.emit({
        type: 'notification',
        method: 'events.event',
        payload: { event: { type: 'agent:message', data: 'native event' } },
        connectionGeneration: 1,
      }),
    );
    await page.getByRole('tab', { name: 'Inbound RPC', exact: true }).click();
    await expect(page.locator('[data-index]')).toHaveCount(0);
    await app.evaluate(() =>
      (globalThis as any).fixture.emit({
        type: 'request',
        direction: 'inbound',
        key: 'reverse-native',
        requestId: 8,
        method: 'fs.readFile',
        payload: { path: 'native-fixture.txt' },
        connectionGeneration: 1,
      }),
    );
    await page.getByRole('cell', { name: 'fs.readFile', exact: true }).click();
    await expect(page.locator('pre')).toContainText('native-fixture.txt');
    await expect(page.getByRole('cell', { name: 'agent:message', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Events' }).click();
    await page.getByRole('cell', { name: 'agent:message', exact: true }).click();
    await expect(page.locator('pre')).toContainText('native event');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator('[data-index]')).toHaveCount(0);
    await expect(page.locator('pre')).toHaveCount(0);
    await page.close();
    await expect.poll(() => app.evaluate(() => (globalThis as any).fixture.observers.size)).toBe(0);
    const reopened = app.waitForEvent('window');
    await opener.evaluate(() => window.electronAPI.invoke('dev-console:open', {}));
    const next = await reopened;
    await expect(next.locator('[data-dev-console-ready="true"]')).toBeVisible();
    await expect(next.locator('[data-index]')).toHaveCount(0);
    expect(
      await app.evaluate(
        () => (globalThis as any).fixture.capture.openSession('fixture-native').fullCapture,
      ),
    ).toEqual([]);
  } finally {
    try {
      await application?.close();
    } finally {
      try {
        await server?.close();
        if (ownedPort !== undefined) expect(await availableLoopbackPort(ownedPort)).toBe(ownedPort);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
});
