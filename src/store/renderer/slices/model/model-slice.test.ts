import {
  describe,
  expect,
  it,
} from 'vitest';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';
import { providerCatalogLoaded } from '../provider-catalog/provider-catalog-slice';
import {
  clearModelFallbackInfo,
  clearLoadingStateForProvider,
  hydrateModelFallbackInfo,
  hydrateModelPickerCollapsedGroups,
  initialState as bareInitialState,
  loadProviderModelsFromStorage,
  modelReducer,
  setModelFallbackInfo,
  setModelPickerGroupCollapsed,
  setAvailableModels,
  setLoadingStateForProvider,
  setRetryAttempt,
  setSelectedModel,
} from './model-slice';
import { selectAllProviderWarnings } from './model-selectors';
import type { ModelState } from './model-types';

const defaultProviderId = MOCK_PROVIDER_CATALOG.defaultProviderId;

// Most cases exercise the slice after catalog hydration (the boot-time
// contract: the provider-catalog seeder lands before user model picks).
const initialState = modelReducer(
  bareInitialState,
  providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
);

const mockModels: AuggieModel[] = [
  {
    value: 'gpt5.4',
    label: 'GPT 5.4',
    description: 'Smart model',
  },
  {
    value: 'codex:gpt-5.3-codex/high',
    label: 'Codex High',
  },
];

describe('modelReducer', () => {
  it('returns the initial state', () => {
    expect(modelReducer(undefined, { type: '@@INIT' })).toEqual(bareInitialState);
  });

  it('snapshots the default provider id from catalog hydration', () => {
    expect(bareInitialState.defaultProviderId).toBe('');
    expect(initialState.defaultProviderId).toBe(defaultProviderId);
  });

  it('re-normalizes persisted picks that landed before catalog hydration', () => {
    const preCatalog = modelReducer(
      bareInitialState,
      loadProviderModelsFromStorage({
        auggie: 'auggie:gpt5.4',
        codex: 'gpt-5.3-codex/high',
      }),
    );
    // Before hydration defaultProviderId is '' — everything stays prefixed.
    expect(preCatalog.providerModels).toEqual({
      auggie: 'auggie:gpt5.4',
      codex: 'codex:gpt-5.3-codex/high',
    });

    const hydrated = modelReducer(preCatalog, providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
    expect(hydrated.providerModels).toEqual({
      auggie: 'gpt5.4',
      codex: 'codex:gpt-5.3-codex/high',
    });
  });

  it('stores available models as a collection', () => {
    const state = modelReducer(initialState, setAvailableModels(mockModels));

    expect(state.availableModels).toEqual(createCollection('value', mockModels));
  });

  it('stores selected models in providerModels using provider normalization', () => {
    const defaultState = modelReducer(
      initialState,
      setSelectedModel({
        providerId: defaultProviderId,
        model: `${defaultProviderId}:gpt5.4`,
      }),
    );
    const nonDefaultState = modelReducer(
      defaultState,
      setSelectedModel({ providerId: 'codex', model: 'gpt-5.3-codex/high' }),
    );

    expect(nonDefaultState.providerModels).toEqual({
      [defaultProviderId]: 'gpt5.4',
      codex: 'codex:gpt-5.3-codex/high',
    });
  });

  it('updates provider-specific loading state and preserves omitted fields', () => {
    const loadingState = modelReducer(
      initialState,
      setLoadingStateForProvider({
        providerId: 'codex',
        status: 'error',
        retryAttempt: 2,
        error: 'boom',
      }),
    );
    const successState = modelReducer(
      loadingState,
      setLoadingStateForProvider({ providerId: 'codex', status: 'success' }),
    );

    expect(successState.loadingState.codex).toEqual({
      status: 'success',
      retryAttempt: 2,
      error: 'boom',
    });
  });

  it('clears provider loading state for only the requested provider', () => {
    const prev: ModelState = {
      ...initialState,
      loadingState: {
        auggie: { status: 'loading', retryAttempt: 0 },
        codex: { status: 'error', retryAttempt: 1, error: 'boom' },
      },
    };

    const state = modelReducer(prev, clearLoadingStateForProvider('codex'));

    expect(state.loadingState).toEqual({
      auggie: { status: 'loading', retryAttempt: 0 },
    });
  });

  it('stores warnings on success and clears them on success without warnings, error, and clear', () => {
    const warningState = modelReducer(
      initialState,
      setLoadingStateForProvider({
        providerId: 'codex',
        status: 'success',
        warning: 'Codex not installed; using static model list',
      }),
    );
    expect(warningState.loadingState.codex.warning).toBe(
      'Codex not installed; using static model list',
    );

    const loadingState = modelReducer(
      warningState,
      setLoadingStateForProvider({ providerId: 'codex', status: 'loading' }),
    );
    expect(loadingState.loadingState.codex.warning).toBe(
      'Codex not installed; using static model list',
    );

    const successWithoutWarning = modelReducer(
      warningState,
      setLoadingStateForProvider({ providerId: 'codex', status: 'success' }),
    );
    expect(successWithoutWarning.loadingState.codex.warning).toBeUndefined();

    const warningAgain = modelReducer(
      warningState,
      setLoadingStateForProvider({
        providerId: 'codex',
        status: 'error',
        error: 'boom',
      }),
    );
    expect(warningAgain.loadingState.codex.warning).toBeUndefined();

    const cleared = modelReducer(warningState, clearLoadingStateForProvider('codex'));
    expect(cleared.loadingState.codex).toBeUndefined();
  });

  it('selects provider warnings', () => {
    const state = {
      model: {
        ...initialState,
        loadingState: {
          codex: {
            status: 'success',
            retryAttempt: 0,
            warning: 'Codex not installed; using static model list',
          },
          auggie: { status: 'success', retryAttempt: 0 },
        },
      },
      providerSettings: {
        activeProviderId: 'codex',
      },
    };

    expect(selectAllProviderWarnings.select(state)).toEqual({
      codex: 'Codex not installed; using static model list',
    });
  });

  it('updates retry attempt while preserving existing provider status', () => {
    const prev: ModelState = {
      ...initialState,
      loadingState: {
        codex: { status: 'error', retryAttempt: 1, error: 'boom' },
      },
    };

    const state = modelReducer(prev, setRetryAttempt({ providerId: 'codex', attempt: 3 }));

    expect(state.loadingState.codex).toEqual({
      status: 'error',
      retryAttempt: 3,
      error: 'boom',
    });
  });

  it('normalizes provider models loaded from storage', () => {
    const state = modelReducer(
      initialState,
      loadProviderModelsFromStorage({
        [defaultProviderId]: `${defaultProviderId}:gpt5.4`,
        codex: 'gpt-5.3-codex/high',
      }),
    );

    expect(state.providerModels).toEqual({
      [defaultProviderId]: 'gpt5.4',
      codex: 'codex:gpt-5.3-codex/high',
    });
  });

  it('hydrates and toggles model picker collapsed groups', () => {
    const hydrated = modelReducer(
      initialState,
      hydrateModelPickerCollapsedGroups(['auggie', 'codex', 'auggie']),
    );
    const expanded = modelReducer(hydrated, setModelPickerGroupCollapsed('auggie', false));
    const collapsed = modelReducer(expanded, setModelPickerGroupCollapsed('openai', true));

    expect(hydrated.modelPickerCollapsedGroups).toEqual(['auggie', 'codex']);
    expect(expanded.modelPickerCollapsedGroups).toEqual(['codex']);
    expect(collapsed.modelPickerCollapsedGroups).toEqual(['codex', 'openai']);
  });

  it('hydrates, sets, and clears model fallback info by agent', () => {
    const info = { fromModel: 'old-model', toModel: 'new-model' };
    const hydrated = modelReducer(initialState, hydrateModelFallbackInfo('agent-1', info));
    const set = modelReducer(
      hydrated,
      setModelFallbackInfo('agent-2', { fromModel: 'missing', toModel: 'fallback' }),
    );
    const cleared = modelReducer(set, clearModelFallbackInfo('agent-1'));

    expect(hydrated.fallbackInfoByAgentId).toEqual({ 'agent-1': info });
    expect(set.fallbackInfoByAgentId['agent-2']).toEqual({
      fromModel: 'missing',
      toModel: 'fallback',
    });
    expect(cleared.fallbackInfoByAgentId).toEqual({
      'agent-2': { fromModel: 'missing', toModel: 'fallback' },
    });
  });
});
