/**
 * The library side of Intent apps in main, against a scripted local daemon:
 * the exact `app.*` requests (docs/protocol/methods/apps.md), the capability
 * gate (`server.capabilities.intentApps: 1`), the event re-read and the push
 * to renderers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type Responder = (params: unknown) => unknown;
  /** A scripted daemon: one per machine. */
  const daemon = (backendId: string, config: Record<string, unknown>) => ({
    backendId,
    config,
    hello: { server: { capabilities: { intentApps: 1 } } } as unknown,
    responses: new Map<string, Responder>(),
    requests: [] as { method: string; params: unknown }[],
  });
  return {
    handlers: new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>(),
    prefs: new Map<string, unknown>(),
    local: daemon('local', { transport: 'uds', socketPath: '/tmp/intentd.sock' }),
    remote: daemon('conn-remote', {
      transport: 'wss',
      host: 'build-box.example',
      port: 7443,
      token: 'owner-token',
      fingerprint: 'AA:BB',
    }),
    remoteConnected: true,
    notificationListeners: [] as ((
      backendId: string,
      n: { method: string; params: unknown },
    ) => void)[],
    reconnectListeners: [] as ((backendId: string) => void)[],
    renderers: [] as { backendId: string; sent: { channel: string; payload: unknown }[] }[],
    focusedBackendId: 'local',
    hosts: [] as {
      admin: {
        request(method: string, params?: unknown): Promise<unknown>;
        createSocket(): unknown;
      };
      machine: { key: string | null; label(): string | null };
      openApp: ReturnType<typeof import('vitest').vi.fn>;
    }[],
    createBackendSocket: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
  };
});

/** The local renderer's pushes (the first renderer). */
const sent = () => mocks.renderers[0].sent;
/** Requests that reached the local daemon. */
const localRequests = () => mocks.local.requests;

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) =>
      mocks.handlers.set(channel, handler),
  },
}));
vi.mock('../../../main/local-prefs', () => ({
  getLocalPref: async (key: string) => mocks.prefs.get(key),
  setLocalPref: async (key: string, value: unknown) => void mocks.prefs.set(key, value),
}));
vi.mock('../../../main/offscreen-window', () => ({
  getAppWindows: () => [{ isDestroyed: () => false }],
}));
vi.mock('../../../main/window-backend', () => ({
  getRendererWebContents: () =>
    mocks.renderers.map((renderer) => ({
      backendId: renderer.backendId,
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => renderer.sent.push({ channel, payload }),
    })),
  getBackendIdForWebContents: (contents: { backendId?: string }) => contents.backendId ?? 'local',
}));
vi.mock('../../../main/window', () => ({
  getFocusedWindowBackendId: () => mocks.focusedBackendId,
}));
vi.mock('../../backend/main/desktop-connections-store', () => ({
  list: async () => [{ id: 'conn-remote', label: 'Build box' }],
}));
vi.mock('../../backend/main/backend-connection', async () => {
  const { vi: vitest } = await import('vitest');
  mocks.createBackendSocket = vitest.fn((config: unknown) => ({ config }));
  return { createBackendSocket: mocks.createBackendSocket };
});
vi.mock('../../backend/main/backend.ipc', () => {
  const client = (daemon: typeof mocks.local) => ({
    readHelloSnapshot: async () => daemon.hello,
    getConfig: () => daemon.config,
    request: async (method: string, params: unknown) => {
      daemon.requests.push({ method, params });
      const respond = daemon.responses.get(method);
      if (!respond) throw new Error(`unexpected ${method} on ${daemon.backendId}`);
      return respond(params);
    },
  });
  return {
    getBackendClientForId: (backendId: string) => {
      if (backendId === 'local') return client(mocks.local);
      if (backendId === 'conn-remote' && mocks.remoteConnected) return client(mocks.remote);
      throw new Error(`Backend client is not connected: ${backendId}`);
    },
    onAnyBackendNotification: (
      listener: (backendId: string, n: { method: string; params: unknown }) => void,
    ) => {
      mocks.notificationListeners.push(listener);
      return () => {};
    },
    onAnyBackendReconnected: (listener: (backendId: string) => void) => {
      mocks.reconnectListeners.push(listener);
      return () => {};
    },
  };
});
vi.mock('./app-host', async () => {
  const { vi: vitest } = await import('vitest');
  return {
    LOCAL_APP_HOST_MACHINE: { key: null, label: () => null },
    IntentAppHost: class {
      openAppIds = () => [];
      registerIpc = () => {};
      openApp = vitest.fn(async () => {});
      closeAll = () => {};
      clearAppStorage = async () => {};
      readBundle = async () => ({ mimeType: 'image/png', contentBase64: 'iVBO' });
      constructor(
        admin: (typeof mocks.hosts)[number]['admin'],
        _onOpenChanged: unknown,
        _preload: unknown,
        machine: (typeof mocks.hosts)[number]['machine'],
      ) {
        mocks.hosts.push({ admin, machine, openApp: this.openApp });
      }
    },
  };
});

const APP = {
  id: 'pomodoro-timer',
  name: 'Pomodoro Timer',
  version: '1.0.0',
  description: 'A focus timer.',
  icon: 'icon.png',
  entry: 'index.html',
  bundleHash: 'sha256:9f2c',
  fileCount: 4,
  sizeBytes: 18234,
  permissions: { level: 2, features: ['models', 'notifications'] },
  window: {
    width: 960,
    height: 640,
    minWidth: null,
    minHeight: null,
    resizable: true,
    alwaysOnTop: false,
  },
  approval: { status: 'pending', level: null, features: [], bundleHash: null, approvedAt: null },
  source: { workspaceId: 'ws-1', path: 'apps/pomodoro' },
  publisher: null,
  updateUrl: null,
  signature: null,
  installedAt: '2026-11-26T11:59:00.000Z',
  updatedAt: '2026-11-26T11:59:00.000Z',
  open: false,
};

async function setup() {
  vi.resetModules();
  mocks.handlers.clear();
  mocks.local.requests.length = 0;
  mocks.remote.requests.length = 0;
  mocks.renderers = [{ backendId: 'local', sent: [] }];
  mocks.notificationListeners.length = 0;
  mocks.reconnectListeners.length = 0;
  mocks.hosts.length = 0;
  const module = await import('./intent-apps.ipc');
  module.setupIntentAppsIPC();
  return module;
}

function invoke(channel: string, payload: unknown = {}, backendId = 'local') {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler({ sender: { backendId } }, payload);
}

/** The host of a machine, by the partition key it got (null: this computer). */
const hostOf = (local: boolean) =>
  mocks.hosts.find((host) => (host.machine.key === null) === local);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Intent apps library in main', () => {
  beforeEach(() => {
    mocks.prefs.clear();
    mocks.focusedBackendId = 'local';
    mocks.remoteConnected = true;
    for (const daemon of [mocks.local, mocks.remote]) {
      daemon.hello = { server: { capabilities: { intentApps: 1 } } };
      daemon.responses.clear();
      daemon.responses.set('events.subscribe', () => ({ subscriptionId: 'sub-1' }));
      daemon.responses.set('app.list', () => ({ apps: [APP] }));
    }
  });

  it('stays off and sends nothing to the daemon while the Labs switch is off', async () => {
    await setup();
    await settle();
    expect(await invoke('intent-apps:get-state')).toMatchObject({
      labEnabled: false,
      supported: false,
      apps: [],
    });
    expect(localRequests()).toEqual([]);
    expect(await invoke('intent-apps:install', { workspaceId: 'ws-1', path: '.' })).toMatchObject({
      ok: false,
      error: { code: 'lab-off' },
    });
  });

  it('with the Labs switch off: no daemon call, no window, no push, on every entry point', async () => {
    const module = await setup();
    await settle();
    // Open entry (argv, second instance, intent://app link).
    module.requestOpenApp('pomodoro-timer');
    // App events and reconnects from the daemon.
    mocks.notificationListeners[0]('local', {
      method: 'events.event',
      params: { subscriptionId: 'sub-1', event: { type: 'app:installed', data: { appId: 'x' } } },
    });
    // Renderer requests that a Settings page could send.
    await invoke('intent-apps:get-state');
    await invoke('intent-apps:refresh');
    for (const [channel, payload] of [
      ['intent-apps:install', { workspaceId: 'ws-1', path: '.' }],
      ['intent-apps:approve', { appId: 'a-b', bundleHash: 'sha256:x', level: 1, features: [] }],
      ['intent-apps:revoke', { appId: 'a-b' }],
      ['intent-apps:uninstall', { appId: 'a-b' }],
      ['intent-apps:open', { appId: 'a-b' }],
    ] as const) {
      expect(await invoke(channel, payload)).toMatchObject({
        ok: false,
        error: { code: 'lab-off' },
      });
    }
    await settle();
    expect(localRequests()).toEqual([]);
    expect(hostOf(true)?.openApp).not.toHaveBeenCalled();
    expect(sent()).toEqual([]);
  });

  it('turns on, subscribes to the three app events and reads app.list', async () => {
    await setup();
    const state = await invoke('intent-apps:set-lab', { enabled: true });
    expect(mocks.prefs.get('intentAppsLabEnabled')).toBe(true);
    expect(localRequests()).toEqual([
      {
        method: 'events.subscribe',
        params: { eventTypes: ['app:installed', 'app:removed', 'app:approval-changed'] },
      },
      { method: 'app.list', params: {} },
    ]);
    expect(state).toMatchObject({ labEnabled: true, supported: true, apps: [APP] });
    expect(sent().at(-1)).toEqual({ channel: 'intent-apps:changed', payload: state });
  });

  it('hides the library on a daemon without intentApps: 1 (catalog presence is no probe)', async () => {
    mocks.local.hello = { server: { capabilities: { intentApps: 2 } } };
    mocks.prefs.set('intentAppsLabEnabled', true);
    await setup();
    await settle();
    expect(await invoke('intent-apps:refresh')).toMatchObject({
      labEnabled: true,
      supported: false,
    });
    expect(localRequests().map((request) => request.method)).not.toContain('app.list');
  });

  it('sends app.install, app.approve, app.revoke and app.uninstall exactly as the contract names them', async () => {
    mocks.prefs.set('intentAppsLabEnabled', true);
    await setup();
    await settle();
    mocks.local.responses.set('app.install', (params) => ({
      app: APP,
      replaced: false,
      approvalReset: false,
      dryRun: (params as { dryRun?: boolean }).dryRun === true,
    }));
    mocks.local.responses.set('app.approve', () => ({
      app: { ...APP, approval: { ...APP.approval, status: 'approved' } },
    }));
    mocks.local.responses.set('app.revoke', () => ({ app: APP, revoked: true }));
    mocks.local.responses.set('app.uninstall', () => ({ removed: true }));
    mocks.local.requests.length = 0;

    expect(
      await invoke('intent-apps:install', {
        workspaceId: 'ws-1',
        path: 'apps/pomodoro',
        dryRun: true,
      }),
    ).toMatchObject({ ok: true, result: { dryRun: true, app: { id: 'pomodoro-timer' } } });
    expect(localRequests()[0]).toEqual({
      method: 'app.install',
      params: { workspaceId: 'ws-1', path: 'apps/pomodoro', dryRun: true },
    });

    await invoke('intent-apps:approve', {
      appId: 'pomodoro-timer',
      bundleHash: 'sha256:9f2c',
      level: 2,
      features: ['models'],
    });
    expect(localRequests().find((request) => request.method === 'app.approve')).toEqual({
      method: 'app.approve',
      params: {
        appId: 'pomodoro-timer',
        bundleHash: 'sha256:9f2c',
        level: 2,
        features: ['models'],
      },
    });
    await invoke('intent-apps:revoke', { appId: 'pomodoro-timer' });
    await invoke('intent-apps:uninstall', { appId: 'pomodoro-timer' });
    expect(
      localRequests().filter((r) => r.method === 'app.revoke' || r.method === 'app.uninstall'),
    ).toEqual([
      { method: 'app.revoke', params: { appId: 'pomodoro-timer' } },
      { method: 'app.uninstall', params: { appId: 'pomodoro-timer' } },
    ]);
  });

  it('returns the daemon data.code of a refusal to the renderer', async () => {
    mocks.prefs.set('intentAppsLabEnabled', true);
    await setup();
    await settle();
    mocks.local.responses.set('app.install', () => {
      throw Object.assign(new Error('App exists'), {
        rpcCode: -32602,
        data: { code: 'app-exists' },
      });
    });
    expect(await invoke('intent-apps:install', { workspaceId: 'ws-1', path: '.' })).toEqual({
      ok: false,
      error: { code: 'app-exists', message: 'App exists' },
    });
  });

  it('re-reads app.list on an app event of its subscription and ignores others', async () => {
    mocks.prefs.set('intentAppsLabEnabled', true);
    await setup();
    await settle();
    await invoke('intent-apps:refresh');
    mocks.local.requests.length = 0;
    const notify = (n: { method: string; params: unknown }) =>
      mocks.notificationListeners[0]('local', n);
    notify({
      method: 'events.event',
      params: { subscriptionId: 'sub-1', event: { type: 'agent:started', data: {} } },
    });
    notify({
      method: 'events.event',
      params: { subscriptionId: 'other', event: { type: 'app:installed', data: { appId: 'x' } } },
    });
    await settle();
    expect(localRequests()).toEqual([]);
    notify({
      method: 'events.event',
      params: {
        subscriptionId: 'sub-1',
        event: { type: 'app:approval-changed', data: { appId: 'pomodoro-timer' } },
      },
    });
    await settle();
    expect(localRequests()).toEqual([{ method: 'app.list', params: {} }]);
  });

  it('opens through the host from a renderer, and refuses while the lab is off', async () => {
    await setup();
    await settle();
    expect(await invoke('intent-apps:open', { appId: 'pomodoro-timer' })).toMatchObject({
      ok: false,
      error: { code: 'lab-off' },
    });
    await invoke('intent-apps:set-lab', { enabled: true });
    expect(await invoke('intent-apps:open', { appId: 'pomodoro-timer' })).toEqual({
      ok: true,
      result: undefined,
    });
    expect(hostOf(true)?.openApp).toHaveBeenCalledWith('pomodoro-timer');
  });
  describe('a window connected to a remote machine', () => {
    const REMOTE = 'conn-remote';

    async function setupRemote() {
      mocks.prefs.set('intentAppsLabEnabled', true);
      const module = await setup();
      mocks.renderers.push({ backendId: REMOTE, sent: [] });
      await settle();
      mocks.local.requests.length = 0;
      return module;
    }

    it('reads, installs, approves and opens on that machine, never on this computer', async () => {
      await setupRemote();
      const remoteApp = { ...APP, id: 'side-by-side', name: 'Side by side' };
      mocks.remote.responses.set('app.list', () => ({ apps: [remoteApp] }));
      mocks.remote.responses.set('app.install', (params) => ({
        app: remoteApp,
        replaced: false,
        approvalReset: false,
        dryRun: (params as { dryRun?: boolean }).dryRun === true,
      }));
      mocks.remote.responses.set('app.approve', () => ({ app: remoteApp }));

      const state = await invoke('intent-apps:get-state', {}, REMOTE);
      expect(state).toMatchObject({ labEnabled: true, supported: true, apps: [remoteApp] });
      expect(
        await invoke(
          'intent-apps:install',
          { workspaceId: 'ws-remote', path: '.intent/apps/side-by-side' },
          REMOTE,
        ),
      ).toMatchObject({ ok: true, result: { app: { id: 'side-by-side' } } });
      await invoke(
        'intent-apps:approve',
        { appId: 'side-by-side', bundleHash: 'sha256:9f2c', level: 2, features: ['models'] },
        REMOTE,
      );
      expect(await invoke('intent-apps:open', { appId: 'side-by-side' }, REMOTE)).toEqual({
        ok: true,
        result: undefined,
      });
      await settle();

      expect(mocks.remote.requests.map((request) => request.method)).toEqual([
        'events.subscribe',
        'app.list',
        'app.install',
        'app.list',
        'app.approve',
        'app.list',
      ]);
      expect(mocks.remote.requests[2].params).toEqual({
        workspaceId: 'ws-remote',
        path: '.intent/apps/side-by-side',
      });
      expect(mocks.remote.requests[4].params).toEqual({
        appId: 'side-by-side',
        bundleHash: 'sha256:9f2c',
        level: 2,
        features: ['models'],
      });
      expect(localRequests()).toEqual([]);
      expect(hostOf(false)?.openApp).toHaveBeenCalledWith('side-by-side');
      expect(hostOf(true)?.openApp).not.toHaveBeenCalled();
      // The local window keeps this computer's library; the remote window gets its own.
      expect(JSON.stringify(sent())).not.toContain('side-by-side');
      expect(mocks.renderers[1].sent.at(-1)?.payload).toMatchObject({ apps: [remoteApp] });
    });

    it("gives the remote host that machine's partition key, title and transport", async () => {
      await setupRemote();
      await invoke('intent-apps:get-state', {}, REMOTE);
      const host = hostOf(false)!;
      expect(host.machine.key).toMatch(/^[0-9a-f]{16}$/);
      expect(host.machine.label()).toBe('Build box');
      expect(hostOf(true)!.machine.key).toBeNull();

      // The app session opens on that machine's administrator connection ...
      mocks.remote.responses.set('app.session.open', () => ({ sessionId: 's-1', token: 't' }));
      await host.admin.request('app.session.open', { appId: 'side-by-side' });
      expect(mocks.remote.requests.at(-1)).toEqual({
        method: 'app.session.open',
        params: { appId: 'side-by-side' },
      });
      // ... and the app connection (attach first, then every bridge call such as
      // app.complete) is a new socket with the same WSS transport and owner token.
      mocks.createBackendSocket.mockClear();
      host.admin.createSocket();
      expect(mocks.createBackendSocket).toHaveBeenCalledWith(mocks.remote.config);
    });

    it("re-reads only that machine's library on its app events and reconnects", async () => {
      await setupRemote();
      await invoke('intent-apps:get-state', {}, REMOTE);
      mocks.remote.requests.length = 0;
      const event = {
        method: 'events.event',
        params: { subscriptionId: 'sub-1', event: { type: 'app:installed', data: { appId: 'x' } } },
      };
      mocks.notificationListeners[0](REMOTE, event);
      await settle();
      expect(mocks.remote.requests).toEqual([{ method: 'app.list', params: {} }]);
      expect(localRequests()).toEqual([]);
      mocks.remote.requests.length = 0;
      mocks.reconnectListeners[0](REMOTE);
      await settle();
      expect(mocks.remote.requests.map((request) => request.method)).toEqual([
        'events.subscribe',
        'app.list',
      ]);
      expect(localRequests()).toEqual([]);
    });

    it('shows an error, not a crash, while the machine is not connected', async () => {
      await setupRemote();
      mocks.remoteConnected = false;
      expect(await invoke('intent-apps:get-state', {}, REMOTE)).toMatchObject({
        labEnabled: true,
        supported: false,
        error: expect.stringContaining('not connected'),
      });
    });

    it('hides the library on a guest connection (the library is owner-only)', async () => {
      await setupRemote();
      mocks.remote.responses.set('events.subscribe', () => {
        throw Object.assign(new Error('Forbidden'), { rpcCode: -32003 });
      });
      expect(await invoke('intent-apps:get-state', {}, REMOTE)).toEqual({
        labEnabled: true,
        supported: false,
        apps: [],
        openAppIds: [],
        error: null,
      });
    });

    it('opens the open entry on the only machine that has the app, and locally first', async () => {
      const module = await setupRemote();
      mocks.remote.responses.set('app.list', () => ({ apps: [{ ...APP, id: 'side-by-side' }] }));
      await invoke('intent-apps:get-state', {}, REMOTE);
      module.requestOpenApp('side-by-side');
      await settle();
      expect(hostOf(false)?.openApp).toHaveBeenCalledWith('side-by-side');
      module.requestOpenApp('pomodoro-timer');
      await settle();
      expect(hostOf(true)?.openApp).toHaveBeenCalledWith('pomodoro-timer');
      expect(hostOf(false)?.openApp).not.toHaveBeenCalledWith('pomodoro-timer');
    });
  });
});
