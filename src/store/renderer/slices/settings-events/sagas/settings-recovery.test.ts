import { afterEach, beforeEach, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import {
  setProviderEnabled,
  loadEnabledProvidersFromStorage,
} from '../../provider-settings/provider-settings-slice';
import {
  setDefaultModel,
  hydrateSettings,
} from '../../background-agent-settings/background-agent-settings-slice';
import { setServers, setWorkspaceDisabledMcpServers } from '../../mcp-settings/mcp-settings-slice';
import {
  settingsFormOpened,
  settingsFormLoadRequested,
  settingsFormSaveRequested,
} from '../settings-events-slice';
import { hydrateDefaultProvider } from '../../model/model-slice';

beforeEach(() => {
  vi.clearAllMocks();
  retireSettingsWork(true);
  store.init();
});
afterEach(() => {
  for (const stop of [...cleanups]) stop();
  rendererEventRecovery.dispose();
  retireSettingsWork(true);
  store.dispose();
  vi.useRealTimers();
});

it('drops pending global edits before a recovery snapshot and preserves workspace MCP ownership', () => {
  store.dispatch(setProviderEnabled('codex', true));
  store.dispatch(setDefaultModel('old-local-edit'));
  store.dispatch(setWorkspaceDisabledMcpServers('ws', { scoped: true }));
  store.dispatch({ type: 'settings/recoveryInvalidated', payload: [] });
  store.dispatch(loadEnabledProvidersFromStorage({ codex: false }));
  store.dispatch(
    hydrateSettings({
      defaultModel: 'authoritative',
      typeOverrides: { commit: '', pr: '', review: '', fast: '' },
    }),
  );
  expect(store.state.providerSettings.enabledProviders).toEqual({ codex: false });
  expect(store.state.providerSettings.pendingEnablementOverrides).toEqual({});
  expect(store.state.backgroundAgentSettings.defaultModel).toBe('authoritative');
  expect(store.state.backgroundAgentSettings.persistencePending).toBeFalsy();
  expect(store.state.mcpSettings.byWorkspaceId.ws.disabledServers).toEqual({ scoped: true });
});

it('clears protected global mirrors and mounted forms when settings authority retires', () => {
  store.dispatch(hydrateDefaultProvider('private-provider'));
  store.dispatch(setProviderEnabled('private-provider', true));
  store.dispatch(setDefaultModel('private-model'));
  store.dispatch(setServers([{ id: 'secret', name: 'private-server', type: 'stdio' }]));
  store.dispatch(settingsFormOpened({ formId: 'secret', sessionId: 'one' }, 'agent-backend'));
  store.dispatch({ type: 'settings/authorityRetired', payload: [] });
  expect(store.state.model.defaultProviderId).toBe('');
  expect(store.state.providerSettings.enabledProviders).toEqual({});
  expect(store.state.backgroundAgentSettings.defaultModel).toBe('');
  expect(store.state.mcpSettings.servers).toEqual([]);
  expect(store.state.settingsEvents.forms.ids).toEqual([]);
});

import { vi } from 'vitest';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { installSettingsRecovery } from './settings-recovery';
const cleanups = new Set<() => void>();
function installTracked() {
  const dispose = installSettingsRecovery();
  const stop = () => {
    cleanups.delete(stop);
    dispose();
  };
  cleanups.add(stop);
  return stop;
}
import {
  captureSettingsWork,
  retireSettingsWork,
} from '$features/settings/settings-recovery-lifetime';

async function settle() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
}
function recoveryHarness() {
  let receive!: (notification: RecoveryNotification) => void;
  const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    if (method === 'events.subscribe')
      return {
        subscriptionId: 'global',
        ...((params as { lossRecovery?: number })?.lossRecovery === 1 ? { lossRecovery: 1 } : {}),
      };
    if (method === 'events.fence') return params;
    if (method === 'settings.list')
      return {
        revision: 10,
        settings: [
          { path: 'providers.enabled', value: { codex: false } },
          { path: 'model.defaultProvider', value: 'codex' },
          { path: 'quickActions.defaultModel', value: 'recovered' },
        ],
      };
    throw new Error(method);
  });
  const session = createEventRecoverySession({
    supported: true,
    isCurrent: () => true,
    onRetired: () => () => {},
    onNotification: (handler) => {
      receive = handler;
      return () => {};
    },
    request: async (method, params, observe) => {
      const result = await request(method, params);
      observe?.(result);
      return result;
    },
    dispose: () => {},
  });
  return { request, session, emit: (notification: RecoveryNotification) => receive(notification) };
}

it('recovers the lost final global settings event once and rejects earlier writes', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const stop = installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  store.dispatch(setProviderEnabled('codex', true));
  store.dispatch(setDefaultModel('pending'));
  const stale = captureSettingsWork();
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await settle();
  expect(store.state.providerSettings.enabledProviders).toEqual({ codex: false });
  expect(store.state.backgroundAgentSettings.defaultModel).toBe('recovered');
  expect(stale.isCurrent()).toBe(false);
  expect(h.request.mock.calls.map(([method]) => method)).toEqual([
    'events.subscribe',
    'events.fence',
    'settings.list',
    'events.fence',
  ]);
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await settle();
  expect(h.request).toHaveBeenCalledTimes(4);
  rendererEventRecovery.dispose();
  expect(store.state.model.defaultProviderId).toBe('');
  stop();
});

const formClient = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  getMcpServers: vi.fn(),
  getMcpServerStatuses: vi.fn(),
  toggleWorkspaceMcpServer: vi.fn(),
}));
vi.mock('$lib/client', () => ({ appClient: { settings: formClient } }));
import { settingsFormSaga } from './settings-form-saga';
import { principalIdentityChanged } from '../../principal/principal-slice';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';

it.each(['load', 'save'] as const)(
  'rejects a held form %s after principal replacement',
  async (operation) => {
    admitLegacyPrincipal();
    const h = recoveryHarness();
    const stop = installTracked();
    rendererEventRecovery.attach(h.session);
    const stopForms = store.runSaga(settingsFormSaga);
    const identity = { formId: 'form', sessionId: 'mounted' };
    const request = { ...identity, requestId: 'held', resource: 'load' };
    store.dispatch(settingsFormOpened(identity, 'workspace-api'));
    let resolve!: (value: unknown) => void;
    const held = new Promise((done) => {
      resolve = done;
    });
    if (operation === 'save') {
      formClient.list.mockResolvedValue([{ path: 'workspaceApi.toonOutput', value: true }]);
      store.dispatch(settingsFormLoadRequested({ ...request, requestId: 'initial' }));
      await settle();
      expect(getItem(store.state.settingsEvents.forms, 'form')?.loaded).toBe(true);
      formClient.update.mockReturnValue(held);
      store.dispatch(
        settingsFormSaveRequested({ ...request, resource: 'save' }, [
          { path: 'workspaceApi.toonOutput', value: false },
        ]),
      );
    } else {
      formClient.list.mockReturnValue(held);
      store.dispatch(settingsFormLoadRequested(request));
    }
    await settle();
    store.dispatch(principalIdentityChanged(store.state.principal.boundPrincipalId!));
    resolve([{ path: 'workspaceApi.toonOutput', value: false }]);
    await settle();
    expect(getItem(store.state.settingsEvents.forms, 'form')).toBeUndefined();
    stopForms();
    stop();
  },
);

it('keeps legacy push application without a recovery read', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const stop = installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: false });
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'model.defaultProvider', value: 'legacy' }] },
      },
    },
  });
  await settle();
  expect(store.state.model.defaultProviderId).toBe('legacy');
  expect(h.request.mock.calls).toEqual([
    ['events.subscribe', { eventTypes: ['settings:changed'] }],
  ]);
  stop();
});

it('clears protected values on the first canonical authority failure without retry', async () => {
  vi.useFakeTimers();
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const stop = installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  const normal = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'settings.list') throw { rpcCode: -32003, code: 'forbidden' };
    return normal(method, params);
  });
  store.dispatch(hydrateDefaultProvider('protected'));
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.request.mock.calls.filter(([method]) => method === 'settings.list')).toHaveLength(1);
  expect(store.state.model.defaultProviderId).toBe('');
  stop();
});

import { mcpSettingsSaga } from '../../mcp-settings/sagas/mcp-settings-saga';
import { loadServers } from '../../mcp-settings/mcp-settings-slice';

it('recovers MCP configuration and status while discarding a held ordinary load', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'mcp.servers.list')
      return {
        servers: [
          {
            id: 'fresh',
            name: 'fresh-server',
            transport: 'stdio',
            command: 'run',
            env: { SECRET: 'redacted' },
          },
        ],
      };
    if (method === 'mcp.servers.getStatus')
      return { status: { serverId: 'fresh', state: 'running' } };
    return normal(method, params);
  });
  const stop = installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['mcp.servers:status-changed'] }, { recover: true });
  let resolve!: (servers: unknown[]) => void;
  formClient.getMcpServers.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const stopMcp = store.runSaga(mcpSettingsSaga);
  store.dispatch(loadServers());
  await settle();
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await settle();
  expect(h.request.mock.calls.filter(([method]) => method === 'mcp.servers.list')).toHaveLength(0);
  resolve([{ id: 'old', name: 'old-server', type: 'stdio' }]);
  await settle();
  expect(store.state.mcpSettings.servers).toEqual([
    { id: 'fresh', name: 'fresh-server', type: 'stdio', command: 'run' },
  ]);
  expect(store.state.mcpSettings.statusMap).toEqual({ fresh: 'connected' });
  expect(h.request.mock.calls).toEqual([
    ['events.subscribe', { eventTypes: ['mcp.servers:status-changed'], lossRecovery: 1 }],
    ['events.fence', { subscriptionIds: ['global'] }],
    ['mcp.servers.list', undefined],
    ['mcp.servers.getStatus', { serverId: 'fresh' }],
    ['events.fence', { subscriptionIds: ['global'] }],
  ]);
  expect(store.state.mcpSettings.servers.map((server) => server.id)).toEqual(['fresh']);
  stopMcp();
  stop();
});

it('coalesces distinct losses during a held read into one trailing snapshot', async () => {
  vi.useFakeTimers();
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  let resolve!: (value: unknown) => void;
  const held = new Promise((done) => {
    resolve = done;
  });
  let reads = 0;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'settings.list' && ++reads === 1) return held;
    return normal(method, params);
  });
  const stop = installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  const loss = (generation: string) =>
    h.emit({
      method: 'events.lost',
      params: { subscriptionId: 'global', generation, scope: { workspaceId: null } },
    });
  loss('1');
  await settle();
  loss('2');
  loss('3');
  expect(h.request.mock.calls.filter(([method]) => method === 'settings.list')).toHaveLength(1);
  resolve({ revision: 1, settings: [{ path: 'model.defaultProvider', value: 'obsolete' }] });
  await vi.advanceTimersByTimeAsync(1000);
  expect(store.state.model.defaultProviderId).toBe('codex');
  expect(h.request.mock.calls.map(([method]) => method)).toEqual([
    'events.subscribe',
    'events.fence',
    'settings.list',
    'events.fence',
    'events.fence',
    'settings.list',
    'events.fence',
  ]);
  stop();
});

import { settingsHydrationSaga } from './settings-hydration-saga';
import { settingsChangesReceived } from '../settings-events-slice';

it('drops the pre-loss settings journal while its boot snapshot is held', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const scope = rendererEventRecovery.attach(h.session);
  let resolve!: (value: unknown[]) => void;
  formClient.list.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const stop = store.runSaga(settingsHydrationSaga);
  cleanups.add(stop);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  store.dispatch(
    settingsChangesReceived([{ path: 'model.defaultProvider', value: 'stale-journal' }], 1),
  );
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await settle();
  expect(h.request.mock.calls.filter(([method]) => method === 'settings.list')).toHaveLength(0);
  resolve([{ path: 'model.defaultProvider', value: 'stale-boot' }]);
  await settle();
  expect(store.state.model.defaultProviderId).toBe('codex');
  expect(formClient.list).toHaveBeenCalledTimes(1);
  expect(h.request.mock.calls.filter(([method]) => method === 'settings.list')).toHaveLength(1);
});

it('recovers mounted catalog and value-based forms without another form read', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) =>
    method === 'settings.list'
      ? {
          revision: 10,
          settings: [
            { path: 'agents.maxConcurrent', value: 7, min: 1, max: 20 },
            { path: 'rtk.enabled', value: true },
            { path: 'server.wsApi.enabled', value: false },
            { path: 'server.wsApi.port', value: 5555 },
          ],
        }
      : normal(method, params),
  );
  for (const kind of ['agent-backend', 'rtk', 'websocket-api'] as const)
    store.dispatch(settingsFormOpened({ formId: kind, sessionId: 'mounted' }, kind));
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await settle();
  const forms = store.state.settingsEvents.forms;
  expect(getItem(getItem(forms, 'agent-backend')!.entries, 'agents.maxConcurrent')).toMatchObject({
    value: 7,
    min: 1,
    max: 20,
  });
  expect(getItem(forms, 'rtk')?.values).toMatchObject({ enabled: true, settingKnown: true });
  expect(getItem(forms, 'websocket-api')?.values).toMatchObject({
    enabled: false,
    persistedPort: 5555,
  });
  expect(h.request.mock.calls.filter(([method]) => method === 'settings.list')).toHaveLength(1);
});

it.each(['load', 'save'] as const)(
  'settles a %s requested while settings admission is suspended',
  async (resource) => {
    const identity = { formId: 'form', sessionId: 'one' };
    store.dispatch(settingsFormOpened(identity, 'agent-backend'));
    const stop = store.runSaga(settingsFormSaga);
    cleanups.add(stop);
    retireSettingsWork(false);
    const request = { ...identity, resource, requestId: 'request' };
    store.dispatch(
      resource === 'load'
        ? settingsFormLoadRequested(request)
        : settingsFormSaveRequested(request, [{ path: 'agents.maxConcurrent', value: 2 }]),
    );
    await settle();
    const form = getItem(store.state.settingsEvents.forms, identity.formId)!;
    expect(getItem(form.operations, resource)?.status).toBe('cancelled');
  },
);

import { workspaceCatalogReceived } from '../../provider-catalog/provider-catalog-slice';
import { toggleWorkspaceMcpServer } from '../../mcp-settings/mcp-settings-slice';

it('invalidates a post-loss workspace MCP toggle before writing the protected mirror', async () => {
  vi.useFakeTimers();
  const ws = 'workspace-mcp';
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) =>
    method === 'mcp.servers.list' ? { servers: [] } : normal(method, params),
  );
  const scope = rendererEventRecovery.attach(h.session);
  scope.registerResource({
    key: `workspace-catalog:${JSON.stringify([ws])}`,
    workspaceId: ws,
    eventTypes: ['mcp.servers:status-changed'],
    isCurrent: () => true,
    read: ({ request }) => request('mcp.servers.list', { workspaceId: ws }),
    apply: () => {
      store.dispatch(setWorkspaceDisabledMcpServers(ws, {}));
    },
    invalidate: () => {},
    retire: () => {},
  });
  store.dispatch(
    workspaceCatalogReceived(
      ws,
      {
        catalog: { providers: [] },
        readiness: {},
        settings: [],
        specialists: [],
        mcpServers: [{ id: 'server', name: 'tools', type: 'stdio' }],
      },
      0,
    ),
  );
  await scope.subscribe(
    { workspaceId: ws, eventTypes: ['mcp.servers:status-changed'] },
    { recover: true },
  );
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: ws } },
  });
  await settle();
  expect(store.state.mcpSettings.byWorkspaceId[ws].disabledServers).toEqual({});
  formClient.toggleWorkspaceMcpServer.mockResolvedValue({ success: true, workspaceDisabled: true });
  cleanups.add(store.runSaga(mcpSettingsSaga));
  store.dispatch(toggleWorkspaceMcpServer(ws, 'server', false));
  await settle();
  expect(formClient.toggleWorkspaceMcpServer).toHaveBeenCalledTimes(1);
  expect(store.state.mcpSettings.byWorkspaceId[ws].disabledServers).toEqual({});
  await vi.advanceTimersByTimeAsync(250);
  expect(h.request.mock.calls.filter(([method]) => method === 'mcp.servers.list')).toHaveLength(2);
  expect(h.request.mock.calls.filter(([method]) => method === 'events.fence')).toHaveLength(4);
});

const settingsTransport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: settingsTransport.request,
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));
import { LiveSettingsClient as RealSettingsClient } from '$lib/client/live/live-settings-client';

it('MCP recovery drains held siblings before retrying', async () => {
  vi.useFakeTimers();
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  let release!: (value: unknown) => void;
  const held = new Promise((done) => {
    release = done;
  });
  h.request.mockImplementation(async (method, params) => {
    if (method === 'mcp.servers.list')
      return {
        servers: [
          { id: 'one', name: 'one', transport: 'stdio', command: 'x' },
          { id: 'two', name: 'two', transport: 'stdio', command: 'y' },
        ],
      };
    if (method === 'mcp.servers.getStatus') {
      if ((params as { serverId: string }).serverId === 'one') throw new Error('temporary');
      return held;
    }
    return normal(method, params);
  });
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['mcp.servers:status-changed'] }, { recover: true });
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.request.mock.calls.filter(([method]) => method === 'mcp.servers.list')).toHaveLength(
      1,
    );
    expect(
      h.request.mock.calls.filter(
        ([method, params]) =>
          method === 'mcp.servers.getStatus' && (params as { serverId: string }).serverId === 'two',
      ),
    ).toHaveLength(1);
  } finally {
    release({ status: { state: 'running' } });
    await settle();
  }
});

it('late canonical MCP sibling failure retires protected state', async () => {
  vi.useFakeTimers();
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  let reject!: (reason: unknown) => void;
  const held = new Promise((_done, fail) => {
    reject = fail;
  });
  h.request.mockImplementation(async (method, params) => {
    if (method === 'mcp.servers.list')
      return {
        servers: [
          { id: 'one', name: 'one', transport: 'stdio', command: 'x' },
          { id: 'two', name: 'two', transport: 'stdio', command: 'y' },
        ],
      };
    if (method === 'mcp.servers.getStatus') {
      if ((params as { serverId: string }).serverId === 'one') throw new Error('temporary');
      return held;
    }
    return normal(method, params);
  });
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['mcp.servers:status-changed'] }, { recover: true });
  store.dispatch(setServers([{ id: 'private', name: 'private', type: 'stdio' }]));
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await settle();
  reject({ rpcCode: -32003, data: { code: 'forbidden' } });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(store.state.mcpSettings.servers).toEqual([]);
  expect(h.request.mock.calls.filter(([method]) => method === 'mcp.servers.list')).toHaveLength(1);
});

it('global recovery waits for an ordinary real settings.get', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  let release!: (value: unknown) => void;
  const held = new Promise((done) => {
    release = done;
  });
  settingsTransport.request.mockReturnValueOnce(held);
  const client = new RealSettingsClient();
  const pending = client.get('model.defaultProvider');
  await settle();
  expect(settingsTransport.request).toHaveBeenCalledWith('settings.get', {
    path: 'model.defaultProvider',
  });
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  try {
    await settle();
    expect(h.request.mock.calls.filter(([method]) => method === 'settings.list')).toHaveLength(0);
  } finally {
    release({ definition: { path: 'model.defaultProvider' }, value: 'old' });
    await pending;
    await settle();
  }
});

it('canonical initial hydration failure clears protected mirrors and does not retry', async () => {
  vi.useFakeTimers();
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  settingsTransport.request
    .mockReset()
    .mockRejectedValue({ rpcCode: -32003, data: { code: 'forbidden' } });
  const client = new RealSettingsClient();
  formClient.list.mockImplementation(() => client.list());
  store.dispatch(hydrateDefaultProvider('private'));
  const stop = store.runSaga(settingsHydrationSaga);
  cleanups.add(stop);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(store.state.model.defaultProviderId).toBe('');
  expect(
    settingsTransport.request.mock.calls.filter(([method]) => method === 'settings.list'),
  ).toHaveLength(1);
});

it('unrelated ordinary push cannot strand an initial form read', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  const stop = store.runSaga(settingsFormSaga);
  cleanups.add(stop);
  const identity = { formId: 'initial-form', sessionId: 'one' };
  let release!: (value: unknown) => void;
  formClient.list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  store.dispatch(settingsFormOpened(identity, 'workspace-api'));
  store.dispatch(
    settingsFormLoadRequested({ ...identity, requestId: 'initial', resource: 'load' }),
  );
  await settle();
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'providers.enabled', value: { codex: true } }] },
      },
    },
  });
  release([{ path: 'workspaceApi.toonOutput', value: false }]);
  await settle();
  expect(getItem(store.state.settingsEvents.forms, identity.formId)?.loaded).toBe(true);
  expect(
    getItem(
      getItem(store.state.settingsEvents.forms, identity.formId)!.entries,
      'workspaceApi.toonOutput',
    )?.value,
  ).toBe(false);
});

it('related ordinary push wins over a held initial form snapshot', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  const stop = store.runSaga(settingsFormSaga);
  cleanups.add(stop);
  const identity = { formId: 'initial-form', sessionId: 'one' };
  let release!: (value: unknown) => void;
  formClient.list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  store.dispatch(settingsFormOpened(identity, 'workspace-api'));
  store.dispatch(
    settingsFormLoadRequested({ ...identity, requestId: 'initial', resource: 'load' }),
  );
  await settle();
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'workspaceApi.toonOutput', value: true }] },
      },
    },
  });
  release([{ path: 'workspaceApi.toonOutput', value: false }]);
  await settle();
  expect(getItem(store.state.settingsEvents.forms, identity.formId)?.loaded).toBe(true);
  expect(
    getItem(
      getItem(store.state.settingsEvents.forms, identity.formId)!.entries,
      'workspaceApi.toonOutput',
    )?.value,
  ).toBe(true);
});

it('partial push does not admit a save before form hydration', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  const stop = store.runSaga(settingsFormSaga);
  cleanups.add(stop);
  const identity = { formId: 'partial-form', sessionId: 'one' };
  let release!: (value: unknown) => void;
  const held = new Promise((done) => {
    release = done;
  });
  formClient.get.mockReturnValue(held);
  formClient.update.mockResolvedValue([{ path: 'agents.maxConcurrent', value: 2 }]);
  store.dispatch(settingsFormOpened(identity, 'agent-backend'));
  store.dispatch(
    settingsFormLoadRequested({ ...identity, requestId: 'initial', resource: 'load' }),
  );
  await settle();
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'agents.memoryBudgetMb', value: 1024 }] },
      },
    },
  });
  store.dispatch(
    settingsFormSaveRequested(
      { ...identity, requestId: 'early', resource: 'agents.maxConcurrent' },
      [{ path: 'agents.maxConcurrent', value: 2 }],
    ),
  );
  try {
    await settle();
    expect(formClient.update).not.toHaveBeenCalled();
  } finally {
    release({ path: 'agents.maxConcurrent', value: 3 });
    await settle();
  }
});

it('irrelevant domain events and valid settings pushes add no reads', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed', 'agent:updated'] }, { recover: true });
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: { type: 'agent:updated', workspaceId: 'ws', data: { id: 'a' } },
    },
  });
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'model.defaultProvider', value: 'ordinary' }] },
      },
    },
  });
  await settle();
  expect(store.state.model.defaultProviderId).toBe('ordinary');
  expect(h.request.mock.calls.map(([method]) => method)).toEqual(['events.subscribe']);
});

const settingsIpc = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$shared/generated/ipc-client', () => ({ invoke: settingsIpc.request }));
import { rtkSettingsSaga as recoveryRtkSaga } from '../../rtk-settings/sagas/rtk-settings-saga';
import { rtkSettingsRequested as recoveryRtkRequested } from '../../rtk-settings/rtk-settings-slice';

it('held RTK availability cannot replay an older setting over an admitted push', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  const stop = store.runSaga(recoveryRtkSaga);
  cleanups.add(stop);
  const identity = { formId: 'rtk-held', sessionId: 'one' };
  let release!: (value: unknown) => void;
  formClient.get.mockResolvedValue({ path: 'rtk.enabled', value: false });
  settingsIpc.request.mockImplementation(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  store.dispatch(settingsFormOpened(identity, 'rtk'));
  store.dispatch(
    recoveryRtkRequested({ ...identity, requestId: 'initial', resource: 'load' }, { kind: 'load' }),
  );
  await settle();
  expect(settingsIpc.request).toHaveBeenCalledTimes(1);
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'rtk.enabled', value: true }] },
      },
    },
  });
  expect(getItem(store.state.settingsEvents.forms, identity.formId)?.values.enabled).toBe(true);
  release({ data: { available: true } });
  await settle();
  expect(getItem(store.state.settingsEvents.forms, identity.formId)?.values.enabled).toBe(true);
});

import { websocketApiSaga as recoveryApiSaga } from '../../websocket-api/sagas/websocket-api-saga';
import { websocketApiRequested as recoveryApiRequested } from '../../websocket-api/websocket-api-slice';
import { selfPublicationRequested as recoveryPublication } from '../../connections/connections-slice';
import { takeEvery as recoveryTakeEvery, put as recoveryPut } from 'typed-redux-saga';

it('held websocket pairing cannot replay older form values over an admitted push', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  let release!: (value: unknown) => void;
  const pairingInfo = vi.fn(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const { appClient } = await import('$lib/client');
  (appClient as unknown as { server: unknown }).server = { pairingInfo };
  const stop = store.runSaga(recoveryApiSaga);
  cleanups.add(stop);
  const stopPublication = store.runSaga(function* () {
    yield* recoveryTakeEvery(recoveryPublication, function* (action) {
      yield* recoveryPut(action.success(undefined));
    });
  });
  cleanups.add(stopPublication);
  const identity = { formId: 'api-held', sessionId: 'one' };
  formClient.list.mockResolvedValue([
    { path: 'server.wsApi.enabled', value: true },
    { path: 'server.wsApi.port', value: 5000 },
  ]);
  store.dispatch(settingsFormOpened(identity, 'websocket-api'));
  store.dispatch(
    recoveryApiRequested(
      { ...identity, requestId: 'initial', resource: 'load' },
      { kind: 'load', connectionId: 'local' },
    ),
  );
  await settle();
  expect(pairingInfo).toHaveBeenCalledTimes(1);
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'server.wsApi.port', value: 6000 }] },
      },
    },
  });
  expect(getItem(store.state.settingsEvents.forms, identity.formId)?.values.persistedPort).toBe(
    6000,
  );
  release({ token: 'synthetic', port: 5000, localIps: [], certFingerprint: '' });
  await settle();
  expect(getItem(store.state.settingsEvents.forms, identity.formId)?.values.persistedPort).toBe(
    6000,
  );
});

it('MCP-only loss does not restart unrelated global settings hydration', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) =>
    method === 'mcp.servers.list' ? { servers: [] } : normal(method, params),
  );
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['mcp.servers:status-changed'] }, { recover: true });
  formClient.list.mockResolvedValue([{ path: 'model.defaultProvider', value: 'codex' }]);
  const stop = store.runSaga(settingsHydrationSaga);
  cleanups.add(stop);
  await settle();
  expect(formClient.list).toHaveBeenCalledTimes(1);
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await settle();
  expect(formClient.list).toHaveBeenCalledTimes(1);
});

it('preserves canonical authority failure in a trailing real settings snapshot', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  let release!: (value: unknown) => void;
  settingsTransport.request.mockReset().mockImplementationOnce(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const client = new RealSettingsClient();
  const initial = client.listSnapshot();
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'model.defaultProvider', value: 'new' }] },
      },
    },
  });
  await settle();
  const denied = { rpcCode: -32003, data: { code: 'forbidden' } };
  settingsTransport.request.mockRejectedValueOnce(denied);
  const trailing = client.listSnapshot();
  const rejection = expect(trailing).rejects.toBe(denied);
  release({ settings: [{ path: 'model.defaultProvider', value: 'old' }], revision: 1 });
  await initial;
  await rejection;
  expect(settingsTransport.request).toHaveBeenCalledTimes(2);
  expect(store.state.model.defaultProviderId).toBe('');
});

it('canonical ordinary real settings.get retires protected mirrors', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  settingsTransport.request
    .mockReset()
    .mockRejectedValue({ rpcCode: -32003, data: { code: 'forbidden' } });
  store.dispatch(hydrateDefaultProvider('private'));
  const client = new RealSettingsClient();
  await client.get('model.defaultProvider');
  expect(store.state.model.defaultProviderId).toBe('');
  expect(captureSettingsWork().isCurrent()).toBe(false);
});

it('canonical held MCP denial after timeout still retires protected state', async () => {
  vi.useFakeTimers();
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  let reject!: (reason: unknown) => void;
  const held = new Promise((_done, fail) => {
    reject = fail;
  });
  h.request.mockImplementation(async (method, params) => {
    if (method === 'mcp.servers.list')
      return {
        servers: [
          { id: 'one', name: 'one', transport: 'stdio', command: 'x' },
          { id: 'two', name: 'two', transport: 'stdio', command: 'y' },
        ],
      };
    if (method === 'mcp.servers.getStatus') {
      if ((params as { serverId: string }).serverId === 'one') throw new Error('temporary');
      return held;
    }
    return normal(method, params);
  });
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['mcp.servers:status-changed'] }, { recover: true });
  store.dispatch(setServers([{ id: 'private', name: 'private', type: 'stdio' }]));
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await vi.advanceTimersByTimeAsync(35_000);
  reject({ rpcCode: -32003, data: { code: 'forbidden' } });
  await settle();
  expect(store.state.mcpSettings.servers).toEqual([]);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.request.mock.calls.filter(([method]) => method === 'mcp.servers.list')).toHaveLength(1);
});

it('global authority retirement also fences an already-held MCP snapshot', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  let release!: (value: unknown) => void;
  const held = new Promise((done) => {
    release = done;
  });
  h.request.mockImplementation(async (method, params) => {
    if (method === 'settings.list') throw { rpcCode: -32003, data: { code: 'forbidden' } };
    if (method === 'mcp.servers.list') return held;
    if (method === 'mcp.servers.getStatus') return { status: { state: 'running' } };
    return normal(method, params);
  });
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe(
    { eventTypes: ['settings:changed', 'mcp.servers:status-changed'] },
    { recover: true },
  );
  store.dispatch(hydrateDefaultProvider('private'));
  store.dispatch(setServers([{ id: 'private', name: 'private', type: 'stdio' }]));
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await settle();
  expect(store.state.model.defaultProviderId).toBe('');
  expect(store.state.mcpSettings.servers).toEqual([]);
  release({ servers: [{ id: 'old-scope', name: 'old-scope', transport: 'stdio', command: 'x' }] });
  await settle();
  expect(store.state.mcpSettings.servers).toEqual([]);
  expect(
    h.request.mock.calls.filter(([method]) => method === 'mcp.servers.getStatus'),
  ).toHaveLength(0);
});

it('unrelated push does not strand RTK initial hydration', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  const stop = store.runSaga(recoveryRtkSaga);
  cleanups.add(stop);
  const identity = { formId: 'rtk-unrelated', sessionId: 'one' };
  let release!: (value: unknown) => void;
  formClient.get.mockResolvedValue({ path: 'rtk.enabled', value: false });
  settingsIpc.request.mockImplementation(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  store.dispatch(settingsFormOpened(identity, 'rtk'));
  store.dispatch(
    recoveryRtkRequested({ ...identity, requestId: 'initial', resource: 'load' }, { kind: 'load' }),
  );
  await settle();
  expect(settingsIpc.request).toHaveBeenCalledTimes(1);
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'providers.enabled', value: { codex: true } }] },
      },
    },
  });
  release({ data: { available: true } });
  await settle();
  expect(getItem(store.state.settingsEvents.forms, identity.formId)?.values.loaded).toBe(true);
  expect(getItem(store.state.settingsEvents.forms, identity.formId)?.values.enabled).toBe(false);
  expect(formClient.get).toHaveBeenCalledTimes(1);
});

it('unrelated push does not strand websocket initial hydration', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  let release!: (value: unknown) => void;
  const pairingInfo = vi.fn(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const { appClient } = await import('$lib/client');
  (appClient as unknown as { server: unknown }).server = { pairingInfo };
  cleanups.add(store.runSaga(recoveryApiSaga));
  cleanups.add(
    store.runSaga(function* () {
      yield* recoveryTakeEvery(recoveryPublication, function* (action) {
        yield* recoveryPut(action.success(undefined));
      });
    }),
  );
  const identity = { formId: 'api-unrelated', sessionId: 'one' };
  formClient.list.mockResolvedValue([
    { path: 'server.wsApi.enabled', value: true },
    { path: 'server.wsApi.port', value: 5000 },
  ]);
  store.dispatch(settingsFormOpened(identity, 'websocket-api'));
  store.dispatch(
    recoveryApiRequested(
      { ...identity, requestId: 'initial', resource: 'load' },
      { kind: 'load', connectionId: 'local' },
    ),
  );
  await settle();
  expect(pairingInfo).toHaveBeenCalledTimes(1);
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'providers.enabled', value: { codex: true } }] },
      },
    },
  });
  release({ enabled: true, port: 5000, token: 'synthetic', localIps: [], certFingerprint: '' });
  await settle();
  expect(getItem(store.state.settingsEvents.forms, identity.formId)?.loaded).toBe(true);
  expect(getItem(store.state.settingsEvents.forms, identity.formId)?.values.persistedPort).toBe(
    5000,
  );
  expect(formClient.list).toHaveBeenCalledTimes(1);
});

it('a late ordinary denial cannot retire replacement settings authority', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  rendererEventRecovery.attach(h.session);
  let reject!: (reason: unknown) => void;
  settingsTransport.request.mockReset().mockImplementationOnce(
    () =>
      new Promise((_done, fail) => {
        reject = fail;
      }),
  );
  const pending = new RealSettingsClient().get('model.defaultProvider');
  rendererEventRecovery.attach(recoveryHarness().session);
  store.dispatch(hydrateDefaultProvider('replacement'));
  reject({ rpcCode: -32003, data: { code: 'forbidden' } });
  await pending;
  expect(store.state.model.defaultProviderId).toBe('replacement');
  expect(captureSettingsWork().isCurrent()).toBe(true);
});

it('late timed-out MCP denial cannot clear replacement authority', async () => {
  vi.useFakeTimers();
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  let reject!: (reason: unknown) => void;
  const held = new Promise((_done, fail) => {
    reject = fail;
  });
  h.request.mockImplementation(async (method, params) => {
    if (method === 'mcp.servers.list')
      return {
        servers: [
          { id: 'one', name: 'one', transport: 'stdio', command: 'x' },
          { id: 'two', name: 'two', transport: 'stdio', command: 'y' },
        ],
      };
    if (method === 'mcp.servers.getStatus') {
      if ((params as { serverId: string }).serverId === 'one') throw new Error('temporary');
      return held;
    }
    return normal(method, params);
  });
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['mcp.servers:status-changed'] }, { recover: true });
  store.dispatch(setServers([{ id: 'private', name: 'private', type: 'stdio' }]));
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await vi.advanceTimersByTimeAsync(35_000);
  rendererEventRecovery.attach(recoveryHarness().session);
  store.dispatch(setServers([{ id: 'replacement', name: 'replacement', type: 'stdio' }]));
  reject({ rpcCode: -32003, data: { code: 'forbidden' } });
  await settle();
  expect(store.state.mcpSettings.servers.map((server) => server.id)).toEqual(['replacement']);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.request.mock.calls.filter(([method]) => method === 'mcp.servers.list')).toHaveLength(1);
});

import { setVolume as recoverySetVolume } from '../../user-preferences/user-preferences-slice';

it('recovered notification volume replaces pending pre-loss edit', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) =>
    method === 'settings.list'
      ? { revision: 10, settings: [{ path: 'notifications.volume', value: 0.4 }] }
      : normal(method, params),
  );
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  formClient.list.mockResolvedValue([{ path: 'notifications.volume', value: 0.2 }]);
  cleanups.add(store.runSaga(settingsHydrationSaga));
  await settle();
  expect(store.state.userPreferences.volume).toBe(0.2);
  store.dispatch(recoverySetVolume(0.9));
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await settle();
  expect(store.state.userPreferences.volume).toBe(0.4);
  expect(store.state.userPreferences.pendingNotificationVolumeEditId).toBeNull();
});

it('settings authority retirement clears protected notification volume and journal', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'settings.list') throw { rpcCode: -32003, data: { code: 'forbidden' } };
    return normal(method, params);
  });
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  const initialVolume = store.state.userPreferences.volume;
  formClient.list.mockResolvedValue([{ path: 'notifications.volume', value: 0.2 }]);
  cleanups.add(store.runSaga(settingsHydrationSaga));
  await settle();
  expect(store.state.userPreferences.volume).toBe(0.2);
  store.dispatch(recoverySetVolume(0.9));
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await settle();
  expect(captureSettingsWork().isCurrent()).toBe(false);
  expect(store.state.userPreferences.volume).toBe(initialVolume);
  expect(store.state.userPreferences.pendingNotificationVolumeEditId).toBeNull();
});

it('known canonical MCP denial clears protected state before unrelated held sibling settles', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const normal = h.request.getMockImplementation()!;
  let release!: (value: unknown) => void;
  const held = new Promise((done) => {
    release = done;
  });
  h.request.mockImplementation(async (method, params) => {
    if (method === 'mcp.servers.list')
      return {
        servers: [
          { id: 'denied', name: 'denied', transport: 'stdio', command: 'x' },
          { id: 'held', name: 'held', transport: 'stdio', command: 'y' },
        ],
      };
    if (method === 'mcp.servers.getStatus') {
      if ((params as { serverId: string }).serverId === 'denied')
        throw { rpcCode: -32003, data: { code: 'forbidden' } };
      return held;
    }
    return normal(method, params);
  });
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['mcp.servers:status-changed'] }, { recover: true });
  store.dispatch(setServers([{ id: 'private', name: 'private', type: 'stdio' }]));
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  try {
    await settle();
    expect(store.state.mcpSettings.servers).toEqual([]);
    expect(h.request.mock.calls.filter(([method]) => method === 'mcp.servers.list')).toHaveLength(
      1,
    );
  } finally {
    release({ status: { state: 'running' } });
    await settle();
  }
});

import { persistNotificationSettingsWorker as recoveryPersistNotificationSettingsWorker } from '../../user-preferences/sagas/notification-settings-saga';

it('unrelated settings push preserves a pending notification save debounce', async () => {
  vi.useFakeTimers();
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  settingsTransport.request.mockReset().mockResolvedValue({ revision: 20, applied: [] });
  store.dispatch(recoverySetVolume(0.9));
  cleanups.add(store.runSaga(recoveryPersistNotificationSettingsWorker));
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'providers.enabled', value: { codex: true } }] },
      },
    },
  });
  await vi.advanceTimersByTimeAsync(100);
  await settle();
  expect(
    settingsTransport.request.mock.calls.filter(([method]) => method === 'settings.update'),
  ).toHaveLength(1);
  expect(store.state.userPreferences.pendingNotificationVolumeEditId).toBeNull();
});

it('unrelated settings push cannot strand a held notification save journal', async () => {
  vi.useFakeTimers();
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  let release!: (value: unknown) => void;
  const held = new Promise((done) => {
    release = done;
  });
  settingsTransport.request.mockReset().mockReturnValue(held);
  store.dispatch(recoverySetVolume(0.9));
  cleanups.add(store.runSaga(recoveryPersistNotificationSettingsWorker));
  await vi.advanceTimersByTimeAsync(100);
  expect(
    settingsTransport.request.mock.calls.filter(([method]) => method === 'settings.update'),
  ).toHaveLength(1);
  h.emit({
    method: 'events.event',
    params: {
      subscriptionId: 'global',
      event: {
        type: 'settings:changed',
        data: { revision: 4, changes: [{ path: 'providers.enabled', value: { codex: true } }] },
      },
    },
  });
  await settle();
  release({ revision: 20, applied: [] });
  await settle();
  expect(store.state.userPreferences.pendingNotificationVolumeEditId).toBeNull();
  expect(store.state.userPreferences.volume).toBe(0.9);
});

import { hydrateNotificationSettingsWorker as recoveryHydrateNotificationSettingsWorker } from '../../user-preferences/sagas/notification-settings-saga';

it.each([false, true])(
  'notification initial hydration preserves unrelated push=%s',
  async (sendPush) => {
    admitLegacyPrincipal();
    const h = recoveryHarness();
    installTracked();
    const scope = rendererEventRecovery.attach(h.session);
    await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    settingsTransport.request.mockReset().mockImplementation(async (method, params) => {
      if (method !== 'settings.get') throw new Error(method);
      await held;
      return {
        definition: { path: params.path },
        value: params.path === 'notifications.soundOnlyWhenUnfocused',
      };
    });
    cleanups.add(store.runSaga(recoveryHydrateNotificationSettingsWorker));
    await settle();
    expect(
      settingsTransport.request.mock.calls.filter(([method]) => method === 'settings.get'),
    ).toHaveLength(3);
    if (sendPush)
      h.emit({
        method: 'events.event',
        params: {
          subscriptionId: 'global',
          event: {
            type: 'settings:changed',
            data: { revision: 4, changes: [{ path: 'providers.enabled', value: { codex: true } }] },
          },
        },
      });
    await settle();
    release();
    await settle();
    expect(store.state.userPreferences.enabled).toBe(false);
    expect(store.state.userPreferences.soundEnabled).toBe(false);
    expect(store.state.userPreferences.soundOnlyWhenUnfocused).toBe(true);
  },
);

import { setSoundEnabled as recoverySetSoundEnabled } from '../../user-preferences/user-preferences-slice';

it.each(['newer edit', 'newer daemon revision'] as const)(
  'notification save settlement preserves %s',
  async (mode) => {
    vi.useFakeTimers();
    admitLegacyPrincipal();
    const h = recoveryHarness();
    installTracked();
    const scope = rendererEventRecovery.attach(h.session);
    await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
    let release!: (value: unknown) => void;
    settingsTransport.request.mockReset().mockReturnValue(
      new Promise((done) => {
        release = done;
      }),
    );
    store.dispatch(recoverySetVolume(0.9));
    cleanups.add(store.runSaga(recoveryPersistNotificationSettingsWorker));
    await vi.advanceTimersByTimeAsync(100);
    expect(settingsTransport.request).toHaveBeenCalledTimes(1);
    if (mode === 'newer edit') store.dispatch(recoverySetVolume(0.6));
    else
      h.emit({
        method: 'events.event',
        params: {
          subscriptionId: 'global',
          event: {
            type: 'settings:changed',
            data: { revision: 30, changes: [{ path: 'notifications.volume', value: 0.4 }] },
          },
        },
      });
    await settle();
    const editId = store.state.userPreferences.pendingNotificationVolumeEditId;
    release({ revision: 20, applied: [] });
    await settle();
    expect(store.state.userPreferences.volume).toBe(mode === 'newer edit' ? 0.6 : 0.4);
    expect(store.state.userPreferences.pendingNotificationVolumeEditId).toBe(
      mode === 'newer edit' ? editId : null,
    );
    expect(settingsTransport.request).toHaveBeenCalledTimes(1);
  },
);

it('notification hydration preserves a newer local field edit', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  settingsTransport.request.mockReset().mockImplementation(async (_method, params) => {
    await held;
    return { definition: { path: params.path }, value: true };
  });
  cleanups.add(store.runSaga(recoveryHydrateNotificationSettingsWorker));
  await settle();
  store.dispatch(recoverySetSoundEnabled(false));
  release();
  await settle();
  expect(store.state.userPreferences.soundEnabled).toBe(false);
  expect(settingsTransport.request).toHaveBeenCalledTimes(3);
});

it.each([
  [4, 0.9],
  [30, 0.4],
])(
  'notification save orders daemon revision %s against acknowledged revision 20',
  async (revision, expected) => {
    vi.useFakeTimers();
    admitLegacyPrincipal();
    const h = recoveryHarness();
    installTracked();
    const scope = rendererEventRecovery.attach(h.session);
    await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
    let release!: (value: unknown) => void;
    const held = new Promise((done) => {
      release = done;
    });
    settingsTransport.request.mockReset().mockReturnValue(held);
    store.dispatch(recoverySetVolume(0.9));
    cleanups.add(store.runSaga(recoveryPersistNotificationSettingsWorker));
    await vi.advanceTimersByTimeAsync(100);
    expect(
      settingsTransport.request.mock.calls.filter(([method]) => method === 'settings.update'),
    ).toHaveLength(1);
    h.emit({
      method: 'events.event',
      params: {
        subscriptionId: 'global',
        event: {
          type: 'settings:changed',
          data: { revision, changes: [{ path: 'notifications.volume', value: 0.4 }] },
        },
      },
    });
    await settle();
    release({ revision: 20, applied: [{ path: 'notifications.volume', value: 0.9 }] });
    await settle();
    expect(store.state.userPreferences.volume).toBe(expected);
    expect(store.state.userPreferences.pendingNotificationVolumeEditId).toBeNull();
  },
);

it('notification hydration preserves a local field edit that returns to its initial value', async () => {
  admitLegacyPrincipal();
  const h = recoveryHarness();
  installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  settingsTransport.request.mockReset().mockImplementation(async (_method, params) => {
    await held;
    return { definition: { path: params.path }, value: false };
  });
  expect(store.state.userPreferences.soundEnabled).toBe(true);
  cleanups.add(store.runSaga(recoveryHydrateNotificationSettingsWorker));
  await settle();
  store.dispatch(recoverySetSoundEnabled(false));
  store.dispatch(recoverySetSoundEnabled(true));
  release();
  await settle();
  expect(store.state.userPreferences.soundEnabled).toBe(true);
});
