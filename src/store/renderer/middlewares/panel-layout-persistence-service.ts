/**
 * Panel Layout Persistence Service
 *
 * Restores the workspace panel tabs + split layout persistence that the
 * removed `panel-layout-saga` performed. Follows the established middleware
 * pattern (like `tab-state-persistence-service`) without re-adding a saga:
 *   - On creation: hydrates panel layout from localStorage + retroactively
 *     restores the active workspace's layout if it hasn't been restored yet.
 *   - After any layout-mutating action: writes {root, panels, focusedPanelId}
 *     to localStorage.
 *   - On HISTORY_ACTIONS (debounced): persists layout history to disk via IPC.
 *   - On `workspaceMounted`: validates and restores saved layout once per session.
 *   - On `clearPanelLayout`: removes localStorage entry.
 *   - On `workspaceUnmounted`: clears adapter entry and restore flag.
 *
 * Storage keys and payload shape match the reference saga so persisted state
 * remains cross-compatible.
 *
 * Dependency-light per src/store AGENTS.md: imports only safe-storage, IPC
 * client, slice actions/types — no selectors, reads state via api.getState().
 */

import type { StoreMiddleware } from "$lib/store-shim/types";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import type { StoreState } from "../types";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../slices/workspace-lifecycle/workspace-lifecycle-slice";
import {
  initializeLayout,
  loadLayoutHistory,
  clearPanelLayout,
  setRestoreStatus,
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
} from "../slices/panel-layout/panel-layout-slice";
import {
  PANEL_LAYOUT_STORAGE_KEY_PREFIX,
  HISTORY_PERSIST_DEBOUNCE_MS,
  type WorkspacePanelLayout,
  type PanelLayoutNode,
} from "../slices/panel-layout/panel-layout-types";
import {
  savePanelLayoutHistory,
  loadPanelLayoutHistory,
  type PanelLayoutHistoryData,
} from "$features/layout/panel-layout-history.client";
import { connectionsListReceived } from "../slices/connections/connections-slice";
import { getActiveBackendId, namespaceBackendKey } from "./backend-storage-namespace";

// ============================================================================
// Helpers
// ============================================================================

function getStorageKey(wsId: string, backendId: string): string {
  return namespaceBackendKey(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${wsId}`, backendId);
}

const restoredWorkspaceIds = new Set<string>();

function isValidMountedWorkspaceId(wsId: string): boolean {
  return !!wsId && wsId !== "new" && !wsId.startsWith("optimistic-") && wsId !== "undefined";
}

function collectPanelIdsFromTree(node: PanelLayoutNode, panelIds: Set<string>): boolean {
  if (node.type === "panel") {
    if (typeof node.panelId !== "string" || node.panelId.length === 0) {
      return false;
    }
    panelIds.add(node.panelId);
    return true;
  }

  if (!Array.isArray(node.children) || !Array.isArray(node.sizes) || node.children.length !== node.sizes.length) {
    return false;
  }

  return node.children.every((child) => collectPanelIdsFromTree(child, panelIds));
}

function isStoredLayoutValid(layout: WorkspacePanelLayout | null | undefined): layout is WorkspacePanelLayout {
  try {
    if (!layout || typeof layout !== "object" || !layout.root || !layout.panels || typeof layout.panels !== "object") {
      return false;
    }

    const panelIdsInTree = new Set<string>();
    if (!collectPanelIdsFromTree(layout.root, panelIdsInTree) || panelIdsInTree.size === 0) {
      return false;
    }

    for (const panelId of panelIdsInTree) {
      if (!layout.panels[panelId]) {
        return false;
      }
    }

    if (layout.focusedPanelId !== null && !panelIdsInTree.has(layout.focusedPanelId)) {
      return false;
    }

    for (const [panelId, panel] of Object.entries(layout.panels)) {
      if (!panel || panel.id !== panelId || !Array.isArray(panel.tabs)) {
        return false;
      }

      if (!panel.tabs.every((tab) => tab && typeof tab === "object" && typeof tab.id === "string")) {
        return false;
      }

      if (panel.activeTabId !== null && !panel.tabs.some((tab) => tab.id === panel.activeTabId)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

// Actions that require localStorage persistence
const PERSIST_ACTIONS = new Set<string>([
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
]);

// Actions that also affect layout history (need disk persistence)
const HISTORY_ACTIONS = new Set<string>([
  openTab.type,
  openTabInAdjacentOrSplit.type,
  closeTab.type,
  closeActiveTab.type,
  closeOtherTabs.type,
  closeTabsToRight.type,
  closeAllTabs.type,
  closeAllOthersEverywhere.type,
  splitPanel.type,
  closePanel.type,
  moveTabToPanel.type,
  moveTabToSplit.type,
  moveTabToSplitLevel.type,
  setActiveTab.type,
  goBack.type,
  goForward.type,
  resetLayout.type,
]);

/** Extract wsId from any panel layout action */
function getWsId(action: { payload?: any }): string | undefined {
  const p = action.payload;
  if (!p) return undefined;
  if (typeof p === "string") return p;
  if (Array.isArray(p)) return p[0];
  if (typeof p === "object" && "wsId" in p) return p.wsId;
  return undefined;
}

function loadStoredLayout(wsId: string, backendId: string): WorkspacePanelLayout | "invalid" | null {
  const stored = safeLocalStorage.getJSON<WorkspacePanelLayout>(getStorageKey(wsId, backendId));
  if (!stored) return null;
  return isStoredLayoutValid(stored) ? stored : "invalid";
}

function hasAnyTab(panels: WorkspacePanelLayout["panels"]): boolean {
  return Object.values(panels).some((panel) => panel.tabs.length > 0);
}

function persistToLocalStorage(state: StoreState, wsId: string): void {
  const ws = state.panelLayout.byWorkspaceId[wsId];
  if (!ws) return;
  const backendId = getActiveBackendId(state);
  // Pre-restore clobber guard: any persist action dispatched for a workspace
  // before its once-per-session restore runs lazily creates an empty (tab-less)
  // workspace state in the reducer. Persisting that would overwrite a good
  // stored layout with a valid-but-empty one, losing the user's tabs (e.g. the
  // initial agent tab of a freshly created workspace). Skip the write when the
  // workspace hasn't been restored this session, the state has no tabs, and a
  // valid non-empty layout is already stored.
  if (!restoredWorkspaceIds.has(wsId) && !hasAnyTab(ws.panels)) {
    const stored = loadStoredLayout(wsId, backendId);
    if (stored !== null && stored !== "invalid" && hasAnyTab(stored.panels)) return;
  }
  const layout: WorkspacePanelLayout = {
    root: ws.root,
    panels: ws.panels,
    focusedPanelId: ws.focusedPanelId,
  };
  safeLocalStorage.setJSON(getStorageKey(wsId, backendId), layout);
}

// ============================================================================
// History Debouncing
// ============================================================================

const pendingHistorySaves = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleHistorySave(getState: () => StoreState, wsId: string): void {
  const existing = pendingHistorySaves.get(wsId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingHistorySaves.delete(wsId);
    // Read state at timer execution time to avoid stale data
    const state = getState();
    const ws = state.panelLayout.byWorkspaceId[wsId];
    if (!ws) return;

    const data: PanelLayoutHistoryData = {
      version: 1,
      workspaceId: wsId,
      history: ws.layoutHistory,
      historyIndex: ws.historyIndex,
      lastUpdated: new Date().toISOString(),
    };

    // Namespace the on-disk history by active backend (read at save time) so two
    // backends sharing a workspace id keep separate undo/redo snapshots (T17).
    savePanelLayoutHistory(wsId, data, getActiveBackendId(state)).catch(() => {
      // Non-critical — history can be rebuilt
    });
  }, HISTORY_PERSIST_DEBOUNCE_MS);

  pendingHistorySaves.set(wsId, timer);
}

/** Restore (or mark empty/invalid) a workspace's saved layout for one backend. */
function restoreLayoutForWorkspace(
  dispatch: (action: unknown) => void,
  wsId: string,
  backendId: string,
): void {
  dispatch(setRestoreStatus(wsId, "pending"));

  const storedLayout = loadStoredLayout(wsId, backendId);
  if (storedLayout === null) {
    dispatch(setRestoreStatus(wsId, "empty"));
  } else if (storedLayout === "invalid") {
    dispatch(setRestoreStatus(wsId, "invalid"));
  } else {
    dispatch(initializeLayout(wsId, storedLayout));
    dispatch(setRestoreStatus(wsId, "restored"));
  }
}

// ============================================================================
// Middleware Factory
// ============================================================================

export function createPanelLayoutPersistenceMiddleware(): StoreMiddleware {
  return (api) => {
    // Track the active backend so a switch (which flips activeId via a
    // connections:list refresh after the window reloads) re-restores the
    // incoming backend's layout from its own namespace.
    let lastBackendId = getActiveBackendId(api.getState() as StoreState);

    // Retroactive mount check: if a workspace is already active, restore it
    const state = api.getState() as StoreState;
    const activeWsId = state.workspace.activeWorkspaceId;
    if (activeWsId && isValidMountedWorkspaceId(activeWsId) && !restoredWorkspaceIds.has(activeWsId)) {
      restoredWorkspaceIds.add(activeWsId);
      restoreLayoutForWorkspace(api.dispatch, activeWsId, lastBackendId);
    }

    return (next) => (action) => {
      const result = next(action);
      if (!action || !action.type) return result;

      // Backend switched: re-restore the active workspace's layout from the
      // incoming backend's namespace. The switch reloads the window, so this
      // fires once the boot connections:list refresh flips activeId to the
      // remote backend.
      if (action.type === connectionsListReceived.type) {
        const nextBackendId = getActiveBackendId(api.getState() as StoreState);
        if (nextBackendId !== lastBackendId) {
          lastBackendId = nextBackendId;
          const currentState = api.getState() as StoreState;
          const currentWsId = currentState.workspace.activeWorkspaceId;
          restoredWorkspaceIds.clear();
          if (currentWsId && isValidMountedWorkspaceId(currentWsId)) {
            restoredWorkspaceIds.add(currentWsId);
            restoreLayoutForWorkspace(api.dispatch, currentWsId, nextBackendId);
          }
        }
      }

      // Handle workspace mounted: restore layout
      if (action.type === workspaceMounted.type) {
        const [wsId] = action.payload as [string];
        if (!isValidMountedWorkspaceId(wsId)) return result;
        if (restoredWorkspaceIds.has(wsId)) return result;

        restoredWorkspaceIds.add(wsId);
        restoreLayoutForWorkspace(
          api.dispatch,
          wsId,
          getActiveBackendId(api.getState() as StoreState),
        );
      }

      // Handle workspace unmounted: cleanup
      if (action.type === workspaceUnmounted.type) {
        const [wsId] = action.payload as [string];
        restoredWorkspaceIds.delete(wsId);
        // Cancel any pending history save for this workspace
        const pendingTimer = pendingHistorySaves.get(wsId);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingHistorySaves.delete(wsId);
        }
        // Clear adapter entry
        import("$features/layout/panel-layout-adapter").then(({ clearPanelLayoutAdapter }) => {
          clearPanelLayoutAdapter(wsId);
        }).catch(() => {
          // Non-critical - module may not be available in all environments
        });
      }

      // Handle clearPanelLayout: remove localStorage entry
      if (action.type === clearPanelLayout.type) {
        const wsId = getWsId(action);
        if (wsId) {
          safeLocalStorage.removeItem(
            getStorageKey(wsId, getActiveBackendId(api.getState() as StoreState)),
          );
        }
      }

      // Handle initializeLayout: load history from disk
      if (action.type === initializeLayout.type) {
        const wsId = getWsId(action);
        if (wsId && isValidMountedWorkspaceId(wsId)) {
          const backendId = getActiveBackendId(api.getState() as StoreState);
          loadPanelLayoutHistory(wsId, backendId).then((data) => {
            if (data && data.history && Array.isArray(data.history) && typeof data.historyIndex === 'number') {
              // Check workspace still exists before dispatching (async load may finish after unmount)
              const currentState = api.getState() as StoreState;
              if (currentState.panelLayout.byWorkspaceId[wsId]) {
                api.dispatch(loadLayoutHistory(wsId, data.history, data.historyIndex));
              }
            }
          }).catch(() => {
            // Non-critical
          });
        }
      }

      // Persist layout to localStorage on mutating actions
      if (PERSIST_ACTIONS.has(action.type)) {
        const wsId = getWsId(action);
        if (wsId && isValidMountedWorkspaceId(wsId)) {
          const state = api.getState() as StoreState;
          persistToLocalStorage(state, wsId);
        }
      }

      // Schedule history save on history-affecting actions
      if (HISTORY_ACTIONS.has(action.type)) {
        const wsId = getWsId(action);
        if (wsId && isValidMountedWorkspaceId(wsId)) {
          scheduleHistorySave(() => api.getState() as StoreState, wsId);
        }
      }

      return result;
    };
  };
}
