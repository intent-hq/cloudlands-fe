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
  hydrateActiveProvider,
  setActiveProvider,
} from '../provider-settings/provider-settings-slice';
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

// With nothing user-configured, the first catalog row is the effective default.
const defaultProviderId = MOCK_PROVIDER_CATALOG.providers[0].id;

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

  it('falls back to the first catalog row at hydration when no active provider was mirrored', () => {
    expect(bareInitialState.defaultProviderId).toBe('');
    expect(initialState.defaultProviderId).toBe(defaultProviderId);
  });

  it('mirrors the active provider as the default and re-normalizes picks', () => {
    const withActive = modelReducer(bareInitialState, setActiveProvider('codex'));
    expect(withActive.defaultProviderId).toBe('codex');
    // A mirrored active provider survives catalog hydration (no first-row clobber).
    const hydrated = modelReducer(withActive, providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
    expect(hydrated.defaultProviderId).toBe('codex');
    expect(hydrated.catalogProviderIds).toEqual(
      MOCK_PROVIDER_CATALOG.providers.map((provider) => provider.id),
    );

    const withPicks = modelReducer(
      hydrated,
      loadProviderModelsFromStorage({ codex: 'codex:gpt-5.3-codex/high', auggie: 'gpt5.4' }),
    );
    // Switching the active provider re-normalizes: codex picks become bare,
    // other providers' picks become prefixed.
    expect(withPicks.providerModels).toEqual({
      codex: 'gpt-5.3-codex/high',
      auggie: 'auggie:gpt5.4',
    });
  });

  it('resets a stale mirrored default at catalog hydration', () => {
    // A pre-hydration mirror (e.g. hydrateActiveProvider from persisted
    // settings) naming a provider absent from the newly hydrated catalog is
    // stale — hydration falls back to the first row instead of keeping it.
    const withStale = modelReducer(bareInitialState, hydrateActiveProvider('removed-provider'));
    expect(withStale.defaultProviderId).toBe('removed-provider');

    const hydrated = modelReducer(withStale, providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
    expect(hydrated.defaultProviderId).toBe(defaultProviderId);
  });

  it('rejects unknown provider ids mirrored after catalog hydration', () => {
    // Post-hydration, hydrateActiveProvider/setActiveProvider payloads are
    // validated against the catalog: unknown ids keep the current default so
    // model-id normalization never strips/prefixes against a bogus provider.
    const fromHydrate = modelReducer(initialState, hydrateActiveProvider('removed-provider'));
    expect(fromHydrate.defaultProviderId).toBe(defaultProviderId);

    const fromSet = modelReducer(initialState, setActiveProvider('removed-provider'));
    expect(fromSet.defaultProviderId).toBe(defaultProviderId);

    // Known ids are still adopted.
    const known = modelReducer(initialState, hydrateActiveProvider('codex'));
    expect(known.defaultProviderId).toBe('codex');
  });

  it("keeps the first-row fallback when hydrateActiveProvider('') arrives (unset providers.active boot path)", () => {
    // Boot ordering regression: `LiveSettingsClient.getProviderSettings()`
    // returns `activeProviderId: ''` when `providers.active` is unset but
    // `providers.enabled` is present, and the settings seeder dispatches it
    // verbatim. After providerCatalogLoaded installed the first-row fallback,
    // the empty payload must not clobber it (which would re-normalize every
    // persisted pick to the prefixed form and break bare-id validation).
    const withPicks = modelReducer(
      initialState,
      loadProviderModelsFromStorage({ [defaultProviderId]: 'gpt5.4' }),
    );
    const afterEmptyHydrate = modelReducer(withPicks, hydrateActiveProvider(''));
    expect(afterEmptyHydrate.defaultProviderId).toBe(defaultProviderId);
    expect(afterEmptyHydrate.providerModels).toEqual({ [defaultProviderId]: 'gpt5.4' });

    // setActiveProvider('') (defensive symmetry) behaves the same.
    const afterEmptySet = modelReducer(withPicks, setActiveProvider(''));
    expect(afterEmptySet.defaultProviderId).toBe(defaultProviderId);
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

  it('attributes available models to the explicit providerId when given', () => {
    const state = modelReducer(initialState, setAvailableModels(mockModels, 'codex'));

    expect(state.availableModelsProviderId).toBe('codex');
  });

  it('attributes available models to the default provider when no providerId is given', () => {
    const withActive = modelReducer(initialState, setActiveProvider('grok'));
    const state = modelReducer(withActive, setAvailableModels(mockModels));

    expect(state.availableModelsProviderId).toBe('grok');
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
