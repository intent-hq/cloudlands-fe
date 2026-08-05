import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { Collection } from '$lib/store-shim/utils/collections/collection-utils';

export type ModelLoadingStatus = 'success' | 'loading' | 'error';

export type ModelLoadingState = {
  status: ModelLoadingStatus;
  retryAttempt: number;
  error?: string;
  warning?: string;
};

export type ModelFallbackInfo = {
  fromModel: string;
  toModel: string;
};

export type ModelState = {
  availableModels: Collection<AuggieModel, 'value'>;
  loadingState: Record<string, ModelLoadingState>;
  providerModels: Record<string, string>;
  modelPickerCollapsedGroups: string[];
  fallbackInfoByAgentId: Record<string, ModelFallbackInfo>;
  /**
   * Effective default provider id mirrored for model-id normalization
   * ('' before hydration). Reducers only see their own slice, so this is
   * snapshotted from `setActiveProvider`/`hydrateActiveProvider` (the user's
   * active provider) with a first-catalog-row fallback at
   * `providerCatalogLoaded` — the registry itself carries no default.
   */
  defaultProviderId: string;
};
