/**
 * File Content Prune Service
 *
 * Automatically removes file-content entries from the files slice when their
 * corresponding file tabs are closed. Replicates the deleted
 * `cleanupClosedFileContentEntries` / `watchOpenFileTabContentCleanup` saga
 * behavior as a middleware.
 *
 * Key semantics (from deleted saga):
 *   - Reacts when the stale-path computation CHANGES (not on every action).
 *   - Computes stale paths = file-content entry paths for the active workspace
 *     that are not open in any panel file tab.
 *   - Dispatches removeFileContentEntry(activeWsId, path) for each stale path.
 *   - Guards: empty payload no-op, invalid/missing active workspace id no-op.
 *   - CRITICAL: removeFileContentEntry itself mutates files state — ensure the
 *     prune pass does NOT re-trigger itself in a loop.
 *
 * Dependency-light per src/store/renderer AGENTS.md: no module-scope selector
 * imports; reads state via api.getState(); inlines the stale-path computation.
 */

import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import type { StoreState } from "../types";
import {
  removeFileContentEntry,
  loadFileContentRequested,
  loadFileContentSucceeded,
  loadFileContentFailed,
  updateFileContent,
  applyExternalFileContent,
  saveFileContentRequested,
  saveFileContentSucceeded,
  saveFileContentFailed,
} from "../slices/files/files-slice";
import { setActiveWorkspaceId } from "../slices/workspace/workspace-slice";
import {
  initializeLayout,
  openTab,
  openTabInAdjacentOrSplit,
  closeTab,
  closeActiveTab,
  closeTabsByType,
  closeTabsByAgentId,
  reopenClosedTab,
  setActiveTab,
  selectNextTab,
  selectPreviousTab,
  reorderTabs,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  closeOtherTabs,
  closeTabsToRight,
  closeAllTabs,
  closeAllOthersEverywhere,
  focusPanel,
  splitPanel,
  closePanel,
  updateSizes,
  updateSplitSizes,
  toggleExpandPanel,
  resetLayout,
  goBack,
  goForward,
  goBackInFocusHistory,
  goForwardInFocusHistory,
  setDeferSpecTab,
  reconcileStaleAgentTabs,
  updateTabTitle,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateFileTabPath,
  consumePendingFocus,
  clearPanelLayout,
} from "../slices/panel-layout/panel-layout-slice";
import { workspaceMounted, workspaceUnmounted } from "../slices/workspace-lifecycle/workspace-lifecycle-slice";

// ============================================================================
// Helpers
// ============================================================================

function isValidActiveWorkspaceId(wsId: string | null): wsId is string {
  return !!wsId && wsId !== "new" && !wsId.startsWith("optimistic-") && wsId !== "undefined";
}

/**
 * Compute stale paths for the active workspace: file-content entry paths not
 * open in any panel file tab. Mirrors selectFileContentPrunePayload logic.
 */
function computeStalePaths(state: StoreState): string[] {
  const activeWsId = state.workspace.activeWorkspaceId;
  if (!isValidActiveWorkspaceId(activeWsId)) {
    return [];
  }

  const ws = state.panelLayout.byWorkspaceId[activeWsId];
  const filesWorkspace = state.files.byWorkspaceId[activeWsId];
  if (!ws || !filesWorkspace) {
    return [];
  }

  const openPaths = new Set<string>();
  for (const panel of Object.values(ws.panels)) {
    for (const tab of panel.tabs) {
      if (tab.type === "file" && typeof tab.filePath === "string" && tab.filePath.length > 0) {
        openPaths.add(tab.filePath);
      }
    }
  }

  const stalePaths: string[] = [];
  for (const path of filesWorkspace.files.ids) {
    if (!openPaths.has(path)) {
      stalePaths.push(path);
    }
  }

  if (stalePaths.length === 0) {
    return [];
  }

  stalePaths.sort((left, right) => left.localeCompare(right));
  return stalePaths;
}

function areStalePathsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Actions that can change the set of open file tabs or the active workspace
const PRUNE_TRIGGER_ACTIONS = new Set<string>([
  setActiveWorkspaceId.type,
  workspaceMounted.type,
  workspaceUnmounted.type,
  initializeLayout.type,
  openTab.type,
  openTabInAdjacentOrSplit.type,
  closeTab.type,
  closeActiveTab.type,
  closeTabsByType.type,
  closeTabsByAgentId.type,
  reopenClosedTab.type,
  setActiveTab.type,
  selectNextTab.type,
  selectPreviousTab.type,
  reorderTabs.type,
  moveTabToPanel.type,
  moveTabToSplit.type,
  moveTabToSplitLevel.type,
  closeOtherTabs.type,
  closeTabsToRight.type,
  closeAllTabs.type,
  closeAllOthersEverywhere.type,
  focusPanel.type,
  splitPanel.type,
  closePanel.type,
  updateSizes.type,
  updateSplitSizes.type,
  toggleExpandPanel.type,
  resetLayout.type,
  goBack.type,
  goForward.type,
  goBackInFocusHistory.type,
  goForwardInFocusHistory.type,
  setDeferSpecTab.type,
  reconcileStaleAgentTabs.type,
  updateTabTitle.type,
  updateTabBrowserUrl.type,
  updateTabFavicon.type,
  updateFileTabPath.type,
  consumePendingFocus.type,
  clearPanelLayout.type,
  // File actions that can add/modify file-content entries (via upsertFileEntry)
  // All eight actions that call upsertFileEntry (which can create entries):
  loadFileContentRequested.type,
  loadFileContentSucceeded.type,
  loadFileContentFailed.type,
  updateFileContent.type,
  applyExternalFileContent.type,
  saveFileContentRequested.type,
  saveFileContentSucceeded.type,
  saveFileContentFailed.type,
]);

// ============================================================================
// Middleware
// ============================================================================

export function createFileContentPruneService(): StoreMiddleware {
  let previousStalePaths: string[] = [];

  return (api) => {
    // Initial state check (retroactive prune on middleware creation)
    const initialState = api.getState();
    const initialStalePaths = computeStalePaths(initialState);
    previousStalePaths = initialStalePaths;

    if (initialStalePaths.length > 0) {
      const activeWsId = initialState.workspace.activeWorkspaceId;
      if (activeWsId && isValidActiveWorkspaceId(activeWsId)) {
        for (const path of initialStalePaths) {
          api.dispatch(removeFileContentEntry(activeWsId, path));
        }
      }
    }

    return (next) => (action) => {
      // Let the action go through first
      const result = next(action);

      // CRITICAL: Skip prune check when the action IS removeFileContentEntry to prevent loops
      if (action.type === removeFileContentEntry.type) {
        return result;
      }

      // Only check on actions that can change the open-tab or active-workspace state
      if (!PRUNE_TRIGGER_ACTIONS.has(action.type)) {
        return result;
      }

      const state = api.getState();
      const stalePaths = computeStalePaths(state);

      // Only dispatch if the stale paths CHANGED (selector-channel semantics)
      if (!areStalePathsEqual(stalePaths, previousStalePaths)) {
        previousStalePaths = stalePaths;

        if (stalePaths.length === 0) {
          return result;
        }

        const activeWsId = state.workspace.activeWorkspaceId;
        if (!activeWsId || !isValidActiveWorkspaceId(activeWsId)) {
          return result;
        }

        for (const path of stalePaths) {
          api.dispatch(removeFileContentEntry(activeWsId, path));
        }
      }

      return result;
    };
  };
}
