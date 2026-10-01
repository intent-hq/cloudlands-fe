import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { all, call } from 'typed-redux-saga';
import { providerSettingsSaga } from '../../provider-settings/sagas/provider-settings-saga';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';

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
import { initialState as backgroundInitialState } from '../../background-agent-settings/background-agent-settings-slice';
import {
  initialState as providerSettingsInitialState,
  providerSettingsReducer,
} from '../../provider-settings/provider-settings-slice';

import {
  hydrateDefaultProvider,
  initialState as modelInitialState,
  loadDefaultReasoningEffortFromStorage,
  loadProviderModelsFromStorage,
  modelReducer,
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

function state() {
  return {
    backgroundAgentSettings: backgroundInitialState,
    providerSettings: { ...providerSettingsInitialState },
    providerCatalog: {
      providers: createCollection('id', [{ id: 'codex', canBeDisabled: true }]),
      loaded: true,
    },
    model: {
      ...modelInitialState,
      providerModels: { auggie: 'sonnet4.5' },
      defaultReasoningEffort: 'high',
      defaultProviderId: 'auggie',
    },
  };
}

function selectionEnvironment(
  current: Omit<ReturnType<typeof state>, 'model'> & { model: typeof modelInitialState },
) {
  const channel = stdChannel();
  const dispatch = vi.fn((action) => {
    current.model = modelReducer(current.model, action);
    current.providerSettings = providerSettingsReducer(current.providerSettings, action);
    channel.put(action);
    return action;
  });
  const environment = { channel, dispatch, getState: () => current };
  const owner = runSaga(environment, modelSelectionSaga);
  return { environment, dispatch, owner };
}

describe('modelSelectionSaga', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.update.mockResolvedValue([]);
    mocks.list.mockImplementation(async () => structuredClone(daemonSettings));
    mocks.listSnapshot = undefined;
  });

  it('routes a known compound pick without changing daemon-owned state or requesting a reload', async () => {
    const current = state();
    const { environment, dispatch, owner } = selectionEnvironment(current);
    try {
      await runSaga(environment, handleSelectModel, selectModel('codex:gpt-5')).toPromise();

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
      expect(current.model.defaultProviderId).toBe('auggie');
      expect(current.model.providerModels).toEqual({ auggie: 'sonnet4.5' });
      expect(mocks.update).toHaveBeenCalledTimes(1);
    } finally {
      owner.cancel();
      await owner.toPromise();
    }
  });

  it('keeps daemon receipts authoritative while a compound Claude pick is in flight', async () => {
    mocks.update.mockReturnValueOnce(new Promise(() => {}));
    const current = {
      ...state(),
      model: { ...modelInitialState },
      providerCatalog: {
        providers: createCollection('id', [{ id: 'claude-code', canBeDisabled: true }]),
        loaded: true,
      },
    };
    const { environment, dispatch, owner } = selectionEnvironment(current);
    try {
      await runSaga(
        environment,
        handleSelectModel,
        selectModel('claude-code:opus-4-1'),
      ).toPromise();
      await settle();
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(current.model.defaultProviderId).toBe('');
      dispatch(hydrateDefaultProvider('auggie'));
      dispatch(loadProviderModelsFromStorage({ auggie: 'external' }));
      expect(current.model.defaultProviderId).toBe('auggie');
      expect(current.model.providerModels).toEqual({ auggie: 'external' });
    } finally {
      owner.cancel();
      await owner.toPromise();
    }
  });

  it('does not switch for an unknown compound provider once the catalog is loaded', async () => {
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: state },
      handleSelectModel,
      selectModel('unknown:model'),
    ).toPromise();

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('sends a compound provider pick before catalog hydration without adopting it locally', async () => {
    const preCatalog = {
      ...state(),
      providerCatalog: { providers: createCollection('id', []), loaded: false },
    };
    const { environment, dispatch, owner } = selectionEnvironment(preCatalog);
    try {
      await runSaga(environment, handleSelectModel, selectModel('claude-code:fable5')).toPromise();

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
      expect(preCatalog.model.defaultProviderId).toBe('auggie');
    } finally {
      owner.cancel();
      await owner.toPromise();
    }
  });

  it('reads the uncached daemon map instead of merging picks over Redux', async () => {
    mocks.list.mockResolvedValue([
      ...daemonSettings.filter(({ path }) => path.startsWith('quickActions.')),
      { path: 'model.defaultProvider', value: 'auggie' },
      { path: 'model.providerDefaults', value: { auggie: 'external', grok: 'keep' } },
    ]);
    const landed = await runSaga(
      { dispatch: vi.fn(), getState: state },
      persistSelectedModelsWorker,
      { codex: 'codex:gpt-5' },
    ).toPromise();

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
    const dispatch = vi.fn();

    const landed = await runSaga(
      { dispatch, getState: state },
      persistSelectedModelsWorker,
      { codex: 'codex:gpt-5' },
      'codex',
    ).toPromise();

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
      const current = state();
      const before = current.model;
      current.model = modelReducer(
        current.model,
        setSelectedModel({ providerId: 'codex', model: 'gpt-5' }),
      );
      expect(current.model).toBe(before);
      const dispatch = vi.fn((action) => {
        current.model = modelReducer(current.model, action);
      });
      const result = await runSaga(
        { dispatch, getState: () => current },
        persistSelectedModelsWorker,
        { codex: 'gpt-5' },
        'codex',
        null,
      ).toPromise();
      expect(result).toBe(true);
      expect(current.model).toBe(before);
      expect(dispatch).not.toHaveBeenCalled();
      dispatch(hydrateDefaultProvider('codex'));
      dispatch(loadProviderModelsFromStorage({ auggie: 'sonnet4.5', codex: 'gpt-5' }));
      expect(current.model.defaultProviderId).toBe('codex');
      expect(current.model.providerModels).toEqual({ auggie: 'sonnet4.5', codex: 'gpt-5' });
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
    const current = state();
    const { dispatch, owner: task } = selectionEnvironment(current);
    await settle();

    dispatch(setSelectedModel({ providerId: 'auggie', model: 'one' }));
    await settle();
    dispatch(setSelectedModel({ providerId: 'auggie', model: 'two' }));
    dispatch(setSelectedModel({ providerId: 'auggie', model: 'three' }));
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(current.model.providerModels).toEqual({ auggie: 'sonnet4.5' });
    release();
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(3));

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.providerDefaults', value: { auggie: 'one' } }]],
      [[{ path: 'model.providerDefaults', value: { auggie: 'two' } }]],
      [[{ path: 'model.providerDefaults', value: { auggie: 'three' } }]],
    ]);
    expect(mocks.list.mock.calls).toEqual([[], [], []]);
    expect(current.model.providerModels).toEqual({ auggie: 'sonnet4.5' });
    task.cancel();
    await task.toPromise();
  });

  it('does not send a write after the connection changes during its uncached read', async () => {
    let release!: (settings: AppSettingChange[]) => void;
    mocks.list.mockReturnValueOnce(
      new Promise<AppSettingChange[]>((resolve) => {
        release = resolve;
      }),
    );
    const current = state();
    const dispatch = vi.fn();
    const task = runSaga(
      { dispatch, getState: () => current },
      persistSelectedModelsWorker,
      { codex: 'gpt-5' },
      'codex',
      null,
    );
    current.model = modelReducer(current.model, hostExecutionConnectionChanged('remote'));
    release(structuredClone(daemonSettings));
    expect(await task.toPromise()).toBe(false);
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
    const current = state();
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => current },
      modelSelectionSaga,
    );
    await settle();

    // First pick's settings.update is held in flight.
    channel.put(setSelectedModel({ providerId: 'auggie', model: 'one' }));
    await settle();
    // A newer pick queues while the write is in flight...
    channel.put(setSelectedModel({ providerId: 'auggie', model: 'two' }));
    // ...then a stale snapshot/echo hydration resets the map to the older value.
    current.model = modelReducer(current.model, loadProviderModelsFromStorage({ auggie: 'one' }));
    channel.put(loadProviderModelsFromStorage({ auggie: 'one' }));
    release();
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));

    // The queued action's payload wins — the stale renderer receipt is never persisted.
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.providerDefaults', value: { auggie: 'one' } }]],
      [[{ path: 'model.providerDefaults', value: { auggie: 'two' } }]],
    ]);
    task.cancel();
    await task.toPromise();
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
    const current = state();
    const channel = stdChannel();
    const dispatch = (action: Parameters<typeof modelReducer>[1]) => {
      current.model = modelReducer(current.model, action);
      channel.put(action);
    };
    const task = runSaga({ channel, dispatch, getState: () => current }, modelSelectionSaga);
    await settle();

    // Provider A's pick starts a held-in-flight write.
    dispatch(setSelectedModel({ providerId: 'codex', model: 'gpt-5' }));
    await settle();
    // Provider B's pick queues behind it...
    dispatch(setSelectedModel({ providerId: 'claude-code', model: 'fable5' }));
    // The earlier write commits independently of renderer receipt timing.
    persisted.find(({ path }) => path === 'model.providerDefaults')!.value = {
      auggie: 'external',
      codex: 'gpt-5',
      grok: 'keep',
    };
    dispatch(loadProviderModelsFromStorage({ auggie: 'sonnet4.5' }));
    release();
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));

    expect(current.model.providerModels).toEqual({ auggie: 'sonnet4.5' });
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
    task.cancel();
    await task.toPromise();
  });

  it('does not retry a structured daemon error response for providerDefaults', async () => {
    mocks.update.mockRejectedValue(
      new BackendError({ code: 'INVALID_PARAMS', message: 'invalid', rpcCode: -32602 }),
    );
    const current = state();
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => current },
      modelSelectionSaga,
    );

    channel.put(setSelectedModel({ providerId: 'auggie', model: 'picked' }));
    await settle();

    expect(mocks.update).toHaveBeenCalledTimes(1);
    task.cancel();
    await task.toPromise();
  });

  it('does not resend a rejected session pick with the next valid write', async () => {
    mocks.update
      .mockRejectedValueOnce(
        new BackendError({ code: 'INVALID_PARAMS', message: 'invalid', rpcCode: -32602 }),
      )
      .mockResolvedValue([]);
    const current = state();
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => current },
      modelSelectionSaga,
    );

    channel.put(setSelectedModel({ providerId: 'auggie', model: 'invalid' }));
    await settle();

    channel.put(setSelectedModel({ providerId: 'codex', model: 'gpt-5' }));
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
    task.cancel();
    await task.toPromise();
  });

  it('requests field-only recovery after transport failure without scheduling a retry', async () => {
    vi.useFakeTimers();
    try {
      mocks.update.mockRejectedValueOnce(new Error('backend unavailable')).mockResolvedValue([]);
      const current = state();
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => current }, modelSelectionSaga);

      channel.put(setSelectedModel({ providerId: 'auggie', model: 'picked' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.update).toHaveBeenCalledTimes(1);

      await vi.runAllTimersAsync();
      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'model.providerDefaults', value: { auggie: 'picked' } }]],
      ]);
      expect(dispatch).toHaveBeenCalledWith(
        settingsFieldsRefreshRequested(['model.providerDefaults'], null),
      );
      expect(current.model.providerModels).toEqual({ auggie: 'sonnet4.5' });
      task.cancel();
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues to the next queued model intent after a failed write without retrying it', async () => {
    vi.useFakeTimers();
    try {
      mocks.update.mockRejectedValueOnce(new Error('backend unavailable')).mockResolvedValue([]);
      const current = state();
      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => current },
        modelSelectionSaga,
      );

      channel.put(setSelectedModel({ providerId: 'auggie', model: 'first' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.update).toHaveBeenCalledTimes(1);

      channel.put(setSelectedModel({ providerId: 'auggie', model: 'second' }));
      await vi.advanceTimersByTimeAsync(0);

      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'model.providerDefaults', value: { auggie: 'first' } }]],
        [[{ path: 'model.providerDefaults', value: { auggie: 'second' } }]],
      ]);
      task.cancel();
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists the exact daemon settings path and the picked effort', async () => {
    mocks.update.mockResolvedValue([]);
    await runSaga(
      { dispatch: vi.fn(), getState: state },
      persistDefaultReasoningEffortWorker,
      'high',
    ).toPromise();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultReasoningEffort', value: 'high' }]],
    ]);
  });

  it('persists effort picks including clearing to Default (empty string)', async () => {
    mocks.update.mockResolvedValue([]);
    const current = state();
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => current },
      modelSelectionSaga,
    );
    await settle();

    channel.put(setDefaultReasoningEffort('low'));
    await settle();
    channel.put(setDefaultReasoningEffort(''));
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultReasoningEffort', value: 'low' }]],
      [[{ path: 'model.defaultReasoningEffort', value: '' }]],
    ]);
    expect(current.model.defaultReasoningEffort).toBe('high');
    task.cancel();
    await task.toPromise();
  });

  it('does not persist the hydration echo (no write loop)', async () => {
    mocks.update.mockResolvedValue([]);
    const current = state();
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => current },
      modelSelectionSaga,
    );
    await settle();

    channel.put(loadDefaultReasoningEffortFromStorage('medium'));
    await settle();

    expect(mocks.update).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
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
    const current = state();
    const { dispatch, owner: task } = selectionEnvironment(current);
    await settle();

    // First pick's settings.update is held in flight.
    dispatch(setDefaultReasoningEffort('low'));
    await settle();
    // A newer pick queues while the write is in flight...
    dispatch(setDefaultReasoningEffort('medium'));
    dispatch(setDefaultReasoningEffort(''));
    expect(current.model.defaultReasoningEffort).toBe('high');
    // ...then the daemon echo of the FIRST write resets state to the older value.
    dispatch(loadDefaultReasoningEffortFromStorage('low'));
    release();
    await settle();

    // The queued action's payload wins — the stale snapshot is never persisted.
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultReasoningEffort', value: 'low' }]],
      [[{ path: 'model.defaultReasoningEffort', value: 'medium' }]],
      [[{ path: 'model.defaultReasoningEffort', value: '' }]],
    ]);
    expect(current.model.defaultReasoningEffort).toBe('low');
    task.cancel();
    await task.toPromise();
  });

  it('requests only effort recovery when an effort write fails', async () => {
    mocks.update.mockRejectedValueOnce(new Error('offline'));
    const current = state();
    const { dispatch, owner } = selectionEnvironment(current);
    try {
      dispatch(setDefaultReasoningEffort('low'));
      dispatch(setDefaultReasoningEffort('medium'));
      await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'model.defaultReasoningEffort', value: 'low' }]],
        [[{ path: 'model.defaultReasoningEffort', value: 'medium' }]],
      ]);
      expect(dispatch).toHaveBeenCalledWith(
        settingsFieldsRefreshRequested(['model.defaultReasoningEffort'], null),
      );
      expect(current.model.defaultReasoningEffort).toBe('high');
    } finally {
      owner.cancel();
      await owner.toPromise();
    }
  });
});
