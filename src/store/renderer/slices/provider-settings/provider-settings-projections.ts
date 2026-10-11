import type { ProviderReadState } from '../provider-catalog/provider-read-types';
import {
  getHostExecutionContext,
  getIsHostMember,
} from '../host-execution/host-execution-projections';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { resolveProviderEnabled } from '$shared/provider-catalog';
import { isProviderAuthenticationReady } from '$shared/types/provider-availability';
import {
  getHasCheckedOnce,
  getProviderStatusMap,
} from '../agent-availability/agent-availability-projections';
import {
  getNormalizedProviderId,
  getProviderCatalogEntry,
} from '../provider-catalog/provider-catalog-projections';

export const getProviderSettingsSessionRequests = (state: ProviderReadState, sessionId: string) =>
  getItems(state.providerSettings.requests).filter((request) => request.sessionId === sessionId);
export const getProviderSettingsSessionActive = (state: ProviderReadState, sessionId: string) =>
  state.providerSettings.sessions.includes(sessionId);
export const getProviderWriteRevision = (state: ProviderReadState, resource: string) =>
  state.providerSettings.writeRevisions?.[resource] ?? 0;
export const getProviderPaths = (state: ProviderReadState) => state.providerSettings.paths;
export const getProviderPathsRevision = (state: ProviderReadState) =>
  state.providerSettings.pathsRevision;
export const getPiAdapter = (state: ProviderReadState) => state.providerSettings.piAdapter;

/**
 * Default provider id — the provider leg of the default model triple
 * (`model.defaultProvider`). The standalone `providers.active` concept is
 * retired; the state lives in the model slice ('' before hydration).
 */
export const getActiveProviderId = (state: ProviderReadState): string => {
  return getIsHostMember(state)
    ? (getHostExecutionContext(state)?.defaultProviderId ?? '')
    : state.model.defaultProviderId;
};

export const getIsProviderActive = (state: ProviderReadState, providerId: string): boolean => {
  return getActiveProviderId(state) === providerId;
};

export const getEnabledProviders = (state: ProviderReadState): Record<string, boolean> => {
  if (getIsHostMember(state)) {
    return Object.fromEntries(
      (getHostExecutionContext(state)?.enabledProviderIds ?? []).map((id) => [id, true]),
    );
  }
  return state.providerSettings.enabledProviders;
};

export const getIsProviderEnabled = (state: ProviderReadState, providerId: string): boolean => {
  if (getIsHostMember(state)) {
    return getHostExecutionContext(state)?.enabledProviderIds?.includes(providerId) === true;
  }
  const nonDisableable = state.providerSettings.nonDisableableProviderIds ?? [];
  return resolveProviderEnabled(state.providerSettings.enabledProviders, providerId, {
    canBeDisabled: !nonDisableable.includes(providerId),
  });
};

export const getEnabledProviderIds = (state: ProviderReadState): string[] => {
  if (getIsHostMember(state)) return getHostExecutionContext(state)?.enabledProviderIds ?? [];
  const enabledProviders = state.providerSettings.enabledProviders;
  const catalogEntries = state.providerCatalog ? getItems(state.providerCatalog.providers) : [];
  const enabled = new Set(
    catalogEntries.filter((p) => getIsProviderEnabled(state, p.id)).map((p) => p.id),
  );
  const activeProviderId = getActiveProviderId(state);
  if (activeProviderId) enabled.add(activeProviderId);

  for (const [providerId, isEnabled] of Object.entries(enabledProviders)) {
    if (isEnabled) {
      enabled.add(providerId);
    }
  }

  return [...enabled];
};

/**
 * A provider is hidden when it's gated behind an env var / feature code the
 * renderer cannot verify — mirrors the default-deny gating in
 * `provider-status-bridge-seeder.ts`'s `computeHiddenProviders`.
 */
function isProviderHidden(state: ProviderReadState, providerId: string): boolean {
  const entry = getProviderCatalogEntry(state, providerId);
  if (getIsHostMember(state)) return entry?.visible !== true;
  return Boolean(entry?.requiresEnvVar || entry?.requiresFeatureCode);
}

/** Antigravity model access requires confirmed sign-in, including at startup.
 * Other providers retain their existing model-probe behavior. This does not
 * change enabled/default preferences or require an agent's provider to be enabled. */
export const getIsProviderModelAccessAllowed = (
  state: ProviderReadState,
  providerId: string,
): boolean => {
  if (providerId !== 'antigravity') return true;
  const status = getProviderStatusMap(state)[providerId];
  return (
    status?.available === true && isProviderAuthenticationReady(providerId, status.authenticated)
  );
};

/** Enabled, visible providers that are ready for model selection.
 * This set never changes the user's saved provider preference. */
export const getAvailableEnabledProviderIds = (state: ProviderReadState): string[] => {
  const statusMap = getProviderStatusMap(state);
  return getEnabledProviderIds(state).filter(
    (id) =>
      !isProviderHidden(state, id) &&
      statusMap[id]?.available === true &&
      getIsProviderModelAccessAllowed(state, id),
  );
};

/**
 * Providers a quota-exceeded turn can be retried on (#4455): the
 * available+enabled set narrowed to providers whose sign-in is ready, minus
 * the exhausted provider. `getAvailableEnabledProviderIds` is a model-picker
 * gate that only applies the auth rule to Antigravity, so a signed-out Codex /
 * Droid / Auggie with `{ available: true, authenticated: false }` would
 * otherwise be offered as a dead-end retry target. Unknown auth (no
 * `authenticated` flag reported) stays offered, matching
 * `isProviderAuthenticationReady`. The picker gate also always admits the
 * active `defaultProviderId` even when explicitly disabled; a retry target
 * must be genuinely enabled or the daemon's setModel gate rejects the switch.
 * Does not change the generic picker policy.
 */
export const getQuotaRetryProviderIds = (
  state: ProviderReadState,
  exhaustedProviderId: string,
): string[] => {
  const statusMap = getProviderStatusMap(state);
  const exhausted = getNormalizedProviderId(state, exhaustedProviderId);
  return getAvailableEnabledProviderIds(state).filter(
    (id) =>
      getNormalizedProviderId(state, id) !== exhausted &&
      getIsProviderEnabled(state, id) &&
      isProviderAuthenticationReady(id, statusMap[id]?.authenticated),
  );
};

/** Initial model fetches may precede general discovery, but not Antigravity auth. */
export const getModelFetchProviderIds = (state: ProviderReadState): string[] => {
  const ids = getHasCheckedOnce(state)
    ? getAvailableEnabledProviderIds(state)
    : getEnabledProviderIds(state);
  return ids.filter((id) => getIsProviderModelAccessAllowed(state, id));
};

/** Whether the currently active provider is in the available+enabled set. */
export const getIsActiveProviderAvailable = (state: ProviderReadState): boolean => {
  const activeProviderId = getActiveProviderId(state);
  return getAvailableEnabledProviderIds(state).includes(activeProviderId);
};

export const getProviderFastModeState = (state: ProviderReadState) =>
  state.providerSettings.fastMode;

export const getProviderFastModeValues = (state: ProviderReadState): Record<string, boolean> => {
  const fastMode = state.providerSettings.fastMode;
  const values = { ...fastMode?.confirmed };
  for (const [id, edit] of Object.entries(fastMode?.pending ?? {})) values[id] = edit.enabled;
  return values;
};

export const getFastModeSupportedProviders = (state: ProviderReadState): string[] => {
  if (!state.providerSettings.fastMode?.supported) return [];
  return ['claude-code', 'codex'].filter(
    (id) => getProviderCatalogEntry(state, id)?.supportsFastMode === true,
  );
};
