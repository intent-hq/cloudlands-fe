import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { Collection } from '$lib/store-shim/utils/collections/collection-utils';

export type ModelLoadingStatus = 'success' | 'loading' | 'error';

export type ModelLoadingState = {
  status: ModelLoadingStatus;
  retryAttempt: number;
  error?: string;
  warning?: string;
  /**
   * Whether `warning` accompanies a last-known-good model list served from the
   * daemon's cache (PROTOCOL §5.30 `stale: true`) rather than a degraded
   * static fallback. Consumers use it to tell a transient probe failure apart
   * from a genuinely missing CLI.
   */
  stale?: boolean;
};

export type ModelFallbackInfo = {
  fromModel: string;
  toModel: string;
};

export type ModelState = {
  availableModels: Collection<AuggieModel, 'value'>;
  /**
   * Provider the current `availableModels` catalog was loaded for ('' before
   * the first load). Bare model ids re-attribute to whatever the default
   * provider currently is, so consumers need this explicit provenance to know
   * whether the global catalog belongs to a given provider (e.g. the model
   * picker's disabled-provider fallback group).
   */
  availableModelsProviderId: string;
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
   * Ids are validated against `catalogProviderIds` once the catalog lands.
   */
  defaultProviderId: string;
  /**
   * Catalog provider ids mirrored from `providerCatalogLoaded` (registry
   * order), used to reject stale/unknown provider ids in the mirrors above.
   * Empty before the first hydration.
   */
  catalogProviderIds: string[];
};
