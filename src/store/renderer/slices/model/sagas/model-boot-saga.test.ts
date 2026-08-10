import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

const mocks = vi.hoisted(() => ({ list: vi.fn(), getProviderSettings: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: {
    models: { list: mocks.list },
    settings: { getProviderSettings: mocks.getProviderSettings },
  },
}));

import { loadModelsOnBootWorker } from './model-boot-saga';

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
