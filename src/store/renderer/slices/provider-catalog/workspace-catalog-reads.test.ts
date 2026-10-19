import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import McpServersSection from '$lib/components/workspace/sidebar/McpServersSection.svelte';
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
import { onBackendNotification } from '$lib/client/live/backend-transport';
import { workspaceCatalogEventReceived } from './provider-catalog-slice';
import type { WorkspaceEvent } from '$features/events/types';
import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';
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
  let offEvents: () => void;
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
    offEvents = onBackendNotification(({ method, params }) => {
      if (method === 'events.event')
        store.dispatch(workspaceCatalogEventReceived((params as { event: WorkspaceEvent }).event));
    });
    cancelAvailability = store.runSaga(providerAvailabilitySaga);
  });
  afterEach(() => {
    const binaryRequests = backend.requests.filter((r) => r.method === 'host.findBinary');
    cleanup();
    offEvents();
    cancelAvailability();
    cancel();
    dispose();
    resetMockBackend();
    vi.useRealTimers();
    expect(binaryRequests).toEqual([]);
  });
  it('shares lifecycle and sidebar mount demand without a second MCP list', async () => {
    let release!: (value: { providers: [] }) => void;
    backend.onRequest(
      'providers.catalog',
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    backend.onRequest('mcp.servers.list', () => ({
      servers: [
        { id: 'server', name: 'tools', transport: 'stdio', enabled: true, workspaceDisabled: true },
      ],
    }));
    backend.onRequest('mcp.servers.getStatus', () => ({
      status: { serverId: 'server', state: 'stopped' },
    }));
    store.dispatch(workspaceMounted(WS));
    const options = {
      props: { workspaceId: WS },
      context: new Map([['redux-store-context', { store, dispose }]]),
    };
    render(McpServersSection, options);
    render(McpServersSection, options);
    await settle();
    release({ providers: [] });
    await settle();
    expect(backend.requests.filter((request) => request.method === 'mcp.servers.list')).toEqual([
      { method: 'mcp.servers.list', params: { workspaceId: WS } },
    ]);
    expect(probes()).toHaveLength(1);
    expect(store.state.mcpSettings.byWorkspaceId[WS].disabledServers).toEqual({ server: true });
    cleanup();
    render(McpServersSection, options);
    await settle();
    expect(probes()).toHaveLength(1);
  });

  it('applies settings and MCP status pushes during slow hydration without re-reading catalogs', async () => {
    let release!: (value: { providers: [] }) => void;
    backend.onRequest(
      'providers.catalog',
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    backend.onRequest('settings.list', () => ({
      settings: [{ path: 'model.defaultProvider', value: 'old', origin: 'default' }],
    }));
    backend.onRequest('mcp.servers.list', () => ({
      servers: [
        {
          id: 'server',
          name: 'tools',
          transport: 'stdio',
          enabled: true,
          workspaceDisabled: false,
        },
      ],
    }));
    backend.onRequest('mcp.servers.getStatus', () => ({
      status: { serverId: 'server', state: 'starting' },
    }));
    store.dispatch(workspaceMounted(WS));
    await settle();
    backend.pushEvent({
      type: 'settings:changed',
      workspaceId: '',
      data: {
        changes: [{ path: 'model.defaultProvider', value: 'codex', origin: 'file' }],
        revision: 1,
      },
    });
    backend.pushEvent({
      type: 'mcp.servers:status-changed',
      workspaceId: '',
      data: { serverId: 'server', status: { serverId: 'server', state: 'running' } },
    });
    backend.pushEvent({
      type: 'workspace:updated',
      workspaceId: WS,
      data: {
        workspaceId: WS,
        changes: { mcpServerToggled: { serverId: 'server', workspaceDisabled: true } },
      },
    });
    release({ providers: [] });
    await settle();
    expect(probes()).toHaveLength(1);
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].settings[0]).toMatchObject({
      value: 'codex',
      origin: 'file',
    });
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].mcpStatuses).toEqual([
      { serverId: 'server', state: 'running' },
    ]);
    expect(store.state.mcpSettings.byWorkspaceId[WS].disabledServers).toEqual({ server: true });
  });

  it('refreshes only scoped specialist definitions and ignores duplicate deliveries', async () => {
    store.dispatch(workspaceMounted(WS));
    store.dispatch(workspaceMounted('other'));
    await settle();
    backend.requests.length = 0;
    backend.onRequest('specialist.list', () => ({
      specialists: [{ id: 'new-role', name: 'New role', description: '', source: 'project' }],
    }));
    const event = {
      type: 'specialists:changed',
      workspaceId: WS,
      data: { workspaceId: WS },
      id: 'same-change',
    };
    backend.pushEvent(event);
    backend.pushEvent(event);
    await settle();
    expect(backend.requests).toEqual([
      { method: 'specialist.list', params: { workspaceId: WS, includeProject: true } },
    ]);
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].specialists[0].id).toBe('new-role');
    expect(store.state.providerCatalog.byWorkspaceId?.other.specialists).toEqual([]);
  });

  it('updates complete global settings and scoped toggles without any reads after hydration', async () => {
    backend.onRequest('settings.list', () => ({
      settings: [{ path: 'model.defaultProvider', value: 'codex', origin: 'default' }],
    }));
    backend.onRequest('mcp.servers.list', ({ workspaceId }: { workspaceId: string }) => ({
      servers: [
        {
          id: 'server',
          name: 'tools',
          transport: 'stdio',
          enabled: true,
          workspaceDisabled: workspaceId === 'other',
        },
      ],
    }));
    backend.onRequest('mcp.servers.getStatus', () => ({
      status: { serverId: 'server', state: 'running' },
    }));
    store.dispatch(workspaceMounted(WS));
    store.dispatch(workspaceMounted('other'));
    await settle();
    backend.requests.length = 0;
    backend.pushEvent({
      type: 'settings:changed',
      workspaceId: '',
      data: {
        changes: [{ path: 'model.defaultProvider', value: 'claude-code', origin: 'file' }],
        revision: 3,
      },
    });
    backend.pushEvent({
      type: 'workspace:updated',
      workspaceId: WS,
      data: { changes: { mcpServerToggled: { serverId: 'server', workspaceDisabled: true } } },
    });
    backend.pushEvent({
      type: 'mcp.servers:status-changed',
      workspaceId: WS,
      data: {
        serverId: 'server',
        status: { serverId: 'server', state: 'error', lastError: 'offline' },
      },
    });
    await settle();
    expect(backend.requests).toEqual([]);
    expect(store.state.providerCatalog.workspaceEpoch ?? 0).toBe(0);
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].settings[0]).toMatchObject({
      value: 'claude-code',
      origin: 'file',
    });
    expect(store.state.providerCatalog.byWorkspaceId?.other.settings[0].value).toBe('claude-code');
    expect(store.state.mcpSettings.byWorkspaceId[WS].disabledServers).toEqual({ server: true });
    expect(store.state.mcpSettings.byWorkspaceId.other.disabledServers).toEqual({ server: true });
    expect(store.state.providerCatalog.byWorkspaceId?.other.mcpStatuses).toEqual([
      { serverId: 'server', state: 'running' },
    ]);
    backend.pushEvent({
      type: 'mcp.servers:status-changed',
      workspaceId: WS,
      data: { serverId: 'server', status: { serverId: 'server', state: 'running' } },
    });
    await settle();
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].mcpStatuses).toEqual([
      { serverId: 'server', state: 'running' },
    ]);
    expect(backend.requests).toEqual([]);
  });

  it('reads only redacted MCP configuration and new statuses while retaining other catalogs', async () => {
    backend.onRequest('settings.list', () => ({
      settings: [{ path: 'mcp.servers', value: '********' }],
    }));
    store.dispatch(workspaceMounted(WS));
    await settle();
    backend.requests.length = 0;
    backend.onRequest('mcp.servers.list', () => ({
      servers: [
        {
          id: 'new-server',
          name: 'new',
          transport: 'http',
          url: 'https://example.test/mcp',
          enabled: true,
          workspaceDisabled: true,
        },
      ],
    }));
    backend.onRequest('mcp.servers.getStatus', () => ({
      status: { serverId: 'new-server', state: 'running' },
    }));
    backend.pushEvent({
      type: 'settings:changed',
      workspaceId: '',
      data: { changes: [{ path: 'mcp.servers', value: '********' }], revision: 3 },
    });
    await settle();
    expect(backend.requests).toEqual([
      { method: 'mcp.servers.list', params: { workspaceId: WS } },
      { method: 'mcp.servers.getStatus', params: { workspaceId: WS, serverId: 'new-server' } },
    ]);
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].mcpServers?.[0]).toMatchObject({
      id: 'new-server',
      workspaceDisabled: true,
    });
    expect(store.state.mcpSettings.byWorkspaceId[WS].disabledServers).toEqual({
      'new-server': true,
    });
  });

  it.each(['reconnect', 'identity'] as const)(
    'abandons old reads on %s and preserves pushes on the replacement read',
    async (kind) => {
      let releaseOld!: (value: { providers: [] }) => void;
      backend.onRequest(
        'providers.catalog',
        () =>
          new Promise((resolve) => {
            releaseOld = resolve;
          }),
      );
      store.dispatch(workspaceMounted(WS));
      await settle();
      backend.onRequest('providers.catalog', () => ({ providers: [] }));
      backend.onRequest('settings.list', () => ({
        settings: [{ path: 'model.defaultProvider', value: 'new-daemon' }],
      }));
      if (kind === 'reconnect') backend.triggerReconnect();
      else store.dispatch(hostExecutionConnectionChanged('new-principal'));
      await settle();
      expect(probes()).toHaveLength(2);
      expect(store.state.providerCatalog.byWorkspaceId?.[WS].settings[0].value).toBe('new-daemon');
      backend.pushEvent({
        type: 'settings:changed',
        workspaceId: '',
        data: { changes: [{ path: 'model.defaultProvider', value: 'pushed' }], revision: 1 },
      });
      releaseOld({ providers: [] });
      await settle();
      expect(store.state.providerCatalog.byWorkspaceId?.[WS].settings[0].value).toBe('pushed');
      expect(probes()).toHaveLength(2);
    },
  );

  it('retains every resource invalidation queued behind a slow specialist read', async () => {
    backend.onRequest('settings.list', () => ({
      settings: [{ path: 'mcp.servers', value: '********' }],
    }));
    store.dispatch(workspaceMounted(WS));
    await settle();
    backend.requests.length = 0;
    let release!: (value: { specialists: [] }) => void;
    backend.onRequest(
      'specialist.list',
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    backend.pushEvent({ type: 'specialists:changed', workspaceId: WS, data: { workspaceId: WS } });
    await settle();
    backend.pushEvent({
      type: 'settings:changed',
      workspaceId: '',
      data: { changes: [{ path: 'mcp.servers', value: '********' }], revision: 4 },
    });
    backend.pushEvent({ type: 'skills:changed', workspaceId: WS, data: { workspaceId: WS } });
    backend.onRequest('specialist.list', () => ({
      specialists: [{ id: 'new-role', name: 'New role', source: 'project', description: '' }],
      importDiagnostics: [],
    }));
    release({ specialists: [] });
    await settle();
    expect(backend.requests.map((request) => request.method).sort()).toEqual([
      'mcp.servers.list',
      'specialist.list',
      'specialist.list',
    ]);
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].specialists[0].id).toBe('new-role');
    expect(store.state.providerCatalog.byWorkspaceId?.[WS].importDiagnostics).toEqual([]);
  });

  it('does not resurrect an unmounted workspace from a slow read or a scoped event', async () => {
    let release!: (value: { providers: [] }) => void;
    backend.onRequest(
      'providers.catalog',
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    store.dispatch(workspaceMounted(WS));
    await settle();
    store.dispatch(workspaceUnmounted(WS));
    backend.pushEvent({ type: 'specialists:changed', workspaceId: WS, data: { workspaceId: WS } });
    release({ providers: [] });
    await settle();
    expect(store.state.providerCatalog.byWorkspaceId?.[WS]).toBeUndefined();
    expect(probes()).toHaveLength(1);
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
    backend.pushEvent({ type: 'settings:changed', workspaceId: '', data: {} });
    await settle();
    expect(probes()).toHaveLength(3);
  });

  it.each(['explicit'] as const)(
    'retries stale cached readiness on mount after a failed %s refresh',
    async () => {
      store.dispatch(workspaceMounted(WS));
      await settle();
      expect(
        store.state.providerCatalog.byWorkspaceId?.[WS].readiness['claude-code'].available,
      ).toBe(true);
      backend.onRequest('providers.catalog', () => {
        throw new Error('temporary failure');
      });
      store.dispatch(workspaceCatalogRequested(WS));
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
