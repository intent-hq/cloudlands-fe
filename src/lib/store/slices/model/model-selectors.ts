import { createSelector } from '../../utils/create-selector';
import { findItem, getItems, type Collection } from '../../utils/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import { ACP_PROVIDERS, parseCompoundModelId } from '$shared/config/provider-config';
import { selectActiveProviderId } from '../provider-settings/provider-settings-selectors';
import type { ModelLoadingState } from './model-types';

function getEffectiveProviderId(state: any, providerId?: string): string {
  return providerId ?? selectActiveProviderId.select(state);
}

/** Select the currently selected model value */
export const selectSelectedModel = createSelector((state, providerId?: string): string => {
  const effectiveProviderId = getEffectiveProviderId(state, providerId);
  return state.model.providerModels[effectiveProviderId] ?? MODEL_DEFAULTS.UI_INITIAL_MODEL;
});

export const selectAvailableModelsCollection = createSelector(
  (state): Collection<AuggieModel, 'value'> => {
    return state.model.availableModels;
  },
);

export const selectAvailableModels = createSelector((state): AuggieModel[] => {
  return getItems(selectAvailableModelsCollection.select(state));
});

export const selectProviderLoadingState = createSelector(
  (state, providerId?: string): ModelLoadingState | null => {
    const effectiveProviderId = getEffectiveProviderId(state, providerId);
    return state.model.loadingState[effectiveProviderId] ?? null;
  },
);

export const selectIsLoadingModels = createSelector((state, providerId?: string): boolean => {
  return selectProviderLoadingState.select(state, providerId)?.status === 'loading';
});

export const selectModelsLoaded = createSelector((state, providerId?: string): boolean => {
  return selectProviderLoadingState.select(state, providerId)?.status === 'success';
});

/** Select the load error message */
export const selectLoadError = createSelector((state, providerId?: string): string | null => {
  const loadingState = selectProviderLoadingState.select(state, providerId);
  if (loadingState?.status !== 'error') {
    return null;
  }

  return loadingState.error ?? null;
});

export const selectProviderWarning = createSelector(
  (state, providerId?: string): string | undefined => {
    return selectProviderLoadingState.select(state, providerId)?.warning;
  },
);

export const selectAllProviderWarnings = createSelector((state): Record<string, string> => {
  const warnings: Record<string, string> = {};

  for (const [providerId, loadingState] of Object.entries(state.model.loadingState)) {
    if (loadingState.warning) {
      warnings[providerId] = loadingState.warning;
    }
  }

  return warnings;
});

export const selectRetryAttempt = createSelector((state, providerId?: string): number => {
  return selectProviderLoadingState.select(state, providerId)?.retryAttempt ?? 0;
});

export const selectIsLoadingModelsForProvider = selectIsLoadingModels;

export const selectModelsLoadedForProvider = selectModelsLoaded;

/** Select all workspace models */
export const selectWorkspaceModels = createSelector((state): Record<string, string> => {
  return state.model.workspaceModels;
});

/** Select all provider models */
export const selectProviderModels = createSelector((state): Record<string, string> => {
  return state.model.providerModels;
});

/**
 * Select the display label for a model value.
 * Handles both simple model IDs and compound IDs.
 */
export const selectModelLabel = createSelector((state, modelValue: string): string => {
  if (!modelValue) return modelValue;

  const availableModels = selectAvailableModelsCollection.select(state);
  const { modelId } = parseCompoundModelId(modelValue);
  const model = findItem(
    availableModels,
    (candidate: AuggieModel) => candidate.value === modelValue || candidate.value === modelId,
  );

  return model?.label || modelValue;
});

/** Select the label for the currently selected model */
export const selectCurrentModelLabel = createSelector((state): string => {
  const selectedModel = selectSelectedModel.select(state);
  if (!selectedModel) return selectedModel;

  const availableModels = selectAvailableModelsCollection.select(state);
  const { modelId } = parseCompoundModelId(selectedModel);
  const model = findItem(
    availableModels,
    (candidate: AuggieModel) => candidate.value === selectedModel || candidate.value === modelId,
  );

  return model?.label || selectedModel;
});

/**
 * Select the default model for a specific workspace.
 * Falls back to the global selected model if no workspace-specific model is set.
 */
export const selectWorkspaceDefaultModel = createSelector((state, workspaceId: string): string => {
  const workspaceModel = state.model.workspaceModels[workspaceId];
  return workspaceModel || selectSelectedModel.select(state);
});

/** Select whether a workspace has a specific default model set */
export const selectHasWorkspaceDefaultModel = createSelector(
  (state, workspaceId: string): boolean => {
    return workspaceId in state.model.workspaceModels;
  },
);

/**
 * Select models grouped by provider.
 * Returns a single group with the active provider's models.
 */
export const selectGroupedModels = createSelector(
  (
    state,
    activeProviderId: string,
  ): Array<{
    providerId: string;
    providerDisplayName: string;
    models: AuggieModel[];
  }> => {
    const providerConfig = ACP_PROVIDERS[activeProviderId];
    const availableModels = selectAvailableModels.select(state);

    if (!providerConfig || availableModels.length === 0) {
      return [];
    }

    return [
      {
        providerId: providerConfig.id,
        providerDisplayName: providerConfig.displayName,
        models: availableModels,
      },
    ];
  },
);

export const selectModelPickerCollapsedGroups = createSelector((state): string[] => {
  return state.model.modelPickerCollapsedGroups;
});

export const selectIsModelPickerGroupCollapsed = createSelector(
  (state, groupKey: string): boolean => {
    return state.model.modelPickerCollapsedGroups.includes(groupKey);
  },
);

export const selectModelFallbackInfo = createSelector((state, agentId: string) => {
  return state.model.fallbackInfoByAgentId[agentId] ?? null;
});
