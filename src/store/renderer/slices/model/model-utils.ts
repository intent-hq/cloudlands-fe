/**
 * Model utility functions.
 *
 * These are standalone async functions that fetch models for a specific provider
 * WITHOUT updating Redux state. Used by components like ModelPicker that need
 * models for a provider different from the global active provider.
 */
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import {
  getProviderModels,
  type ProviderModelEntry,
} from '$features/providers/provider-models.client';
import { store as appStore } from '../../store';
import {
  selectEffectiveDefaultProviderId,
  selectNormalizedProviderId,
  selectProviderCatalogEntry,
} from '../provider-catalog/provider-catalog-selectors';
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

/**
 * Fetch raw models for a specific provider through the uniform daemon-backed
 * `<provider>:get-models` channel (`models.list { providerId }`, PROTOCOL
 * §6.7). Normalizes aliases (e.g. 'acp' → 'auggie') via getProviderConfig().
 */
async function fetchProviderModelsWithWarning(
  providerId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<ProviderModelsWithWarning> {
  const normalizedId = selectNormalizedProviderId.select(appStore.state, providerId);
  if (normalizedId === 'mock') {
    return { models: [] };
  }
  return await getProviderModels(normalizedId, options);
}

export async function fetchModelsForProvider(providerId: string): Promise<ProviderModel[]> {
  return (await fetchProviderModelsWithWarning(providerId)).models;
}

function prefixModelsForProvider(providerId: string, models: ProviderModel[]): AuggieModel[] {
  if (models.length === 0) {
    return [];
  }
  const defaultProviderId = selectEffectiveDefaultProviderId.select(appStore.state);
  return models.map((model) => {
    if (providerId !== defaultProviderId) {
      return {
        ...model,
        value: `${providerId}:${model.value}`,
      } as AuggieModel;
    }
    return model as AuggieModel;
  });
}

export async function getModelsForProviderForLoadingState(
  providerId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<{
  models: AuggieModel[];
  warning?: string;
  stale?: boolean;
}> {
  const normalizedId = selectNormalizedProviderId.select(appStore.state, providerId);
  const result = await fetchProviderModelsWithWarning(normalizedId, options);
  return {
    models: prefixModelsForProvider(normalizedId, result.models),
    warning: result.warning,
    stale: result.stale,
  };
}

/**
 * Fetch and return models for a specific provider ID.
 * Unlike the load-models saga, this does NOT update Redux state.
 * Used by ModelPicker when an agent's provider differs from the global active provider.
 *
 * Applies the same provider-ID prefixing logic as the load-models saga.
 */
export async function getModelsForProvider(providerId: string): Promise<AuggieModel[]> {
  return (await getModelsForProviderForLoadingState(providerId)).models;
}
/**
 * Get models grouped by provider.
 * Utility function that takes explicit params instead of reading from stores.
 */
export function getGroupedModels(
  activeProviderId: string,
  availableModels: AuggieModel[],
): Array<{
  providerId: string;
  providerDisplayName: string;
  models: AuggieModel[];
}> {
  const providerEntry = selectProviderCatalogEntry.select(appStore.state, activeProviderId);
  if (!providerEntry || availableModels.length === 0) {
    return [];
  }
  return [
    {
      providerId: providerEntry.id,
      providerDisplayName: providerEntry.displayName,
      models: availableModels,
    },
  ];
}
