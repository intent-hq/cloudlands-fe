import type { ProviderReadState } from '../provider-catalog/provider-read-types';
import { learnedModelName } from './model-name-cache';
import type { ProviderModelsCacheEntry, ProviderModelsRequest } from './provider-models-types';
import { providerModelsContextKey } from './provider-models-utils';

/**
 * The full cache map keyed by normalized provider id. `{}` before any fetch
 * lands (fresh session / after a reconnect clear).
 */
export const getProviderModelsCacheMap = (
  state: ProviderReadState,
  workspaceId?: string,
): Record<string, ProviderModelsCacheEntry> =>
  (workspaceId
    ? state.providerModels?.byWorkspaceId?.[workspaceId]
    : state.providerModels?.byProviderId) ?? {};

/**
 * One provider's cached catalog; `undefined` on a cache miss (never fetched
 * this session, or the cache was cleared on reconnect).
 *
 * Workspace pickers also read warning/stale fields from their own entries.
 * Direct pickers retain the global loading-state slice. The fields are
 * stored verbatim per the fetch-result contract.
 */
export const getProviderModelsCacheEntry = (
  state: ProviderReadState,
  providerId: string,
  workspaceId?: string,
): ProviderModelsCacheEntry | undefined =>
  getProviderModelsCacheMap(state, workspaceId)[providerId];

/**
 * The current clear epoch. Writers read this when their fetch STARTS and
 * stamp it into `providerModelsLoaded`; the reducer drops writes stamped
 * with a pre-clear epoch (a reconnect happened while the response was in
 * flight).
 */
export const getProviderModelsClearEpoch = (state: ProviderReadState): number =>
  state.providerModels?.clearEpoch ?? 0;

export const getProviderModelsRequests = (
  state: ProviderReadState,
  workspaceId?: string,
): Record<string, ProviderModelsRequest> =>
  (workspaceId
    ? state.providerModels?.requestsByWorkspaceId?.[workspaceId]?.map
    : state.providerModels?.requests?.map) ?? {};

export const getObservedModelProviders = (
  state: ProviderReadState,
): Record<string, { providerId: string; workspaceId?: string }> =>
  Object.fromEntries(
    Object.values(state.providerModels?.observers?.map ?? {}).flatMap(
      ({ providerIds, workspaceId }) =>
        providerIds.map((providerId) => [
          providerModelsContextKey(providerId, workspaceId),
          { providerId, workspaceId },
        ]),
    ),
  );

export const getObservedModelProviderKeys = (state: ProviderReadState): string[] =>
  Object.keys(getObservedModelProviders(state)).sort();

/** Local, display-only lookup by normalized provider and bare model ID. */
export const getLearnedModelDisplayName = (
  state: ProviderReadState,
  providerId: string,
  modelId: string,
): string | undefined =>
  learnedModelName(state.providerModels?.learnedNames ?? {}, providerId, modelId);

export const getLearnedModelNames = (state: ProviderReadState) => state.providerModels.learnedNames;
