import { createSelector } from "../../utils/create-selector";
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import {
  ACP_PROVIDERS,
  parseCompoundModelId,
} from "$shared/config/provider-config";

/** Select the currently selected model value */
export const selectSelectedModel = createSelector(
  (state): string => {
    return state.model.selectedModel;
  }
);

/** Select all available models */
export const selectAvailableModelsForProvider = createSelector(
  (state, providerId: string): AuggieModel[] => {
    return state.model.availableModelsByProvider[providerId] ?? [];
  }
);

export const selectAvailableModels = createSelector(
  (state): AuggieModel[] => {
    return state.model.availableModelsByProvider[state.model.activeProviderId ?? ""] ?? [];
  }
);

/** Select whether models are currently loading */
export const selectIsLoadingModelsForProvider = createSelector(
  (state, providerId: string): boolean => {
    return state.model.isLoadingByProvider[providerId] ?? false;
  }
);

export const selectIsLoadingModels = createSelector(
  (state): boolean => {
    return state.model.isLoadingByProvider[state.model.activeProviderId ?? ""] ?? false;
  }
);

/** Select whether models have been loaded */
export const selectModelsLoadedForProvider = createSelector(
  (state, providerId: string): boolean => {
    return state.model.modelsLoadedByProvider[providerId] ?? false;
  }
);

export const selectModelsLoaded = createSelector(
  (state): boolean => {
    return state.model.modelsLoadedByProvider[state.model.activeProviderId ?? ""] ?? false;
  }
);

/** Select the load error message */
export const selectLoadError = createSelector(
  (state): string | null => {
    return state.model.loadError;
  }
);

/** Select all workspace models */
export const selectWorkspaceModels = createSelector(
  (state): Record<string, string> => {
    return state.model.workspaceModels;
  }
);

/** Select all provider models */
export const selectProviderModels = createSelector(
  (state): Record<string, string> => {
    return state.model.providerModels;
  }
);

/**
 * Select the display label for a model value.
 * Handles both simple model IDs and compound IDs.
 */
export const selectModelLabel = createSelector(
  (state, modelValue: string): string => {
    if (!modelValue) return modelValue;

    const availableModels =
      state.model.availableModelsByProvider[state.model.activeProviderId ?? ""] ?? [];
    const { modelId } = parseCompoundModelId(modelValue);
    const model = availableModels.find(
      (m: AuggieModel) => m.value === modelValue || m.value === modelId
    );

    return model?.label || modelValue;
  }
);

/** Select the label for the currently selected model */
export const selectCurrentModelLabel = createSelector(
  (state): string => {
    const selectedModel = state.model.selectedModel;
    if (!selectedModel) return selectedModel;

    const availableModels =
      state.model.availableModelsByProvider[state.model.activeProviderId ?? ""] ?? [];
    const { modelId } = parseCompoundModelId(selectedModel);
    const model = availableModels.find(
      (m: AuggieModel) => m.value === selectedModel || m.value === modelId
    );

    return model?.label || selectedModel;
  }
);

/**
 * Select the default model for a specific workspace.
 * Falls back to the global selected model if no workspace-specific model is set.
 */
export const selectWorkspaceDefaultModel = createSelector(
  (state, workspaceId: string): string => {
    const workspaceModel = state.model.workspaceModels[workspaceId];
    return workspaceModel || state.model.selectedModel;
  }
);

/** Select whether a workspace has a specific default model set */
export const selectHasWorkspaceDefaultModel = createSelector(
  (state, workspaceId: string): boolean => {
    return workspaceId in state.model.workspaceModels;
  }
);

/** Select the active provider ID for model lookups */
export const selectActiveProviderId = createSelector(
  (state): string | null => {
    return state.model.activeProviderId;
  }
);

/** Select the current retry attempt count */
export const selectRetryAttempt = createSelector(
  (state): number => {
    return state.model.retryAttempt;
  }
);

/**
 * Select models grouped by provider.
 * Returns a single group with the active provider's models.
 */
export const selectGroupedModels = createSelector(
  (
    state,
    activeProviderId: string
  ): Array<{
    providerId: string;
    providerDisplayName: string;
    models: AuggieModel[];
  }> => {
    const providerConfig = ACP_PROVIDERS[activeProviderId];
    const availableModels =
      state.model.availableModelsByProvider[activeProviderId] ?? [];

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
  }
);

