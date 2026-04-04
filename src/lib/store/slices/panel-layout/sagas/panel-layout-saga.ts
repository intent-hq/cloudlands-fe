/**
 * Panel Layout Saga
 *
 * Handles persistence of panel layout state:
 * - localStorage persistence on every layout change
 * - Disk history persistence (debounced via IPC)
 * - Load history from disk on initialize
 * - Cleanup on clearPanelLayout
 */

import { call, debounce, fork, put, takeEvery, type SagaGenerator } from "typed-redux-saga";
import { clearPanelLayoutAdapter } from "$features/layout/panel-layout-adapter";
import { workspaceUnmounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  setLocalStorageJSON,
  getLocalStorageJSON,
  removeLocalStorageItem,
} from "../../../utils/safe-local-storage-saga";
import {
  panelLayoutHistoryClient,
  type PanelLayoutHistoryData,
} from "$features/layout/panel-layout-history.client";
import { selectPanelLayoutWorkspace } from "../panel-layout-selectors";
import {
  initializeLayout,
  loadLayoutHistory,
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
  clearPanelLayout,
  updateTabTitle,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateFileTabPath,
  consumePendingFocus,
} from "../panel-layout-slice";
import { PANEL_LAYOUT_STORAGE_KEY_PREFIX, HISTORY_PERSIST_DEBOUNCE_MS } from "../panel-layout-types";
import type { WorkspacePanelLayout } from "../panel-layout-types";

// ============================================================================
// Helpers
// ============================================================================

function getStorageKey(wsId: string): string {
  return `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${wsId}`;
}

// Actions that require localStorage persistence
const PERSIST_ACTIONS = [
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
];

// Actions that also affect layout history (need disk persistence)
const HISTORY_ACTIONS = [
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
];

// ============================================================================
// Persistence Sagas
// ============================================================================

/** Extract wsId from any panel layout action */
function getWsId(action: { payload: any }): string | undefined {
  const p = action.payload;
  if (Array.isArray(p)) return p[0];
  if (p && typeof p === "object" && "wsId" in p) return p.wsId;
  return undefined;
}

/** Persist layout to localStorage */
function* persistToLocalStorage(action: { payload: any }): SagaGenerator<void> {
  const wsId = getWsId(action);
  if (!wsId) return;

  const ws = yield* selectPanelLayoutWorkspace.effect(wsId);
  const layout: WorkspacePanelLayout = {
    root: ws.root,
    panels: ws.panels,
    focusedPanelId: ws.focusedPanelId,
    pendingFocusTabId: ws.pendingFocusTabId,
  };
  yield* call(setLocalStorageJSON, getStorageKey(wsId), layout);
}

/** Persist history to disk (called after debounce) */
function* persistHistoryToDisk(action: { payload: any }): SagaGenerator<void> {
  const wsId = getWsId(action);
  if (!wsId) return;

  const ws = yield* selectPanelLayoutWorkspace.effect(wsId);
  const data: PanelLayoutHistoryData = {
    version: 1,
    workspaceId: wsId,
    history: ws.layoutHistory,
    historyIndex: ws.historyIndex,
    lastUpdated: new Date().toISOString(),
  };

  try {
    yield* call([panelLayoutHistoryClient, panelLayoutHistoryClient.save], wsId as any, data);
  } catch {
    // Ignore disk errors - history is non-critical
  }
}

/** Load saved layout from localStorage */
export function* loadLayoutFromStorage(wsId: string): SagaGenerator<WorkspacePanelLayout | null> {
  const stored = yield* getLocalStorageJSON<WorkspacePanelLayout>(getStorageKey(wsId));
  if (stored && stored.root && stored.panels) {
    return stored;
  }
  return null;
}

/** Handle clearPanelLayout: remove localStorage entry */
function* handleClearLayout(action: ReturnType<typeof clearPanelLayout>): SagaGenerator<void> {
  const [wsId] = action.payload;
  yield* call(removeLocalStorageItem, getStorageKey(wsId));
}

// ============================================================================
// Watchers
// ============================================================================

const persistActionsSet = new Set(PERSIST_ACTIONS);
const historyActionsSet = new Set(HISTORY_ACTIONS);

function isPersistAction(action: { type: string }): boolean {
  return persistActionsSet.has(action.type);
}

function isHistoryAction(action: { type: string }): boolean {
  return historyActionsSet.has(action.type);
}

function* watchLocalStoragePersistence() {
  yield* takeEvery(isPersistAction as any, persistToLocalStorage);
}

function* watchHistoryPersistence() {
  yield* debounce(HISTORY_PERSIST_DEBOUNCE_MS, isHistoryAction as any, persistHistoryToDisk);
}

function* watchClearLayout() {
  yield* takeEvery(clearPanelLayout.type, handleClearLayout);
}

/** Clean up PanelLayoutAdapter Map entry when a workspace is unmounted */
export function* handleWorkspaceUnmounted(action: ReturnType<typeof workspaceUnmounted>): SagaGenerator<void> {
  const [wsId] = action.payload;
  clearPanelLayoutAdapter(wsId);
}

function* watchWorkspaceUnmounted() {
  yield* takeEvery(workspaceUnmounted, handleWorkspaceUnmounted);
}

/** Load history from disk when a layout is initialized */
function* watchInitializeLayout() {
  yield* takeEvery(initializeLayout.type, function* (action: ReturnType<typeof initializeLayout>) {
    const wsId = action.payload.wsId;
    try {
      const data: PanelLayoutHistoryData | null = yield* call(
        [panelLayoutHistoryClient, panelLayoutHistoryClient.load],
        wsId as any,
      );
      if (data && data.history && Array.isArray(data.history)) {
        yield* put(loadLayoutHistory(wsId, data.history, data.historyIndex));
      }
    } catch {
      // Non-critical — history can be rebuilt
    }
  });
}

// ============================================================================
// Root Saga
// ============================================================================

export function* panelLayoutSaga() {
  yield* fork(watchLocalStoragePersistence);
  yield* fork(watchHistoryPersistence);
  yield* fork(watchClearLayout);
  yield* fork(watchInitializeLayout);
  yield* fork(watchWorkspaceUnmounted);
}

