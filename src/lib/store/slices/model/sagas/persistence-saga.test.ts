import { beforeEach, describe, it, vi } from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';

vi.mock('typed-redux-saga', async () => await import('$lib/store/utils/test-helpers/typed-redux-saga-mock'));

import {
  removeLocalStorageItem,
  setLocalStorageItem,
} from '$lib/store/utils/safe-local-storage-saga';
import { normalizeModelForProvider } from '../model-selection-utils';
import {
  GLOBAL_MODEL_KEY,
  WORKSPACE_MODELS_KEY,
  clearLoadingStateForProvider,
  clearAllWorkspaceModels,
  loadModels,
  setAvailableModels,
  setSelectedModel,
} from '../model-slice';
import { handleReloadModelsForProvider } from './persistence-saga';

describe('persistenceSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('forces a refetch when reloading models for an already-loaded provider', async () => {
    const savedModel = 'codex:claude-sonnet-4-5';

    await expectSaga(handleReloadModelsForProvider)
      .withState({
        model: {
          providerModels: { codex: savedModel },
        },
        providerSettings: {
          activeProviderId: 'codex',
          enabledProviders: {},
        },
      })
      .put(clearAllWorkspaceModels())
      .call(removeLocalStorageItem, WORKSPACE_MODELS_KEY)
      .put(setSelectedModel({ providerId: 'codex', model: savedModel }))
      .call(setLocalStorageItem, GLOBAL_MODEL_KEY, savedModel)
      .put(clearLoadingStateForProvider('codex'))
      .put(setAvailableModels([]))
      .put(loadModels())
      .silentRun(0);
  });

  it('resets global and unified selection to a provider default when no saved model exists', async () => {
    const fallbackModel = normalizeModelForProvider('codex', MODEL_DEFAULTS.UI_INITIAL_MODEL);

    await expectSaga(handleReloadModelsForProvider)
      .withState({
        model: {
          providerModels: {},
        },
        providerSettings: {
          activeProviderId: 'codex',
          enabledProviders: {},
        },
      })
      .put(clearAllWorkspaceModels())
      .call(removeLocalStorageItem, WORKSPACE_MODELS_KEY)
      .put(setSelectedModel({ providerId: 'codex', model: fallbackModel }))
      .call(setLocalStorageItem, GLOBAL_MODEL_KEY, fallbackModel)
      .put(clearLoadingStateForProvider('codex'))
      .put(setAvailableModels([]))
      .put(loadModels())
      .silentRun(0);
  });
});