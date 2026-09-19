import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getProviderModels: vi.fn(),
  setModel: vi.fn(),
  reconcileEffort: vi.fn(),
}));
vi.mock('$lib/client', () => ({ appClient: { models: { list: mocks.list } } }));
vi.mock('$features/agent/agent.client', () => ({ agentClient: { setModel: mocks.setModel } }));
vi.mock('$features/agent/reasoning-effort', () => ({
  reconcileAgentReasoningEffort: mocks.reconcileEffort,
}));
vi.mock('../model-utils', () => ({
  getModelsForProviderForLoadingState: mocks.getProviderModels,
}));

import { m } from '$shared/paraglide/messages.js';
import { reloadModelsForProvider, setAgentModelRequested } from '../model-slice';
import { loadProviderModelsRequested } from '../../provider-models/provider-models-slice';
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

    expect(mocks.list.mock.calls).toEqual([['auggie']]);
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

  it('debounces and force-refreshes one provider through the saga', async () => {
    vi.useFakeTimers();
    const result = {
      models: [{ value: 'codex:gpt-6', label: 'GPT-6' }],
      warning: 'stale adapter',
      stale: true,
    };
    mocks.getProviderModels.mockResolvedValue(result);
    const channel = stdChannel();
    const dispatch = vi.fn();
    const state = { providerModels: { byProviderId: {}, clearEpoch: 0 } };
    const task = runSaga({ channel, dispatch, getState: () => state }, modelReloadSaga);
    const action = loadProviderModelsRequested('codex', true, true);

    channel.put(action);
    await vi.advanceTimersByTimeAsync(49);
    expect(mocks.getProviderModels).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(action.promise).resolves.toEqual(result);

    expect(mocks.getProviderModels).toHaveBeenCalledExactlyOnceWith('codex', {
      forceRefresh: true,
    });
    expect(dispatch.mock.calls.map(([dispatched]) => dispatched.type)).toEqual([
      'model/setLoadingStateForProvider',
      'providerModels/providerModelsLoaded',
      'model/setLoadingStateForProvider',
      'providerModels/loadProviderModelsRequested_SUCCESS',
    ]);
    task.cancel();
    vi.useRealTimers();
  });

  it('sends the exact agent model request and reconciles effort from the protocol response', async () => {
    mocks.setModel.mockResolvedValue({ ok: true, data: { success: true, modelId: 'gpt-6' } });
    mocks.reconcileEffort.mockResolvedValue(true);
    const channel = stdChannel();
    const dispatch = vi.fn();
    const state = {
      agentSessions: { byAgentId: { 'agent-1': { reasoningEffort: 'xhigh' } } },
    };
    const task = runSaga({ channel, dispatch, getState: () => state }, modelReloadSaga);
    const action = setAgentModelRequested(7, 'agent-1', 'ws-1', 'codex:gpt-6', 'codex', [
      'low',
      'high',
    ]);

    channel.put(action);
    await expect(action.promise).resolves.toBeUndefined();

    expect(mocks.setModel).toHaveBeenCalledExactlyOnceWith(
      'agent-1',
      'codex:gpt-6',
      'ws-1',
      'codex',
    );
    expect(mocks.reconcileEffort).toHaveBeenCalledExactlyOnceWith('agent-1', 'ws-1', 'xhigh', [
      'low',
      'high',
    ]);
    expect(dispatch.mock.calls.map(([dispatched]) => dispatched.type)).toContain(
      'model/setAgentModelRequested_SUCCESS',
    );
    task.cancel();
  });
});
