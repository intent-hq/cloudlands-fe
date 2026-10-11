import { store } from '../index';
import * as projections from '../../../../../src/store/renderer/slices/model/model-projections';

export const selectModelSelectionState = store.createSelector(projections.getModelSelectionState);
export const selectModelBootContext = store.createSelector(projections.getModelBootContext);
export const selectSelectedModel = store.createSelector(projections.getSelectedModel);
export const selectHasResolvableModel = store.createSelector(projections.getHasResolvableModel);
export const selectHasResolvableProvider = store.createSelector(
  projections.getHasResolvableProvider,
);
export const selectAvailableModels = store.createSelector(projections.getAvailableModels);
export const selectAvailableModelsProviderId = store.createSelector(
  projections.getAvailableModelsProviderId,
);
export const selectIsLoadingModels = store.createSelector(projections.getIsLoadingModels);
export const selectLoadError = store.createSelector(projections.getLoadError);
export const selectAllProviderWarnings = store.createSelector(projections.getAllProviderWarnings);
export const selectAllProviderStaleFlags = store.createSelector(
  projections.getAllProviderStaleFlags,
);
export const selectProviderModels = store.createSelector(projections.getProviderModels);
export const selectDefaultReasoningEffort = store.createSelector(
  projections.getDefaultReasoningEffort,
);
export const selectModelPickerCollapsedGroups = store.createSelector(
  projections.getModelPickerCollapsedGroups,
);
export const selectModelFallbackInfo = store.createSelector(projections.getModelFallbackInfo);
export const selectModelCatalogEntry = store.createSelector(projections.getModelCatalogEntry);
export const selectModelDisplayName = store.createSelector(projections.getModelDisplayName);
export const selectModelEffortLevels = store.createSelector(projections.getModelEffortLevels);
export const selectProviderModelEffortLevels = store.createSelector(
  projections.getProviderModelEffortLevels,
);
export const selectAgentModelEffortLevels = store.createSelector(
  projections.getAgentModelEffortLevels,
);
