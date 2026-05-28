import {
  beforeEach,
  describe,
  it,
  vi,
} from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';

vi.mock(
  'typed-redux-saga',
  async () => await import('$lib/store/utils/test-helpers/typed-redux-saga-mock'),
);

vi.mock('../model-utils', () => ({
  getModelsForProviderForLoadingState: vi.fn(),
}));

import { createCollection } from '$lib/store/utils/collection-utils';
import { getModelsForProviderForLoadingState } from '../model-utils';
import {
  MAX_AUTO_RETRIES,
  selectModel,
  setAvailableModels,
  setLoadingStateForProvider,
} from '../model-slice';
import { handleLoadModels } from './load-models-saga';

describe('loadModelsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes and persists an existing matched model for the active provider', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'gpt5.4', label: 'GPT 5.4' }] as any,
      warning: 'Codex not installed; using static model list',
    });

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
        }),
      )
      .put(setAvailableModels([{ value: 'codex:gpt5.4', label: 'GPT 5.4' }]))
      .put(
        setLoadingStateForProvider({
          providerId: 'codex',
          status: 'success',
          retryAttempt: 0,
          warning: 'Codex not installed; using static model list',
        }),
      )
      .put(selectModel('codex:gpt5.4'))
      .silentRun(0);
  });

  it('records provider-specific errors when fetching models fails', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockRejectedValue(
      new Error('Auggie: CLI not found'),
    );

    await expectSaga(handleLoadModels)
      .withState({
        model: {
          availableModels: createCollection('value'),
          loadingState: {
            auggie: { status: 'error', retryAttempt: MAX_AUTO_RETRIES },
          },
          workspaceModels: {},
          providerModels: {},
        },
        providerSettings: {
          activeProviderId: 'auggie',
          enabledProviders: {},
        },
      })
      .put(
        setLoadingStateForProvider({
          providerId: 'auggie',
          status: 'loading',
        }),
      )
      .put(
        setLoadingStateForProvider({
          providerId: 'auggie',
          status: 'error',
          error: 'Auggie: CLI not found',
        }),
      )
      .silentRun(0);
  });
});
