import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { models: { list: mocks.list } } }));

import { m } from '$shared/paraglide/messages.js';
import { reloadModelsForProvider } from '../model-slice';
import { modelReloadSaga, reloadModelsWorker } from './model-reload-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('modelReloadSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clears stale models and reaches the exact success state', async () => {
    mocks.list.mockResolvedValue([{ value: 'sonnet4.5', label: 'Sonnet 4.5' }]);
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => ({ model: { defaultProviderId: 'auggie' } }) },
      reloadModelsWorker,
    ).toPromise();

    expect(mocks.list.mock.calls).toEqual([[]]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'model/setLoadingStateForProvider',
        payload: [{ providerId: 'auggie', status: 'loading' }],
      },
      { type: 'model/setAvailableModels', payload: [[], 'auggie'] },
      {
        type: 'model/setAvailableModels',
        payload: [[{ value: 'sonnet4.5', label: 'Sonnet 4.5' }], 'auggie'],
      },
      {
        type: 'model/setLoadingStateForProvider',
        payload: [{ providerId: 'auggie', status: 'success', retryAttempt: 0 }],
      },
    ]);
  });

  it('reaches the exact terminal state for an empty catalog', async () => {
    mocks.list.mockResolvedValue([]);
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => ({ model: { defaultProviderId: 'codex' } }) },
      reloadModelsWorker,
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'model/setLoadingStateForProvider',
        payload: [{ providerId: 'codex', status: 'loading' }],
      },
      { type: 'model/setAvailableModels', payload: [[], 'codex'] },
      {
        type: 'model/setLoadingStateForProvider',
        payload: [
          {
            providerId: 'codex',
            status: 'error',
            error: m.settings_models_noneAvailable({ providerId: 'codex' }),
          },
        ],
      },
    ]);
  });

  it('cancels an older reload so its response cannot overwrite the new provider', async () => {
    let resolveFirst!: (models: Array<{ value: string; label: string }>) => void;
    mocks.list
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce([{ value: 'gpt-5', label: 'GPT-5' }]);
    const current = { model: { defaultProviderId: 'auggie' } };
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => current }, modelReloadSaga);
    channel.put(reloadModelsForProvider());
    await settle();
    current.model.defaultProviderId = 'codex';
    channel.put(reloadModelsForProvider());
    await settle();
    resolveFirst([{ value: 'stale', label: 'Stale' }]);
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'model/setLoadingStateForProvider',
        payload: [{ providerId: 'auggie', status: 'loading' }],
      },
      { type: 'model/setAvailableModels', payload: [[], 'auggie'] },
      {
        type: 'model/setLoadingStateForProvider',
        payload: [{ providerId: 'codex', status: 'loading' }],
      },
      { type: 'model/setAvailableModels', payload: [[], 'codex'] },
      {
        type: 'model/setAvailableModels',
        payload: [[{ value: 'gpt-5', label: 'GPT-5' }], 'codex'],
      },
      {
        type: 'model/setLoadingStateForProvider',
        payload: [{ providerId: 'codex', status: 'success', retryAttempt: 0 }],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });
});
