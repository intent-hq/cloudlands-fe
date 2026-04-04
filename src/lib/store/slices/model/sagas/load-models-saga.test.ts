import { beforeEach, describe, it, vi } from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';

vi.mock('typed-redux-saga', async () => await import('$lib/store/utils/test-helpers/typed-redux-saga-mock'));



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