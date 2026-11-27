/**
 * The library side of Intent apps in main, against a scripted local daemon:
 * the exact `app.*` requests (docs/protocol/methods/apps.md), the capability
 * gate (`server.capabilities.intentApps: 1`), the event re-read and the push
 * to renderers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>(),
  prefs: new Map<string, unknown>(),
  requests: [] as { method: string; params: unknown }[],
  hello: { server: { capabilities: { intentApps: 1 } } } as unknown,
  responses: new Map<string, (params: unknown) => unknown>(),
  notificationListeners: [] as ((n: { method: string; params: unknown }) => void)[],
  sent: [] as { channel: string; payload: unknown }[],
  openApp: vi.fn(async () => {}),
}));

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
  getRendererWebContents: () => [
    {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => mocks.sent.push({ channel, payload }),
    },
  ],
}));
vi.mock('../../backend/main/backend-connection', () => ({ createBackendSocket: vi.fn() }));
vi.mock('../../backend/main/backend.ipc', () => ({
  getLocalBackendClient: () => ({
    readHelloSnapshot: async () => mocks.hello,
    getConfig: () => ({ transport: 'uds', socketPath: '/tmp/intentd.sock' }),
    request: async (method: string, params: unknown) => {
      mocks.requests.push({ method, params });
      const respond = mocks.responses.get(method);
      if (!respond) throw new Error(`unexpected ${method}`);
      return respond(params);
    },
  }),
  onBackendNotification: (listener: (n: { method: string; params: unknown }) => void) => {
    mocks.notificationListeners.push(listener);
    return () => {};
  },
  onBackendReconnected: () => () => {},
}));
vi.mock('./app-host', () => ({
  IntentAppHost: class {
    openAppIds = () => [];
    registerIpc = () => {};
    openApp = mocks.openApp;
    closeAll = () => {};
    clearAppStorage = async () => {};
    readBundle = async () => ({ mimeType: 'image/png', contentBase64: 'iVBO' });
  },
}));

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
  mocks.requests.length = 0;
  mocks.sent.length = 0;
  mocks.notificationListeners.length = 0;
  const module = await import('./intent-apps.ipc');
  module.setupIntentAppsIPC();
  return module;
}

function invoke(channel: string, payload: unknown = {}) {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler({ sender: {} }, payload);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Intent apps library in main', () => {
  beforeEach(() => {
    mocks.prefs.clear();
    mocks.openApp.mockClear();
    mocks.hello = { server: { capabilities: { intentApps: 1 } } };
    mocks.responses.clear();
    mocks.responses.set('events.subscribe', () => ({ subscriptionId: 'sub-1' }));
    mocks.responses.set('app.list', () => ({ apps: [APP] }));
  });

  it('stays off and sends nothing to the daemon while the Labs switch is off', async () => {
    await setup();
    await settle();
    expect(await invoke('intent-apps:get-state')).toMatchObject({
      labEnabled: false,
      supported: false,
      apps: [],
    });
    expect(mocks.requests).toEqual([]);
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
    mocks.notificationListeners[0]({
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
    expect(mocks.requests).toEqual([]);
    expect(mocks.openApp).not.toHaveBeenCalled();
    expect(mocks.sent).toEqual([]);
  });

  it('turns on, subscribes to the three app events and reads app.list', async () => {
    await setup();
    const state = await invoke('intent-apps:set-lab', { enabled: true });
    expect(mocks.prefs.get('intentAppsLabEnabled')).toBe(true);
    expect(mocks.requests).toEqual([
      {
        method: 'events.subscribe',
        params: { eventTypes: ['app:installed', 'app:removed', 'app:approval-changed'] },
      },
      { method: 'app.list', params: {} },
    ]);
    expect(state).toMatchObject({ labEnabled: true, supported: true, apps: [APP] });
    expect(mocks.sent.at(-1)).toEqual({ channel: 'intent-apps:changed', payload: state });
  });

  it('hides the library on a daemon without intentApps: 1 (catalog presence is no probe)', async () => {
    mocks.hello = { server: { capabilities: { intentApps: 2 } } };
    mocks.prefs.set('intentAppsLabEnabled', true);
    await setup();
    await settle();
    expect(await invoke('intent-apps:refresh')).toMatchObject({
      labEnabled: true,
      supported: false,
    });
    expect(mocks.requests.map((request) => request.method)).not.toContain('app.list');
  });

  it('sends app.install, app.approve, app.revoke and app.uninstall exactly as the contract names them', async () => {
    mocks.prefs.set('intentAppsLabEnabled', true);
    await setup();
    await settle();
    mocks.responses.set('app.install', (params) => ({
      app: APP,
      replaced: false,
      approvalReset: false,
      dryRun: (params as { dryRun?: boolean }).dryRun === true,
    }));
    mocks.responses.set('app.approve', () => ({
      app: { ...APP, approval: { ...APP.approval, status: 'approved' } },
    }));
    mocks.responses.set('app.revoke', () => ({ app: APP, revoked: true }));
    mocks.responses.set('app.uninstall', () => ({ removed: true }));
    mocks.requests.length = 0;

    expect(
      await invoke('intent-apps:install', {
        workspaceId: 'ws-1',
        path: 'apps/pomodoro',
        dryRun: true,
      }),
    ).toMatchObject({ ok: true, result: { dryRun: true, app: { id: 'pomodoro-timer' } } });
    expect(mocks.requests[0]).toEqual({
      method: 'app.install',
      params: { workspaceId: 'ws-1', path: 'apps/pomodoro', dryRun: true },
    });

    await invoke('intent-apps:approve', {
      appId: 'pomodoro-timer',
      bundleHash: 'sha256:9f2c',
      level: 2,
      features: ['models'],
    });
    expect(mocks.requests.find((request) => request.method === 'app.approve')).toEqual({
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
      mocks.requests.filter((r) => r.method === 'app.revoke' || r.method === 'app.uninstall'),
    ).toEqual([
      { method: 'app.revoke', params: { appId: 'pomodoro-timer' } },
      { method: 'app.uninstall', params: { appId: 'pomodoro-timer' } },
    ]);
  });

  it('returns the daemon data.code of a refusal to the renderer', async () => {
    mocks.prefs.set('intentAppsLabEnabled', true);
    await setup();
    await settle();
    mocks.responses.set('app.install', () => {
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
    mocks.requests.length = 0;
    const notify = mocks.notificationListeners[0];
    notify({
      method: 'events.event',
      params: { subscriptionId: 'sub-1', event: { type: 'agent:started', data: {} } },
    });
    notify({
      method: 'events.event',
      params: { subscriptionId: 'other', event: { type: 'app:installed', data: { appId: 'x' } } },
    });
    await settle();
    expect(mocks.requests).toEqual([]);
    notify({
      method: 'events.event',
      params: {
        subscriptionId: 'sub-1',
        event: { type: 'app:approval-changed', data: { appId: 'pomodoro-timer' } },
      },
    });
    await settle();
    expect(mocks.requests).toEqual([{ method: 'app.list', params: {} }]);
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
    expect(mocks.openApp).toHaveBeenCalledWith('pomodoro-timer');
  });
});
