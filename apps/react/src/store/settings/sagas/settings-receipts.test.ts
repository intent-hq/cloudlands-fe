// Real configured React Store, settings client/owner and admitted event router.
// Only transport delivery and notifications are controlled; no application root starts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeEvery } from 'typed-redux-saga';
import type { GenericAction } from '@themislib/themis/types';
import type {
  BackendNotification,
  BackendRequestOptions,
  BackendTransport,
} from '$lib/client/live/backend-transport-types';
import { BackendError } from '$lib/client/live/backend-transport-types';
import type {
  AppSettingChange,
  SettingsSnapshot,
  SettingsUpdateResult,
  SettingDefinitionWithValue,
} from '$lib/client/settings-types';
import { store } from '../../index';
import { settingsSaga } from './settings-saga';
import { daemonEventsSaga } from '../../workspace-events/sagas/daemon-events-saga';
import { settingsRuntime } from '../../../features/settings/settings-client';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { selectModelSelectionState } from '../../model/model-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../../src/test/fixtures/admitted-legacy-principal';
import { connectionsListReceived } from '../../../../../../src/store/renderer/slices/connections/connections-slice';
import { connectionStatusChanged } from '../../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import {
  principalContextChanged,
  principalReceived,
} from '../../../../../../src/store/renderer/slices/principal/principal-slice';
import { hostExecutionConnectionChanged } from '../../../../../../src/store/renderer/slices/host-execution/host-execution-slice';
import { setDefaultReasoningEffort } from '../../../../../../src/store/renderer/slices/model/model-slice';
import { setAtomicDefaultModel } from '../../../../../../src/store/renderer/slices/provider-settings/provider-settings-slice';
import {
  settingsChangesReceived,
  settingsFieldsRefreshRequested,
} from '../../../../../../src/store/renderer/slices/settings-events/settings-events-slice';

const wire = vi.hoisted(() => ({
  request:
    vi.fn<
      (method: string, params?: unknown, options?: BackendRequestOptions) => Promise<unknown>
    >(),
  notifications: new Set<(notification: BackendNotification) => void>(),
  reconnects: new Set<() => void>(),
}));
vi.mock('../../../features/backend/backend-transport', () => {
  const backendRequest: BackendTransport['request'] = async <T = unknown>(
    ...args: Parameters<BackendTransport['request']>
  ): Promise<T> => (await wire.request(...args)) as T;
  const backendSubscribe: BackendTransport['subscribe'] = async <T>(params: unknown): Promise<T> =>
    backendRequest<T>('events.subscribe', params);
  const backendUnsubscribe: BackendTransport['unsubscribe'] = async (
    subscriptionId,
    workspaceId,
  ) => {
    await backendRequest('events.unsubscribe', {
      subscriptionId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
  };
  const onBackendNotification: BackendTransport['onNotification'] = (listener) => {
    wire.notifications.add(listener);
    return () => {
      wire.notifications.delete(listener);
    };
  };
  const onBackendReconnected: BackendTransport['onReconnected'] = (listener) => {
    wire.reconnects.add(listener);
    return () => {
      wire.reconnects.delete(listener);
    };
  };
  return {
    backendRequest,
    onBackendNotification,
    onBackendReconnected,
    backend: {
      backendRequest,
      backendSubscribe,
      backendUnsubscribe,
      onBackendNotification,
      onBackendReconnected,
    },
  };
});
vi.mock('../../../components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

const eventTypes = [
  'git:clone:progress',
  'git:clone:done',
  'settings:changed',
  'host:members-changed',
  'host:invites-changed',
  'host:execution-context-changed',
  'principal:identity-changed',
  'workspace:updated',
  'workspace:created',
  'workspace:deleted',
  'agent:*',
];
const emptyBackground = {
  defaultModel: '',
  typeOverrides: { commit: '', pr: '', review: '', fast: '' },
  defaultReasoningEffort: '',
  typeReasoningEffortOverrides: {},
};
const initialDisplay = {
  provider: 'grok',
  models: { grok: 'grok-old', codex: 'codex-old' },
  effort: 'low',
};
function setting(
  path: string,
  value: unknown,
  type: SettingDefinitionWithValue['type'],
): SettingDefinitionWithValue {
  return {
    path,
    value,
    type,
    label: path,
    description: 'Settings receipt fixture',
    category: 'model',
    origin: 'file',
  };
}
function initialSnapshot(): SettingsSnapshot {
  return {
    revision: 7,
    settings: [
      setting('model.defaultProvider', 'grok', 'string'),
      setting('model.providerDefaults', { grok: 'grok-old', codex: 'codex-old' }, 'object'),
      setting('model.defaultReasoningEffort', 'low', 'string'),
      setting('quickActions.defaultModel', '', 'string'),
      setting('quickActions.typeOverrides', { commit: '', pr: '', review: '', fast: '' }, 'object'),
      setting('quickActions.defaultReasoningEffort', '', 'string'),
      setting('quickActions.typeReasoningEffortOverrides', {}, 'object'),
      setting('quickActions.providerSettings', {}, 'object'),
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const settle = async () => {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
};
const cleanups: Array<() => Promise<void>> = [];

beforeEach(() => {
  wire.request.mockReset();
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function harness() {
  const dispose = store.init();
  const runtimeErrors: unknown[] = [];
  const recordError = (error: unknown) => {
    runtimeErrors.push(error);
  };
  store.traceStreams.runtimeError.onValue(recordError);
  let snapshot = initialSnapshot();
  let leaseNumber = 0;
  let eventNumber = 0;
  let pendingRead: ReturnType<typeof deferred<SettingsSnapshot>> | undefined;
  const writes: Array<ReturnType<typeof deferred<SettingsUpdateResult>>> = [];
  const actions: GenericAction[] = [];
  const stops: Array<() => void> = [];
  let stopEvents: (() => void) | undefined;
  wire.request.mockImplementation(async (method) => {
    if (method === 'events.subscribe') return { subscriptionId: `settings-lease-${++leaseNumber}` };
    if (method === 'events.unsubscribe') return { success: true };
    if (method === 'settings.list') {
      if (pendingRead) {
        const read = pendingRead;
        pendingRead = undefined;
        return read.promise;
      }
      return structuredClone(snapshot);
    }
    if (method === 'settings.update') {
      const pending = deferred<SettingsUpdateResult>();
      writes.push(pending);
      return pending.promise;
    }
    throw new Error(`Unexpected settings test request: ${method}`);
  });
  cleanups.push(async () => {
    for (const stop of stops.splice(0).reverse()) stop();
    stopEvents?.();
    await settle();
    settingsRuntime.dispose();
    dispose();
    store.traceStreams.runtimeError.offValue(recordError);
    expect(runtimeErrors).toEqual([]);
    expect(wire.notifications.size).toBe(0);
    expect(wire.reconnects.size).toBe(0);
    expect(wire.request.mock.calls.filter(([method]) => method === 'events.unsubscribe')).toEqual(
      Array.from({ length: leaseNumber }, (_, index) => [
        'events.unsubscribe',
        { subscriptionId: `settings-lease-${index + 1}` },
      ]),
    );
  });
  settingsRuntime.start();
  stops.push(
    store.runSaga(function* observeSettingsReceipts() {
      yield* takeEvery(
        [settingsChangesReceived, settingsFieldsRefreshRequested],
        (action: GenericAction) => {
          actions.push(action);
        },
      );
    }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  const startEvents = async () => {
    stopEvents = store.runSaga(daemonEventsSaga);
    await vi.waitFor(() => expect(store.state.workspaceEvents.subscriptionPending).toBe(false));
  };
  await startEvents();

  const admit = (role: 'owner' | 'guest', backendId: string) => {
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: backendId, windowBackendId: backendId }),
    );
    const context = selectPrincipalConnectionContext.select(store.state);
    expect(context).not.toBeNull();
    if (context === null)
      throw new Error('Receipt test requires an acknowledged event subscription');
    const { principal } = createAdmittedLegacyPrincipal(
      {
        connections: { activeId: backendId, windowBackendId: backendId },
        daemonHealth: { connectionGeneration: store.state.daemonHealth.connectionGeneration },
        workspaceEvents: {
          subscriptionGeneration: store.state.workspaceEvents.subscriptionGeneration,
        },
      },
      role,
    );
    expect(principal.context).toBe(context);
    if (principal.snapshot === null) throw new Error('Receipt test requires a principal snapshot');
    store.dispatch(principalContextChanged(context));
    store.dispatch(hostExecutionConnectionChanged(context));
    store.dispatch(
      principalReceived({ context, invalidation: 0, presentationVersion: 0 }, principal.snapshot),
    );
    return context;
  };
  const connection = admit('owner', 'local');
  stops.push(store.runSaga(settingsSaga));
  await vi.waitFor(() => expect(displayed()).toEqual(initialDisplay));
  expect(wire.request.mock.calls).toEqual([
    ['events.subscribe', { eventTypes }],
    ['settings.list'],
  ]);
  return {
    actions,
    connection,
    lease: () => `settings-lease-${leaseNumber}`,
    replaceSnapshot: (next: SettingsSnapshot) => {
      snapshot = structuredClone(next);
    },
    holdNextRead() {
      if (pendingRead) throw new Error('A settings read is already held');
      pendingRead = deferred<SettingsSnapshot>();
      return pendingRead;
    },
    async write(index: number) {
      await vi.waitFor(() => expect(writes).toHaveLength(index + 1));
      return writes[index];
    },
    emit(receipt: SettingsUpdateResult, subscriptionId = `settings-lease-${leaseNumber}`) {
      const notification: BackendNotification = {
        method: 'events.event',
        params: {
          subscriptionId,
          event: {
            id: `settings-event-${++eventNumber}`,
            type: 'settings:changed',
            actor: { type: 'system' },
            timestamp: '2026-10-12T00:00:00.000Z',
            data: { changes: receipt.applied, revision: receipt.revision },
          },
        },
      };
      for (const listener of [...wire.notifications]) listener(notification);
    },
    revoke() {
      const principal = store.state.principal;
      if (!principal.context || !principal.snapshot) throw new Error('Expected admitted principal');
      store.dispatch(
        principalReceived(
          {
            context: principal.context,
            invalidation: principal.invalidation,
            presentationVersion: principal.presentationVersion,
          },
          {
            ...principal.snapshot,
            principal: { ...principal.snapshot.principal, isAdministrator: false },
          },
        ),
      );
    },
    async switchHost() {
      store.dispatch(connectionStatusChanged('disconnected'));
      stopEvents?.();
      await settle();
      settingsRuntime.resetSettingsConnectionCache();
      store.dispatch(connectionStatusChanged('connected'));
      await startEvents();
      return admit('owner', 'remote');
    },
  };
}
function displayed() {
  const state = selectModelSelectionState.select(store.state);
  return {
    provider: state.defaultProviderId,
    models: state.providerModels,
    effort: state.defaultReasoningEffort,
  };
}

const atomicChanges: AppSettingChange[] = [
  { path: 'model.defaultProvider', value: 'codex' },
  { path: 'model.providerDefaults', value: { grok: 'grok-old', codex: 'codex-new' } },
  { path: 'quickActions.defaultModel', value: '' },
  { path: 'quickActions.typeOverrides', value: { commit: '', pr: '', review: '', fast: '' } },
  { path: 'quickActions.defaultReasoningEffort', value: '' },
  { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
  { path: 'quickActions.providerSettings', value: { grok: emptyBackground } },
];
const atomicReceipt: SettingsUpdateResult = {
  revision: 8,
  applied: [
    { path: 'model.defaultProvider', value: 'codex', origin: 'file' },
    {
      path: 'model.providerDefaults',
      value: { grok: 'grok-old', codex: 'codex-new' },
      origin: 'file',
    },
    { path: 'quickActions.providerSettings', value: { grok: emptyBackground }, origin: 'file' },
  ],
};
const effortReceipt: SettingsUpdateResult = {
  revision: 8,
  applied: [{ path: 'model.defaultReasoningEffort', value: 'high', origin: 'file' }],
};
const scenarios = [
  {
    name: 'atomic provider and model',
    intent: () => setAtomicDefaultModel({ providerId: 'codex', model: 'codex-new' }),
    changes: atomicChanges,
    receipt: atomicReceipt,
    expected: {
      provider: 'codex',
      models: { grok: 'grok-old', codex: 'codex-new' },
      effort: 'low',
    },
    listCalls: 2,
  },
  {
    name: 'reasoning effort',
    intent: () => setDefaultReasoningEffort('high'),
    changes: [{ path: 'model.defaultReasoningEffort', value: 'high' }],
    receipt: effortReceipt,
    expected: {
      provider: 'grok',
      models: { grok: 'grok-old', codex: 'codex-old' },
      effort: 'high',
    },
    listCalls: 1,
  },
] as const;

describe('React model receipts through the admitted daemon event router', () => {
  for (const scenario of scenarios) {
    for (const order of ['ack-before-event', 'event-before-ack'] as const) {
      it(`${scenario.name}: ${order} hydrates only admitted daemon receipts`, async () => {
        const h = await harness();
        store.dispatch(scenario.intent());
        const pending = await h.write(0);
        expect(wire.request.mock.calls).toEqual([
          ['events.subscribe', { eventTypes }],
          ...Array.from({ length: scenario.listCalls }, () => ['settings.list']),
          ['settings.update', { changes: scenario.changes }],
        ]);
        expect(displayed()).toEqual(initialDisplay);
        expect(h.actions.filter(({ type }) => type === settingsChangesReceived.toString())).toEqual(
          [],
        );
        if (order === 'event-before-ack') {
          h.emit(scenario.receipt);
          await vi.waitFor(() => expect(displayed()).toEqual(scenario.expected));
        }
        pending.resolve(structuredClone(scenario.receipt));
        await settle();
        expect(displayed()).toEqual(
          order === 'event-before-ack' ? scenario.expected : initialDisplay,
        );
        if (order === 'ack-before-event') {
          expect(
            h.actions.filter(({ type }) => type === settingsChangesReceived.toString()),
          ).toEqual([]);
          h.emit(scenario.receipt);
        }
        await vi.waitFor(() => expect(displayed()).toEqual(scenario.expected));
        expect(
          h.actions.filter(({ type }) => type === settingsChangesReceived.toString()),
        ).toHaveLength(1);
        expect(wire.request.mock.calls.filter(([method]) => method === 'settings.update')).toEqual([
          ['settings.update', { changes: scenario.changes }],
        ]);
      });
    }
  }

  it('rejects old subscription events and an outstanding ACK after changing the admitted host', async () => {
    const h = await harness();
    const oldLease = h.lease();
    store.dispatch(setDefaultReasoningEffort('high'));
    const pending = await h.write(0);
    const next = initialSnapshot();
    next.revision = 1;
    next.settings.find(({ path }) => path === 'model.defaultReasoningEffort')!.value = 'medium';
    h.replaceSnapshot(next);
    const nextConnection = await h.switchHost();
    expect(nextConnection).not.toBe(h.connection);
    await vi.waitFor(() => expect(displayed()).toEqual({ ...initialDisplay, effort: 'medium' }));
    pending.resolve(effortReceipt);
    h.emit(effortReceipt, oldLease);
    await settle();
    expect(displayed()).toEqual({ ...initialDisplay, effort: 'medium' });
    expect(h.actions.filter(({ type }) => type === settingsChangesReceived.toString())).toEqual([]);
    h.emit({ revision: 2, applied: [{ path: 'model.defaultReasoningEffort', value: 'low' }] });
    await vi.waitFor(() => expect(displayed().effort).toBe('low'));
    expect(wire.request.mock.calls.filter(([method]) => method === 'settings.update')).toEqual([
      ['settings.update', { changes: [{ path: 'model.defaultReasoningEffort', value: 'high' }] }],
    ]);
  });

  it('cancels writes and hydration on owner authority loss without accepting a pending ACK', async () => {
    const h = await harness();
    store.dispatch(setDefaultReasoningEffort('high'));
    const pending = await h.write(0);
    h.revoke();
    pending.resolve(effortReceipt);
    h.emit(effortReceipt);
    store.dispatch(setDefaultReasoningEffort('medium'));
    await settle();
    expect(displayed()).toEqual(initialDisplay);
    expect(wire.request.mock.calls.filter(([method]) => method === 'settings.update')).toEqual([
      ['settings.update', { changes: [{ path: 'model.defaultReasoningEffort', value: 'high' }] }],
    ]);
    expect(wire.request.mock.calls.filter(([method]) => method === 'settings.list')).toEqual([
      ['settings.list'],
    ]);
  });

  it('recovers only the rejected field and retains a newer unrelated admitted receipt', async () => {
    const h = await harness();
    store.dispatch(setDefaultReasoningEffort('high'));
    const pending = await h.write(0);
    const recovery = initialSnapshot();
    recovery.revision = 8;
    recovery.settings.find(({ path }) => path === 'model.defaultReasoningEffort')!.value = 'medium';
    const recoveringRead = h.holdNextRead();
    pending.reject(
      new BackendError({ code: 'INVALID_PARAMS', message: 'Rejected effort', rpcCode: -32602 }),
    );
    await vi.waitFor(() =>
      expect(wire.request.mock.calls.filter(([method]) => method === 'settings.list')).toHaveLength(
        2,
      ),
    );
    // The read captured revision 8 before an unrelated revision 9 event; its response arrives last.
    h.emit({
      revision: 9,
      applied: [
        { path: 'model.providerDefaults', value: { grok: 'from-event', codex: 'codex-old' } },
      ],
    });
    await vi.waitFor(() =>
      expect(displayed().models).toEqual({ grok: 'from-event', codex: 'codex-old' }),
    );
    recoveringRead.resolve(recovery);
    await vi.waitFor(() =>
      expect(displayed()).toEqual({
        provider: 'grok',
        models: { grok: 'from-event', codex: 'codex-old' },
        effort: 'medium',
      }),
    );
    expect(h.actions).toContainEqual(
      settingsFieldsRefreshRequested(['model.defaultReasoningEffort'], h.connection),
    );
    expect(wire.request.mock.calls).toEqual([
      ['events.subscribe', { eventTypes }],
      ['settings.list'],
      ['settings.update', { changes: [{ path: 'model.defaultReasoningEffort', value: 'high' }] }],
      ['settings.list'],
    ]);
    h.emit({ revision: 7, applied: [{ path: 'model.defaultReasoningEffort', value: 'low' }] });
    await settle();
    expect(displayed()).toEqual({
      provider: 'grok',
      models: { grok: 'from-event', codex: 'codex-old' },
      effort: 'medium',
    });
  });
});
