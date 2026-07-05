import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the `mcp.disabledServers` rewire
 * (PROTOCOL.md §5.12). The legacy `settings` electron-store
 * `disabledMcpServers` reader is retired; the daemon-owned
 * `mcp.disabledServers` value is hydrated into an in-memory cache via
 * `settings.get` and consulted synchronously by
 * `getGlobalDisabledMcpServers`.
 */

const requestMock = vi.hoisted(() =>
  vi.fn(async () => ({ path: 'mcp.disabledServers', value: [] as string[] })),
);

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

vi.mock('../../../shared/logger', () => ({
  Logger: class {
    info() {}
    warn() {}
    error() {}
    debug() {}
  },
}));

// The tested module also imports mcp-auth-providers and shared/main/config —
// stub them so importing the module does not spin up unrelated side effects.
vi.mock('../main/mcp-auth-providers', () => ({
  injectMcpAuth: vi.fn((c: unknown) => c),
}));

vi.mock('../../../shared/main/config', () => ({
  WorkspaceConfig: {
    paths: {
      metadata: (workspaceId: string) => `/mock/workspaces/${workspaceId}/.workspace`,
    },
  },
}));

describe('user-mcp-settings ↔ daemon mcp.disabledServers', () => {
  beforeEach(async () => {
    requestMock.mockClear();
    requestMock.mockImplementation(async () => ({
      path: 'mcp.disabledServers',
      value: [],
    }));
    vi.resetModules();
    const mod = await import('../main/user-mcp-settings');
    mod.__resetGlobalDisabledMcpServersForTesting();
  });

  it('initGlobalDisabledMcpServers hydrates via settings.get { path }', async () => {
    requestMock.mockResolvedValueOnce({
      path: 'mcp.disabledServers',
      value: ['Sentry', 'Figma'],
    });
    const { initGlobalDisabledMcpServers, getGlobalDisabledMcpServers } = await import(
      '../main/user-mcp-settings'
    );
    await initGlobalDisabledMcpServers();
    expect(requestMock).toHaveBeenCalledWith('settings.get', {
      path: 'mcp.disabledServers',
    });
    // Sync API reflects the hydrated value.
    expect(getGlobalDisabledMcpServers()).toEqual(['Sentry', 'Figma']);
  });

  it('filters non-string entries from the daemon response', async () => {
    requestMock.mockResolvedValueOnce({
      path: 'mcp.disabledServers',
      value: ['ok', 42, null, 'also-ok', {}] as unknown as string[],
    });
    const { initGlobalDisabledMcpServers, getGlobalDisabledMcpServers } = await import(
      '../main/user-mcp-settings'
    );
    await initGlobalDisabledMcpServers();
    expect(getGlobalDisabledMcpServers()).toEqual(['ok', 'also-ok']);
  });

  it('defaults to [] when the daemon call rejects', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom'));
    const { initGlobalDisabledMcpServers, getGlobalDisabledMcpServers } = await import(
      '../main/user-mcp-settings'
    );
    await initGlobalDisabledMcpServers();
    expect(getGlobalDisabledMcpServers()).toEqual([]);
  });

  it('defaults to [] before hydration completes (no race regression)', async () => {
    const { getGlobalDisabledMcpServers } = await import('../main/user-mcp-settings');
    expect(getGlobalDisabledMcpServers()).toEqual([]);
  });

  it('never writes back to the daemon (read-only consumer)', async () => {
    const { initGlobalDisabledMcpServers } = await import('../main/user-mcp-settings');
    await initGlobalDisabledMcpServers();
    const writes = requestMock.mock.calls.filter(([m]) => m === 'settings.update');
    expect(writes).toHaveLength(0);
  });
});
