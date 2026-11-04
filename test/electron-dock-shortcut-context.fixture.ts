/** Cold native foreground identity and real Electron guest provenance; no Intent profile or daemon. */
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'vite';

test('cold shortcut context preserves native identity and first-use guest ownership', async ({}, info) => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), 'intent-shortcut-context-'));
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Synthetic preview</title><p>Only fixture content</p>');
  });
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture server');
    const url = `http://127.0.0.1:${address.port}/project/`;
    const entry = join(root, 'entry.ts');
    await writeFile(
      entry,
      [
        `export { embeddedBrowserCdp } from ${JSON.stringify(resolve('src/features/browser/main/embedded-browser-cdp-service.ts'))};`,
        `export { stampWindowWithBackend } from ${JSON.stringify(resolve('src/main/window-backend.ts'))};`,
        `export { getDesktopNativeAdapter, desktopNativeAvailable } from ${JSON.stringify(resolve('src/features/desktop/main/desktop-native.ts'))};`,
        `export { sampleDockForeground } from ${JSON.stringify(resolve('src/main/dock-shortcut-foreground.ts'))};`,
      ].join('\n'),
    );
    await build({
      configFile: false,
      logLevel: 'error',
      resolve: { alias: { $shared: resolve('src/shared') } },
      ssr: { noExternal: true },
      plugins: [
        {
          name: 'isolated-workspace-routing',
          enforce: 'pre',
          resolveId(id) {
            if (id === '../../system/main/system.ipc') return '\0fixture-workspace';
            if (id.endsWith('shared/logger') || id === '$shared/logger') return '\0fixture-logger';
          },
          load(id) {
            if (id === '\0fixture-logger')
              return 'export class Logger { info() {} debug() {} warn() {} error() {} }';
            if (id === '\0fixture-workspace')
              return `export function sendToWorkspaceWindows(){throw new Error('No agent-list warmup allowed');} export function getWindowIdsForWorkspace(id, backend){return id==='fixture-workspace'&&backend==='fixture-backend'?[globalThis.shortcutWindow.id]:[];}`;
          },
        },
      ],
      build: {
        ssr: entry,
        outDir: root,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'context.cjs' },
        },
      },
    });
    await writeFile(
      join(root, 'main.cjs'),
      `
   const {app,BrowserWindow}=require('electron');
   app.setPath('userData',${JSON.stringify(join(root, 'profile'))});
   app.setAppPath(${JSON.stringify(process.cwd())});
   app.whenReady().then(async()=>{ const window=new BrowserWindow({show:false,webPreferences:{webviewTag:true,nodeIntegration:true,contextIsolation:false,sandbox:false}});globalThis.shortcutWindow=window;await window.loadURL('data:text/html,'+encodeURIComponent('<webview id="guest" src="${url}" style="width:400px;height:200px"></webview>'));globalThis.shortcutContext=require('./context.cjs');globalThis.shortcutContext.stampWindowWithBackend(window,'fixture-backend');}).catch(error=>{globalThis.shortcutStartupError=String(error.stack||error);});
  `,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('DD_') && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key),
      ),
    );
    application = await electron.launch({
      args: [join(root, 'main.cjs')],
      env: { ...env, NODE_PATH: resolve('node_modules'), DD_TRACE_ENABLED: 'false' },
    });
    await expect
      .poll(() =>
        application!.evaluate(() =>
          (globalThis as any).shortcutContext
            ? 'ready'
            : ((globalThis as any).shortcutStartupError ?? 'starting'),
        ),
      )
      .toBe('ready');
    const page = await application.firstWindow();
    await expect
      .poll(() =>
        page.evaluate(() => {
          try {
            return (document.querySelector('webview') as any)?.getWebContentsId();
          } catch {
            return 0;
          }
        }),
      )
      .toBeGreaterThan(0);
    const guestId = await page.evaluate(() =>
      (document.querySelector('webview') as any).getWebContentsId(),
    );
    await expect
      .poll(() =>
        application!.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), guestId),
      )
      .toBe(url);
    const evidence = await application.evaluate(async ({ webContents }, guestId) => {
      const {
        embeddedBrowserCdp: service,
        stampWindowWithBackend,
        sampleDockForeground,
        getDesktopNativeAdapter,
        desktopNativeAvailable,
      } = (globalThis as any).shortcutContext;
      const window = (globalThis as any).shortcutWindow;
      const cold = await sampleDockForeground(getDesktopNativeAdapter());
      const nativeIdentity = {
        available: desktopNativeAvailable(),
        identityOutcome: cold.identityOutcome,
        urlOutcome: cold.urlOutcome,
        elapsedMs: cold.elapsedMs,
        pidPresent: !!cold.snapshot.pid,
        appNamePresent: !!cold.snapshot.appName,
        appIdPresent: !!cold.snapshot.appId,
      };
      const degraded = await sampleDockForeground({
        foregroundApp: () => getDesktopNativeAdapter().foregroundApp(),
        foregroundContext: () => Promise.reject(new Error('Synthetic unavailable URL seam')),
      });
      const before = service.focusedTabOwner(guestId);
      service.registerTab('fixture-tab', guestId, 'fixture-workspace');
      const owned = service.focusedTabOwner(guestId);
      stampWindowWithBackend(window, 'fixture-backend');
      const afterRestamp = service.focusedTabOwner(guestId);
      service.registerTab('fixture-tab', guestId, 'fixture-workspace');
      const rebound = service.focusedTabOwner(guestId);
      stampWindowWithBackend(window, 'foreign-backend');
      const afterBackendChange = service.focusedTabOwner(guestId);
      return {
        boundary:
          'Real Electron webview, production native adapter/helper/sampler and tab registry. Workspace-window membership is an explicit fixture seam; no daemon, hotkeys or user profile.',
        nativeIdentity,
        degradedIdentityPreserved: !!degraded.snapshot.pid && !!degraded.snapshot.appName,
        before,
        owned,
        afterRestamp,
        rebound,
        afterBackendChange,
        guestType: webContents.fromId(guestId)?.getType(),
      };
    }, guestId);
    expect(evidence.nativeIdentity.available).toBe(true);
    expect(evidence.nativeIdentity.identityOutcome).toBe('ok');
    expect(evidence.nativeIdentity.pidPresent).toBe(true);
    expect(evidence.nativeIdentity.appNamePresent).toBe(true);
    expect(evidence.degradedIdentityPreserved).toBe(true);
    expect(evidence.before).toBeNull();
    expect(evidence.owned).toEqual({
      workspaceId: 'fixture-workspace',
      backendId: 'fixture-backend',
      url,
    });
    expect(evidence.afterRestamp).toBeNull();
    expect(evidence.rebound).toEqual(evidence.owned);
    expect(evidence.afterBackendChange).toBeNull();
    expect(evidence.guestType).toBe('webview');
    await writeFile(
      info.outputPath('cold-native-and-guest-context.json'),
      JSON.stringify(evidence, null, 2),
    );
  } finally {
    if (application) await application.close();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
