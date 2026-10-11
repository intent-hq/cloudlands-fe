/**
 * Model utility functions.
 *
 * These are standalone async functions that fetch models for a specific provider
 * WITHOUT updating Redux state. Used by components like ModelPicker that need
 * models for a provider different from the global active provider.
 */
import type { ProviderModelInfo as AuggieModel } from '$shared/models/wire-model-info';
import type {
  ProviderModelEntry,
  ProviderModelsResult,
  ProviderModelsOptions,
} from '../../../../features/providers/provider-models-types';
/**
 * Provider model row shape — the provider-agnostic daemon catalog shape
 * shared by all eight providers (`models.list`, PROTOCOL §6.7).
 */
export type ProviderModel = ProviderModelEntry;

type ProviderModelsWithWarning = {
  models: ProviderModel[];
  warning?: string;
  stale?: boolean;
};

export function createModelReads({
  getProviderModels,
  normalizeProviderId,
}: {
  getProviderModels: (id: string, options?: ProviderModelsOptions) => Promise<ProviderModelsResult>;
  normalizeProviderId: (id: string) => string;
}) {
  /**
   * Fetch raw models for a specific provider through the uniform daemon-backed
   * `<provider>:get-models` channel (`models.list { providerId }`, PROTOCOL
   * §6.7). Normalizes aliases (e.g. 'acp' → 'auggie') via getProviderConfig().
   */
  async function fetchProviderModelsWithWarning(
    providerId: string,
    options: { forceRefresh?: boolean; workspaceId?: string } = {},
  ): Promise<ProviderModelsWithWarning> {
    const normalizedId = options.workspaceId ? providerId : normalizeProviderId(providerId);
    if (normalizedId === 'mock') {
      return { models: [] };
    }
    return await getProviderModels(normalizedId, options);
  }

  async function fetchModelsForProvider(providerId: string): Promise<ProviderModel[]> {
    return (await fetchProviderModelsWithWarning(providerId)).models;
  }

  async function getModelsForProviderForLoadingState(
    providerId: string,
    options: { forceRefresh?: boolean; workspaceId?: string } = {},
  ): Promise<{
    models: AuggieModel[];
    warning?: string;
    stale?: boolean;
  }> {
    const normalizedId = options.workspaceId ? providerId : normalizeProviderId(providerId);
    const result = await fetchProviderModelsWithWarning(normalizedId, options);
    return {
      // Catalog rows keep their bare daemon-served ids; provider provenance is
      // carried separately by the caller (availableModelsProviderId / the
      // per-provider map key), never encoded into the id.
      models: result.models as AuggieModel[],
      warning: result.warning,
      stale: result.stale,
    };
  }

  /**
   * Fetch and return models for a specific provider ID.
   * Unlike the load-models saga, this does NOT update Redux state.
   * Used by ModelPicker when an agent's provider differs from the global active provider.
   */
  async function getModelsForProvider(
    providerId: string,
    workspaceId?: string,
  ): Promise<AuggieModel[]> {
    return (await getModelsForProviderForLoadingState(providerId, { workspaceId })).models;
  }

  return { fetchModelsForProvider, getModelsForProviderForLoadingState, getModelsForProvider };
}
