import { describe, expect, it } from 'vitest';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';
import { providerCatalogLoaded } from '../provider-catalog/provider-catalog-slice';
import {
  activeProviderReconciled,
  hydrateActiveProvider,
  setActiveProvider,
  setAtomicDefaultModel,
} from '../provider-settings/provider-settings-slice';
import {
  initialState as bareInitialState,
  loadDefaultReasoningEffortFromStorage,
  loadProviderModelsFromStorage,
  modelReducer,
  providerModelsPersistRejected,
  setDefaultReasoningEffort,
  setAvailableModels,
  setLoadingStateForProvider,
  setSelectedModel,
} from './model-slice';
import { selectAllProviderStaleFlags, selectAllProviderWarnings } from './model-selectors';

// With nothing user-configured, the first catalog row is the effective default.
const defaultProviderId = MOCK_PROVIDER_CATALOG.providers[0].id;

// Most cases exercise the slice after catalog hydration (the boot-time
// contract: the provider-catalog seeder lands before user model picks).
const initialState = modelReducer(bareInitialState, providerCatalogLoaded(MOCK_PROVIDER_CATALOG));

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

  it('stores and clears the default reasoning effort', () => {
    expect(bareInitialState.defaultReasoningEffort).toBe('');

    const picked = modelReducer(bareInitialState, setDefaultReasoningEffort('high'));
    expect(picked.defaultReasoningEffort).toBe('high');

    const cleared = modelReducer(picked, setDefaultReasoningEffort(''));
    expect(cleared.defaultReasoningEffort).toBe('');
  });

  it('hydrates the default reasoning effort from the settings catalog', () => {
    const hydrated = modelReducer(
      bareInitialState,
      loadDefaultReasoningEffortFromStorage('medium'),
    );
    expect(hydrated.defaultReasoningEffort).toBe('medium');
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

  it('does not independently apply raw active-provider hydration', () => {
    const selected = modelReducer(initialState, setActiveProvider('claude-code'));
    const stale = modelReducer(selected, hydrateActiveProvider('auggie'));
    expect(stale).toBe(selected);
    expect(stale.defaultProviderId).toBe('claude-code');
  });

  it('resets a stale mirrored default at catalog hydration', () => {
    // A pre-hydration mirror (e.g. reconciled persisted provider hydration)
    // settings) naming a provider absent from the newly hydrated catalog is
    // stale — hydration falls back to the first row instead of keeping it.
    const withStale = modelReducer(bareInitialState, activeProviderReconciled('removed-provider'));
    expect(withStale.defaultProviderId).toBe('removed-provider');

    const hydrated = modelReducer(withStale, providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
    expect(hydrated.defaultProviderId).toBe(defaultProviderId);
  });

  it('rejects unknown provider ids mirrored after catalog hydration', () => {
    // Post-hydration, reconciled/setActiveProvider payloads are
    // validated against the catalog: unknown ids keep the current default so
    // model-id normalization never strips/prefixes against a bogus provider.
    const fromHydrate = modelReducer(initialState, activeProviderReconciled('removed-provider'));
    expect(fromHydrate.defaultProviderId).toBe(defaultProviderId);

    const fromSet = modelReducer(initialState, setActiveProvider('removed-provider'));
    expect(fromSet.defaultProviderId).toBe(defaultProviderId);

    // Known ids are still adopted.
    const known = modelReducer(initialState, activeProviderReconciled('codex'));
    expect(known.defaultProviderId).toBe('codex');
  });

  it("keeps the first-row fallback when activeProviderReconciled('') arrives (unset providers.active boot path)", () => {
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
    const afterEmptyHydrate = modelReducer(withPicks, activeProviderReconciled(''));
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
    const state = modelReducer(initialState, setAvailableModels(mockModels, defaultProviderId));

    expect(state.availableModels).toEqual(createCollection('value', mockModels));
  });

  it('attributes available models to the providerId carried by the action', () => {
    const state = modelReducer(initialState, setAvailableModels(mockModels, 'codex'));

    expect(state.availableModelsProviderId).toBe('codex');
  });

  it('keeps the action providerId as provenance even when the active provider differs', () => {
    // Provenance is stamped from the dispatch, never re-derived from the
    // current default/active provider — a provider switch between trigger and
    // dispatch must not silently re-attribute the catalog.
    const withActive = modelReducer(initialState, setActiveProvider('grok'));
    const state = modelReducer(withActive, setAvailableModels(mockModels, 'codex'));

    expect(state.availableModelsProviderId).toBe('codex');
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

  it('keeps local model picks authoritative through stale hydration and retires them on confirmation', () => {
    const picked = modelReducer(
      modelReducer(initialState, setActiveProvider('codex')),
      setSelectedModel({ providerId: 'codex', model: 'codex:gpt-5.3-codex/high' }),
    );
    const stale = modelReducer(
      picked,
      loadProviderModelsFromStorage({ auggie: 'gpt5.4', codex: 'codex:old-model' }),
    );
    expect(stale.providerModels.codex).toBe('gpt-5.3-codex/high');
    expect(stale.pendingProviderModels).toEqual({ codex: 'gpt-5.3-codex/high' });

    const confirmed = modelReducer(
      stale,
      loadProviderModelsFromStorage({ auggie: 'gpt5.4', codex: 'gpt-5.3-codex/high' }),
    );
    expect(confirmed.pendingProviderModels).toEqual({});

    const external = modelReducer(
      confirmed,
      loadProviderModelsFromStorage({ auggie: 'gpt5.4', codex: 'gpt-5.4-codex' }),
    );
    expect(external.providerModels.codex).toBe('gpt-5.4-codex');
  });

  it('normalizes an atomic cross-provider pick against the newly active provider', () => {
    const picked = modelReducer(
      initialState,
      setAtomicDefaultModel({ providerId: 'codex', model: 'codex:gpt-5.3-codex/high' }),
    );

    expect(picked.defaultProviderId).toBe('codex');
    expect(picked.providerModels.codex).toBe('gpt-5.3-codex/high');
    expect(picked.pendingProviderModels.codex).toBe('gpt-5.3-codex/high');

    const confirmed = modelReducer(
      picked,
      loadProviderModelsFromStorage({
        [defaultProviderId]: 'auggie:gpt5.4',
        codex: 'gpt-5.3-codex/high',
      }),
    );
    expect(confirmed.pendingProviderModels).toEqual({});
  });

  it('retires a rejected local model intent so later hydration can win', () => {
    const picked = modelReducer(
      initialState,
      setSelectedModel({ providerId: defaultProviderId, model: 'gpt5.4' }),
    );
    const rejected = modelReducer(
      picked,
      providerModelsPersistRejected({ [defaultProviderId]: 'gpt5.4' }),
    );
    const hydrated = modelReducer(
      rejected,
      loadProviderModelsFromStorage({ [defaultProviderId]: 'external' }),
    );
    expect(hydrated.providerModels[defaultProviderId]).toBe('external');
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

  it('tracks the stale flag alongside the warning', () => {
    // PROTOCOL §5.30 degraded-but-cached response: models + stale + warning.
    const staleState = modelReducer(
      initialState,
      setLoadingStateForProvider({
        providerId: 'codex',
        status: 'success',
        warning: 'probe timed out; serving last known model list',
        stale: true,
      }),
    );
    expect(staleState.loadingState.codex.stale).toBe(true);
    expect(selectAllProviderStaleFlags.select({ model: staleState })).toEqual({ codex: true });

    const stillStale = modelReducer(
      staleState,
      setLoadingStateForProvider({ providerId: 'codex', status: 'loading' }),
    );
    expect(stillStale.loadingState.codex.stale).toBe(true);

    const freshSuccess = modelReducer(
      staleState,
      setLoadingStateForProvider({ providerId: 'codex', status: 'success' }),
    );
    expect(freshSuccess.loadingState.codex.stale).toBeUndefined();

    const errored = modelReducer(
      staleState,
      setLoadingStateForProvider({ providerId: 'codex', status: 'error', error: 'boom' }),
    );
    expect(errored.loadingState.codex.stale).toBeUndefined();
  });

  it('omits providers without a stale flag from the stale selector', () => {
    const state = {
      model: {
        ...initialState,
        loadingState: {
          codex: {
            status: 'success' as const,
            retryAttempt: 0,
            warning: 'Codex not installed; using static model list',
          },
          auggie: { status: 'success' as const, retryAttempt: 0 },
        },
      },
    };

    expect(selectAllProviderStaleFlags.select(state)).toEqual({});
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
});
