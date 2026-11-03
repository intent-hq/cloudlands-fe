import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bindBrowserAccessList,
  captureHostFingerprint,
  fetchBrowserAccessConnections,
  getBrowserAccessHost,
  openBrowserAccessBackend,
  updateHostConnection,
  type BrowserAccessHost,
} from './browser-access-host';

const DESKTOP_HOST: BrowserAccessHost = {
  backendId: 'remote-1',
  connectionsUrl: '/__browser-access/connections',
  eventsUrl: null,
  canManageConnections: false,
  tailcatAvailable: false,
};
const WEB_HOST: BrowserAccessHost = {
  backendId: null,
  connectionsUrl: '/__intent-web/connections',
  eventsUrl: '/__intent-web/events',
  canManageConnections: true,
  tailcatAvailable: true,
};

type ConfigGlobal = typeof globalThis & { __INTENT_RUNTIME_CONFIG__?: unknown };

afterEach(() => {
  delete (globalThis as ConfigGlobal).__INTENT_RUNTIME_CONFIG__;
});

function setConfig(config: unknown): void {
  (globalThis as ConfigGlobal).__INTENT_RUNTIME_CONFIG__ = config;
}

describe('getBrowserAccessHost', () => {
  it('is null outside Browser access', () => {
    expect(getBrowserAccessHost()).toBeNull();
    setConfig({ intentdWsUrl: '/intentd/ws' });
    expect(getBrowserAccessHost()).toBeNull();
  });

  it('reads the backend and connections path', () => {
    setConfig({ backendId: 'remote-1', connectionsUrl: '/__browser-access/connections' });
    expect(getBrowserAccessHost()).toEqual(DESKTOP_HOST);
  });

  it('reads intent-web capabilities, including a tab with no backend yet', () => {
    setConfig({
      backendId: null,
      intentdWsUrl: null,
      connectionsUrl: '/__intent-web/connections',
      eventsUrl: '/__intent-web/events',
      hostCapabilities: ['connections.manage'],
      tailcatAvailable: true,
      localAvailable: false,
    });
    expect(getBrowserAccessHost()).toEqual(WEB_HOST);
  });

  it('needs connections.manage before a tab may have no backend', () => {
    setConfig({ backendId: null, connectionsUrl: '/c', hostCapabilities: [] });
    expect(getBrowserAccessHost()).toBeNull();
  });

  it('ignores an off-site events stream', () => {
    setConfig({
      backendId: 'local',
      connectionsUrl: '/c',
      eventsUrl: '//evil.example/e',
      hostCapabilities: ['connections.manage'],
    });
    expect(getBrowserAccessHost()?.eventsUrl).toBeNull();
  });

  it.each([
    { backendId: '../x', connectionsUrl: '/c' },
    { backendId: 'local', connectionsUrl: 'https://evil.example/c' },
    { backendId: 'local', connectionsUrl: '//evil.example/c' },
  ])('rejects unsafe values %j', (config) => {
    setConfig(config);
    expect(getBrowserAccessHost()).toBeNull();
  });
});

describe('fetchBrowserAccessConnections', () => {
  it('requests the list for this tab and binds the result to its backend', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            connections: [{ id: 'remote-1' }],
            activeId: 'local',
            windowBackendId: 'x',
          }),
        ),
    );
    const result = await fetchBrowserAccessConnections(
      DESKTOP_HOST,
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledWith('/__browser-access/connections?backend=remote-1', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(result.windowBackendId).toBe('remote-1');
    expect(result.connections).toEqual([{ id: 'remote-1' }]);
  });

  it('throws on an HTTP error', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    await expect(
      fetchBrowserAccessConnections(
        { ...DESKTOP_HOST, backendId: 'local', connectionsUrl: '/c' },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/401/);
  });
});

describe('intent-web lists', () => {
  it('lists without a backend and keeps an unbound tab unbound', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ connections: [], activeId: null, windowBackendId: null })),
    );
    const result = await fetchBrowserAccessConnections(
      WEB_HOST,
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledWith('/__intent-web/connections', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(result).toEqual({ connections: [], activeId: '', windowBackendId: '' });
  });

  it('binds a pushed list to the tab, not the host default', () => {
    expect(
      bindBrowserAccessList(
        { ...WEB_HOST, backendId: 'remote-1' },
        { connections: [], activeId: 'local', windowBackendId: 'local' },
      ),
    ).toEqual({ connections: [], activeId: 'local', windowBackendId: 'remote-1' });
  });
});

describe('intent-web writes', () => {
  it('raises the host capture failure like the desktop handler', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, code: 'timeout', error: 'capture timed out' })),
    );
    await expect(
      captureHostFingerprint(
        WEB_HOST,
        { host: '192.0.2.5', port: 1, token: '' },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow('capture timed out');
    // An empty token is not sent: the host rejects blank text fields.
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      host: '192.0.2.5',
      port: 1,
    });
  });

  it('refuses an id that would escape the connections path', () => {
    expect(() =>
      updateHostConnection(WEB_HOST, { id: '../x', label: 'x', accent: null }, vi.fn()),
    ).toThrow(/invalid connection id/);
  });
});

describe('openBrowserAccessBackend', () => {
  it('turns a tab with no backend into the opened backend tab', () => {
    const open = vi.fn();
    const navigate = vi.fn();
    openBrowserAccessBackend('remote-1', open, navigate, true);
    expect(navigate).toHaveBeenCalledWith('/?backend=remote-1');
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the backend in a new tab', () => {
    const open = vi.fn();
    expect(openBrowserAccessBackend('remote-1', open)).toEqual({
      status: 'opened',
      id: 'remote-1',
    });
    expect(open).toHaveBeenCalledWith('/?backend=remote-1', '_blank', 'noopener');
  });

  it('refuses invalid ids', () => {
    expect(() => openBrowserAccessBackend('a/b', vi.fn())).toThrow(/invalid connection id/);
  });
});
