/** Native window selection only: no dock implementation, daemon, or invite redemption. */
import { expect, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { closeElectronApp, electronTest as test } from './electron-app-close';

function hasWindowManager(): boolean {
  if (process.platform !== 'linux') return true;
  try {
    return /window id # 0x[0-9a-f]+/i.test(
      execFileSync('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK'], {
        encoding: 'utf8',
        timeout: 5000,
      }),
    );
  } catch {
    return false;
  }
}

test('invites select registered app windows and share creation until the first document loads', async ({
  launchElectron,
}, info) => {
  test.setTimeout(60_000);
  const root = await mkdtemp(join(tmpdir(), 'intent-invite-window-'));
  const observations: unknown[] = [];
  const protocolObservations: unknown[] = [];
  const windowManager = hasWindowManager();
  const held: ServerResponse[] = [];
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url?.startsWith('/created/')) held.push(res);
    else res.end('<!doctype html><title>Native invite selection fixture</title>');
  });
  let app: ElectronApplication | undefined;
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
    const url = `http://127.0.0.1:${address.port}`;
    const entry = join(root, 'entry.ts');
    await writeFile(
      entry,
      [
        `export { getInviteWindow, focusInviteWindow } from ${JSON.stringify(resolve('src/main/invite-window.ts'))};`,
        `export { configureIntentProtocolClient } from ${JSON.stringify(resolve('src/main/intent-protocol-client.ts'))};`,
        `export { registerChatWindow, isChatWindow } from ${JSON.stringify(resolve('src/main/chat-window-identity.ts'))};`,
        `export { setMainWindow } from ${JSON.stringify(resolve('src/main/state.ts'))};`,
        `export { stampWindowWithBackend, getBackendIdForWindow } from ${JSON.stringify(resolve('src/main/window-backend.ts'))};`,
      ].join('\n'),
    );
    await build({
      configFile: false,
      logLevel: 'error',
      plugins: [
        {
          name: 'invite-window-creation-only',
          enforce: 'pre',
          resolveId(id, importer) {
            if (id === './window' && importer?.endsWith('/main/invite-window.ts'))
              return '\0fixture-invite-window';
          },
          load(id) {
            if (id === '\0fixture-invite-window')
              return `
            import { BrowserWindow } from 'electron';
            import { registerChatWindow } from ${JSON.stringify(resolve('src/main/chat-window-identity.ts'))};
            import { setMainWindow } from ${JSON.stringify(resolve('src/main/state.ts'))};
            import { stampWindowWithBackend } from ${JSON.stringify(resolve('src/main/window-backend.ts'))};
            export async function createWindow(backendId = 'local') {
              const fixture = globalThis.inviteFixture;
              const window = new BrowserWindow({ show: false });
              registerChatWindow(window);
              stampWindowWithBackend(window, backendId);
              setMainWindow(window);
              fixture.created.push({ id: window.id, backendId });
              // Production also returns before the first renderer load completes.
              void window.loadURL(fixture.url + '/created/' + window.id).catch(() => {});
            }
          `;
          },
        },
      ],
      ssr: { noExternal: true },
      build: {
        ssr: entry,
        outDir: root,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'invite.cjs', inlineDynamicImports: true },
        },
      },
    });
    await writeFile(
      join(root, 'main.cjs'),
      `
      const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(root, 'profile'))});
      app.on('window-all-closed', () => {});
      app.whenReady().then(async () => {
        const api = require('./invite.cjs');
        const fixture = globalThis.inviteFixture = {
          ...api, url: ${JSON.stringify(url)}, windows: {}, created: [], settled: [],
          snapshot(label, chosen) {
            return { label, chosenId: chosen?.id ?? null,
              pickerId: api.getInviteWindow()?.id ?? null,
              focusedId: BrowserWindow.getFocusedWindow()?.id ?? null,
              created: [...this.created], settled: [...this.settled],
              windows: BrowserWindow.getAllWindows().map(w => ({
                id: w.id, url: w.webContents.getURL(), chat: api.isChatWindow(w),
                backendId: api.getBackendIdForWindow(w), minimized: w.isMinimized(),
                visible: w.isVisible(), loading: w.webContents.isLoadingMainFrame(),
              })),
            };
          },
          request(count) {
            this.settled = [];
            this.pending = Promise.all(Array.from({ length: count }, () =>
              api.focusInviteWindow().then(w => {
                const row = this.snapshot('focus resolved', w);
                this.settled.push(row.chosenId);
                return row;
              })));
          },
        };
        for (const name of ['main', 'second', 'auxiliary']) {
          const window = new BrowserWindow({ show: false });
          fixture.windows[name] = window;
          if (name !== 'auxiliary') api.registerChatWindow(window);
          api.stampWindowWithBackend(window, 'local');
          // An auxiliary's copied app URL must not grant chat-window identity.
          await window.loadURL(fixture.url + '/app');
        }
        api.setMainWindow(fixture.windows.main);
        fixture.ready = true;
      }).catch(error => { globalThis.inviteStartupError = String(error.stack || error); });
    `,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('DD_') && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key),
      ),
    );
    app = await launchElectron({
      args: [join(root, 'main.cjs')],
      env: { ...env, DD_TRACE_ENABLED: 'false' },
    });
    await expect
      .poll(() =>
        app!.evaluate(() =>
          (globalThis as any).inviteFixture?.ready
            ? 'ready'
            : ((globalThis as any).inviteStartupError ?? 'starting'),
        ),
      )
      .toBe('ready');

    for (const scenario of [
      {
        label: 'real dev runtime',
        packaged: null,
        owned: false,
        isolated: false,
        env: 'development',
        result: 'skipped',
        calls: [],
      },
      {
        label: 'unpackaged production renderer',
        packaged: false,
        owned: false,
        isolated: false,
        env: 'production',
        result: 'skipped',
        calls: [],
      },
      {
        label: 'stale dev owner',
        packaged: false,
        owned: true,
        isolated: false,
        env: 'development',
        result: 'skipped',
        calls: [],
      },
      {
        label: 'installed Intent',
        packaged: true,
        owned: false,
        isolated: false,
        env: 'production',
        result: 'registered',
        calls: ['register'],
      },
      {
        label: 'installed Intent with inherited dev environment',
        packaged: true,
        owned: false,
        isolated: false,
        env: 'development',
        result: 'registered',
        calls: ['register'],
      },
      {
        label: 'isolated package',
        packaged: true,
        owned: true,
        isolated: true,
        env: 'production',
        result: 'skipped',
        calls: [],
      },
      {
        label: 'isolated dev runtime',
        packaged: false,
        owned: true,
        isolated: true,
        env: 'development',
        result: 'skipped',
        calls: [],
      },
      {
        label: 'registration refused',
        packaged: true,
        owned: false,
        isolated: false,
        env: 'production',
        result: 'failed',
        calls: ['register'],
        refuse: true,
      },
    ]) {
      const row = await app.evaluate(({ app }, scenario) => {
        const calls: Array<{ method: string; args: unknown[] }> = [];
        const capture =
          (method: string, result: boolean) =>
          (...args: unknown[]) => {
            calls.push({ method, args });
            return result;
          };
        const previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = scenario.env;
        try {
          const application = {
            isPackaged: scenario.packaged ?? app.isPackaged,
            getAppPath: () => app.getAppPath(),
            isDefaultProtocolClient: capture('isDefault', scenario.owned),
            setAsDefaultProtocolClient: capture('register', !scenario.refuse),
            removeAsDefaultProtocolClient: capture('remove', !scenario.refuse),
          };
          const result = (globalThis as any).inviteFixture.configureIntentProtocolClient(
            application,
            scenario.isolated,
          );
          return {
            label: scenario.label,
            result,
            calls,
            isPackaged: application.isPackaged,
            execPath: process.execPath,
            appPath: app.getAppPath(),
          };
        } finally {
          if (previousEnv === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = previousEnv;
        }
      }, scenario);
      protocolObservations.push(row);
      expect(row.result, scenario.label).toBe(scenario.result);
      expect(
        row.calls.map((call) => call.method),
        scenario.label,
      ).toEqual(scenario.calls);
      if (scenario.packaged === null) expect(row.isPackaged).toBe(false);
      for (const call of row.calls) {
        expect(call.args, scenario.label).toEqual(
          call.method === 'register' ? ['intent'] : ['intent', row.execPath, [row.appPath]],
        );
      }
    }

    async function focus(name: string) {
      const id = await app!.evaluate((_electron, name) => {
        const w = (globalThis as any).inviteFixture.windows[name];
        w.show();
        w.focus();
        return w.id;
      }, name);
      await expect
        .poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id))
        .toBe(id);
      return id;
    }
    async function select(label: string, expectedId: number) {
      const row = await app!.evaluate(async (_electron, label) => {
        const f = (globalThis as any).inviteFixture;
        const picked = f.getInviteWindow();
        const chosen = await f.focusInviteWindow();
        return { ...f.snapshot(label, chosen), initialPickerId: picked?.id ?? null };
      }, label);
      observations.push(row);
      expect(row.initialPickerId, label).toBe(expectedId);
      expect(row.chosenId, label).toBe(expectedId);
      await expect
        .poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id))
        .toBe(expectedId);
      const focused = await app!.evaluate((_electron, label) => {
        const f = (globalThis as any).inviteFixture;
        return f.snapshot(label + ' native focus settled', f.getInviteWindow());
      }, label);
      observations.push(focused);
      expect(focused.windows.find((w: any) => w.id === expectedId)).toMatchObject({
        chat: true,
        visible: true,
        minimized: false,
        loading: false,
      });
      return row;
    }
    const ids = await app.evaluate(() =>
      Object.fromEntries(
        Object.entries((globalThis as any).inviteFixture.windows).map(([name, w]) => [
          name,
          (w as any).id,
        ]),
      ),
    );

    await focus('auxiliary');
    await select('focused auxiliary routes to main', ids.main);
    await focus('second');
    await select('focused normal app window preserved', ids.second);

    if (windowManager) {
      await app.evaluate(() => (globalThis as any).inviteFixture.windows.main.minimize());
      await expect
        .poll(() =>
          app!.evaluate(() => (globalThis as any).inviteFixture.windows.main.isMinimized()),
        )
        .toBe(true);
      await focus('auxiliary');
      await select('minimized main restored', ids.main);
    } else {
      observations.push({ label: 'Minimize requires an X11 window manager', skipped: true });
    }

    for (const stale of ['null', 'destroyed']) {
      await app.evaluate((_electron, stale) => {
        const f = (globalThis as any).inviteFixture;
        if (stale === 'null') f.setMainWindow(null);
        else {
          f.setMainWindow(f.windows.main);
          f.windows.main.destroy();
        }
      }, stale);
      await focus('auxiliary');
      const row = await app.evaluate((_electron, stale) => {
        const f = (globalThis as any).inviteFixture;
        return f.snapshot(stale + ' main fallback', f.getInviteWindow());
      }, stale);
      observations.push(row);
      expect(row.chosenId).not.toBeNull();
      expect(row.windows.find((w: any) => w.id === row.chosenId)?.chat).toBe(true);
      if (stale === 'destroyed') expect(row.chosenId).toBe(ids.second);
      await select(stale + ' main focus', row.chosenId);
    }

    await app.evaluate(() => (globalThis as any).inviteFixture.windows.second.destroy());
    await focus('auxiliary');
    const auxiliaryOnly = await app.evaluate(() => {
      const f = (globalThis as any).inviteFixture;
      return f.snapshot('only auxiliary remains', f.getInviteWindow());
    });
    observations.push(auxiliaryOnly);
    expect(auxiliaryOnly.chosenId).toBeNull();
    expect(auxiliaryOnly.windows).toHaveLength(1);

    await app.evaluate(() => (globalThis as any).inviteFixture.request(3));
    await expect.poll(() => held.length).toBe(1);
    const loading = await app.evaluate(() => {
      const f = (globalThis as any).inviteFixture;
      return f.snapshot('concurrent requests waiting for first load', null);
    });
    observations.push(loading);
    expect(loading.created).toHaveLength(1);
    expect(loading.created[0].backendId).toBe('local');
    expect(loading.settled).toEqual([]);
    const createdId = loading.created[0].id;
    expect(loading.windows.find((w: any) => w.id === createdId)).toMatchObject({
      chat: true,
      loading: true,
    });
    // Steal focus during loading: the pending parent must remain the created app window.
    await focus('auxiliary');
    held.shift()!.end('<!doctype html><title>Loaded native invite fixture</title>');
    const resolved = await app.evaluate(() => (globalThis as any).inviteFixture.pending);
    observations.push(...resolved);
    expect(resolved.map((row: any) => row.chosenId)).toEqual([createdId, createdId, createdId]);
    for (const row of resolved) {
      expect(row.windows.find((w: any) => w.id === createdId)).toMatchObject({
        chat: true,
        loading: false,
        visible: true,
        minimized: false,
        url: `${url}/created/${createdId}`,
      });
    }
    await expect
      .poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id))
      .toBe(createdId);

    // A window closed during first load must release callers, allowing a later retry.
    await app.evaluate(({ BrowserWindow }) => {
      const f = (globalThis as any).inviteFixture;
      BrowserWindow.fromId(f.created[0].id)!.destroy();
      f.request(1);
    });
    await expect.poll(() => held.length).toBe(1);
    await app.evaluate(({ BrowserWindow }) => {
      const f = (globalThis as any).inviteFixture;
      BrowserWindow.fromId(f.created[1].id)!.destroy();
    });
    const closed = await app.evaluate(() => (globalThis as any).inviteFixture.pending);
    observations.push(...closed);
    expect(closed[0].chosenId).toBeNull();
    held.shift()!.end();
    await app.evaluate(() => (globalThis as any).inviteFixture.request(1));
    await expect.poll(() => held.length).toBe(1);
    held.shift()!.end('<!doctype html><title>Retry loaded</title>');
    const retry = await app.evaluate(() => (globalThis as any).inviteFixture.pending);
    observations.push(...retry);
    expect(retry[0].created).toHaveLength(3);
    expect(retry[0].chosenId).toBe(retry[0].created[2].id);
  } finally {
    try {
      const path = info.outputPath('native-invite-window-evidence.json');
      await writeFile(
        path,
        JSON.stringify(
          {
            boundary:
              'Real Electron window selection with production chat identity, state and backend. Window creation and protocol association calls are intercepted; no OS association changes or invite redemption.',
            platform: process.platform,
            windowManager,
            protocolObservations,
            observations,
          },
          null,
          2,
        ),
      );
      await info.attach('Native invite window selection', {
        path,
        contentType: 'application/json',
      });
    } finally {
      try {
        for (const res of held) res.end();
        if (app) await closeElectronApp(app);
      } finally {
        server.closeAllConnections();
        if (server.listening) await new Promise<void>((done) => server.close(() => done()));
        await rm(root, { recursive: true, force: true });
      }
    }
  }
});
