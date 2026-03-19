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
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

vi.mock('$features/agent/services/unified-state-store', () => ({
  unifiedStateStore: {
    setAvailableModels: vi.fn(),
    setModelsLoading: vi.fn(),
  },
}));

vi.mock('../model-utils', () => ({
  fetchModelsForProvider: vi.fn(),
}));

import { createCollection } from '$lib/store/utils/collection-utils';
import { fetchModelsForProvider } from '../model-utils';
import { selectModel, setAvailableModels, setLoadingStateForProvider } from '../model-slice';
import { handleLoadModels } from './load-models-saga';

describe('loadModelsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes and persists an existing matched model for the active provider', async () => {
    vi.mocked(fetchModelsForProvider).mockResolvedValue([
      { value: 'gpt5.4', label: 'GPT 5.4' },
    ] as any);

    await expectSaga(handleLoadModels)
      .withState({
        model: {
          availableModels: createCollection('value'),
          loadingState: {},
          workspaceModels: {},
          providerModels: {},
        },
        providerSettings: {
          activeProviderId: 'codex',
          enabledProviders: {},
        },
      })
      .put(
        setLoadingStateForProvider({
          providerId: 'codex',
          status: 'loading',
        })
      )
      .put(setAvailableModels([{ value: 'codex:gpt5.4', label: 'GPT 5.4' }]))
      .put(
        setLoadingStateForProvider({
          providerId: 'codex',
          status: 'success',
          retryAttempt: 0,
        })
      )
      .put(selectModel('codex:gpt5.4'))
      .silentRun(0);
  });
});