import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getProviderSettings: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    models: { list: mocks.list },
    settings: { getProviderSettings: mocks.getProviderSettings },
  },
}));

import { loadModelsOnBootWorker, modelBootSaga } from './model-boot-saga';

const MODELS = [{ value: 'gpt-5', label: 'GPT-5', effortLevels: ['low', 'medium', 'high'] }];

describe('loadModelsOnBootWorker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads models for the slice-hydrated active provider without re-reading settings', async () => {
    mocks.list.mockResolvedValue(MODELS);
    const dispatch = vi.fn();
    const loaded = await runSaga(
      { dispatch, getState: () => ({ model: { defaultProviderId: 'codex' } }) },
      loadModelsOnBootWorker,
    ).toPromise();

    expect(loaded).toBe(true);
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
      { dispatch, getState: () => ({ model: { defaultProviderId: '' } }) },
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
    const loaded = await runSaga(
      { dispatch, getState: () => ({ model: { defaultProviderId: '' } }) },
      loadModelsOnBootWorker,
    ).toPromise();

    expect(loaded).toBe(false);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('drops the response when the active provider changed while the list was in flight', async () => {
    const current = { model: { defaultProviderId: '' } };
    mocks.getProviderSettings.mockResolvedValue({
      activeProviderId: 'codex',
      enabledProviders: {},
    });
    mocks.list.mockImplementation(async () => {
      current.model.defaultProviderId = 'auggie';
      return MODELS;
    });
    const dispatch = vi.fn();
    const loaded = await runSaga(
      { dispatch, getState: () => current },
      loadModelsOnBootWorker,
    ).toPromise();

    // The reload saga owns that provider's load — settled from our side.
    expect(loaded).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('leaves state untouched on an empty catalog (seeder semantics)', async () => {
    mocks.list.mockResolvedValue([]);
    const dispatch = vi.fn();
    const loaded = await runSaga(
      { dispatch, getState: () => ({ model: { defaultProviderId: 'codex' } }) },
      loadModelsOnBootWorker,
    ).toPromise();

    expect(loaded).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('swallows transport failures without dispatching', async () => {
    mocks.list.mockRejectedValue(new Error('uds boom'));
    const dispatch = vi.fn();
    const loaded = await runSaga(
      { dispatch, getState: () => ({ model: { defaultProviderId: 'codex' } }) },
      loadModelsOnBootWorker,
    ).toPromise();

    expect(loaded).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('modelBootSaga', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const statusHandlers: Array<(payload: unknown) => void> = [];
  const offById = vi.fn();

  const emitStatus = (payload: unknown) => {
    for (const handler of [...statusHandlers]) handler(payload);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    statusHandlers.length = 0;
    let listenerCount = 0;
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        if (channel === 'backend:status') statusHandlers.push(handler);
        return `listener-${++listenerCount}`;
      }),
      offById,
    };
  });

  const start = () =>
    runSaga(
      {
        dispatch: vi.fn(),
        getState: () => ({ model: { defaultProviderId: 'codex' } }),
      },
      modelBootSaga,
    );

  it('does not re-fetch on a plain connected when the boot load already succeeded', async () => {
    mocks.list.mockResolvedValue(MODELS);
    const task = start();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    emitStatus({ status: 'connected' });
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    task.cancel();
  });

  it('re-runs on the first connected when the boot load failed (slow daemon start)', async () => {
    mocks.list.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(MODELS);
    const task = start();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    emitStatus({ status: 'connected' });
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    // Settled now — a later plain connected does not re-fetch.
    emitStatus({ status: 'connected' });
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    task.cancel();
  });

  it('keeps retrying on each connect until a load lands', async () => {
    mocks.list
      .mockRejectedValueOnce(new Error('boot boom'))
      .mockRejectedValueOnce(new Error('retry boom'))
      .mockResolvedValue(MODELS);
    const task = start();
    await flush();

    emitStatus({ status: 'connected' });
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    emitStatus({ status: 'connected' });
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(3);

    emitStatus({ status: 'connected' });
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(3);

    task.cancel();
  });

  it('always re-runs on a reconnected marker, even after a successful load', async () => {
    mocks.list.mockResolvedValue(MODELS);
    const task = start();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    emitStatus({ status: 'connected', reconnected: true });
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    emitStatus({ status: 'connected', reconnected: true });
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(3);

    task.cancel();
  });

  it('ignores non-connected status events', async () => {
    mocks.list.mockRejectedValueOnce(new Error('boot boom')).mockResolvedValue(MODELS);
    const task = start();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    emitStatus({ status: 'connecting' });
    emitStatus({ status: 'disconnected' });
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    emitStatus({ status: 'connected' });
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    task.cancel();
  });

  it('coalesces a connect burst during an in-flight load into one trailing re-run', async () => {
    let resolveFirst: (models: typeof MODELS) => void;
    mocks.list
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue(MODELS);
    const task = start();
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    emitStatus({ status: 'connected' });
    emitStatus({ status: 'connected', reconnected: true });
    emitStatus({ status: 'connected', reconnected: true });
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    resolveFirst!(MODELS);
    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    task.cancel();
  });

  it('unregisters the status listener when the saga is cancelled', async () => {
    mocks.list.mockResolvedValue(MODELS);
    const task = start();
    await flush();
    expect(offById).not.toHaveBeenCalled();

    task.cancel();
    await flush();
    expect(offById).toHaveBeenCalledTimes(1);
    expect(offById).toHaveBeenCalledWith('backend:status', 'listener-1');
  });
});
