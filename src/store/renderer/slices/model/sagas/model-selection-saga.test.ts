import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ update: vi.fn(), updateSnapshot: undefined as any }));
vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      update: mocks.update,
      get updateSnapshot() {
        return mocks.updateSnapshot;
      },
    },
  },
}));

import { BackendError } from '$lib/client/live/backend-transport-types';
import {
  hydrateActiveProvider,
  initialState as providerSettingsInitialState,
  providerSettingsReducer,
} from '../../provider-settings/provider-settings-slice';

import {
  loadDefaultReasoningEffortFromStorage,
  loadProviderModelsFromStorage,
  selectModel,
  setDefaultReasoningEffort,
  setSelectedModel,
} from '../model-slice';
import {
  modelSelectionSaga,
  persistDefaultReasoningEffortWorker,
  persistSelectedModelsWorker,
  handleSelectModel,
  PROVIDER_DEFAULTS_RETRY_DELAYS_MS,
} from './model-selection-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function state() {
  return {
    providerSettings: { ...providerSettingsInitialState, activeProviderId: 'auggie' },
    providerCatalog: {
      providers: createCollection('id', [{ id: 'codex', canBeDisabled: true }]),
      loaded: true,
    },
    model: {
      providerModels: { auggie: 'sonnet4.5' },
      defaultReasoningEffort: 'high',
      defaultProviderId: 'auggie',
    },
  };
}

describe('modelSelectionSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSnapshot = undefined;
  });

  it('switches a known compound provider before reload and selection', async () => {
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: state },
      handleSelectModel,
      selectModel('codex:gpt-5'),
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'model/reloadModelsForProvider', payload: [] },
      {
        type: 'providerSettings/setAtomicDefaultModel',
        payload: [{ providerId: 'codex', model: 'codex:gpt-5' }],
      },
    ]);
  });

  it('keeps a compound Claude model pick authoritative over stale provider hydration', async () => {
    const current = {
      ...state(),
      providerCatalog: {
        providers: createCollection('id', [{ id: 'claude-code', canBeDisabled: true }]),
        loaded: true,
      },
    };
    const dispatch = vi.fn((action) => {
      current.providerSettings = providerSettingsReducer(current.providerSettings, action);
      return action;
    });

    await runSaga(
      { dispatch, getState: () => current },
      handleSelectModel,
      selectModel('claude-code:opus-4-1'),
    ).toPromise();
    current.providerSettings = providerSettingsReducer(
      current.providerSettings,
      hydrateActiveProvider('auggie'),
    );

    expect(current.providerSettings.activeProviderId).toBe('claude-code');
    expect(current.providerSettings.pendingActiveProviderId).toBe('claude-code');
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

  it('adopts the picked compound provider before catalog hydration (onboarding race)', async () => {
    const preCatalog = {
      ...state(),
      providerCatalog: { providers: createCollection('id', []), loaded: false },
    };
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => preCatalog },
      handleSelectModel,
      selectModel('claude-code:fable5'),
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'model/reloadModelsForProvider', payload: [] },
      {
        type: 'providerSettings/setAtomicDefaultModel',
        payload: [{ providerId: 'claude-code', model: 'claude-code:fable5' }],
      },
    ]);
  });

  it('persists the exact daemon settings path with the session picks overlaid on the map', async () => {
    mocks.update.mockResolvedValue([]);
    const landed = await runSaga(
      { dispatch: vi.fn(), getState: state },
      persistSelectedModelsWorker,
      { codex: 'codex:gpt-5' },
    ).toPromise();

    expect(landed).toBe('persisted');
    expect(mocks.update.mock.calls).toEqual([
      [
        [
          {
            path: 'model.providerDefaults',
            value: { auggie: 'sonnet4.5', codex: 'codex:gpt-5' },
          },
        ],
      ],
    ]);
  });

  it('persists a cross-provider default as one revision-bearing atomic batch', async () => {
    mocks.updateSnapshot = vi.fn().mockResolvedValue({
      applied: [
        { path: 'providers.active', value: 'codex' },
        { path: 'model.providerDefaults', value: { auggie: 'sonnet4.5', codex: 'codex:gpt-5' } },
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

    expect(landed).toBe('persisted');
    expect(mocks.updateSnapshot).toHaveBeenCalledWith([
      { path: 'providers.active', value: 'codex' },
      {
        path: 'model.providerDefaults',
        value: { auggie: 'sonnet4.5', codex: 'codex:gpt-5' },
      },
    ]);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'settings/changesReceived',
      payload: [
        [
          { path: 'providers.active', value: 'codex' },
          {
            path: 'model.providerDefaults',
            value: { auggie: 'sonnet4.5', codex: 'codex:gpt-5' },
          },
        ],
        7,
      ],
    });
  });

  it('serializes writes and retains only the latest queued snapshot', async () => {
    let release!: () => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve;
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

    current.model.providerModels = { auggie: 'one' };
    channel.put(setSelectedModel({ providerId: 'auggie', model: 'one' }));
    await settle();
    current.model.providerModels = { auggie: 'two' };
    channel.put(setSelectedModel({ providerId: 'auggie', model: 'two' }));
    current.model.providerModels = { auggie: 'three' };
    channel.put(setSelectedModel({ providerId: 'auggie', model: 'three' }));
    release();
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.providerDefaults', value: { auggie: 'one' } }]],
      [[{ path: 'model.providerDefaults', value: { auggie: 'three' } }]],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists the queued pick even when a stale hydration echo clobbers the map first', async () => {
    let release!: () => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve;
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
    current.model.providerModels = { auggie: 'one' };
    channel.put(setSelectedModel({ providerId: 'auggie', model: 'one' }));
    await settle();
    // A newer pick queues while the write is in flight...
    current.model.providerModels = { auggie: 'two' };
    channel.put(setSelectedModel({ providerId: 'auggie', model: 'two' }));
    // ...then a stale snapshot/echo hydration resets the map to the older value.
    current.model.providerModels = { auggie: 'one' };
    channel.put(loadProviderModelsFromStorage({ auggie: 'one' }));
    release();
    await settle();

    // The queued action's payload wins — the stale snapshot is never persisted.
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.providerDefaults', value: { auggie: 'one' } }]],
      [[{ path: 'model.providerDefaults', value: { auggie: 'two' } }]],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it("keeps an earlier provider's pick when a stale echo interleaves a different provider's write", async () => {
    let release!: () => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve;
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

    // Provider A's pick starts a held-in-flight write.
    current.model.providerModels = { auggie: 'sonnet4.5', codex: 'codex:gpt-5' };
    channel.put(setSelectedModel({ providerId: 'codex', model: 'codex:gpt-5' }));
    await settle();
    // Provider B's pick queues behind it...
    current.model.providerModels = {
      auggie: 'sonnet4.5',
      codex: 'codex:gpt-5',
      'claude-code': 'claude-code:fable5',
    };
    channel.put(setSelectedModel({ providerId: 'claude-code', model: 'claude-code:fable5' }));
    // ...then a stale boot snapshot resets the SHARED map, wiping A's pick
    // from state before B's write runs.
    current.model.providerModels = { auggie: 'sonnet4.5' };
    channel.put(loadProviderModelsFromStorage({ auggie: 'sonnet4.5' }));
    release();
    await settle();

    // Both session picks survive: the second write overlays A's AND B's picks
    // onto the stale map instead of spreading it with only B applied.
    expect(mocks.update.mock.calls).toEqual([
      [
        [
          {
            path: 'model.providerDefaults',
            value: { auggie: 'sonnet4.5', codex: 'codex:gpt-5' },
          },
        ],
      ],
      [
        [
          {
            path: 'model.providerDefaults',
            value: {
              auggie: 'sonnet4.5',
              codex: 'codex:gpt-5',
              'claude-code': 'claude-code:fable5',
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

    current.model.providerModels = { auggie: 'invalid' };
    channel.put(setSelectedModel({ providerId: 'auggie', model: 'invalid' }));
    await settle();

    current.model.providerModels = { auggie: 'sonnet4.5', codex: 'codex:gpt-5' };
    channel.put(setSelectedModel({ providerId: 'codex', model: 'codex:gpt-5' }));
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.providerDefaults', value: { auggie: 'invalid' } }]],
      [
        [
          {
            path: 'model.providerDefaults',
            value: { auggie: 'sonnet4.5', codex: 'codex:gpt-5' },
          },
        ],
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('retries a failed providerDefaults write until it lands (daemon not ready at pick time)', async () => {
    vi.useFakeTimers();
    try {
      mocks.update.mockRejectedValueOnce(new Error('backend unavailable')).mockResolvedValue([]);
      const current = state();
      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => current },
        modelSelectionSaga,
      );

      current.model.providerModels = { auggie: 'picked' };
      channel.put(setSelectedModel({ providerId: 'auggie', model: 'picked' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.update).toHaveBeenCalledTimes(1);

      // The retry fires after the backoff delay and persists the same pick.
      await vi.advanceTimersByTimeAsync(PROVIDER_DEFAULTS_RETRY_DELAYS_MS[0]);
      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'model.providerDefaults', value: { auggie: 'picked' } }]],
        [[{ path: 'model.providerDefaults', value: { auggie: 'picked' } }]],
      ]);
      task.cancel();
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a newer pick supersede a failed write instead of waiting out the backoff', async () => {
    vi.useFakeTimers();
    try {
      mocks.update.mockRejectedValueOnce(new Error('backend unavailable')).mockResolvedValue([]);
      const current = state();
      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => current },
        modelSelectionSaga,
      );

      current.model.providerModels = { auggie: 'first' };
      channel.put(setSelectedModel({ providerId: 'auggie', model: 'first' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.update).toHaveBeenCalledTimes(1);

      current.model.providerModels = { auggie: 'second' };
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

    current.model.defaultReasoningEffort = 'low';
    channel.put(setDefaultReasoningEffort('low'));
    await settle();
    current.model.defaultReasoningEffort = '';
    channel.put(setDefaultReasoningEffort(''));
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultReasoningEffort', value: 'low' }]],
      [[{ path: 'model.defaultReasoningEffort', value: '' }]],
    ]);
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

    current.model.defaultReasoningEffort = 'medium';
    channel.put(loadDefaultReasoningEffortFromStorage('medium'));
    await settle();

    expect(mocks.update).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('persists the queued pick even when a stale hydration echo resets state first', async () => {
    let release!: () => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve;
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
    current.model.defaultReasoningEffort = 'low';
    channel.put(setDefaultReasoningEffort('low'));
    await settle();
    // A newer pick queues while the write is in flight...
    current.model.defaultReasoningEffort = 'medium';
    channel.put(setDefaultReasoningEffort('medium'));
    // ...then the daemon echo of the FIRST write resets state to the older value.
    current.model.defaultReasoningEffort = 'low';
    channel.put(loadDefaultReasoningEffortFromStorage('low'));
    release();
    await settle();

    // The queued action's payload wins — the stale snapshot is never persisted.
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultReasoningEffort', value: 'low' }]],
      [[{ path: 'model.defaultReasoningEffort', value: 'medium' }]],
    ]);
    task.cancel();
    await task.toPromise();
  });
});
