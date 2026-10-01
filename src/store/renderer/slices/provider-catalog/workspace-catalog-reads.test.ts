import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('$lib/electron-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/electron-bridge')>()),
  invoke: ipc.invoke,
}));
import { providerAvailabilitySaga } from '../agent-availability/sagas/provider-availability-saga';
import {
  checkSingleProviderRequested,
  checkAllProvidersRequested,
} from '../agent-availability/agent-availability-slice';
import { selectContextModelProviderIds } from './workspace-catalog-selectors';
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
  let cancelAvailability: () => void;
  const probes = () => backend.requests.filter((r) => r.method === 'host.findBinary');
  beforeEach(() => {
    vi.useFakeTimers();
    ipc.invoke.mockReset();
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
    cancelAvailability = store.runSaga(providerAvailabilitySaga);
  });
  afterEach(() => {
    cancelAvailability();
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

  it.each(['event', 'explicit'] as const)(
    'retries stale cached readiness on mount after a failed %s refresh',
    async (trigger) => {
      store.dispatch(workspaceMounted(WS));
      await settle();
      expect(
        store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'].available,
      ).toBe(true);
      backend.onRequest('providers.catalog', () => {
        throw new Error('temporary failure');
      });
      if (trigger === 'event') backend.pushEvent({ type: 'settings:changed', data: {} });
      else store.dispatch(workspaceCatalogRequested(WS));
      await settle();
      expect(
        store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'].available,
      ).toBe(true);
      backend.onRequest('providers.catalog', () => ({ providers: [] }));
      backend.onRequest('host.findBinary', () => ({ available: false }));
      store.dispatch(ensureWorkspaceCatalogRequested(WS));
      await settle();
      expect(
        store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'].available,
      ).toBe(false);
      expect(probes()).toHaveLength(2);
    },
  );

  it('retries when the trailing refresh fails after an older pending snapshot succeeds', async () => {
    let release!: (value: { providers: [] }) => void;
    const first = new Promise<{ providers: [] }>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    backend.onRequest('providers.catalog', () => {
      calls++;
      if (calls === 1) return first;
      if (calls === 2) throw new Error('trailing refresh failed');
      return { providers: [] };
    });
    store.dispatch(workspaceMounted(WS));
    store.dispatch(workspaceCatalogRequested(WS));
    release({ providers: [] });
    await settle();
    expect(calls).toBe(2);
    backend.onRequest('host.findBinary', () => ({ available: false }));
    store.dispatch(ensureWorkspaceCatalogRequested(WS));
    await settle();
    expect(calls).toBe(3);
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'].available).toBe(
      false,
    );
  });

  it.each(['single', 'all'] as const)(
    'refreshes workspace readiness after an explicit %s provider recheck',
    async (kind) => {
      backend.onRequest('providers.catalog', () => ({
        providers: [
          {
            id: 'claude-code',
            displayName: 'Claude',
            shortName: 'Claude',
            command: 'claude',
            canBeDisabled: false,
            visible: true,
          },
        ],
      }));
      let installed = false;
      backend.onRequest('host.findBinary', () => ({ available: installed }));
      ipc.invoke.mockImplementation(async (channel: string) => ({
        success: true,
        data:
          channel === 'providers:get-availability'
            ? { hiddenProviders: [], providers: {}, hasAnyProvider: true }
            : { available: installed },
      }));
      store.dispatch(workspaceMounted(WS));
      await settle();
      expect(selectContextModelProviderIds.select(store.state, WS)).toEqual([]);
      installed = true;
      store.dispatch(
        kind === 'single'
          ? checkSingleProviderRequested('claude-code')
          : checkAllProvidersRequested(),
      );
      await settle();
      expect(store.state.agentAvailability.providerStatusMap['claude-code'].available).toBe(true);
      store.dispatch(ensureWorkspaceCatalogRequested(WS));
      store.dispatch(ensureWorkspaceCatalogRequested(WS));
      await settle();
      expect(selectContextModelProviderIds.select(store.state, WS)).toEqual(['claude-code']);
      expect(probes()).toHaveLength(2);
      store.dispatch(ensureWorkspaceCatalogRequested(WS));
      await settle();
      expect(probes()).toHaveLength(2);
    },
  );

  it('does not refresh workspace catalogs for failed or superseded provider checks', async () => {
    store.dispatch(workspaceMounted(WS));
    await settle();
    ipc.invoke.mockRejectedValueOnce(new Error('provider probe failed'));
    store.dispatch(checkSingleProviderRequested('claude-code'));
    await settle();
    store.dispatch(ensureWorkspaceCatalogRequested(WS));
    await settle();
    expect(probes()).toHaveLength(1);
    let release!: (value: { success: boolean; data: { available: boolean } }) => void;
    const stale = new Promise((resolve) => {
      release = resolve;
    });
    ipc.invoke
      .mockReturnValueOnce(stale)
      .mockResolvedValueOnce({ success: true, data: { available: true } });
    store.dispatch(checkSingleProviderRequested('claude-code'));
    store.dispatch(checkSingleProviderRequested('claude-code'));
    await settle();
    expect(probes()).toHaveLength(2);
    release({ success: true, data: { available: false } });
    await settle();
    expect(probes()).toHaveLength(2);
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'].available).toBe(
      true,
    );
  });

  it('retains a provider recheck invalidation while a workspace catalog read is pending', async () => {
    let release!: (value: { available: boolean }) => void;
    const old = new Promise<{ available: boolean }>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    backend.onRequest('host.findBinary', () => (++calls === 1 ? old : { available: true }));
    store.dispatch(workspaceMounted(WS));
    await settle();
    ipc.invoke.mockResolvedValue({ success: true, data: { available: true } });
    store.dispatch(checkSingleProviderRequested('claude-code'));
    await settle();
    store.dispatch(ensureWorkspaceCatalogRequested(WS));
    release({ available: false });
    await settle();
    expect(probes()).toHaveLength(2);
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'].available).toBe(
      true,
    );
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
