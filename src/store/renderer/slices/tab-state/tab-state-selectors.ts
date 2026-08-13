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

export const selectIsWorkspaceTabOpen = store.createSelector((state, workspaceId: string) => {
  return state.tabState.openTabs[workspaceId] === true;
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
