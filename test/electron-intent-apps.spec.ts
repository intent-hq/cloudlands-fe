/**
 * Intent apps end to end in real Electron against a real intentd that
 * advertises `intentApps: 1` (docs/protocol/methods/apps.md): install the
 * sample app from a workspace, approve it, open it in its own window, make a
 * model call through `window.intent`, and see the answer. Then check one
 * window per app, the app's isolation, and that a revoke ends the window.
 *
 * Manual (playwright.manual.config.ts); needs a display (xvfb-run on Linux):
 *
 *   INTENT_APPS_E2E_INTENTD=/path/to/intentd \
 *   INTENT_APPS_E2E_BUNDLE=../intent-apps/templates/quick-call \
 *   xvfb-run -a pnpm exec playwright test -c playwright.manual.config.ts electron-intent-apps
 *
 * The model call uses the daemon's default one-shot provider and the host's
 * provider sign-in. Screenshots and logs go to .demo-artifacts/intent-apps-e2e/.
 */
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { closeElectronApp } from './electron-app-close';

const intentdBin = process.env.INTENT_APPS_E2E_INTENTD;
const bundleSource = process.env.INTENT_APPS_E2E_BUNDLE;
const artifacts = resolve('.demo-artifacts/intent-apps-e2e');
const PROMPT = 'Reply with exactly one word, in lower case: pineapple';

let root: string;
let daemon: ChildProcess | undefined;
let socketPath: string;
let mainBundle: string;
let preloadBundle: string;
let repo: string;

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

async function bundle(entry: string, outDir: string, fileName: string) {
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: {
      alias: ['lib', 'store', 'features', 'shared'].map((name) => ({
        find: `$${name}`,
        replacement: resolve(`src/${name}`),
      })),
    },
    ssr: { noExternal: true },
    build: {
      ssr: entry,
      outDir,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['electron', 'bufferutil', 'utf-8-validate'],
        output: { format: 'cjs', entryFileNames: fileName },
      },
    },
  });
}

test.describe.configure({ mode: 'serial' });
test.skip(!intentdBin || !bundleSource, 'Set INTENT_APPS_E2E_INTENTD and INTENT_APPS_E2E_BUNDLE');

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await mkdir(artifacts, { recursive: true });
  root = await mkdtemp(join(tmpdir(), 'intent-apps-e2e-'));
  // Inside the package, so the bundle's runtime requires (ws) resolve from node_modules.
  const code = resolve('.dev/intent-apps-e2e/code');
  await rm(code, { recursive: true, force: true });
  await bundle(resolve('test/fixtures/intent-apps/main-entry.ts'), code, 'main.cjs');
  await bundle(resolve('src/preload/intent-app.ts'), code, 'intent-app.js');
  mainBundle = join(code, 'main.cjs');
  preloadBundle = join(code, 'intent-app.js');

  // A workspace repo with the sample app in apps/quick-call.
  repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  await cp(resolve(bundleSource!), join(repo, 'apps', 'quick-call'), { recursive: true });
  await writeFile(join(repo, 'README.md'), '# Intent apps E2E\n');
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['add', '-A'],
    ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.invalid', 'commit', '-qm', 'sample app'],
  ]) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  }

  const dataDir = join(root, 'intentd');
  await mkdir(dataDir, { recursive: true });
  socketPath = join(dataDir, 'intentd.sock');
  const log = createWriteStream(join(artifacts, 'intentd.log'));
  daemon = spawn(intentdBin!, ['serve'], {
    env: {
      ...process.env,
      INTENTD_DATA_DIR: dataDir,
      INTENTD_WORKSPACES_DIR: join(dataDir, 'workspaces'),
      INTENTD_TCP_PORT: String(await freePort()),
      INTENTD_LEGACY_IMPORT_ROOTS: '',
      RUST_LOG: process.env.RUST_LOG ?? 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  daemon.stdout?.pipe(log);
  daemon.stderr?.pipe(log);
  await expect.poll(() => existsSync(socketPath), { timeout: 60_000 }).toBe(true);
});

test.afterAll(async () => {
  daemon?.kill('SIGTERM');
  if (root) await rm(root, { recursive: true, force: true });
});

async function launch(): Promise<{ app: ElectronApplication; log: string[] }> {
  const electronBinary = createRequire(import.meta.url)('electron') as unknown as string;
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [mainBundle],
    env: {
      ...Object.fromEntries(
        ['PATH', 'HOME', 'TMPDIR', 'DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR'].flatMap((key) =>
          process.env[key] ? [[key, process.env[key]!]] : [],
        ),
      ),
      INTENTD_SOCKET: socketPath,
      INTENT_APP_PRELOAD: preloadBundle,
      INTENT_APPS_E2E_PROFILE: join(root, 'profile'),
    },
  });
  const log: string[] = [];
  app.process().stdout?.on('data', (chunk) => log.push(String(chunk)));
  app.process().stderr?.on('data', (chunk) => log.push(String(chunk)));
  try {
    await expect
      .poll(() => app.evaluate(() => typeof (globalThis as any).__intentAppsE2e), {
        timeout: 30_000,
      })
      .toBe('object');
  } catch (error) {
    await writeFile(join(artifacts, 'electron-main.log'), log.join(''));
    await closeElectronApp(app);
    throw error;
  }
  return { app, log };
}

function rpc<T = any>(
  app: ElectronApplication,
  method: string,
  params?: unknown,
  timeoutMs?: number,
): Promise<T> {
  return app.evaluate(
    async (_electron, [m, p, t]) => {
      try {
        return { ok: true, result: await (globalThis as any).__intentAppsE2e.request(m, p, t) };
      } catch (error: any) {
        return { ok: false, error: { message: String(error?.message), data: error?.data } };
      }
    },
    [method, params, timeoutMs] as const,
  ) as Promise<T>;
}

test('install, approve, open and call a model through window.intent', async () => {
  test.setTimeout(420_000);
  const { app, log } = await launch();
  try {
    // The socket exists before the daemon finishes starting: wait for the handshake.
    let hello: any = null;
    await expect
      .poll(
        async () => {
          hello = await app
            .evaluate(() => (globalThis as any).__intentAppsE2e.hello())
            .catch(() => null);
          return hello !== null;
        },
        { timeout: 90_000 },
      )
      .toBe(true);
    expect(hello?.server?.capabilities?.intentApps).toBe(1);

    const created = await rpc(app, 'workspace.create', {
      title: 'Intent apps E2E',
      repositoryPath: repo,
      skipIsolation: true,
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    const workspaceId: string = created.result.workspace?.id ?? created.result.id;

    const dry = await rpc(app, 'app.install', {
      workspaceId,
      path: 'apps/quick-call',
      dryRun: true,
    });
    expect(dry).toMatchObject({ ok: true, result: { dryRun: true, app: { id: 'quick-call' } } });
    const installed = await rpc(app, 'app.install', { workspaceId, path: 'apps/quick-call' });
    expect(installed).toMatchObject({
      ok: true,
      result: { app: { id: 'quick-call', approval: { status: 'pending' } } },
    });
    const bundleHash: string = installed.result.app.bundleHash;
    expect(bundleHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Not approved yet: the host cannot open a session.
    const refused = await app.evaluate(async () => {
      try {
        await (globalThis as any).__intentAppsE2e.open('quick-call');
        return null;
      } catch (error: any) {
        return error?.data?.code ?? String(error?.message);
      }
    });
    expect(refused).toBe('not-approved');

    expect(
      await rpc(app, 'app.approve', {
        appId: 'quick-call',
        bundleHash,
        level: 2,
        features: ['models', 'notifications'],
      }),
    ).toMatchObject({ ok: true, result: { app: { approval: { status: 'approved' } } } });

    const windowPromise = app.waitForEvent('window');
    await app.evaluate(() => (globalThis as any).__intentAppsE2e.open('quick-call'));
    const page = await windowPromise;
    page.on('console', (message) => log.push(`[app console] ${message.text()}`));
    await page.waitForLoadState('domcontentloaded');
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle())),
      )
      .toEqual(['Intent App: Quick Call']);
    expect(page.url()).toBe('intent-app://quick-call/index.html');

    // Isolation: only window.intent, no Node.js, no network.
    const isolation = await page.evaluate(async () => {
      let network = 'blocked';
      try {
        await fetch('https://example.com/');
        network = 'open';
      } catch {
        // CSP connect-src 'none'
      }
      return {
        bridge: typeof (window as any).intent?.models?.complete,
        bridgeVersion: (window as any).intent?.bridgeVersion,
        require: typeof (window as any).require,
        process: typeof (window as any).process,
        electronAPI: typeof (window as any).electronAPI,
        network,
      };
    });
    expect(isolation).toEqual({
      bridge: 'function',
      bridgeVersion: 1,
      require: 'undefined',
      process: 'undefined',
      electronAPI: 'undefined',
      network: 'blocked',
    });
    const info = await page.evaluate(() => (window as any).intent.app.info());
    expect(info).toMatchObject({ appId: 'quick-call', bundleHash, level: 2, bridgeVersion: 1 });

    // Storage round trip through the app principal.
    expect(
      await page.evaluate(async () => {
        await (window as any).intent.storage.set('e2e', { n: 1 });
        return (window as any).intent.storage.get('e2e');
      }),
    ).toEqual({ n: 1 });

    // The model call: the template fills providers from intent.models.list().
    await expect
      .poll(() => page.locator('#provider option:not([disabled])').count(), { timeout: 60_000 })
      .toBeGreaterThan(0);
    const models = await page.evaluate(() => (window as any).intent.models.list());
    log.push(`[e2e] models.list=${JSON.stringify(models)}\n`);
    // Prefer a provider this host is signed in to (INTENT_APPS_E2E_PROVIDER, else claude-code).
    const wanted = process.env.INTENT_APPS_E2E_PROVIDER ?? 'claude-code';
    if (models.providers.some((p: any) => p.providerId === wanted && p.available)) {
      await page.selectOption('#provider', wanted);
    }
    await page.fill('#prompt', PROMPT);
    await page.click('#ask');
    try {
      await expect(page.locator('#answer')).not.toBeEmpty({ timeout: 240_000 });
    } catch (error) {
      log.push(`[e2e] status=${JSON.stringify(await page.locator('#status').textContent())}\n`);
      await page.screenshot({ path: join(artifacts, 'quick-call-no-answer.png') });
      throw error;
    }
    const answer = (await page.locator('#answer').textContent())?.trim() ?? '';
    const meta = (await page.locator('#answer-meta').textContent())?.trim() ?? '';
    await page.screenshot({ path: join(artifacts, 'quick-call-answer.png') });
    log.push(`[e2e] answer=${JSON.stringify(answer)} meta=${JSON.stringify(meta)}`);
    expect(answer.toLowerCase()).toContain('pineapple');

    // One window per app: a second open focuses it.
    await app.evaluate(() => (globalThis as any).__intentAppsE2e.open('quick-call'));
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    // on() refuses synchronously: the grant has no globalShortcuts.
    expect(
      await page.evaluate(() => {
        try {
          (window as any).intent.on('shortcut', () => {});
          return null;
        } catch (error: any) {
          return error?.code ?? String(error);
        }
      }),
    ).toBe('forbidden');

    // A revoke ends the session: the app hears session-ended, then the window closes,
    // even when the app tries to keep it open with beforeunload.
    await page.evaluate(() => {
      window.addEventListener('beforeunload', (event) => {
        event.preventDefault();
        event.returnValue = '';
      });
    });
    await page.evaluate(() => {
      (window as any).intent.on('session-ended', (data: unknown) => {
        console.log(`session-ended ${JSON.stringify(data)}`);
      });
    });
    const closed = page.waitForEvent('close', { timeout: 60_000 });
    expect(await rpc(app, 'app.revoke', { appId: 'quick-call' })).toMatchObject({
      ok: true,
      result: { revoked: true },
    });
    await closed;
    expect(log.join('')).toContain('[app console] session-ended {"reason":"revoked"}');

    // A user close is reason "closed": the app hears it before the window goes, also after
    // a quit that was cancelled (main cancels the first quit while it asks about agents).
    expect(
      await rpc(app, 'app.approve', {
        appId: 'quick-call',
        bundleHash,
        level: 2,
        features: ['models', 'notifications'],
      }),
    ).toMatchObject({ ok: true });
    const reopened = app.waitForEvent('window');
    await app.evaluate(() => (globalThis as any).__intentAppsE2e.open('quick-call'));
    const second = await reopened;
    second.on('console', (message) => log.push(`[app console] ${message.text()}`));
    await second.waitForLoadState('domcontentloaded');
    await expect.poll(() => second.evaluate(() => typeof (window as any).intent)).toBe('object');
    await second.evaluate(() => {
      (window as any).intent.on('session-ended', (data: unknown) => {
        console.log(`session-ended ${JSON.stringify(data)}`);
      });
    });
    await app.evaluate(({ app: electronApp }) => {
      const cancelled = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      // Main's handler runs first and cancels; mirror that order for the host's listener.
      cancelled.preventDefault();
      electronApp.emit('before-quit', cancelled);
    });
    const secondClosed = second.waitForEvent('close', { timeout: 30_000 });
    // As the window's close button does.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await secondClosed;
    expect(log.join('')).toContain('[app console] session-ended {"reason":"closed"}');
    expect(await app.evaluate(() => (globalThis as any).__intentAppsE2e.openAppIds())).toEqual([]);
  } finally {
    await writeFile(join(artifacts, 'electron-main.log'), log.join(''));
    await closeElectronApp(app);
  }
});
