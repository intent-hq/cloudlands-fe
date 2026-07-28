import { store } from "../../store";
import {
  getItems,
  type Collection,
} from '$lib/store-shim/utils/collections/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import { selectActiveProviderId } from '../provider-settings/provider-settings-selectors';
import type { ModelLoadingState } from './model-types';

function getEffectiveProviderId(state: any, providerId?: string): string {
  return providerId ?? selectActiveProviderId.select(state);
}

/** Select the currently selected model value */
export const selectSelectedModel = store.createSelector((state, providerId?: string): string => {
  const effectiveProviderId = getEffectiveProviderId(state, providerId);
  return state.model.providerModels[effectiveProviderId] ?? MODEL_DEFAULTS.UI_INITIAL_MODEL;
});

const selectAvailableModelsCollection = store.createSelector(
  (state): Collection<AuggieModel, 'value'> => {
    return state.model.availableModels;
  },
);

export const selectAvailableModels = store.createSelector((state): AuggieModel[] => {
  return getItems(selectAvailableModelsCollection.select(state));
});

const selectProviderLoadingState = store.createSelector(
  (state, providerId?: string): ModelLoadingState | null => {
    const effectiveProviderId = getEffectiveProviderId(state, providerId);
    return state.model.loadingState[effectiveProviderId] ?? null;
  },
);

export const selectIsLoadingModels = store.createSelector((state, providerId?: string): boolean => {
  return selectProviderLoadingState.select(state, providerId)?.status === 'loading';
});

export const selectModelsLoaded = store.createSelector((state, providerId?: string): boolean => {
  return selectProviderLoadingState.select(state, providerId)?.status === 'success';
});

/** Select the load error message */
export const selectLoadError = store.createSelector((state, providerId?: string): string | null => {
  const loadingState = selectProviderLoadingState.select(state, providerId);
  if (loadingState?.status !== 'error') {
    return null;
  }

  return loadingState.error ?? null;
});

export const selectAllProviderWarnings = store.createSelector((state): Record<string, string> => {
  const warnings: Record<string, string> = {};

  for (const [providerId, loadingState] of Object.entries(state.model.loadingState)) {
    if (loadingState.warning) {
      warnings[providerId] = loadingState.warning;
    }
  }

  return warnings;
});

export const selectRetryAttempt = store.createSelector((state, providerId?: string): number => {
  return selectProviderLoadingState.select(state, providerId)?.retryAttempt ?? 0;
});

export const selectIsLoadingModelsForProvider = selectIsLoadingModels;

export const selectModelsLoadedForProvider = selectModelsLoaded;

/** Select all provider models */
export const selectProviderModels = store.createSelector((state): Record<string, string> => {
  return state.model.providerModels;
});

export const selectModelPickerCollapsedGroups = store.createSelector((state): string[] => {
  return state.model.modelPickerCollapsedGroups;
});

export const selectModelFallbackInfo = store.createSelector((state, agentId: string) => {
  return state.model.fallbackInfoByAgentId[agentId] ?? null;
});
