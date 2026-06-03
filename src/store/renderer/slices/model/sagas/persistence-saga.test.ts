import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  expectSaga,
  testSaga,
} from 'redux-saga-test-plan';
import * as sagaEffects from 'redux-saga/effects';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';

vi.mock(
  'typed-redux-saga',
  async () => await import('$store/renderer/utils/test-helpers/typed-redux-saga-mock'),
);

import {
  removeLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageJSON,
  setLocalStorageItem,
} from '$store/renderer/utils/safe-local-storage-saga';
import { selectModelPickerCollapsedGroups } from '../model-selectors';
import { normalizeModelForProvider } from '../model-selection-utils';
import {
  GLOBAL_MODEL_KEY,
  clearModelFallbackInfo,
  WORKSPACE_MODELS_KEY,
  clearLoadingStateForProvider,
  clearAllWorkspaceModels,
  clearWorkspaceModel,
  hydrateModelFallbackInfo,
  loadModels,
  reloadModelsForProvider,
  requestHydrateModelFallbackInfo,
  setAvailableModels,
  setModelPickerGroupCollapsed,
  setModelFallbackInfo,
  setSelectedModel,
  setWorkspaceModel,
} from '../model-slice';
import {
  handleClearModelFallbackInfo,
  handleCollapsedGroupsChange,
  handleHydrateModelFallbackInfo,
  handleReloadModelsForProvider,
  handleSetModelFallbackInfo,
  handleWorkspaceModelChange,
  initPersistenceSaga,
  MODEL_FALLBACK_KEY_PREFIX,
  MODEL_PICKER_COLLAPSED_GROUPS_KEY,
  persistenceSaga,
} from './persistence-saga';

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

  it('persists model picker collapsed groups from Redux state', () => {
    testSaga(handleCollapsedGroupsChange)
      .next()
      .select(selectModelPickerCollapsedGroups.select)
      .next(['auggie', 'codex'])
      .call(setLocalStorageJSON, MODEL_PICKER_COLLAPSED_GROUPS_KEY, ['auggie', 'codex'])
      .next()
      .isDone();
  });

  it('hydrates valid per-agent fallback info from storage', () => {
    const info = { fromModel: 'old-model', toModel: 'new-model' };

    testSaga(handleHydrateModelFallbackInfo, requestHydrateModelFallbackInfo('agent-1'))
      .next()
      .call(getLocalStorageJSON, `${MODEL_FALLBACK_KEY_PREFIX}agent-1`)
      .next(info)
      .put(hydrateModelFallbackInfo('agent-1', info))
      .next()
      .isDone();
  });

  it('hydrates null per-agent fallback info for malformed storage', () => {
    testSaga(handleHydrateModelFallbackInfo, requestHydrateModelFallbackInfo('agent-1'))
      .next()
      .call(getLocalStorageJSON, `${MODEL_FALLBACK_KEY_PREFIX}agent-1`)
      .next({ fromModel: 'old-model' })
      .put(hydrateModelFallbackInfo('agent-1', null))
      .next()
      .isDone();
  });

  it('persists and clears per-agent fallback info', () => {
    const info = { fromModel: 'old-model', toModel: 'new-model' };

    testSaga(handleSetModelFallbackInfo, setModelFallbackInfo('agent-1', info))
      .next()
      .call(setLocalStorageJSON, `${MODEL_FALLBACK_KEY_PREFIX}agent-1`, info)
      .next()
      .isDone();

    testSaga(handleClearModelFallbackInfo, clearModelFallbackInfo('agent-1'))
      .next()
      .call(removeLocalStorageItem, `${MODEL_FALLBACK_KEY_PREFIX}agent-1`)
      .next()
      .isDone();
  });

  it('registers per-agent fallback persistence without global cancellation', () => {
    const iterator = persistenceSaga();

    expect(iterator.next()).toEqual({ value: sagaEffects.call(initPersistenceSaga), done: false });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeLatest(reloadModelsForProvider, handleReloadModelsForProvider),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeLatest(setWorkspaceModel, handleWorkspaceModelChange),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeLatest(clearWorkspaceModel, handleWorkspaceModelChange),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeLatest(setModelPickerGroupCollapsed, handleCollapsedGroupsChange),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(requestHydrateModelFallbackInfo, handleHydrateModelFallbackInfo),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(setModelFallbackInfo, handleSetModelFallbackInfo),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(clearModelFallbackInfo, handleClearModelFallbackInfo),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});
