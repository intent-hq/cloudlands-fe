import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../test/mocks/backend-transport.mock';
import { store } from '../../store';
import { workspaceCatalogSaga } from './workspace-catalog-saga';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  workspaceCatalogRequested,
  ensureWorkspaceCatalogRequested,
} from './provider-catalog-slice';

const WS = 'catalog-probes';
const settle = () => vi.advanceTimersByTimeAsync(0);
describe('workspace catalog host probes through live clients', () => {
  let backend: MockBackendHandle;
  let dispose: () => void;
  let cancel: () => void;
  const probes = () => backend.requests.filter((r) => r.method === 'host.findBinary');
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockBackend();
    backend = installMockBackend();
    backend.onRequest('providers.catalog', () => ({ providers: [] }));
    backend.onRequest('settings.list', () => ({ settings: [] }));
    backend.onRequest('specialist.list', () => ({ specialists: [] }));
    backend.onRequest('host.providerDiscovery', () => ({
      providers: [{ id: 'claude-code', installed: true }],
    }));
    backend.onRequest('host.providerAuthStatus', () => ({ providers: [] }));
    backend.onRequest('mcp.servers.list', () => ({ servers: [] }));
    backend.onRequest('host.findBinary', () => ({ available: true, path: '/bin/claude' }));
    dispose = store.init();
    cancel = store.runSaga(workspaceCatalogSaga);
  });
  afterEach(() => {
    cancel();
    dispose();
    resetMockBackend();
    vi.useRealTimers();
  });
  it('keeps workspace identities separate and preserves invalidation queued during mount demand', async () => {
    let release!: (value: { providers: [] }) => void;
    const first = new Promise<{ providers: [] }>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    backend.onRequest('providers.catalog', () => (++calls === 1 ? first : { providers: [] }));
    store.dispatch(workspaceMounted(WS));
    store.dispatch(ensureWorkspaceCatalogRequested(WS));
    // A real refresh must survive subsequent duplicate mount demand.
    store.dispatch(workspaceCatalogRequested(WS));
    store.dispatch(ensureWorkspaceCatalogRequested(WS));
    release({ providers: [] });
    await settle();
    expect(probes()).toHaveLength(2);
    store.dispatch(ensureWorkspaceCatalogRequested(WS));
    store.dispatch(workspaceMounted('another-workspace'));
    await settle();
    expect(probes()).toHaveLength(3);
    expect(probes()[2].params).toEqual({ name: 'claude', workspaceId: 'another-workspace' });
    backend.pushEvent({ type: 'settings:changed', data: {} });
    await settle();
    expect(probes()).toHaveLength(5);
  });

  it('shares catalog demand across same-workspace mounts while preserving explicit refresh and reconnect', async () => {
    store.dispatch(workspaceMounted(WS));
    store.dispatch(workspaceMounted(WS));
    await settle();
    store.dispatch(workspaceMounted(WS));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probes()).toEqual([
      { method: 'host.findBinary', params: { name: 'claude', workspaceId: WS } },
    ]);
    store.dispatch(workspaceCatalogRequested(WS));
    await settle();
    expect(probes()).toHaveLength(2);
    backend.triggerReconnect();
    await settle();
    expect(probes()).toHaveLength(3);
    store.dispatch(workspaceUnmounted(WS));
    store.dispatch(workspaceMounted(WS));
    await settle();
    expect(probes()).toHaveLength(4);
  });
});
