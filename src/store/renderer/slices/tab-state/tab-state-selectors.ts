import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';

import { type Workspace } from '$shared/types';
import { store } from '../../store';
import { getActiveBackendId } from '../../utils/backend-storage-namespace';
import { serializeWorkspaceTabsState } from './tab-state-slice';

export const selectIsDragging = store.createSelector((state) => {
  return state.tabState.isDragging;
});

export const selectActiveHandleDrop = store.createSelector((state) => {
  return state.tabState.activeHandleDrop;
});

export const selectScrollPosition = store.createSelector(
  (state, tabId: string): number | undefined => {
    return state.tabState.scrollPositions[tabId];
  },
);

export const selectAllScrollPositions = store.createSelector((state) => {
  return state.tabState.scrollPositions;
});

export const selectCurrentWorkspaceTabId = store.createSelector((state) => {
  return state.tabState.currentTabId;
});

/**
 * True once the tab saga has (re)hydrated the persisted tab strip for the
 * ACTIVE backend. Until then `currentTabId` may still be the previous
 * backend's (or empty), so boot-time consumers must not treat it as final.
 */
export const selectWorkspaceTabsHydrated = store.createSelector((state) => {
  return state.tabState.hydratedBackendId === getActiveBackendId(state);
});

export const selectWorkspaceTabOrder = store.createSelector((state) => {
  return state.tabState.workspaceStacks.flatMap((stack) => stack);
});

export const selectWorkspaceStacks = store.createSelector((state) => {
  return state.tabState.workspaceStacks;
});

export const selectWorkspaceViewMode = store.createSelector((state) => {
  return state.tabState.viewMode;
});

export const selectActiveWorkspaceIds = store.createSelector((state): string[] => {
  return Object.keys(state.tabState.openTabs).filter(
    (workspaceId) => state.tabState.openTabs[workspaceId] === true,
  );
});

export const selectLastClosedWorkspaceTab = store.createSelector(
  (state): { workspaceId: string; closedAt: number } | null => {
    const { recentlyClosedTabIds, recentlyClosedTabAt, openTabs } = state.tabState;
    for (let index = recentlyClosedTabIds.length - 1; index >= 0; index--) {
      const workspaceId = recentlyClosedTabIds[index];
      if (!openTabs[workspaceId]) {
        return { workspaceId, closedAt: recentlyClosedTabAt[workspaceId] ?? 0 };
      }
    }
    return null;
  },
);

export const selectPersistedWorkspaceTabsState = store.createSelector((state) => {
  return serializeWorkspaceTabsState(state.tabState);
});

/** Stable empty result so guard-failed states never re-emit through selector channels. */
const NO_TABS_TO_RECONCILE: string[] = [];

/**
 * Open workspace-tab IDs whose workspace is missing from the loaded workspace
 * list — the tabs the reconciliation saga should close. A workspace that
 * still EXISTS in the list is never prunable, regardless of archived status:
 * archived workspaces keep their tabs.
 *
 * Returns the empty list (i.e. "do nothing") until it is provably safe to
 * prune:
 * - the connections list must have been received — until then `activeId` is
 *   the boot-time local default, so the backend-identity checks below can't
 *   be trusted (a remote-active boot hydrates the local strip first);
 * - the tab strip must be hydrated for the ACTIVE backend (a backend switch
 *   re-hydrates, so a stale strip is never reconciled against the new
 *   backend's workspace list);
 * - the workspace list must have completed a load (`hasLoaded`) AND have been
 *   fetched for the ACTIVE backend (`loadedBackendId`) — `hasLoaded` alone is
 *   global and survives a switch, so a re-hydrated strip could otherwise be
 *   compared against the previous backend's list;
 * - the loaded list must be non-empty — the seeder dispatches
 *   `replaceWorkspaceList([])` when the daemon is unreachable, and pruning
 *   then would wipe every tab.
 *
 * Optimistic tabs, workspaces with a pending creation, and workspaces inside
 * the delete-undo grace window (`pendingDeletions` — the entity is removed
 * from the collection up front, but an undo must restore the tab) are never
 * pruned.
 *
 * Scans `workspaceStacks` only: an `openTabs` entry absent from the stacks is
 * unreachable UI-wise and `closeWorkspaceTab` no-ops on it anyway (the reducer
 * early-returns when the ID is not in the tab order).
 */
export const selectWorkspaceTabsToReconcile = store.createSelector((state): string[] => {
  if (state.connections && !state.connections.hasReceivedList) return NO_TABS_TO_RECONCILE;
  const activeBackendId = getActiveBackendId(state);
  if (state.tabState.hydratedBackendId !== activeBackendId) return NO_TABS_TO_RECONCILE;
  if (!state.workspace.hasLoaded) return NO_TABS_TO_RECONCILE;
  if (state.workspace.loadedBackendId !== activeBackendId) return NO_TABS_TO_RECONCILE;
  if (state.workspace.workspaces.ids.length === 0) return NO_TABS_TO_RECONCILE;
  const prunable = state.tabState.workspaceStacks
    .flatMap((stack) => stack)
    .filter((workspaceId) => {
      if (state.tabState.optimisticTabs[workspaceId]) return false;
      if (state.workspace.pendingCreations[workspaceId]) return false;
      if (state.workspace.pendingDeletions[workspaceId]) return false;
      return !getItem(state.workspace.workspaces, workspaceId as Workspace['id']);
    });
  return prunable.length === 0 ? NO_TABS_TO_RECONCILE : prunable;
});
