import { store } from "../../store";
import {
  getItems,
  type Collection,
} from '$lib/store-shim/utils/collections/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import {
  selectActiveProviderId,
  selectEnabledProviderIds,
} from '../provider-settings/provider-settings-selectors';
import { parseCompoundModelId } from '$shared/config/provider-config';
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

/** Select all workspace models */
export const selectWorkspaceModels = store.createSelector((state): Record<string, string> => {
  return state.model.workspaceModels;
});

/** Select all provider models */
export const selectProviderModels = store.createSelector((state): Record<string, string> => {
  return state.model.providerModels;
});

/**
 * Select the default model for a specific workspace.
 * Falls back to the global selected model if no workspace-specific model is set,
 * or if the workspace override's provider is no longer enabled (#584).
 * Bare (non-compound) overrides resolve to the default provider downstream and are returned as-is.
 */
export const selectWorkspaceDefaultModel = store.createSelector((state, workspaceId: string): string => {
  const workspaceModel = state.model.workspaceModels[workspaceId];
  if (workspaceModel && workspaceModel.includes(':')) {
    const { providerId } = parseCompoundModelId(workspaceModel);
    if (!selectEnabledProviderIds.select(state).includes(providerId)) {
      return selectSelectedModel.select(state);
    }
  }
  return workspaceModel || selectSelectedModel.select(state);
});

export const selectModelPickerCollapsedGroups = store.createSelector((state): string[] => {
  return state.model.modelPickerCollapsedGroups;
});

export const selectModelFallbackInfo = store.createSelector((state, agentId: string) => {
  return state.model.fallbackInfoByAgentId[agentId] ?? null;
});
