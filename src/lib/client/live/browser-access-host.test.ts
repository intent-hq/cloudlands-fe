import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchBrowserAccessConnections,
  getBrowserAccessHost,
  openBrowserAccessBackend,
} from './browser-access-host';

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
    expect(getBrowserAccessHost()).toEqual({
      backendId: 'remote-1',
      connectionsUrl: '/__browser-access/connections',
    });
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
      { backendId: 'remote-1', connectionsUrl: '/__browser-access/connections' },
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
        { backendId: 'local', connectionsUrl: '/c' },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/401/);
  });
});

describe('openBrowserAccessBackend', () => {
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
