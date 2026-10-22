import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonRpcClient } from '../../features/backend/main/json-rpc-client';
const mocks = vi.hoisted(() => ({
  reconnect: undefined as undefined | (() => void),
  getBackendClient: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
vi.mock('../../features/backend/main/backend.ipc', () => ({
  getBackendClient: mocks.getBackendClient,
  onBackendReconnected: mocks.onBackendReconnected,
}));

describe('main provider catalog context cache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.reconnect = undefined;
    mocks.onBackendReconnected.mockImplementation((fn: () => void) => {
      mocks.reconnect = fn;
      return () => {};
    });
  });

  it('does not start the backend when imported or seeded for specialist configuration', async () => {
    const accessor = await import('./provider-catalog-accessor');
    const catalog = { providers: [] };
    accessor.setProviderCatalogCacheForTests(catalog);
    expect(accessor.getCachedProviderCatalog()).toBe(catalog);
    expect(mocks.getBackendClient).not.toHaveBeenCalled();
    expect(mocks.onBackendReconnected).not.toHaveBeenCalled();
  });

  it('registers reconnect invalidation once for direct fetches and refreshes after reconnect', async () => {
    const { fetchProviderCatalog } = await import('./provider-catalog-accessor');
    const first = { providers: [] };
    const second = { providers: [] };
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    mocks.getBackendClient.mockReturnValue({ request });
    const cached = await fetchProviderCatalog();
    expect(await fetchProviderCatalog()).toBe(cached);
    expect(mocks.onBackendReconnected).toHaveBeenCalledTimes(1);
    mocks.reconnect?.();
    expect(await fetchProviderCatalog()).not.toBe(cached);
    expect(request.mock.calls).toEqual([
      ['providers.catalog', {}],
      ['providers.catalog', {}],
    ]);
    expect(mocks.onBackendReconnected).toHaveBeenCalledTimes(1);
  });
  it('keys inflight work by client and workspace and abandons old connection cache entries', async () => {
    const { fetchProviderCatalog } = await import('./provider-catalog-accessor');
    let release!: (value: { providers: [] }) => void;
    const pending = new Promise<{ providers: [] }>((resolve) => {
      release = resolve;
    });
    const request = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ providers: [] });
    const client = { request } as unknown as JsonRpcClient;
    const otherRequest = vi.fn().mockResolvedValue({ providers: [] });
    const other = { request: otherRequest } as unknown as JsonRpcClient;
    const a = fetchProviderCatalog('A', client);
    const sharedA = fetchProviderCatalog('A', client);
    await fetchProviderCatalog('B', client);
    await fetchProviderCatalog('A', other);
    expect(request.mock.calls).toEqual([
      ['providers.catalog', { workspaceId: 'A' }],
      ['providers.catalog', { workspaceId: 'B' }],
    ]);
    expect(otherRequest).toHaveBeenCalledWith('providers.catalog', { workspaceId: 'A' });
    mocks.reconnect?.();
    await fetchProviderCatalog('A', client);
    release({ providers: [] });
    await Promise.all([a, sharedA]);
    await fetchProviderCatalog('A', client);
    expect(request).toHaveBeenCalledTimes(3);
    await fetchProviderCatalog(undefined, client);
    expect(request).toHaveBeenLastCalledWith('providers.catalog', {});
  });
});
