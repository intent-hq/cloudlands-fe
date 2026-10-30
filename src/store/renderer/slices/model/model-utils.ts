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
  type ProviderModelsResult,
} from '$features/providers/provider-models.client';
import type { ProviderModelsFetchResult } from '../provider-models/provider-models-types';
import { store as appStore } from '../../store';
import { selectNormalizedProviderId } from '../provider-catalog/provider-catalog-selectors';
/**
 * Provider model row shape — the provider-agnostic daemon catalog shape
 * shared by all eight providers (`models.list`, PROTOCOL §6.7).
 */
export type ProviderModel = ProviderModelEntry;

/**
 * Fetch raw models for a specific provider through the uniform daemon-backed
 * `<provider>:get-models` channel (`models.list { providerId }`, PROTOCOL
 * §6.7). Normalizes aliases (e.g. 'acp' → 'auggie') via getProviderConfig().
 */
async function fetchProviderModelsWithWarning(
  providerId: string,
  options: { forceRefresh?: boolean; workspaceId?: string } = {},
): Promise<ProviderModelsResult> {
  const normalizedId = options.workspaceId
    ? providerId
    : selectNormalizedProviderId.select(appStore.state, providerId);
  if (normalizedId === 'mock') {
    return { models: [] };
  }
  return await getProviderModels(normalizedId, options);
}

export async function fetchModelsForProvider(providerId: string): Promise<ProviderModel[]> {
  return (await fetchProviderModelsWithWarning(providerId)).models;
}

export async function getModelsForProviderForLoadingState(
  providerId: string,
  options: { forceRefresh?: boolean; workspaceId?: string } = {},
): Promise<ProviderModelsFetchResult> {
  const normalizedId = options.workspaceId
    ? providerId
    : selectNormalizedProviderId.select(appStore.state, providerId);
  // Every reply label passes through untouched (no per-label copy), so a new
  // `GetModelsEnvelope` label reaches the loading state without a store edit.
  const { models, ...labels } = await fetchProviderModelsWithWarning(normalizedId, options);
  return {
    ...labels,
    // Catalog rows keep their bare daemon-served ids; provider provenance is
    // carried separately by the caller (availableModelsProviderId / the
    // per-provider map key), never encoded into the id.
    models: models as AuggieModel[],
  };
}

/**
 * Fetch and return models for a specific provider ID.
 * Unlike the load-models saga, this does NOT update Redux state.
 * Used by ModelPicker when an agent's provider differs from the global active provider.
 */
export async function getModelsForProvider(
  providerId: string,
  workspaceId?: string,
): Promise<AuggieModel[]> {
  return (await getModelsForProviderForLoadingState(providerId, { workspaceId })).models;
}
