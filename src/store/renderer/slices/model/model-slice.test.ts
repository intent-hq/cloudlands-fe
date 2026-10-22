import { describe, expect, it } from 'vitest';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';
import {
  clearModelFallbackInfo,
  hydrateDefaultProvider,
  initialState,
  loadDefaultReasoningEffortFromStorage,
  loadProviderModelsFromStorage,
  modelReducer,
  selectModel,
  setAvailableModels,
  setDefaultReasoningEffort,
  setLoadingStateForProvider,
  setModelFallbackInfo,
  setModelPickerGroupCollapsed,
  setSelectedModel,
} from './model-slice';
import { selectAllProviderStaleFlags, selectAllProviderWarnings } from './model-selectors';

const mockModels: AuggieModel[] = [
  { value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' },
  { value: 'codex:gpt-5.3-codex/high', label: 'Codex High' },
];

describe('modelReducer', () => {
  it('returns the initial state', () => {
    expect(modelReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('mirrors the default provider, provider map, and reasoning effort from daemon receipts', () => {
    const withProvider = modelReducer(initialState, hydrateDefaultProvider('codex'));
    const withModels = modelReducer(
      withProvider,
      loadProviderModelsFromStorage({ auggie: 'auggie:gpt5.4', codex: 'codex:gpt-5.3-codex/high' }),
    );
    const hydrated = modelReducer(withModels, loadDefaultReasoningEffortFromStorage('medium'));

    expect(hydrated.defaultProviderId).toBe('codex');
    expect(hydrated.providerModels).toEqual({ auggie: 'gpt5.4', codex: 'gpt-5.3-codex/high' });
    expect(hydrated.defaultReasoningEffort).toBe('medium');
  });

  it('applies a partial provider-model receipt as the daemon-owned map', () => {
    const hydrated = modelReducer(
      initialState,
      loadProviderModelsFromStorage({ auggie: 'gpt5.4', codex: 'old-model' }),
    );
    const partialReceipt = modelReducer(
      hydrated,
      loadProviderModelsFromStorage({ codex: 'codex:new-model' }),
    );

    expect(partialReceipt.providerModels).toEqual({ codex: 'new-model' });
  });

  it('applies later daemon receipts verbatim, including cleared settings', () => {
    const hydrated = modelReducer(
      modelReducer(
        modelReducer(initialState, hydrateDefaultProvider('codex')),
        loadDefaultReasoningEffortFromStorage('high'),
      ),
      loadProviderModelsFromStorage({ codex: 'gpt5.4' }),
    );
    const cleared = modelReducer(
      modelReducer(
        modelReducer(hydrated, hydrateDefaultProvider('')),
        loadDefaultReasoningEffortFromStorage(''),
      ),
      loadProviderModelsFromStorage({}),
    );

    expect(cleared.defaultProviderId).toBe('');
    expect(cleared.defaultReasoningEffort).toBe('');
    expect(cleared.providerModels).toEqual({});
  });

  it('does not let client selection intents update displayed daemon-owned settings', () => {
    const hydrated = modelReducer(
      modelReducer(initialState, hydrateDefaultProvider('codex')),
      loadProviderModelsFromStorage({ codex: 'gpt5.4' }),
    );

    expect(modelReducer(hydrated, setDefaultReasoningEffort('high'))).toBe(hydrated);
    expect(
      modelReducer(hydrated, setSelectedModel({ providerId: 'codex', model: 'new-model' })),
    ).toBe(hydrated);
    expect(modelReducer(hydrated, selectModel('new-model', 'codex'))).toBe(hydrated);
  });

  it('stores available models as a collection with action-provided provenance', () => {
    const state = modelReducer(initialState, setAvailableModels(mockModels, 'codex'));

    expect(state.availableModels).toEqual(createCollection('value', mockModels));
    expect(state.availableModelsProviderId).toBe('codex');
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

  it('tracks stale cached model warnings and clears staleness after a fresh result', () => {
    const staleState = modelReducer(
      initialState,
      setLoadingStateForProvider({
        providerId: 'codex',
        status: 'success',
        warning: 'probe timed out; serving last known model list',
        stale: true,
      }),
    );
    const freshState = modelReducer(
      staleState,
      setLoadingStateForProvider({ providerId: 'codex', status: 'success' }),
    );

    expect(selectAllProviderStaleFlags.select({ model: staleState })).toEqual({ codex: true });
    expect(selectAllProviderWarnings.select({ model: staleState })).toEqual({
      codex: 'probe timed out; serving last known model list',
    });
    expect(freshState.loadingState.codex.stale).toBeUndefined();
  });

  it('tracks model-picker groups and fallback information independently of settings receipts', () => {
    const collapsed = modelReducer(initialState, setModelPickerGroupCollapsed('recommended', true));
    const expanded = modelReducer(collapsed, setModelPickerGroupCollapsed('recommended', false));
    const withFallback = modelReducer(
      expanded,
      setModelFallbackInfo('agent-1', { fromModel: 'old-model', toModel: 'new-model' }),
    );
    const cleared = modelReducer(withFallback, clearModelFallbackInfo('agent-1'));

    expect(collapsed.modelPickerCollapsedGroups).toEqual(['recommended']);
    expect(expanded.modelPickerCollapsedGroups).toEqual([]);
    expect(cleared.fallbackInfoByAgentId).toEqual({});
  });

  it('clears daemon-owned settings when the execution connection changes', () => {
    const hydrated = modelReducer(
      modelReducer(
        modelReducer(initialState, hydrateDefaultProvider('codex')),
        loadProviderModelsFromStorage({ codex: 'gpt5.4' }),
      ),
      loadDefaultReasoningEffortFromStorage('high'),
    );
    const remote = modelReducer(hydrated, hostExecutionConnectionChanged('remote'));
    const local = modelReducer(remote, hostExecutionConnectionChanged(null));

    expect(remote).toEqual({ ...initialState, selectionConnection: 'remote' });
    expect(local).toEqual({ ...initialState, selectionConnection: null });
  });
});
