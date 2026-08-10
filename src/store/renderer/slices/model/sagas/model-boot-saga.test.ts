import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getProviderSettings: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    models: { list: mocks.list },
    settings: { getProviderSettings: mocks.getProviderSettings },
  },
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendReconnected: mocks.onBackendReconnected,
}));

import { loadModelsOnBootWorker, modelBootSaga } from './model-boot-saga';

const MODELS = [{ value: 'gpt-5', label: 'GPT-5', effortLevels: ['low', 'medium', 'high'] }];

describe('loadModelsOnBootWorker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads models for the slice-hydrated active provider without re-reading settings', async () => {
    mocks.list.mockResolvedValue(MODELS);
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => ({ providerSettings: { activeProviderId: 'codex' } }) },
      loadModelsOnBootWorker,
    ).toPromise();

    expect(mocks.getProviderSettings).not.toHaveBeenCalled();
    expect(mocks.list.mock.calls).toEqual([[]]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'model/setAvailableModels', payload: [MODELS, 'codex'] },
      {
        type: 'model/setLoadingStateForProvider',
        payload: [{ providerId: 'codex', status: 'success', retryAttempt: 0 }],
      },
    ]);
  });

  it('falls back to settings.getProviderSettings when the slice is not hydrated yet', async () => {
    mocks.getProviderSettings.mockResolvedValue({
      activeProviderId: 'auggie',
      enabledProviders: {},
    });
    mocks.list.mockResolvedValue(MODELS);
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => ({ providerSettings: { activeProviderId: '' } }) },
      loadModelsOnBootWorker,
    ).toPromise();

    expect(mocks.getProviderSettings).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'model/setAvailableModels', payload: [MODELS, 'auggie'] },
      {
        type: 'model/setLoadingStateForProvider',
        payload: [{ providerId: 'auggie', status: 'success', retryAttempt: 0 }],
      },
    ]);
  });

  it('does nothing when no active provider is known anywhere', async () => {
    mocks.getProviderSettings.mockResolvedValue(null);
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => ({ providerSettings: { activeProviderId: '' } }) },
      loadModelsOnBootWorker,
    ).toPromise();

    expect(mocks.list).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('drops the response when the active provider changed while the list was in flight', async () => {
    const current = { providerSettings: { activeProviderId: '' } };
    mocks.getProviderSettings.mockResolvedValue({
      activeProviderId: 'codex',
      enabledProviders: {},
    });
    mocks.list.mockImplementation(async () => {
      current.providerSettings.activeProviderId = 'auggie';
      return MODELS;
    });
    const dispatch = vi.fn();
    await runSaga({ dispatch, getState: () => current }, loadModelsOnBootWorker).toPromise();

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('leaves state untouched on an empty catalog (seeder semantics)', async () => {
    mocks.list.mockResolvedValue([]);
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => ({ providerSettings: { activeProviderId: 'codex' } }) },
      loadModelsOnBootWorker,
    ).toPromise();

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('swallows transport failures without dispatching', async () => {
    mocks.list.mockRejectedValue(new Error('uds boom'));
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => ({ providerSettings: { activeProviderId: 'codex' } }) },
      loadModelsOnBootWorker,
    ).toPromise();

    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('modelBootSaga', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  let reconnect: () => void;
  const dispose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onBackendReconnected.mockImplementation((handler: () => void) => {
      reconnect = handler;
      return dispose;
    });
  });

  const start = () =>
    runSaga(
      {
        dispatch: vi.fn(),
        getState: () => ({ providerSettings: { activeProviderId: 'codex' } }),
      },
      modelBootSaga,
    );

  it('runs the boot load once and re-runs it on each backend reconnect', async () => {
    mocks.list.mockResolvedValue(MODELS);
    const task = start();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    reconnect();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    reconnect();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(3);

    task.cancel();
  });

  it('coalesces a reconnect burst during an in-flight load into one trailing re-run', async () => {
    let resolveFirst: (models: typeof MODELS) => void;
    mocks.list
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue(MODELS);
    const task = start();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    reconnect();
    reconnect();
    reconnect();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    resolveFirst!(MODELS);
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    task.cancel();
  });

  it('keeps re-running after a failed reconnect load (worker swallows the error)', async () => {
    mocks.list
      .mockResolvedValueOnce(MODELS)
      .mockRejectedValueOnce(new Error('uds boom'))
      .mockResolvedValue(MODELS);
    const task = start();
    await flush();

    reconnect();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    reconnect();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(3);

    task.cancel();
  });

  it('disposes the reconnect listener when the saga is cancelled', async () => {
    mocks.list.mockResolvedValue(MODELS);
    const task = start();
    await flush();
    expect(dispose).not.toHaveBeenCalled();

    task.cancel();
    await flush();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
