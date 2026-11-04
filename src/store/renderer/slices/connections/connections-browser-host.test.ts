import { afterEach, describe, expect, it, vi } from 'vitest';
import { withPageBrowserHost } from './connections-browser-host';
import type { PreloadedStoreState } from '$store/renderer/types';

type ConfigGlobal = typeof globalThis & { __INTENT_RUNTIME_CONFIG__?: unknown };

function servePage(config: object) {
  vi.stubGlobal('electronAPI', undefined);
  (globalThis as ConfigGlobal).__INTENT_RUNTIME_CONFIG__ = config;
}

afterEach(() => {
  delete (globalThis as ConfigGlobal).__INTENT_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
});

describe('withPageBrowserHost', () => {
  it('seeds an intent-web host before any saga runs', () => {
    servePage({
      backendId: null,
      connectionsUrl: '/__intent-web/connections',
      hostCapabilities: ['connections.manage'],
      tailcatAvailable: true,
    });
    expect(withPageBrowserHost()).toEqual({
      connections: {
        browserHost: { manageConnections: true, backendBound: false, tailcatAvailable: true },
      },
    });
  });

  it('seeds desktop Browser access as a host that does not manage connections', () => {
    servePage({ backendId: 'local', connectionsUrl: '/__browser-access/connections' });
    expect(withPageBrowserHost()?.connections?.browserHost).toEqual({
      manageConnections: false,
      backendBound: true,
      tailcatAvailable: false,
    });
  });

  it('leaves the desktop app unseeded', () => {
    const loaded = { theme: {} } as PreloadedStoreState;
    expect(withPageBrowserHost()).toBeUndefined();
    expect(withPageBrowserHost(loaded)).toBe(loaded);
  });

  it('keeps other preloaded state and an explicit preloaded browserHost', () => {
    servePage({
      backendId: 'remote-1',
      connectionsUrl: '/__intent-web/connections',
      hostCapabilities: ['connections.manage'],
    });
    const explicit = { connections: { browserHost: null } } as unknown as PreloadedStoreState;
    expect(withPageBrowserHost(explicit)).toBe(explicit);
    const other = { connections: { keychainSync: null } } as unknown as PreloadedStoreState;
    expect(withPageBrowserHost(other)?.connections).toEqual({
      keychainSync: null,
      browserHost: { manageConnections: true, backendBound: true, tailcatAvailable: false },
    });
  });
});
