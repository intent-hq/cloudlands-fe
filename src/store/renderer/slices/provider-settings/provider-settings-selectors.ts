import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { resolveProviderEnabled } from '$shared/provider-catalog';
import { isProviderAuthenticationReady } from '$shared/types/provider-availability';
import { store } from '../../store';
import {
  selectHasCheckedOnce,
  selectProviderStatusMap,
} from '../agent-availability/agent-availability-selectors';
import { selectProviderCatalogEntry } from '../provider-catalog/provider-catalog-selectors';

/**
 * Default provider id — the provider leg of the default model triple
 * (`model.defaultProvider`). The standalone `providers.active` concept is
 * retired; the state lives in the model slice ('' before hydration).
 */
export const selectActiveProviderId = store.createSelector((state): string => {
  return state.model.defaultProviderId;
});

export const selectIsProviderActive = store.createSelector((state, providerId: string): boolean => {
  return state.model.defaultProviderId === providerId;
});

export const selectEnabledProviders = store.createSelector((state): Record<string, boolean> => {
  return state.providerSettings.enabledProviders;
});

export const selectIsProviderEnabled = store.createSelector(
  (state, providerId: string): boolean => {
    const nonDisableable = state.providerSettings.nonDisableableProviderIds ?? [];
    return resolveProviderEnabled(state.providerSettings.enabledProviders, providerId, {
      canBeDisabled: !nonDisableable.includes(providerId),
    });
  },
);

export const selectEnabledProviderIds = store.createSelector((state): string[] => {
  const enabledProviders = state.providerSettings.enabledProviders;
  const catalogEntries = state.providerCatalog ? getItems(state.providerCatalog.providers) : [];
  const enabled = new Set(
    catalogEntries.filter((p) => selectIsProviderEnabled.select(state, p.id)).map((p) => p.id),
  );
  const activeProviderId = selectActiveProviderId.select(state);
  if (activeProviderId) enabled.add(activeProviderId);

  for (const [providerId, isEnabled] of Object.entries(enabledProviders)) {
    if (isEnabled) {
      enabled.add(providerId);
    }
  }

  return [...enabled];
});

/**
 * A provider is hidden when it's gated behind an env var / feature code the
 * renderer cannot verify — mirrors the default-deny gating in
 * `provider-status-bridge-seeder.ts`'s `computeHiddenProviders`.
 */
function isProviderHidden(state: any, providerId: string): boolean {
  const entry = selectProviderCatalogEntry.select(state, providerId);
  return Boolean(entry?.requiresEnvVar || entry?.requiresFeatureCode);
}

/** Antigravity model access requires confirmed sign-in, including at startup.
 * Other providers retain their existing model-probe behavior. This does not
 * change enabled/default preferences or require an agent's provider to be enabled. */
export const selectIsProviderModelAccessAllowed = store.createSelector(
  (state, providerId: string): boolean => {
    if (providerId !== 'antigravity') return true;
    const status = selectProviderStatusMap.select(state)[providerId];
    return (
      status?.available === true && isProviderAuthenticationReady(providerId, status.authenticated)
    );
  },
);

/** Enabled, visible providers that are ready for model selection.
 * This set never changes the user's saved provider preference. */
export const selectAvailableEnabledProviderIds = store.createSelector((state): string[] => {
  const statusMap = selectProviderStatusMap.select(state);
  return selectEnabledProviderIds
    .select(state)
    .filter(
      (id) =>
        !isProviderHidden(state, id) &&
        statusMap[id]?.available === true &&
        selectIsProviderModelAccessAllowed.select(state, id),
    );
});

/** Initial model fetches may precede general discovery, but not Antigravity auth. */
export const selectModelFetchProviderIds = store.createSelector((state): string[] => {
  const ids = selectHasCheckedOnce.select(state)
    ? selectAvailableEnabledProviderIds.select(state)
    : selectEnabledProviderIds.select(state);
  return ids.filter((id) => selectIsProviderModelAccessAllowed.select(state, id));
});

/** Whether the currently active provider is in the available+enabled set. */
export const selectIsActiveProviderAvailable = store.createSelector((state): boolean => {
  const activeProviderId = selectActiveProviderId.select(state);
  return selectAvailableEnabledProviderIds.select(state).includes(activeProviderId);
});
