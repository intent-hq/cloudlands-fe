import { getItem } from '@themislib/themis/utils/collections/collection-utils';

import { type Workspace } from '$shared/types';
import { getActiveBackendId } from '../../utils/backend-storage-namespace';
import type { ConnectionsState } from '../connections/connections-types';
import type { WorkspaceState } from '../workspace/workspace-slice';
import { serializeWorkspaceTabsState, type TabState } from './tab-state-slice';

type TabStateProjectionState = { tabState: TabState };
type BackendTabStateProjectionState = TabStateProjectionState & {
  connections?: Pick<ConnectionsState, 'windowBackendId'>;
};
type WorkspaceTabReconciliationState = BackendTabStateProjectionState & {
  connections?: Pick<ConnectionsState, 'windowBackendId' | 'hasReceivedList'>;
  workspace: Pick<
    WorkspaceState,
    'hasLoaded' | 'loadedBackendId' | 'workspaces' | 'pendingCreations' | 'pendingDeletions'
  >;
};

export const getIsDragging = (state: TabStateProjectionState) => {
  return state.tabState.isDragging;
};

export const getAllScrollPositions = (state: TabStateProjectionState) => {
  return state.tabState.scrollPositions;
};

export const getCurrentWorkspaceTabId = (state: TabStateProjectionState) => {
  return state.tabState.currentTabId;
};

/** Actual panel webview mounts, including retained inactive tabs. */
export const getMountedBrowserTabLeases = (state: TabStateProjectionState) => {
  return state.tabState.mountedBrowserTabLeases;
};

export const getBrowserTabRecoveryRequests = (state: TabStateProjectionState) => {
  return state.tabState.browserTabRecoveryRequests;
};

export const getBrowserTabNavigations = (state: TabStateProjectionState) => {
  return state.tabState.browserTabNavigations;
};

/**
 * True once the tab saga has (re)hydrated the persisted tab strip for the
 * ACTIVE backend. Until then `currentTabId` may still be the previous
 * backend's (or empty), so boot-time consumers must not treat it as final.
 */
export const getWorkspaceTabsHydrated = (state: BackendTabStateProjectionState) => {
  return state.tabState.hydratedBackendId === getActiveBackendId(state);
};

export const getWorkspaceTabOrder = (state: TabStateProjectionState) => {
  return state.tabState.workspaceStacks.flatMap((stack) => stack);
};

export const getActiveWorkspaceIds = (state: TabStateProjectionState): string[] => {
  return Object.keys(state.tabState.openTabs).filter(
    (workspaceId) => state.tabState.openTabs[workspaceId] === true,
  );
};

export const getLastClosedWorkspaceTab = (
  state: TabStateProjectionState,
): { workspaceId: string; closedAt: number } | null => {
  const { recentlyClosedTabIds, recentlyClosedTabAt, openTabs } = state.tabState;
  for (let index = recentlyClosedTabIds.length - 1; index >= 0; index--) {
    const workspaceId = recentlyClosedTabIds[index];
    if (!openTabs[workspaceId]) {
      return { workspaceId, closedAt: recentlyClosedTabAt[workspaceId] ?? 0 };
    }
  }
  return null;
};

export const getPersistedWorkspaceTabsState = (state: TabStateProjectionState) => {
  return serializeWorkspaceTabsState(state.tabState);
};

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
export const getWorkspaceTabsToReconcile = (state: WorkspaceTabReconciliationState): string[] => {
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
};
