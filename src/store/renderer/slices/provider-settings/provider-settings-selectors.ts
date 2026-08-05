import { getItems } from "$lib/store-shim/utils/collections/collection-utils";
import { resolveProviderEnabled } from "$shared/provider-catalog";
import { store } from "../../store";
import { selectProviderStatusMap } from "../agent-availability/agent-availability-selectors";
import { selectProviderCatalogEntry } from "../provider-catalog/provider-catalog-selectors";

export const selectActiveProviderId = store.createSelector(
  (state): string => {
    return state.providerSettings.activeProviderId;
  }
);

export const selectIsProviderActive = store.createSelector(
  (state, providerId: string): boolean => {
    return state.providerSettings.activeProviderId === providerId;
  }
);

export const selectEnabledProviders = store.createSelector(
  (state): Record<string, boolean> => {
    return state.providerSettings.enabledProviders;
  }
);

export const selectIsProviderEnabled = store.createSelector(
  (state, providerId: string): boolean => {
    // Fall back through the providerCatalog slice for states captured before
    // the providerSettings snapshot fields hydrate (and partial test mocks).
    const defaultProviderId =
      state.providerSettings.defaultProviderId || state.providerCatalog?.defaultProviderId || "";
    const nonDisableable = state.providerSettings.nonDisableableProviderIds ?? [];
    return resolveProviderEnabled(state.providerSettings.enabledProviders, providerId, {
      defaultProviderId,
      canBeDisabled: !nonDisableable.includes(providerId),
    });
  }
);

export const selectEnabledProviderIds = store.createSelector(
  (state): string[] => {
    const enabledProviders = state.providerSettings.enabledProviders;
    const catalogEntries = state.providerCatalog ? getItems(state.providerCatalog.providers) : [];
    const enabled = new Set(
      catalogEntries
        .filter((p) => selectIsProviderEnabled.select(state, p.id))
        .map((p) => p.id)
    );
    const activeProviderId = selectActiveProviderId.select(state);
    if (activeProviderId) enabled.add(activeProviderId);

    for (const [providerId, isEnabled] of Object.entries(enabledProviders)) {
      if (isEnabled) {
        enabled.add(providerId);
      }
    }

    return [...enabled];
  }
);

/**
 * A provider is hidden when it's gated behind an env var / feature code the
 * renderer cannot verify — mirrors the default-deny gating in
 * `provider-status-bridge-seeder.ts`'s `computeHiddenProviders`.
 */
function isProviderHidden(state: any, providerId: string): boolean {
  const entry = selectProviderCatalogEntry.select(state, providerId);
  return Boolean(entry?.requiresEnvVar || entry?.requiresFeatureCode);
}

/**
 * Enabled provider ids that are also known-available (per the
 * agent-availability slice) and not hidden. This is the availability-gated
 * pool the UI should offer for selection — per decision D1(B) we never
 * auto-switch into it, we only use it to detect/surface failure.
 */
export const selectAvailableEnabledProviderIds = store.createSelector(
  (state): string[] => {
    const statusMap = selectProviderStatusMap.select(state);
    return selectEnabledProviderIds
      .select(state)
      .filter((id) => !isProviderHidden(state, id) && statusMap[id]?.available === true);
  }
);

/** Whether the currently active provider is in the available+enabled set. */
export const selectIsActiveProviderAvailable = store.createSelector(
  (state): boolean => {
    const activeProviderId = selectActiveProviderId.select(state);
    return selectAvailableEnabledProviderIds.select(state).includes(activeProviderId);
  }
);