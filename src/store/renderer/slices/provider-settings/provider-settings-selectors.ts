import {
  selectHostExecutionContext,
  selectIsHostMember,
} from '../host-execution/host-execution-selectors';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { providerRefBaseId, type ProviderProfile } from '$shared/provider-profiles';
import { selectProviderCatalogEntries } from '../provider-catalog/provider-catalog-selectors';
import type {
  ProviderProfileMutation,
  ProviderProfileStatus,
  ProviderProfilesState,
} from './provider-settings-types';
import { initialProfilesState } from './provider-profiles-state';
import { resolveProviderEnabled } from '$shared/provider-catalog';
import { isProviderAuthenticationReady } from '$shared/types/provider-availability';
import { store } from '../../store';
import {
  selectHasCheckedOnce,
  selectProviderStatusMap,
} from '../agent-availability/agent-availability-selectors';
import {
  selectNormalizedProviderId,
  selectProviderCatalogEntry,
} from '../provider-catalog/provider-catalog-selectors';

export const selectProviderSettingsSessionRequests = store.createSelector(
  (state, sessionId: string) =>
    getItems(state.providerSettings.requests).filter((request) => request.sessionId === sessionId),
);
export const selectProviderSettingsSessionActive = store.createSelector(
  (state, sessionId: string) => state.providerSettings.sessions.includes(sessionId),
);
export const selectProviderWriteRevision = store.createSelector(
  (state, resource: string) => state.providerSettings.writeRevisions?.[resource] ?? 0,
);
export const selectProviderPaths = store.createSelector((state) => state.providerSettings.paths);
export const selectProviderPathsRevision = store.createSelector(
  (state) => state.providerSettings.pathsRevision,
);

/**
 * Default provider id — the provider leg of the default model triple
 * (`model.defaultProvider`). The standalone `providers.active` concept is
 * retired; the state lives in the model slice ('' before hydration).
 */
export const selectActiveProviderId = store.createSelector((state): string => {
  return selectIsHostMember.select(state)
    ? (selectHostExecutionContext.select(state)?.defaultProviderId ?? '')
    : state.model.defaultProviderId;
});

export const selectIsProviderActive = store.createSelector((state, providerId: string): boolean => {
  return selectActiveProviderId.select(state) === providerId;
});

export const selectEnabledProviders = store.createSelector((state): Record<string, boolean> => {
  if (selectIsHostMember.select(state)) {
    return Object.fromEntries(
      (selectHostExecutionContext.select(state)?.enabledProviderIds ?? []).map((id) => [id, true]),
    );
  }
  return state.providerSettings.enabledProviders;
});

export const selectIsProviderEnabled = store.createSelector(
  (state, providerId: string): boolean => {
    if (selectIsHostMember.select(state)) {
      return (
        selectHostExecutionContext.select(state)?.enabledProviderIds?.includes(providerId) === true
      );
    }
    const nonDisableable = state.providerSettings.nonDisableableProviderIds ?? [];
    return resolveProviderEnabled(state.providerSettings.enabledProviders, providerId, {
      canBeDisabled: !nonDisableable.includes(providerId),
    });
  },
);

export const selectEnabledProviderIds = store.createSelector((state): string[] => {
  if (selectIsHostMember.select(state))
    return selectHostExecutionContext.select(state)?.enabledProviderIds ?? [];
  const enabledProviders = state.providerSettings.enabledProviders;
  const catalogEntries = state.providerCatalog ? getItems(state.providerCatalog.providers) : [];
  const enabled = new Set(
    catalogEntries.filter((p) => selectIsProviderEnabled.select(state, p.id)).map((p) => p.id),
  );
  // A default profile reference (§5.54) keeps its base provider listed.
  const activeProviderId = selectActiveProviderId.select(state);
  if (activeProviderId) enabled.add(providerRefBaseId(activeProviderId));

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
  if (selectIsHostMember.select(state)) return entry?.visible !== true;
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

/**
 * Providers a quota-exceeded turn can be retried on (#4455): the
 * available+enabled set narrowed to providers whose sign-in is ready, minus
 * the exhausted provider. `selectAvailableEnabledProviderIds` is a model-picker
 * gate that only applies the auth rule to Antigravity, so a signed-out Codex /
 * Droid / Auggie with `{ available: true, authenticated: false }` would
 * otherwise be offered as a dead-end retry target. Unknown auth (no
 * `authenticated` flag reported) stays offered, matching
 * `isProviderAuthenticationReady`. The picker gate also always admits the
 * active `defaultProviderId` even when explicitly disabled; a retry target
 * must be genuinely enabled or the daemon's setModel gate rejects the switch.
 * Does not change the generic picker policy.
 */
export const selectQuotaRetryProviderIds = store.createSelector(
  (state, exhaustedProviderId: string): string[] => {
    const statusMap = selectProviderStatusMap.select(state);
    const exhausted = selectNormalizedProviderId.select(state, exhaustedProviderId);
    return selectAvailableEnabledProviderIds
      .select(state)
      .filter(
        (id) =>
          selectNormalizedProviderId.select(state, id) !== exhausted &&
          selectIsProviderEnabled.select(state, id) &&
          isProviderAuthenticationReady(id, statusMap[id]?.authenticated),
      );
  },
);

/** Initial model fetches may precede general discovery, but not Antigravity auth. */
export const selectModelFetchProviderIds = store.createSelector((state): string[] => {
  const ids = selectHasCheckedOnce.select(state)
    ? selectAvailableEnabledProviderIds.select(state)
    : selectEnabledProviderIds.select(state);
  return ids.filter((id) => selectIsProviderModelAccessAllowed.select(state, id));
});

/** Whether the currently active provider is in the available+enabled set. */
export const selectIsActiveProviderAvailable = store.createSelector((state): boolean => {
  // A default profile (§5.54) is available while its base provider is.
  const activeProviderId = providerRefBaseId(selectActiveProviderId.select(state));
  return selectAvailableEnabledProviderIds.select(state).includes(activeProviderId);
});

export const selectProviderFastModeState = store.createSelector(
  (state) => state.providerSettings.fastMode,
);

export const selectProviderFastModeValues = store.createSelector(
  (state): Record<string, boolean> => {
    const fastMode = state.providerSettings.fastMode;
    const values = { ...fastMode?.confirmed };
    for (const [id, edit] of Object.entries(fastMode?.pending ?? {})) values[id] = edit.enabled;
    return values;
  },
);

export const selectFastModeSupportedProviders = store.createSelector((state): string[] => {
  if (!state.providerSettings.fastMode?.supported) return [];
  return ['claude-code', 'codex'].filter(
    (id) => selectProviderCatalogEntry.select(state, id)?.supportsFastMode === true,
  );
});

// Named provider profiles (§5.54): masked daemon reads only.
const profilesState = (state: { providerSettings?: { profiles?: ProviderProfilesState } }) =>
  state.providerSettings?.profiles ?? initialProfilesState;

/** Base provider ids whose catalog row advertises `supportsProfiles: true`. */
export const selectProfileCapableProviderIds = store.createSelector((state): string[] =>
  selectProviderCatalogEntries
    .select(state)
    .filter((entry) => entry.supportsProfiles === true)
    .map((entry) => entry.id),
);

/** Profiles of one base provider, in the daemon's stored order. */
export const selectProviderProfilesForBase = store.createSelector(
  (state, baseProviderId: string): ProviderProfile[] =>
    getItems(profilesState(state).items).filter(
      (profile) => profile.baseProviderId === baseProviderId,
    ),
);

export const selectProviderProfile = store.createSelector(
  (state, profileId: string): ProviderProfile | undefined =>
    getItem(profilesState(state).items, profileId),
);

export const selectProviderProfilesRevision = store.createSelector(
  (state): number => profilesState(state).revision,
);

export const selectProviderProfilesLoadStatus = store.createSelector(
  (state): ProviderProfilesState['loadStatus'] => profilesState(state).loadStatus,
);

export const selectProviderProfileStatusMap = store.createSelector(
  (state): Record<string, ProviderProfileStatus> => profilesState(state).status,
);

export const selectProviderProfileActivationMap = store.createSelector(
  (state): ProviderProfilesState['activation'] => profilesState(state).activation,
);

/** Outstanding and settled-but-undismissed mutations by request id. */
export const selectProviderProfileMutations = store.createSelector(
  (state): Record<string, ProviderProfileMutation> =>
    Object.fromEntries(getItems(profilesState(state).mutations).map((item) => [item.id, item])),
);

/** True while any Settings → Providers panel is open. */
export const selectProviderSettingsHasOpenSession = store.createSelector(
  (state): boolean => (state.providerSettings?.sessions.length ?? 0) > 0,
);
