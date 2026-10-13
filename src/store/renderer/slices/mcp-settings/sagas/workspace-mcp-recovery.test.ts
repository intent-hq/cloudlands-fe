import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { backendRequest } from '$lib/client/live/backend-transport';
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../../test/mocks/backend-transport.mock';
import { workspaceCatalogSaga } from '../../provider-catalog/workspace-catalog-saga';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { toggleWorkspaceMcpServer } from '../mcp-settings-slice';
import { mcpSettingsSaga } from './mcp-settings-saga';
import { retireSettingsWork } from '$features/settings/settings-recovery-lifetime';

vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);

const ws = 'workspace-mcp-receipts';
let backend: MockBackendHandle;
let stopCatalog: () => void;
let stopMcp: () => void;
let receive: (notification: RecoveryNotification) => void;
const settle = () => vi.advanceTimersByTimeAsync(0);
const lists = () => backend.requests.filter((r) => r.method === 'mcp.servers.list');
const lose = () =>
  receive({
    method: 'events.lost',
    params: { subscriptionId: 'catalog', generation: '1', scope: { workspaceId: null } },
  });
const disabled = () =>
  store.state.providerCatalog.byWorkspaceId?.[ws]?.mcpServers?.[0]?.workspaceDisabled;

beforeEach(async () => {
  vi.useFakeTimers();
  retireSettingsWork(true);
  resetMockBackend();
  backend = installMockBackend();
  backend.onRequest('providers.catalog', () => ({ providers: [] }));
  backend.onRequest('settings.list', () => ({ settings: [] }));
  backend.onRequest('specialist.list', () => ({ specialists: [] }));
  backend.onRequest('host.providerDiscovery', () => ({ providers: [] }));
  backend.onRequest('host.providerAuthStatus', () => ({ providers: [] }));
  backend.onRequest('mcp.servers.list', () => ({
    servers: [
      { id: 'server', name: 'tools', transport: 'stdio', command: 'run', workspaceDisabled: false },
    ],
  }));
  backend.onRequest('mcp.servers.getStatus', () => ({
    status: { serverId: 'server', state: 'running' },
  }));
  backend.onRequest('mcp.servers.toggle', () => ({ workspaceDisabled: true }));
  store.init();
  stopCatalog = store.runSaga(workspaceCatalogSaga);
  stopMcp = store.runSaga(mcpSettingsSaga);
  const session = createEventRecoverySession({
    supported: true,
    isCurrent: () => true,
    onNotification: (handler) => {
      receive = handler;
      return () => {};
    },
    onRetired: () => () => {},
    dispose: () => {},
    request: async (method, params, observe) => {
      const result =
        method === 'events.subscribe'
          ? { subscriptionId: 'catalog', lossRecovery: 1 }
          : method === 'events.fence'
            ? params
            : await backendRequest(method, params);
      observe?.(result);
      return result;
    },
  });
  const scope = rendererEventRecovery.attach(session);
  await scope.subscribe(
    {
      eventTypes: [
        'settings:changed',
        'specialists:changed',
        'mcp.servers:status-changed',
        'workspace:updated',
      ],
    },
    { recover: true },
  );
  store.dispatch(workspaceMounted(ws));
  await settle();
  expect(lists()).toHaveLength(1);
});
afterEach(() => {
  stopMcp();
  stopCatalog();
  rendererEventRecovery.dispose();
  store.dispose();
  resetMockBackend();
  retireSettingsWork(true);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('shares one admitted valid toggle across the actual command, catalog, and mirror owners', async () => {
  const push = vi.spyOn(rendererEventRecovery, 'push');
  store.dispatch(toggleWorkspaceMcpServer(ws, 'server', false));
  await settle();
  expect(disabled()).toBe(true);
  expect(store.state.mcpSettings.byWorkspaceId[ws].disabledServers).toEqual({ server: true });
  expect(push).toHaveBeenCalledTimes(1);
  expect(lists()).toHaveLength(1);
});

it.each(['recovery', 'retirement'] as const)(
  'drops a command reply held across %s in both real owners',
  async (transition) => {
    let release!: (value: unknown) => void;
    backend.onRequest(
      'mcp.servers.toggle',
      () =>
        new Promise((done) => {
          release = done;
        }),
    );
    store.dispatch(toggleWorkspaceMcpServer(ws, 'server', false));
    await settle();
    if (transition === 'recovery') lose();
    else store.dispatch(workspaceUnmounted(ws));
    await settle();
    release({ workspaceDisabled: true });
    await settle();
    if (transition === 'recovery') {
      expect(disabled()).toBe(false);
      expect(store.state.mcpSettings.byWorkspaceId[ws].disabledServers).toEqual({});
      expect(lists()).toHaveLength(2);
    } else {
      expect(store.state.providerCatalog.byWorkspaceId?.[ws]).toBeUndefined();
      expect(store.state.mcpSettings.byWorkspaceId[ws]).toBeUndefined();
      expect(lists()).toHaveLength(1);
    }
  },
);

it('reconciles a new post-loss command through one snapshot before either mirror can change', async () => {
  lose();
  await settle();
  store.dispatch(toggleWorkspaceMcpServer(ws, 'server', false));
  await settle();
  expect(disabled()).toBe(false);
  expect(store.state.mcpSettings.byWorkspaceId[ws].disabledServers).toEqual({});
  await vi.advanceTimersByTimeAsync(250);
  expect(disabled()).toBe(false);
  expect(lists()).toHaveLength(3);
});
