import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeEvery } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { connectionsListReceived } from '../../connections/connections-slice';
import { providerCatalogLoaded } from '../../provider-catalog/provider-catalog-slice';
import { getItems, getItem } from '@themislib/themis/utils/collections/collection-utils';
import { BackendError } from '$lib/client/live/backend-transport-types';
import { hostExecutionConnectionChanged } from '../../host-execution/host-execution-slice';
import { hydrateDefaultProvider, loadProviderModelsFromStorage } from '../../model/model-slice';
import {
  hydrateSettings,
  initialState as backgroundInitialState,
  type BackgroundAgentSettingsState,
} from '../../background-agent-settings/background-agent-settings-slice';
import {
  providerSettingsSessionOpened,
  providerSettingsSessionClosed,
  providerPathSaveRequested,
  providerEnablementSeedRequested,
  setProviderEnabled,
  setActiveProvider,
  setAtomicDefaultModel,
  fastModeSupportReceived,
  hydrateProviderFastMode,
  setProviderFastMode,
} from '../provider-settings-slice';
import { providerSettingsSaga } from './provider-settings-saga';
import { selectProviderFastModeValues } from '../provider-settings-selectors';
import { settingsFieldsRefreshRequested } from '../../settings-events/settings-events-slice';
import type { AppSettingChange } from '$lib/client/app-client';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  updateSnapshot: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      get: mocks.get,
      list: mocks.list,
      update: mocks.update,
      updateSnapshot: mocks.updateSnapshot,
    },
  },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: mocks.success, error: mocks.error },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const cleanups: (() => Promise<void>)[] = [];
const emptyQuickActions = {
  defaultModel: '',
  typeOverrides: { commit: '', pr: '', review: '', fast: '' },
  defaultReasoningEffort: '',
  typeReasoningEffortOverrides: {},
};
const daemonSettings: AppSettingChange[] = [
  { path: 'model.defaultProvider', value: 'codex' },
  { path: 'model.providerDefaults', value: {} },
  { path: 'quickActions.defaultModel', value: '' },
  { path: 'quickActions.typeOverrides', value: { commit: '', pr: '', review: '', fast: '' } },
  { path: 'quickActions.defaultReasoningEffort', value: '' },
  { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
  { path: 'quickActions.providerSettings', value: {} },
];
function harness(backgroundAgentSettings: BackgroundAgentSettingsState = backgroundInitialState) {
  const disposeStore = store.init();
  const runtimeErrors: unknown[] = [];
  const recordRuntimeError = (event: unknown) => runtimeErrors.push(event);
  store.traceStreams.runtimeError.onValue(recordRuntimeError);
  const cancelOwners: (() => void)[] = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const cancel of [...cancelOwners].reverse()) cancel();
    await settle();
  };
  cleanups.push(async () => {
    try {
      await stop();
    } finally {
      disposeStore();
      store.traceStreams.runtimeError.offValue(recordRuntimeError);
    }
    expect(runtimeErrors).toEqual([]);
  });
  admitLegacyPrincipal();
  const connection = selectPrincipalConnectionContext.select(store.state);
  if (!connection) throw new Error('Settings test requires an admitted connection');
  store.dispatch(hostExecutionConnectionChanged(connection));
  store.dispatch(hydrateDefaultProvider('codex'));
  store.dispatch(hydrateSettings(backgroundAgentSettings));
  store.dispatch(
    providerCatalogLoaded({
      providers: [
        {
          id: 'codex',
          displayName: 'Codex',
          shortName: 'Codex',
          command: 'codex',
          visible: true,
          canBeDisabled: true,
          supportsFastMode: true,
        },
      ],
    }),
  );
  const actions: { type: string; payload?: unknown }[] = [];
  cancelOwners.push(
    store.runSaga(function* recordSettingsActions() {
      yield* takeEvery('*', function record(action: { type: string; payload?: unknown }) {
        actions.push(action);
      });
    }),
  );
  cancelOwners.push(store.runSaga(providerSettingsSaga));
  store.dispatch(providerSettingsSessionOpened('panel'));
  const switchBackend = (windowBackendId: string) => {
    const current = store.state.connections;
    store.dispatch(
      connectionsListReceived({
        connections: getItems(current.connections),
        activeId: current.activeId,
        windowBackendId,
      }),
    );
    admitLegacyPrincipal();
    const nextConnection = selectPrincipalConnectionContext.select(store.state);
    if (!nextConnection) throw new Error('Settings test requires an admitted connection');
    store.dispatch(hostExecutionConnectionChanged(nextConnection));
  };
  return {
    send: store.dispatch,
    stop,
    actions,
    switchBackend,
    state: () => store.state,
    request: (id: string) => getItem(store.state.providerSettings.requests, id),
  };
}

async function waitForConsumedRequest(promise: Promise<unknown>) {
  await vi.waitFor(() =>
    expect(
      mocks.update.mock.results.some(
        (result) => result.type === 'return' && result.value === promise,
      ),
    ).toBe(true),
  );
}

const context = (id: string) => ({ id, sessionId: 'panel' });
const invalid = () =>
  new BackendError({ code: 'INVALID_PARAMS', message: 'invalid', rpcCode: -32602 });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ value: {} });
  mocks.list.mockImplementation(async () => structuredClone(daemonSettings));
  mocks.update.mockResolvedValue([]);
  mocks.updateSnapshot.mockImplementation(async (changes) => ({
    applied: await mocks.update(changes),
    revision: 1,
  }));
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('provider settings ordered ownership', () => {
  it.each(['resolve', 'reject'] as const)(
    'ignores a previous connection provider %s after its UI request ledger is cleared',
    async (outcome) => {
      const first = deferred<unknown[]>();
      mocks.update.mockReturnValueOnce(first.promise);
      const h = harness();
      h.send(setActiveProvider('codex', context('old-host')));
      await settle();
      expect(mocks.update).toHaveBeenCalledTimes(1);
      h.send(hostExecutionConnectionChanged('remote'));
      h.send(hydrateDefaultProvider('grok'));
      await waitForConsumedRequest(first.promise);
      if (outcome === 'resolve') first.resolve([]);
      else first.reject(invalid());
      await settle();
      expect(h.state().model.defaultProviderId).toBe('grok');
      // Connection changes clear the old host's UI request ledger.
      expect(h.request('old-host')).toBeUndefined();
      expect(h.actions.filter(({ type }) => type === 'settings/changesReceived')).toEqual([]);
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'keeps daemon state through a later rejection after an older %s until a receipt arrives',
    async (outcome) => {
      const first = deferred<unknown[]>();
      const second = deferred<unknown[]>();
      mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const h = harness();
      h.send(hydrateDefaultProvider('codex'));
      h.send(loadProviderModelsFromStorage({ codex: 'balanced', grok: 'shared' }));
      mocks.list
        .mockResolvedValueOnce([
          ...daemonSettings.filter(({ path }) => path !== 'model.providerDefaults'),
          { path: 'model.providerDefaults', value: { codex: 'balanced', grok: 'shared' } },
        ])
        .mockResolvedValueOnce([
          ...daemonSettings.filter(({ path }) => path !== 'model.providerDefaults'),
          {
            path: 'model.providerDefaults',
            value: { codex: outcome === 'resolve' ? 'shared' : 'balanced', grok: 'shared' },
          },
        ]);
      h.send(setAtomicDefaultModel({ providerId: 'codex', model: 'shared' }));
      h.send(setAtomicDefaultModel({ providerId: 'grok', model: 'shared' }));
      await settle();
      expect(h.state().model.defaultProviderId).toBe('codex');
      expect(h.state().model.providerModels).toEqual({ codex: 'balanced', grok: 'shared' });
      await waitForConsumedRequest(first.promise);
      if (outcome === 'resolve') first.resolve([]);
      else first.reject(invalid());
      await settle();
      expect(h.state().model.defaultProviderId).toBe('codex');
      expect(mocks.update).toHaveBeenCalledTimes(2);
      await waitForConsumedRequest(second.promise);
      second.reject(invalid());
      await settle();
      expect(h.state().model.defaultProviderId).toBe('codex');
      expect(h.state().model.providerModels).toEqual({ codex: 'balanced', grok: 'shared' });
      h.send(
        loadProviderModelsFromStorage({
          codex: outcome === 'resolve' ? 'shared' : 'balanced',
          grok: 'shared',
        }),
      );
      expect(h.state().model.providerModels).toEqual({
        codex: outcome === 'resolve' ? 'shared' : 'balanced',
        grok: 'shared',
      });
    },
  );

  for (const pendingAtomic of [false, true]) {
    for (const blockedAtomic of [false, true]) {
      it(`settles an accepted default after a blocked choice (pending atomic ${pendingAtomic}, blocked atomic ${blockedAtomic})`, async () => {
        const pending = deferred<unknown[]>();
        mocks.update.mockReturnValueOnce(pending.promise);
        const h = harness({
          ...backgroundInitialState,
          providerId: 'codex',
          providerSettings: {
            blocked: {
              defaultModel: 'codex:foreign',
              typeOverrides: { ...backgroundInitialState.typeOverrides },
            },
          },
        });
        const admittedConnection = h.state().model.selectionConnection;
        expect(admittedConnection).not.toBeNull();
        h.send(
          pendingAtomic
            ? setAtomicDefaultModel({ providerId: 'codex', model: 'balanced' })
            : setActiveProvider('codex', context('accepted')),
        );
        await settle();
        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(h.state().model.defaultProviderId).toBe('codex');
        expect(h.state().model.providerModels).toEqual({});
        const acceptedBackground = h.state().backgroundAgentSettings;
        h.send(
          blockedAtomic
            ? setAtomicDefaultModel({ providerId: 'blocked', model: 'basic' })
            : setActiveProvider('blocked', context('blocked')),
        );
        await settle();
        expect(h.state().model.defaultProviderId).toBe('codex');
        expect(h.state().backgroundAgentSettings).toBe(acceptedBackground);
        expect(mocks.update).toHaveBeenCalledTimes(1);
        if (!blockedAtomic) expect(h.request('blocked')?.status).toBe('failure');

        await waitForConsumedRequest(pending.promise);
        pending.reject(invalid());
        await settle();
        expect(h.state().model.defaultProviderId).toBe('codex');
        expect(h.state().model.providerModels).toEqual({});
        expect(h.actions).toContainEqual(
          settingsFieldsRefreshRequested(
            pendingAtomic
              ? ['model.defaultProvider', 'model.providerDefaults']
              : ['model.defaultProvider'],
            admittedConnection,
          ),
        );
        if (!pendingAtomic) expect(h.request('accepted')?.status).toBe('failure');
        expect(mocks.update).toHaveBeenCalledTimes(1);
      });
    }
  }

  it('keeps default request acknowledgement independent of Fast mode rollback and retry', async () => {
    const pendingDefault = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(pendingDefault.promise);
    mocks.updateSnapshot
      .mockRejectedValueOnce(invalid())
      .mockImplementation(async (changes) => ({ applied: changes, revision: 3 }));
    const h = harness();
    h.send(fastModeSupportReceived(true));
    h.send(hydrateProviderFastMode({ codex: false }, 1));
    h.send(setActiveProvider('codex', context('default')));
    h.send(setProviderFastMode('codex', true));
    await settle();

    expect(h.state().model.defaultProviderId).toBe('codex');
    expect(h.request('default')?.status).toBe('pending');
    expect(selectProviderFastModeValues.select(h.state() as never)).toEqual({ codex: false });
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();

    h.send(setProviderFastMode('codex', true));
    await settle();
    expect(selectProviderFastModeValues.select(h.state() as never)).toEqual({ codex: true });
    expect(h.request('default')?.status).toBe('pending');
    expect(mocks.updateSnapshot.mock.calls).toEqual([
      [[{ path: 'providers.fastMode', value: { codex: true } }]],
      [[{ path: 'providers.fastMode', value: { codex: true } }]],
    ]);

    expect(mocks.update).toHaveBeenCalledExactlyOnceWith([
      { path: 'model.defaultProvider', value: 'codex' },
    ]);
    pendingDefault.resolve([]);
    await settle();
    expect(h.request('default')?.status).toBe('success');
    expect(h.actions.filter(({ type }) => type === 'settings/changesReceived')).toEqual([]);
    expect(h.actions.filter(({ type }) => type === 'model/reloadModelsForProvider')).toHaveLength(
      0,
    );
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(h.state().providerSettings.fastMode.pending).toEqual({});
  });

  it('does not let an old repeated-value rejection retire newer enablement intent', async () => {
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const h = harness();
    h.send(setProviderEnabled({ providerId: 'codex', enabled: true }, context('old')));
    h.send(setProviderEnabled({ providerId: 'codex', enabled: true }, context('new')));
    await waitForConsumedRequest(first.promise);
    first.reject(invalid());
    await settle();
    expect(h.state().providerSettings.pendingEnablementOverrides).toEqual({ codex: true });
    expect(h.request('old')?.status).toBe('failure');
    expect(h.request('new')?.status).toBe('pending');
    await waitForConsumedRequest(second.promise);
    second.reject(invalid());
    await settle();
    expect(h.state().providerSettings.pendingEnablementOverrides).toEqual({});
    expect(h.request('new')?.status).toBe('failure');
  });

  it('serializes atomic provider/model batches with provider-only defaults in both directions', async () => {
    const persisted = structuredClone(daemonSettings);
    mocks.list.mockImplementation(async () => structuredClone(persisted));
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const h = harness();
    h.send(setAtomicDefaultModel({ providerId: 'codex', model: 'first' }));
    h.send(setActiveProvider('grok', context('default')));
    h.send(setAtomicDefaultModel({ providerId: 'codex', model: 'last' }));
    await settle();
    expect(mocks.update.mock.calls).toEqual([
      [
        [
          { path: 'model.defaultProvider', value: 'codex' },
          { path: 'model.providerDefaults', value: { codex: 'first' } },
        ],
      ],
    ]);
    persisted.find(({ path }) => path === 'model.providerDefaults')!.value = { codex: 'first' };
    first.resolve([]);
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenLastCalledWith([
      { path: 'model.defaultProvider', value: 'grok' },
      { path: 'quickActions.defaultModel', value: '' },
      { path: 'quickActions.typeOverrides', value: { commit: '', pr: '', review: '', fast: '' } },
      { path: 'quickActions.defaultReasoningEffort', value: '' },
      { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
      { path: 'quickActions.providerSettings', value: { codex: emptyQuickActions } },
    ]);
    persisted.find(({ path }) => path === 'model.defaultProvider')!.value = 'grok';
    persisted.find(({ path }) => path === 'quickActions.providerSettings')!.value = {
      codex: emptyQuickActions,
    };
    second.resolve([]);
    await settle();
    expect(mocks.update).toHaveBeenLastCalledWith([
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'model.providerDefaults', value: { codex: 'last' } },
      { path: 'quickActions.defaultModel', value: '' },
      { path: 'quickActions.typeOverrides', value: { commit: '', pr: '', review: '', fast: '' } },
      { path: 'quickActions.defaultReasoningEffort', value: '' },
      { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
      {
        path: 'quickActions.providerSettings',
        value: { codex: emptyQuickActions, grok: emptyQuickActions },
      },
    ]);
    expect(mocks.list.mock.calls).toEqual([[], [], []]);
    expect(h.request('default')?.status).toBe('success');
    expect(h.state().model.defaultProviderId).toBe('codex');
    expect(h.state().model.providerModels).toEqual({});
  });

  it('reads each full paths map only after the preceding provider write acknowledges', async () => {
    const first = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    mocks.get
      .mockResolvedValueOnce({ value: { pi: '/keep' } })
      .mockResolvedValueOnce({ value: { pi: '/keep', codex: '/one' } });
    const h = harness();
    h.send(providerPathSaveRequested('codex', '/one', context('one')));
    h.send(providerPathSaveRequested('grok', '/two', context('two')));
    await settle();
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('providers.paths');
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith([
      { path: 'providers.paths', value: { pi: '/keep', codex: '/one' } },
    ]);
    first.resolve([]);
    await settle();
    expect(mocks.update).toHaveBeenLastCalledWith([
      { path: 'providers.paths', value: { pi: '/keep', codex: '/one', grok: '/two' } },
    ]);
    expect(h.request('one')?.status).toBe('success');
    expect(h.request('two')?.status).toBe('success');
    expect(h.state().providerSettings.paths.configured).toEqual({ codex: '/one', grok: '/two' });
  });

  it('settles in-flight and queued requests on teardown, ignoring late responses', async () => {
    const first = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    const h = harness();
    h.send(providerPathSaveRequested('codex', '/one', context('one')));
    h.send(providerPathSaveRequested('grok', '/two', context('two')));
    await settle();
    await h.stop();
    expect(h.request('one')?.status).toBe('cancelled');
    expect(h.request('two')?.status).toBe('cancelled');
    first.resolve([]);
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(h.state().providerSettings.paths.configured).toEqual({});
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('finishes accepted persistence after panel close without recreating its requests or notifications', async () => {
    const first = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    const h = harness();
    h.send(providerPathSaveRequested('codex', '/one', context('one')));
    await settle();
    h.send(providerSettingsSessionClosed('panel'));
    first.resolve([]);
    await settle();
    expect(h.request('one')).toBeUndefined();
    expect(h.state().providerSettings.paths.configured.codex).toBe('/one');
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('settles a failed path read without writing, and permits a later retry', async () => {
    mocks.get.mockRejectedValueOnce(new Error('offline'));
    const h = harness();
    h.send(providerPathSaveRequested('codex', '/one', context('one')));
    await settle();
    expect(h.request('one')?.status).toBe('failure');
    expect(mocks.update).not.toHaveBeenCalled();
    h.send(providerPathSaveRequested('codex', '/two', context('two')));
    await settle();
    expect(h.request('two')?.status).toBe('success');
  });

  it('seeds only after acknowledgement and preserves a newer explicit false', async () => {
    const first = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    const h = harness();
    h.send(providerEnablementSeedRequested({ codex: true }));
    await settle();
    expect(h.state().providerSettings.enabledProviders).toEqual({});
    h.send(setProviderEnabled({ providerId: 'codex', enabled: false }));
    first.resolve([]);
    await settle();
    expect(h.state().providerSettings.enabledProviders).toEqual({ codex: false });
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'providers.enabled', value: { codex: true } }]],
      [[{ path: 'providers.enabled', value: { codex: false } }]],
    ]);
  });

  it('rechecks live enablement and backend identity before writing a queued seed', async () => {
    const first = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    const h = harness();
    h.send(setActiveProvider('codex'));
    h.send(providerEnablementSeedRequested({ codex: true }));
    await waitForConsumedRequest(first.promise);
    h.switchBackend('remote');
    first.resolve([]);
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(h.state().providerSettings.enabledProviders).toEqual({});
    h.switchBackend('local');
    h.send(setProviderEnabled({ providerId: 'codex', enabled: false }));
    h.send(providerEnablementSeedRequested({ codex: true }));
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(h.state().providerSettings.enabledProviders.codex).toBe(false);
  });
});
