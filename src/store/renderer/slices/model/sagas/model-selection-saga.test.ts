import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { settings: { update: mocks.update } } }));

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
    providerSettings: { activeProviderId: 'auggie' },
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
  beforeEach(() => vi.clearAllMocks());

  it('switches a known compound provider before reload and selection', async () => {
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: state },
      handleSelectModel,
      selectModel('codex:gpt-5'),
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'providerSettings/setActiveProvider', payload: ['codex'] },
      { type: 'model/reloadModelsForProvider', payload: [] },
      {
        type: 'model/setSelectedModel',
        payload: [{ providerId: 'codex', model: 'codex:gpt-5' }],
      },
    ]);
  });

  it('does not switch for an unknown compound provider once the catalog is loaded', async () => {
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: state },
      handleSelectModel,
      selectModel('unknown:model'),
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'model/setSelectedModel',
        payload: [{ providerId: 'unknown', model: 'unknown:model' }],
      },
    ]);
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
      { type: 'providerSettings/setActiveProvider', payload: ['claude-code'] },
      { type: 'model/reloadModelsForProvider', payload: [] },
      {
        type: 'model/setSelectedModel',
        payload: [{ providerId: 'claude-code', model: 'claude-code:fable5' }],
      },
    ]);
  });

  it('persists the exact daemon settings path with the taken pick overlaid on the map', async () => {
    mocks.update.mockResolvedValue([]);
    const landed = await runSaga(
      { dispatch: vi.fn(), getState: state },
      persistSelectedModelsWorker,
      setSelectedModel({ providerId: 'codex', model: 'codex:gpt-5' }),
    ).toPromise();

    expect(landed).toBe(true);
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

  it('retries a failed providerDefaults write until it lands (daemon not ready at pick time)', async () => {
    vi.useFakeTimers();
    try {
      mocks.update
        .mockRejectedValueOnce(new Error('backend unavailable'))
        .mockResolvedValue([]);
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
      mocks.update
        .mockRejectedValueOnce(new Error('backend unavailable'))
        .mockResolvedValue([]);
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
