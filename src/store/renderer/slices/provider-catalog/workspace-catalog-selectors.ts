import { isProviderAuthenticationReady } from '$shared/types/provider-availability';
import { isProviderListed } from '$shared/provider-visibility';
import type { ModelWarningKind } from '$shared/models/wire-model-info';
import {
  selectAllProviderWarnings,
  selectAllProviderStaleFlags,
  selectAllProviderWarningKinds,
  selectSelectedModel,
} from '../model/model-selectors';
import {
  selectHasCheckedOnce,
  selectProviderStatusMap,
  selectIsAnyProviderLoading,
} from '../agent-availability/agent-availability-selectors';
import { store } from '../../store';
import type { Specialist } from '$lib/constants/specialists';
import { selectSpecialists } from '../specialists/specialists-selectors';
import {
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
  selectEnabledProviders,
  selectModelFetchProviderIds,
  selectQuotaRetryProviderIds,
} from '../provider-settings/provider-settings-selectors';
import { selectProviderCatalogEntries } from './provider-catalog-selectors';

/** A settled provider sweep invalidates workspace readiness once, not once per provider. */
export const selectSettledProviderReadiness = store.createSelector((state) =>
  selectIsAnyProviderLoading.select(state) ? null : selectProviderStatusMap.select(state),
);

export const selectWorkspaceCatalogEpoch = store.createSelector(
  (state): number => state.providerCatalog?.workspaceEpoch ?? 0,
);
export const selectWorkspaceCatalog = store.createSelector((state, workspaceId?: string) =>
  workspaceId ? state.providerCatalog?.byWorkspaceId?.[workspaceId] : undefined,
);
/** Includes creation pickers which can demand a catalog before lifecycle mount. */
export const selectWorkspaceCatalogIds = store.createSelector((state): string[] =>
  Object.keys(state.providerCatalog?.byWorkspaceId ?? {}),
);
export const selectWorkspaceCatalogFresh = store.createSelector(
  (state, workspaceId: string): boolean =>
    !!selectWorkspaceCatalog.select(state, workspaceId) &&
    state.providerCatalog.workspaceSnapshotEpochs?.[workspaceId] ===
      selectWorkspaceCatalogEpoch.select(state),
);
export const selectContextProviderEntries = store.createSelector((state, workspaceId?: string) =>
  workspaceId
    ? (selectWorkspaceCatalog.select(state, workspaceId)?.catalog.providers ?? [])
    : selectProviderCatalogEntries.select(state),
);
export const selectContextDefaultProvider = store.createSelector(
  (state, workspaceId?: string): string => {
    if (!workspaceId) return selectActiveProviderId.select(state);
    const value = selectWorkspaceCatalog
      .select(state, workspaceId)
      ?.settings.find((s) => s.path === 'model.defaultProvider')?.value;
    return typeof value === 'string' ? value : '';
  },
);
export const selectContextEnabledProviders = store.createSelector(
  (state, workspaceId?: string): Record<string, boolean> => {
    if (!workspaceId) return selectEnabledProviders.select(state);
    const value = selectWorkspaceCatalog
      .select(state, workspaceId)
      ?.settings.find((s) => s.path === 'providers.enabled')?.value;
    return value && typeof value === 'object' ? (value as Record<string, boolean>) : {};
  },
);
export const selectContextModelProviderIds = store.createSelector(
  (state, workspaceId?: string): string[] => {
    if (!workspaceId) return selectModelFetchProviderIds.select(state);
    const enabled = selectContextEnabledProviders.select(state, workspaceId);
    const defaultId = selectContextDefaultProvider.select(state, workspaceId);
    const readiness = selectWorkspaceCatalog.select(state, workspaceId)?.readiness ?? {};
    return selectContextProviderEntries
      .select(state, workspaceId)
      .filter(
        (p) =>
          p.visible &&
          (!p.canBeDisabled || enabled[p.id] || p.id === defaultId) &&
          readiness[p.id]?.available &&
          (p.id !== 'antigravity' ||
            isProviderAuthenticationReady(p.id, readiness[p.id]?.authenticated)),
      )
      .map((p) => p.id);
  },
);
export const selectContextListedProviderIds = store.createSelector(
  (state, workspaceId?: string): string[] => {
    const enabled = selectContextEnabledProviders.select(state, workspaceId);
    const status = workspaceId
      ? (selectWorkspaceCatalog.select(state, workspaceId)?.readiness ?? {})
      : selectProviderStatusMap.select(state);
    return selectContextProviderEntries
      .select(state, workspaceId)
      .filter((p) => isProviderListed(p.id, status[p.id]?.available, enabled[p.id] === true))
      .map((p) => p.id);
  },
);
export const selectContextAvailableProviderIds = store.createSelector(
  (state, workspaceId?: string): string[] =>
    workspaceId
      ? selectContextModelProviderIds.select(state, workspaceId)
      : selectAvailableEnabledProviderIds.select(state),
);
export const selectContextSpecialists = store.createSelector(
  (state, workspaceId?: string): Specialist[] => selectSpecialists.select(state, workspaceId),
);

export const selectContextReadinessLoaded = store.createSelector(
  (state, workspaceId?: string): boolean =>
    workspaceId
      ? !!selectWorkspaceCatalog.select(state, workspaceId)
      : selectHasCheckedOnce.select(state),
);
export const selectContextSelectedModel = store.createSelector(
  (state, workspaceId?: string): string => {
    if (!workspaceId) return selectSelectedModel.select(state);
    const settings = selectWorkspaceCatalog.select(state, workspaceId)?.settings ?? [];
    const provider = selectContextDefaultProvider.select(state, workspaceId);
    const defaults = settings.find((s) => s.path === 'model.providerDefaults')?.value;
    const value =
      defaults && typeof defaults === 'object'
        ? (defaults as Record<string, unknown>)[provider]
        : undefined;
    if (typeof value === 'string') return value;
    const fallback = settings.find((s) => s.path === 'model.default')?.value;
    return typeof fallback === 'string' ? fallback : '';
  },
);
export const selectContextProviderWarnings = store.createSelector(
  (state, workspaceId?: string): Record<string, string> => {
    if (!workspaceId) return selectAllProviderWarnings.select(state);
    return Object.fromEntries(
      Object.entries(state.providerModels?.byWorkspaceId?.[workspaceId] ?? {}).flatMap(
        ([id, entry]) => (entry.warning ? [[id, entry.warning]] : []),
      ),
    );
  },
);
export const selectContextProviderStaleFlags = store.createSelector(
  (state, workspaceId?: string): Record<string, boolean> => {
    if (!workspaceId) return selectAllProviderStaleFlags.select(state);
    return Object.fromEntries(
      Object.entries(state.providerModels?.byWorkspaceId?.[workspaceId] ?? {}).map(
        ([id, entry]) => [id, entry.stale === true],
      ),
    );
  },
);

export const selectContextProviderWarningKinds = store.createSelector(
  (state, workspaceId?: string): Record<string, ModelWarningKind> => {
    if (!workspaceId) return selectAllProviderWarningKinds.select(state);
    return Object.fromEntries(
      Object.entries(state.providerModels?.byWorkspaceId?.[workspaceId] ?? {}).flatMap(
        ([id, entry]) => (entry.warning && entry.warningKind ? [[id, entry.warningKind]] : []),
      ),
    );
  },
);

export const selectContextQuotaRetryProviderIds = store.createSelector(
  (state, exhaustedProviderId: string, workspaceId?: string): string[] => {
    if (!workspaceId) return selectQuotaRetryProviderIds.select(state, exhaustedProviderId);
    const enabled = selectContextEnabledProviders.select(state, workspaceId);
    const snapshot = selectWorkspaceCatalog.select(state, workspaceId);
    return selectContextModelProviderIds
      .select(state, workspaceId)
      .filter(
        (id) =>
          id !== exhaustedProviderId &&
          (enabled[id] ||
            snapshot?.catalog.providers.find((p) => p.id === id)?.canBeDisabled === false) &&
          isProviderAuthenticationReady(id, snapshot?.readiness[id]?.authenticated),
      );
  },
);

export const selectContextReadiness = store.createSelector((state, workspaceId?: string) =>
  workspaceId
    ? (selectWorkspaceCatalog.select(state, workspaceId)?.readiness ?? {})
    : selectProviderStatusMap.select(state),
);
