/**
 * Svelte compatibility binding for the existing picker and helper import paths.
 * Remove with the Svelte picker at renderer retirement. Canonical algorithms live
 * in the neutral *-projections modules, which never import this Store binding.
 */
import {
  selectAllCatalogProviderIds,
  selectEffectiveDefaultProviderId,
  selectNormalizedProviderId,
  selectProviderCatalogEntries,
  selectProviderCatalogEntry,
  selectResolvedProviderCatalogEntry,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { selectIsHostMember } from '$store/renderer/slices/host-execution/host-execution-selectors';
import { store } from '$store/renderer/store';
import type { ModelPickerProviderContext } from './model-picker-projection-types';

export function getModelPickerProviderContext(workspaceId?: string): ModelPickerProviderContext {
  const state = store.state;
  return {
    providerIds: workspaceId
      ? selectProviderCatalogEntries.select(state, workspaceId).map((entry) => entry.id)
      : selectAllCatalogProviderIds.select(state),
    defaultProviderId: selectEffectiveDefaultProviderId.select(state, workspaceId),
    isHostMember: selectIsHostMember.select(state),
    normalizeProviderId: (id) => selectNormalizedProviderId.select(state, id, workspaceId),
    getProviderEntry: (id) => selectProviderCatalogEntry.select(state, id, workspaceId),
    resolveProviderEntry: (id) => selectResolvedProviderCatalogEntry.select(state, id, workspaceId),
  };
}
