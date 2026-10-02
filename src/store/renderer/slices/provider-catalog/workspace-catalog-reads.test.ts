import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetProviderAuthStatusForTests } from '$features/providers/provider-auth-status.client';
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
import {
  selectContextModelProviderIds,
  selectContextQuotaRetryProviderIds,
} from './workspace-catalog-selectors';
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
  const probes = () => backend.requests.filter((r) => r.method === 'host.providerDiscovery');
  beforeEach(() => {
    vi.useFakeTimers();
    ipc.invoke.mockReset();
    resetMockBackend();
    __resetProviderAuthStatusForTests();
    backend = installMockBackend();
    backend.onRequest('providers.catalog', () => ({ providers: [] }));
    backend.onRequest('settings.list', () => ({ settings: [] }));
    backend.onRequest('specialist.list', () => ({ specialists: [] }));
    backend.onRequest('host.providerDiscovery', () => ({
      providers: [{ id: 'claude-code', installed: true }],
    }));
    backend.onRequest('host.providerAuthStatus', () => ({ providers: [] }));
    backend.onRequest('mcp.servers.list', () => ({ servers: [] }));
    backend.onRequest('host.findBinary', () => {
      throw new Error('Workspace catalogs must not probe binaries');
    });
    dispose = store.init();
    cancel = store.runSaga(workspaceCatalogSaga);
    cancelAvailability = store.runSaga(providerAvailabilitySaga);
  });
  afterEach(() => {
    const binaryRequests = backend.requests.filter((r) => r.method === 'host.findBinary');
    cancelAvailability();
    cancel();
    dispose();
    resetMockBackend();
    vi.useRealTimers();
    expect(binaryRequests).toEqual([]);
  });
  it.each([
    {
      name: 'npx launch',
      row: { id: 'claude-code', installed: true, resolvedPath: '/bin/npx' },
      available: true,
    },
    {
      name: 'adapter override without npx',
      row: { id: 'claude-code', installed: true, resolvedPath: null },
      available: true,
    },
    { name: 'absent', row: { id: 'claude-code', installed: false }, available: false },
    {
      name: 'gated',
      row: { id: 'claude-code', installed: true, gatedOff: 'disabled' },
      available: false,
    },
    { name: 'missing row', row: undefined, available: false },
  ])('uses discovery for $name', async ({ row, available }) => {
    backend.onRequest('host.providerDiscovery', () => ({ providers: row ? [row] : [] }));
    store.dispatch(workspaceMounted(WS));
    await settle();
    expect(
      store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code']?.available ?? false,
    ).toBe(available);
    expect(probes()).toEqual([{ method: 'host.providerDiscovery', params: { workspaceId: WS } }]);
  });

  it('retains accepted readiness after discovery fails and retries on demand', async () => {
    store.dispatch(workspaceMounted(WS));
    await settle();
    backend.onRequest('host.providerDiscovery', () => {
      throw new Error('discovery down');
    });
    store.dispatch(workspaceCatalogRequested(WS));
    await settle();
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'].available).toBe(
      true,
    );
    backend.onRequest('host.providerDiscovery', () => ({ providers: [] }));
    store.dispatch(ensureWorkspaceCatalogRequested(WS));
    await settle();
    expect(
      store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'],
    ).toBeUndefined();
  });

  it.each([true, false, null])(
    'keeps Claude auth %s separate from discovery readiness',
    async (authenticated) => {
      backend.onRequest('providers.catalog', () => ({
        providers: [
          {
            id: 'claude-code',
            displayName: 'Claude',
            shortName: 'Claude',
            command: 'npx',
            canBeDisabled: false,
            visible: true,
          },
        ],
      }));
      backend.onRequest('host.providerAuthStatus', () => ({
        providers: [{ id: 'claude-code', authenticated }],
      }));
      store.dispatch(workspaceMounted(WS));
      await settle();
      expect(
        store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'],
      ).toMatchObject({ available: true });
      expect(
        store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'].authenticated,
      ).toBe(authenticated ?? undefined);
      expect(selectContextQuotaRetryProviderIds.select(store.state, 'codex', WS)).toEqual(
        authenticated === false ? [] : ['claude-code'],
      );
    },
  );

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
    expect(probes()[2].params).toEqual({ workspaceId: 'another-workspace' });
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
      backend.onRequest('host.providerDiscovery', () => ({
        providers: [{ id: 'claude-code', installed: false }],
      }));
      store.dispatch(ensureWorkspaceCatalogRequested(WS));
      await settle();
      expect(
        store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'].available,
      ).toBe(false);
      expect(probes()).toHaveLength(3);
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
    backend.onRequest('host.providerDiscovery', () => ({
      providers: [{ id: 'claude-code', installed: false }],
    }));
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
      backend.onRequest('host.providerDiscovery', () => ({
        providers: [{ id: 'claude-code', installed }],
      }));
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
    let release!: (value: { providers: { id: string; installed: boolean }[] }) => void;
    const old = new Promise<{ providers: { id: string; installed: boolean }[] }>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    backend.onRequest('host.providerDiscovery', () =>
      ++calls === 1 ? old : { providers: [{ id: 'claude-code', installed: true }] },
    );
    store.dispatch(workspaceMounted(WS));
    await settle();
    ipc.invoke.mockResolvedValue({ success: true, data: { available: true } });
    store.dispatch(checkSingleProviderRequested('claude-code'));
    await settle();
    store.dispatch(ensureWorkspaceCatalogRequested(WS));
    release({ providers: [{ id: 'claude-code', installed: false }] });
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
    expect(probes()).toEqual([{ method: 'host.providerDiscovery', params: { workspaceId: WS } }]);
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
