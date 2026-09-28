import { describe, expect, it, vi } from 'vitest';
import type { JsonRpcClient } from '../../features/backend/main/json-rpc-client';
const mocks = vi.hoisted(() => ({ reconnect: undefined as undefined | (() => void) }));
vi.mock('../../features/backend/main/backend.ipc', () => ({
  getBackendClient: vi.fn(),
  onBackendReconnected: (fn: () => void) => {
    mocks.reconnect = fn;
    return () => {};
  },
}));
import { fetchProviderCatalog } from './provider-catalog-accessor';

describe('main provider catalog context cache', () => {
  it('keys inflight work by client and workspace and abandons old connection cache entries', async () => {
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
