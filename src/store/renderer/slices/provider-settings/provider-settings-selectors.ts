import { getItems } from "$lib/store-shim/utils/collections/collection-utils";
import { resolveProviderEnabled } from "$shared/provider-catalog";
import { store } from "../../store";

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