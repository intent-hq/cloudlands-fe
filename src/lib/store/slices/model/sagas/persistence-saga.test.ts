import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';
import * as sagaEffects from 'redux-saga/effects';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';

vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

vi.mock('$features/agent/services/unified-state-store', () => ({
  unifiedStateStore: {
    selectModel: vi.fn(),
    setAvailableModels: vi.fn(),
  },
}));

import { unifiedStateStore } from '$features/agent/services/unified-state-store';
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

    expect(unifiedStateStore.selectModel).toHaveBeenCalledWith(savedModel);
    expect(unifiedStateStore.setAvailableModels).toHaveBeenCalledWith([]);
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

    expect(unifiedStateStore.selectModel).toHaveBeenCalledWith(fallbackModel);
    expect(unifiedStateStore.setAvailableModels).toHaveBeenCalledWith([]);
  });
});