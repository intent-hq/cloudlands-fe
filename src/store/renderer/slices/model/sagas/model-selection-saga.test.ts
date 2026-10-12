import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { all, call, cancelled, take } from 'typed-redux-saga';
import type { SagaIterator } from 'redux-saga';
import type { GenericAction } from '@themislib/themis/types';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { providerCatalogLoaded } from '../../provider-catalog/provider-catalog-slice';
import { providerSettingsSaga } from '../../provider-settings/sagas/provider-settings-saga';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  list: vi.fn(),
  listSnapshot: undefined as ReturnType<typeof vi.fn> | undefined,
}));
vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      update: mocks.update,
      list: mocks.list,
      get listSnapshot() {
        return mocks.listSnapshot;
      },
    },
  },
}));

import { BackendError } from '$lib/client/live/backend-transport-types';
import type { AppSettingChange } from '$lib/client/app-client';
import { settingsFieldsRefreshRequested } from '../../settings-events/settings-events-slice';
import { hostExecutionConnectionChanged } from '../../host-execution/host-execution-slice';

import {
  hydrateDefaultProvider,
  initialState as modelInitialState,
  loadDefaultReasoningEffortFromStorage,
  loadProviderModelsFromStorage,
  selectModel,
  setDefaultReasoningEffort,
  setSelectedModel,
} from '../model-slice';
import {
  modelSelectionSaga as selectionOwner,
  persistDefaultReasoningEffortWorker,
  persistSelectedModelsWorker,
  handleSelectModel,
} from './model-selection-saga';

function* modelSelectionSaga() {
  yield* all([call(selectionOwner), call(providerSettingsSaga)]);
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const daemonSettings: AppSettingChange[] = [
  { path: 'model.defaultProvider', value: 'auggie' },
  { path: 'model.providerDefaults', value: { auggie: 'sonnet4.5' } },
  { path: 'quickActions.defaultModel', value: '' },
  { path: 'quickActions.typeOverrides', value: { commit: '', pr: '', review: '', fast: '' } },
  { path: 'quickActions.defaultReasoningEffort', value: '' },
  { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
  { path: 'quickActions.providerSettings', value: {} },
];

const cleanups: (() => Promise<void>)[] = [];

function harness({
  providerId = 'codex',
  catalogLoaded = true,
  model = {
    ...modelInitialState,
    providerModels: { auggie: 'sonnet4.5' },
    defaultReasoningEffort: 'high',
    defaultProviderId: 'auggie',
  },
  startOwners = true,
}: {
  providerId?: string;
  catalogLoaded?: boolean;
  model?: typeof modelInitialState;
  startOwners?: boolean;
} = {}) {
  const dispose = store.init();
  const runtimeErrors: unknown[] = [];
  const recordError = (error: unknown) => runtimeErrors.push(error);
  store.traceStreams.runtimeError.onValue(recordError);
  const stops: (() => Promise<void>)[] = [];
  cleanups.push(async () => {
    const errors: unknown[] = [];
    for (const stop of [...stops].reverse()) {
      try {
        await stop();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      dispose();
    } catch (error) {
      errors.push(error);
    } finally {
      store.traceStreams.runtimeError.offValue(recordError);
    }
    expect({ runtimeErrors, cleanupErrors: errors }).toEqual({
      runtimeErrors: [],
      cleanupErrors: [],
    });
  });
  admitLegacyPrincipal();
  const connection = selectPrincipalConnectionContext.select(store.state);
  expect(connection).not.toBeNull();
  if (connection === null) throw new Error('Settings test requires an admitted connection');
  store.dispatch(hostExecutionConnectionChanged(connection));
  store.dispatch(hydrateDefaultProvider(model.defaultProviderId));
  store.dispatch(loadProviderModelsFromStorage(model.providerModels));
  store.dispatch(loadDefaultReasoningEffortFromStorage(model.defaultReasoningEffort));
  if (catalogLoaded)
    store.dispatch(
      providerCatalogLoaded({
        providers: [
          {
            id: providerId,
            displayName: providerId,
            shortName: providerId,
            command: providerId,
            canBeDisabled: true,
            visible: true,
          },
        ],
      }),
    );

  // Observe every application action, omitting only Store lifecycle instrumentation.
  const dispatch = vi.fn<(action: GenericAction) => void>();
  let recorderCancelled: boolean | null = null;
  const stopRecorder = store.runSaga(function* recordSettingsTestActions() {
    try {
      while (true) {
        const action: GenericAction = yield* take('*');
        if (action.type !== 'sagaManager/startSaga' && action.type !== 'sagaManager/stopSaga') {
          dispatch(action);
        }
      }
    } finally {
      recorderCancelled = yield* cancelled();
    }
  });
  stops.push(async () => {
    stopRecorder();
    await settle();
    expect(recorderCancelled).toBe(true);
  });

  let stop = async () => {};
  if (startOwners) {
    let ownerCancelled: boolean | null = null;
    const cancel = store.runSaga(function* settingsSelectionTestOwner() {
      try {
        yield* call(modelSelectionSaga);
      } finally {
        ownerCancelled = yield* cancelled();
      }
    });
    let stopped = false;
    stop = async () => {
      if (stopped) return;
      stopped = true;
      cancel();
      await settle();
      expect(ownerCancelled).toBe(true);
    };
    stops.push(stop);
  }

  function runWorker<Args extends unknown[], Result>(
    worker: (...args: Args) => SagaIterator<Result>,
    ...args: Args
  ) {
    let resolve!: (value: Result) => void;
    let reject!: (error: unknown) => void;
    // This promise carries the finite worker result; it is not a fabricated Task.
    const result = new Promise<Result>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    let workerCancelled: boolean | null = null;
    let completed = false;
    const cancel = store.runSaga(function* settingsWorkerUnderTest() {
      try {
        resolve(yield* call(worker, ...args));
      } catch (error) {
        reject(error);
        throw error;
      } finally {
        completed = true;
        workerCancelled = yield* cancelled();
      }
    });
    stops.push(async () => {
      const wasCompleted = completed;
      cancel();
      await settle();
      expect(workerCancelled).toBe(!wasCompleted);
    });
    return result;
  }
  return { send: store.dispatch, dispatch, stop, runWorker, connection };
}

afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0)) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  vi.useRealTimers();
  expect(errors).toEqual([]);
});

describe('modelSelectionSaga', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.update.mockResolvedValue([]);
    mocks.list.mockImplementation(async () => structuredClone(daemonSettings));
    mocks.listSnapshot = undefined;
  });

  it('routes a known compound pick without changing daemon-owned state or requesting a reload', async () => {
    const { runWorker, dispatch, stop } = harness();
    try {
      await runWorker(handleSelectModel, selectModel('codex:gpt-5'));

      await settle();
      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        {
          type: 'providerSettings/setAtomicDefaultModel',
          payload: [{ providerId: 'codex', model: 'gpt-5' }],
        },
        {
          type: 'providerSettings/atomicDefaultModelAccepted',
          payload: [{ providerId: 'codex', model: 'gpt-5' }],
        },
      ]);
      expect(store.state.model.defaultProviderId).toBe('auggie');
      expect(store.state.model.providerModels).toEqual({ auggie: 'sonnet4.5' });
      expect(mocks.update).toHaveBeenCalledTimes(1);
    } finally {
      await stop();
    }
  });

  it('keeps daemon receipts authoritative while a compound Claude pick is in flight', async () => {
    mocks.update.mockReturnValueOnce(new Promise(() => {}));
    const { runWorker, send, stop } = harness({
      providerId: 'claude-code',
      model: modelInitialState,
    });
    try {
      await runWorker(handleSelectModel, selectModel('claude-code:opus-4-1'));
      await settle();
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(store.state.model.defaultProviderId).toBe('');
      send(hydrateDefaultProvider('auggie'));
      send(loadProviderModelsFromStorage({ auggie: 'external' }));
      expect(store.state.model.defaultProviderId).toBe('auggie');
      expect(store.state.model.providerModels).toEqual({ auggie: 'external' });
    } finally {
      await stop();
    }
  });

  it('does not switch for an unknown compound provider once the catalog is loaded', async () => {
    const { runWorker, dispatch } = harness({ startOwners: false });
    await runWorker(handleSelectModel, selectModel('unknown:model'));

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('sends a compound provider pick before catalog hydration without adopting it locally', async () => {
    const { runWorker, dispatch, stop } = harness({ catalogLoaded: false });
    try {
      await runWorker(handleSelectModel, selectModel('claude-code:fable5'));

      await settle();
      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        {
          type: 'providerSettings/setAtomicDefaultModel',
          payload: [{ providerId: 'claude-code', model: 'fable5' }],
        },
        {
          type: 'providerSettings/atomicDefaultModelAccepted',
          payload: [{ providerId: 'claude-code', model: 'fable5' }],
        },
      ]);
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(store.state.model.defaultProviderId).toBe('auggie');
    } finally {
      await stop();
    }
  });

  it('reads the uncached daemon map instead of merging picks over Redux', async () => {
    mocks.list.mockResolvedValue([
      ...daemonSettings.filter(({ path }) => path.startsWith('quickActions.')),
      { path: 'model.defaultProvider', value: 'auggie' },
      { path: 'model.providerDefaults', value: { auggie: 'external', grok: 'keep' } },
    ]);
    const { runWorker } = harness({ startOwners: false });
    const landed = await runWorker(persistSelectedModelsWorker, { codex: 'codex:gpt-5' });

    expect(landed).toBe(true);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.update.mock.calls).toEqual([
      [
        [
          {
            path: 'model.providerDefaults',
            value: { auggie: 'external', grok: 'keep', codex: 'gpt-5' },
          },
        ],
      ],
    ]);
  });

  it('reads a fresh snapshot and persists a cross-provider model plus Quick Action bundle atomically', async () => {
    mocks.listSnapshot = vi.fn().mockResolvedValue({
      settings: [
        ...daemonSettings.filter(({ path }) => path !== 'quickActions.providerSettings'),
        {
          path: 'quickActions.providerSettings',
          value: {
            codex: {
              defaultModel: 'quick-codex',
              typeOverrides: { commit: 'fast' },
              defaultReasoningEffort: 'low',
              typeReasoningEffortOverrides: { review: 'high' },
            },
          },
        },
      ],
      revision: 7,
    });
    const { runWorker, dispatch } = harness({ startOwners: false });
    const landed = await runWorker(persistSelectedModelsWorker, { codex: 'codex:gpt-5' }, 'codex');

    expect(landed).toBe(true);
    expect(mocks.listSnapshot).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith([
      { path: 'model.defaultProvider', value: 'codex' },
      {
        path: 'model.providerDefaults',
        value: { auggie: 'sonnet4.5', codex: 'gpt-5' },
      },
      { path: 'quickActions.defaultModel', value: 'quick-codex' },
      { path: 'quickActions.typeOverrides', value: { commit: 'fast' } },
      { path: 'quickActions.defaultReasoningEffort', value: 'low' },
      { path: 'quickActions.typeReasoningEffortOverrides', value: { review: 'high' } },
      {
        path: 'quickActions.providerSettings',
        value: {
          codex: {
            defaultModel: 'quick-codex',
            typeOverrides: { commit: 'fast' },
            defaultReasoningEffort: 'low',
            typeReasoningEffortOverrides: { review: 'high' },
          },
          auggie: {
            defaultModel: '',
            typeOverrides: { commit: '', pr: '', review: '', fast: '' },
            defaultReasoningEffort: '',
            typeReasoningEffortOverrides: {},
          },
        },
      },
    ]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([0, 1, 3])(
    'does not treat a successful save with %i changed paths as authority',
    async (count) => {
      const applied = [
        { path: 'model.providerDefaults', value: { auggie: 'sonnet4.5', codex: 'gpt-5' } },
        { path: 'model.defaultProvider', value: 'codex' },
        { path: 'model.default', value: '' },
      ].slice(0, count);
      mocks.update.mockResolvedValue(applied);
      const { runWorker, send, dispatch, connection } = harness({ startOwners: false });
      const before = store.state.model;
      send(setSelectedModel({ providerId: 'codex', model: 'gpt-5' }));
      expect(store.state.model).toBe(before);
      dispatch.mockClear();
      const result = await runWorker(
        persistSelectedModelsWorker,
        { codex: 'gpt-5' },
        'codex',
        connection,
      );
      expect(result).toBe(true);
      expect(store.state.model).toBe(before);
      expect(dispatch).not.toHaveBeenCalled();
      send(hydrateDefaultProvider('codex'));
      send(loadProviderModelsFromStorage({ auggie: 'sonnet4.5', codex: 'gpt-5' }));
      expect(store.state.model.defaultProviderId).toBe('codex');
      expect(store.state.model.providerModels).toEqual({ auggie: 'sonnet4.5', codex: 'gpt-5' });
    },
  );

  it('serializes every model intent FIFO without coalescing or publishing acknowledgements', async () => {
    let release!: () => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise<unknown[]>((resolve) => {
          release = () => resolve([]);
        }),
      )
      .mockResolvedValue([]);
    const { send, stop } = harness();
    await settle();

    send(setSelectedModel({ providerId: 'auggie', model: 'one' }));
    await settle();
    send(setSelectedModel({ providerId: 'auggie', model: 'two' }));
    send(setSelectedModel({ providerId: 'auggie', model: 'three' }));
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(store.state.model.providerModels).toEqual({ auggie: 'sonnet4.5' });
    release();
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(3));

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.providerDefaults', value: { auggie: 'one' } }]],
      [[{ path: 'model.providerDefaults', value: { auggie: 'two' } }]],
      [[{ path: 'model.providerDefaults', value: { auggie: 'three' } }]],
    ]);
    expect(mocks.list.mock.calls).toEqual([[], [], []]);
    expect(store.state.model.providerModels).toEqual({ auggie: 'sonnet4.5' });
    await stop();
  });

  it('does not send a write after the connection changes during its uncached read', async () => {
    let release!: (settings: AppSettingChange[]) => void;
    mocks.list.mockReturnValueOnce(
      new Promise<AppSettingChange[]>((resolve) => {
        release = resolve;
      }),
    );
    const { runWorker, send, dispatch, connection } = harness({ startOwners: false });
    const result = runWorker(persistSelectedModelsWorker, { codex: 'gpt-5' }, 'codex', connection);
    send(hostExecutionConnectionChanged('remote'));
    dispatch.mockClear();
    release(structuredClone(daemonSettings));
    expect(await result).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('persists the queued pick even when a stale hydration echo clobbers the map first', async () => {
    let release!: () => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise<unknown[]>((resolve) => {
          release = () => resolve([]);
        }),
      )
      .mockResolvedValue([]);
    const { send, stop } = harness();
    await settle();

    // First pick's settings.update is held in flight.
    send(setSelectedModel({ providerId: 'auggie', model: 'one' }));
    await settle();
    // A newer pick queues while the write is in flight...
    send(setSelectedModel({ providerId: 'auggie', model: 'two' }));
    // ...then a stale snapshot/echo hydration resets the map to the older value.
    send(loadProviderModelsFromStorage({ auggie: 'one' }));
    release();
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));

    // The queued action's payload wins — the stale renderer receipt is never persisted.
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.providerDefaults', value: { auggie: 'one' } }]],
      [[{ path: 'model.providerDefaults', value: { auggie: 'two' } }]],
    ]);
    await stop();
  });

  it('keeps an earlier committed provider pick by rereading the daemon, not stale Redux', async () => {
    const persisted = structuredClone(daemonSettings);
    mocks.list.mockImplementation(async () => structuredClone(persisted));
    let release!: () => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise<unknown[]>((resolve) => {
          release = () => resolve([]);
        }),
      )
      .mockResolvedValue([]);
    const { send, stop } = harness();
    await settle();

    // Provider A's pick starts a held-in-flight write.
    send(setSelectedModel({ providerId: 'codex', model: 'gpt-5' }));
    await settle();
    // Provider B's pick queues behind it...
    send(setSelectedModel({ providerId: 'claude-code', model: 'fable5' }));
    // The earlier write commits independently of renderer receipt timing.
    persisted.find(({ path }) => path === 'model.providerDefaults')!.value = {
      auggie: 'external',
      codex: 'gpt-5',
      grok: 'keep',
    };
    send(loadProviderModelsFromStorage({ auggie: 'sonnet4.5' }));
    release();
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));

    expect(store.state.model.providerModels).toEqual({ auggie: 'sonnet4.5' });
    expect(mocks.list.mock.calls).toEqual([[], []]);
    expect(mocks.update.mock.calls).toEqual([
      [
        [
          {
            path: 'model.providerDefaults',
            value: { auggie: 'sonnet4.5', codex: 'gpt-5' },
          },
        ],
      ],
      [
        [
          {
            path: 'model.providerDefaults',
            value: {
              auggie: 'external',
              codex: 'gpt-5',
              grok: 'keep',
              'claude-code': 'fable5',
            },
          },
        ],
      ],
    ]);
    await stop();
  });

  it('does not resend a rejected session pick with the next valid write', async () => {
    mocks.update
      .mockRejectedValueOnce(
        new BackendError({ code: 'INVALID_PARAMS', message: 'invalid', rpcCode: -32602 }),
      )
      .mockResolvedValue([]);
    const { send, stop } = harness();

    send(setSelectedModel({ providerId: 'auggie', model: 'invalid' }));
    await settle();

    send(setSelectedModel({ providerId: 'codex', model: 'gpt-5' }));
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.providerDefaults', value: { auggie: 'invalid' } }]],
      [
        [
          {
            path: 'model.providerDefaults',
            value: { auggie: 'sonnet4.5', codex: 'gpt-5' },
          },
        ],
      ],
    ]);
    await stop();
  });

  it('requests field-only recovery after transport failure without scheduling a retry', async () => {
    vi.useFakeTimers();
    try {
      mocks.update.mockRejectedValueOnce(new Error('backend unavailable')).mockResolvedValue([]);
      const { send, stop, dispatch, connection } = harness();

      send(setSelectedModel({ providerId: 'auggie', model: 'picked' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.update).toHaveBeenCalledTimes(1);

      await vi.runAllTimersAsync();
      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'model.providerDefaults', value: { auggie: 'picked' } }]],
      ]);
      expect(dispatch).toHaveBeenCalledWith(
        settingsFieldsRefreshRequested(['model.providerDefaults'], connection),
      );
      expect(store.state.model.providerModels).toEqual({ auggie: 'sonnet4.5' });
      await stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues to the next queued model intent after a failed write without retrying it', async () => {
    vi.useFakeTimers();
    try {
      mocks.update.mockRejectedValueOnce(new Error('backend unavailable')).mockResolvedValue([]);
      const { send, stop } = harness();

      send(setSelectedModel({ providerId: 'auggie', model: 'first' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.update).toHaveBeenCalledTimes(1);

      send(setSelectedModel({ providerId: 'auggie', model: 'second' }));
      await vi.advanceTimersByTimeAsync(0);

      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'model.providerDefaults', value: { auggie: 'first' } }]],
        [[{ path: 'model.providerDefaults', value: { auggie: 'second' } }]],
      ]);
      await stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists the exact daemon settings path and the picked effort', async () => {
    mocks.update.mockResolvedValue([]);
    const { runWorker } = harness({ startOwners: false });
    await runWorker(persistDefaultReasoningEffortWorker, 'high');

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultReasoningEffort', value: 'high' }]],
    ]);
  });

  it('persists effort picks including clearing to Default (empty string)', async () => {
    mocks.update.mockResolvedValue([]);
    const { send, stop } = harness();
    await settle();

    send(setDefaultReasoningEffort('low'));
    await settle();
    send(setDefaultReasoningEffort(''));
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultReasoningEffort', value: 'low' }]],
      [[{ path: 'model.defaultReasoningEffort', value: '' }]],
    ]);
    expect(store.state.model.defaultReasoningEffort).toBe('high');
    await stop();
  });

  it('does not persist the hydration echo (no write loop)', async () => {
    mocks.update.mockResolvedValue([]);
    const { send, stop } = harness();
    await settle();

    send(loadDefaultReasoningEffortFromStorage('medium'));
    await settle();

    expect(mocks.update).not.toHaveBeenCalled();
    await stop();
  });

  it('persists all queued effort picks FIFO while only daemon receipts update displayed effort', async () => {
    let release!: () => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue([]);
    const { send, stop } = harness();
    await settle();

    // First pick's settings.update is held in flight.
    send(setDefaultReasoningEffort('low'));
    await settle();
    // A newer pick queues while the write is in flight...
    send(setDefaultReasoningEffort('medium'));
    send(setDefaultReasoningEffort(''));
    expect(store.state.model.defaultReasoningEffort).toBe('high');
    // ...then the daemon echo of the FIRST write resets state to the older value.
    send(loadDefaultReasoningEffortFromStorage('low'));
    release();
    await settle();

    // The queued action's payload wins — the stale snapshot is never persisted.
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultReasoningEffort', value: 'low' }]],
      [[{ path: 'model.defaultReasoningEffort', value: 'medium' }]],
      [[{ path: 'model.defaultReasoningEffort', value: '' }]],
    ]);
    expect(store.state.model.defaultReasoningEffort).toBe('low');
    await stop();
  });

  it('requests only effort recovery when an effort write fails', async () => {
    mocks.update.mockRejectedValueOnce(new Error('offline'));
    const { send, dispatch, stop, connection } = harness();
    try {
      send(setDefaultReasoningEffort('low'));
      send(setDefaultReasoningEffort('medium'));
      await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'model.defaultReasoningEffort', value: 'low' }]],
        [[{ path: 'model.defaultReasoningEffort', value: 'medium' }]],
      ]);
      expect(dispatch).toHaveBeenCalledWith(
        settingsFieldsRefreshRequested(['model.defaultReasoningEffort'], connection),
      );
      expect(store.state.model.defaultReasoningEffort).toBe('high');
    } finally {
      await stop();
    }
  });
});
