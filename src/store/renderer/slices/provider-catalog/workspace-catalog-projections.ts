import type { ProviderReadState } from '../provider-catalog/provider-read-types';
import { isProviderAuthenticationReady } from '$shared/types/provider-availability';
import {
  getAllProviderWarnings,
  getAllProviderStaleFlags,
  getSelectedModel,
} from '../model/model-projections';
import {
  getHasCheckedOnce,
  getProviderStatusMap,
  getIsAnyProviderLoading,
} from '../agent-availability/agent-availability-projections';
import {
  getActiveProviderId,
  getAvailableEnabledProviderIds,
  getEnabledProviders,
  getModelFetchProviderIds,
  getQuotaRetryProviderIds,
} from '../provider-settings/provider-settings-projections';
import { getProviderCatalogEntries } from './provider-catalog-projections';

/** A settled provider sweep invalidates workspace readiness once, not once per provider. */
export const getSettledProviderReadiness = (state: ProviderReadState) =>
  getIsAnyProviderLoading(state) ? null : getProviderStatusMap(state);

export const getWorkspaceCatalogEpoch = (state: ProviderReadState): number =>
  state.providerCatalog?.workspaceEpoch ?? 0;
const getWorkspaceCatalog = (state: ProviderReadState, workspaceId?: string) =>
  workspaceId ? state.providerCatalog?.byWorkspaceId?.[workspaceId] : undefined;
export const getWorkspaceCatalogFresh = (state: ProviderReadState, workspaceId: string): boolean =>
  !!getWorkspaceCatalog(state, workspaceId) &&
  state.providerCatalog.workspaceSnapshotEpochs?.[workspaceId] === getWorkspaceCatalogEpoch(state);
export const getContextProviderEntries = (state: ProviderReadState, workspaceId?: string) =>
  workspaceId
    ? (getWorkspaceCatalog(state, workspaceId)?.catalog.providers ?? [])
    : getProviderCatalogEntries(state);
export const getContextDefaultProvider = (
  state: ProviderReadState,
  workspaceId?: string,
): string => {
  if (!workspaceId) return getActiveProviderId(state);
  const value = getWorkspaceCatalog(state, workspaceId)?.settings.find(
    (s) => s.path === 'model.defaultProvider',
  )?.value;
  return typeof value === 'string' ? value : '';
};
export const getContextEnabledProviders = (
  state: ProviderReadState,
  workspaceId?: string,
): Record<string, boolean> => {
  if (!workspaceId) return getEnabledProviders(state);
  const value = getWorkspaceCatalog(state, workspaceId)?.settings.find(
    (s) => s.path === 'providers.enabled',
  )?.value;
  return value && typeof value === 'object' ? (value as Record<string, boolean>) : {};
};
export const getContextModelProviderIds = (
  state: ProviderReadState,
  workspaceId?: string,
): string[] => {
  if (!workspaceId) return getModelFetchProviderIds(state);
  const enabled = getContextEnabledProviders(state, workspaceId);
  const defaultId = getContextDefaultProvider(state, workspaceId);
  const readiness = getWorkspaceCatalog(state, workspaceId)?.readiness ?? {};
  return getContextProviderEntries(state, workspaceId)
    .filter(
      (p) =>
        p.visible &&
        (!p.canBeDisabled || enabled[p.id] || p.id === defaultId) &&
        readiness[p.id]?.available &&
        (p.id !== 'antigravity' ||
          isProviderAuthenticationReady(p.id, readiness[p.id]?.authenticated)),
    )
    .map((p) => p.id);
};
export const getContextAvailableProviderIds = (
  state: ProviderReadState,
  workspaceId?: string,
): string[] =>
  workspaceId
    ? getContextModelProviderIds(state, workspaceId)
    : getAvailableEnabledProviderIds(state);

export const getContextReadinessLoaded = (
  state: ProviderReadState,
  workspaceId?: string,
): boolean => (workspaceId ? !!getWorkspaceCatalog(state, workspaceId) : getHasCheckedOnce(state));
export const getContextSelectedModel = (state: ProviderReadState, workspaceId?: string): string => {
  if (!workspaceId) return getSelectedModel(state);
  const settings = getWorkspaceCatalog(state, workspaceId)?.settings ?? [];
  const provider = getContextDefaultProvider(state, workspaceId);
  const defaults = settings.find((s) => s.path === 'model.providerDefaults')?.value;
  const value =
    defaults && typeof defaults === 'object'
      ? (defaults as Record<string, unknown>)[provider]
      : undefined;
  if (typeof value === 'string') return value;
  const fallback = settings.find((s) => s.path === 'model.default')?.value;
  return typeof fallback === 'string' ? fallback : '';
};
export const getContextProviderWarnings = (
  state: ProviderReadState,
  workspaceId?: string,
): Record<string, string> => {
  if (!workspaceId) return getAllProviderWarnings(state);
  return Object.fromEntries(
    Object.entries(state.providerModels?.byWorkspaceId?.[workspaceId] ?? {}).flatMap(
      ([id, entry]) => (entry.warning ? [[id, entry.warning]] : []),
    ),
  );
};
export const getContextProviderStaleFlags = (
  state: ProviderReadState,
  workspaceId?: string,
): Record<string, boolean> => {
  if (!workspaceId) return getAllProviderStaleFlags(state);
  return Object.fromEntries(
    Object.entries(state.providerModels?.byWorkspaceId?.[workspaceId] ?? {}).map(([id, entry]) => [
      id,
      entry.stale === true,
    ]),
  );
};

export const getContextQuotaRetryProviderIds = (
  state: ProviderReadState,
  exhaustedProviderId: string,
  workspaceId?: string,
): string[] => {
  if (!workspaceId) return getQuotaRetryProviderIds(state, exhaustedProviderId);
  const enabled = getContextEnabledProviders(state, workspaceId);
  const snapshot = getWorkspaceCatalog(state, workspaceId);
  return getContextModelProviderIds(state, workspaceId).filter(
    (id) =>
      id !== exhaustedProviderId &&
      (enabled[id] ||
        snapshot?.catalog.providers.find((p) => p.id === id)?.canBeDisabled === false) &&
      isProviderAuthenticationReady(id, snapshot?.readiness[id]?.authenticated),
  );
};

export const getContextReadiness = (state: ProviderReadState, workspaceId?: string) =>
  workspaceId
    ? (getWorkspaceCatalog(state, workspaceId)?.readiness ?? {})
    : getProviderStatusMap(state);
