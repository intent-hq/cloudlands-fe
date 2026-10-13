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

it('stops after three failed recovery attempts even when more loss markers arrive', async () => {
  vi.useFakeTimers();
  admitLegacyPrincipal();
  const h = recoveryHarness();
  const stop = installTracked();
  const scope = rendererEventRecovery.attach(h.session);
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  const normal = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'settings.list') throw new Error('offline');
    return normal(method, params);
  });
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.request.mock.calls.filter(([method]) => method === 'settings.list')).toHaveLength(3);
  h.emit({
    method: 'events.lost',
    params: { subscriptionId: 'global', generation: '2', scope: { workspaceId: null } },
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.request.mock.calls.filter(([method]) => method === 'settings.list')).toHaveLength(3);
  stop();
  rendererEventRecovery.dispose();
  vi.useRealTimers();
});

const formClient = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  getMcpServers: vi.fn(),
  getMcpServerStatuses: vi.fn(),
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
