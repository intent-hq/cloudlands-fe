import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';
import * as sagaEffects from 'redux-saga/effects';

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
  },
}));

vi.mock('$lib/stores/active-provider.store.svelte', () => ({
  activeProviderStore: {
    activeProviderId: 'codex',
  },
}));

import { unifiedStateStore } from '$features/agent/services/unified-state-store';
import {
  GLOBAL_MODEL_KEY,
  clearAllWorkspaceModels,
  loadModels,
  setActiveProviderId,
  setLoadError,
  setModelsLoaded,
  setRetryAttempt,
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
      })
      .put(clearAllWorkspaceModels())
      .put(setSelectedModel(savedModel))
      .call([localStorage, localStorage.setItem], GLOBAL_MODEL_KEY, savedModel)
      .put(setActiveProviderId('codex'))
      .put(setModelsLoaded({ providerId: 'codex', loaded: false }))
      .put(setLoadError(null))
      .put(setRetryAttempt(0))
      .put(loadModels())
      .silentRun(0);

    expect(unifiedStateStore.selectModel).toHaveBeenCalledWith(savedModel);
  });
});