import { store } from '@/store';
import * as projections from '../../../../../src/store/renderer/slices/tab-state/tab-state-projections';

export const selectIsDragging = store.createSelector(projections.getIsDragging);

export const selectAllScrollPositions = store.createSelector(projections.getAllScrollPositions);

export const selectCurrentWorkspaceTabId = store.createSelector(
  projections.getCurrentWorkspaceTabId,
);

/** Actual panel webview mounts, including retained inactive tabs. */
export const selectMountedBrowserTabLeases = store.createSelector(
  projections.getMountedBrowserTabLeases,
);

export const selectBrowserTabRecoveryRequests = store.createSelector(
  projections.getBrowserTabRecoveryRequests,
);

export const selectBrowserTabNavigations = store.createSelector(
  projections.getBrowserTabNavigations,
);

/**
 * True once the tab saga has (re)hydrated the persisted tab strip for the
 * ACTIVE backend. Until then `currentTabId` may still be the previous
 * backend's (or empty), so boot-time consumers must not treat it as final.
 */
export const selectWorkspaceTabsHydrated = store.createSelector(
  projections.getWorkspaceTabsHydrated,
);

export const selectWorkspaceTabOrder = store.createSelector(projections.getWorkspaceTabOrder);

export const selectActiveWorkspaceIds = store.createSelector(projections.getActiveWorkspaceIds);

export const selectLastClosedWorkspaceTab = store.createSelector(
  projections.getLastClosedWorkspaceTab,
);

export const selectPersistedWorkspaceTabsState = store.createSelector(
  projections.getPersistedWorkspaceTabsState,
);

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
export const selectWorkspaceTabsToReconcile = store.createSelector(
  projections.getWorkspaceTabsToReconcile,
);
