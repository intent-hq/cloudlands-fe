import {
  call,
  cancelled,
  delay,
  join,
  put,
  takeEvery,
  takeLatest,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';

import { clearPanelLayoutAdapter } from '$features/layout/panel-layout-adapter';
import {
  loadPanelLayoutHistory,
  savePanelLayoutHistory,
  type PanelLayoutHistoryData,
} from '$features/layout/panel-layout-history.client';
import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import {
  getLocalStorageJSON,
  removeLocalStorageItem,
  setLocalStorageJSON,
} from '../../../utils/safe-local-storage-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';
import { selectPanelLayoutWorkspace } from '../panel-layout-selectors';
import {
  clearPanelLayout,
  closeActiveTab,
  closeAllOthersEverywhere,
  closeAllTabs,
  closeOtherTabs,
  closePanel,
  closeTab,
  closeTabsByAgentId,
  closeTabsByType,
  closeTabsToRight,
  consumePendingFocus,
  emptyWorkspaceState,
  focusPanel,
  goBack,
  goBackInFocusHistory,
  goForward,
  goForwardInFocusHistory,
  initializeLayout,
  loadLayoutHistory,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  openTab,
  openTabInAdjacentOrSplit,
  reconcileStaleAgentTabs,
  reorderTabs,
  reopenClosedTab,
  resetLayout,
  selectNextTab,
  selectPreviousTab,
  setActiveTab,
  setDeferSpecTab,
  setRestoreStatus,
  splitPanel,
  toggleExpandPanel,
  updateFileTabPath,
  updateSizes,
  updateSplitSizes,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateTabTitle,
} from '../panel-layout-slice';
import {
  HISTORY_PERSIST_DEBOUNCE_MS,
  PANEL_LAYOUT_STORAGE_KEY_PREFIX,
  type PanelLayoutNode,
  type WorkspacePanelLayout,
} from '../panel-layout-types';

const PERSIST_ACTIONS = [
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
];

const HISTORY_ACTIONS = [
  openTab,
  openTabInAdjacentOrSplit,
  closeTab,
  closeActiveTab,
  closeOtherTabs,
  closeTabsToRight,
  closeAllTabs,
  closeAllOthersEverywhere,
  splitPanel,
  closePanel,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  setActiveTab,
  goBack,
  goForward,
  resetLayout,
];

const restoredWorkspaceIds = new Set<string>();
let pendingHistoryWorkspaceId: string | null = null;

// Layout keys hold backend-specific workspace IDs, so two backends surfacing
// the same workspace id would clobber each other without a per-backend
// namespace (local keeps the legacy un-prefixed key).
function storageKey(wsId: string, backendId: string): string {
  return namespaceBackendKey(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${wsId}`, backendId);
}

function isValidWorkspaceId(wsId: string | null | undefined): wsId is string {
  return Boolean(wsId && wsId !== 'new' && wsId !== 'undefined' && !wsId.startsWith('optimistic-'));
}

function getWsId(action: { payload?: unknown }): string | undefined {
  const payload = action.payload;
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload) && typeof payload[0] === 'string') return payload[0];
  if (
    payload &&
    typeof payload === 'object' &&
    'wsId' in payload &&
    typeof payload.wsId === 'string'
  ) {
    return payload.wsId;
  }
  return undefined;
}

function collectPanelIds(node: PanelLayoutNode, panelIds: Set<string>): boolean {
  if (node.type === 'panel') {
    if (typeof node.panelId !== 'string' || node.panelId.length === 0) return false;
    panelIds.add(node.panelId);
    return true;
  }
  if (
    !Array.isArray(node.children) ||
    !Array.isArray(node.sizes) ||
    node.children.length !== node.sizes.length
  ) {
    return false;
  }
  return node.children.every((child) => collectPanelIds(child, panelIds));
}

export function isStoredLayoutValid(value: unknown): value is WorkspacePanelLayout {
  try {
    if (!value || typeof value !== 'object') return false;
    const layout = value as WorkspacePanelLayout;
    if (!layout.root || !layout.panels || typeof layout.panels !== 'object') return false;
    const panelIds = new Set<string>();
    if (!collectPanelIds(layout.root, panelIds) || panelIds.size === 0) return false;
    for (const panelId of panelIds) {
      if (!layout.panels[panelId]) return false;
    }
    if (layout.focusedPanelId !== null && !panelIds.has(layout.focusedPanelId)) return false;
    for (const [panelId, panel] of Object.entries(layout.panels)) {
      if (!panel || panel.id !== panelId || !Array.isArray(panel.tabs)) return false;
      if (
        !panel.tabs.every((tab) => tab && typeof tab === 'object' && typeof tab.id === 'string')
      ) {
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

function hasAnyTab(layout: WorkspacePanelLayout): boolean {
  return Object.values(layout.panels).some((panel) => panel.tabs.length > 0);
}

export function* loadLayoutFromStorage(
  wsId: string,
): SagaGenerator<WorkspacePanelLayout | 'invalid' | null> {
  const backendId = yield* selectActiveBackendId();
  const stored = yield* call(getLocalStorageJSON<unknown>, storageKey(wsId, backendId));
  if (!stored) return null;
  return isStoredLayoutValid(stored) ? stored : 'invalid';
}

export function* handleWorkspaceMountedRestore(
  action: ReturnType<typeof workspaceMounted>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  if (!isValidWorkspaceId(wsId) || restoredWorkspaceIds.has(wsId)) return;
  restoredWorkspaceIds.add(wsId);
  yield* put(setRestoreStatus(wsId, 'pending'));
  const stored = yield* call(loadLayoutFromStorage, wsId);
  if (stored === null) {
    yield* put(setRestoreStatus(wsId, 'empty'));
  } else if (stored === 'invalid') {
    yield* put(setRestoreStatus(wsId, 'invalid'));
  } else {
    yield* put(initializeLayout(wsId, stored));
    yield* put(setRestoreStatus(wsId, 'restored'));
  }
}

export function* persistPanelLayout(action: { payload?: unknown }): SagaGenerator<void> {
  try {
    const wsId = getWsId(action);
    if (!isValidWorkspaceId(wsId)) return;
    const workspace = yield* selectPanelLayoutWorkspace.effect(wsId);
    if (workspace === emptyWorkspaceState) return;
    const layout: WorkspacePanelLayout = {
      root: workspace.root,
      panels: workspace.panels,
      focusedPanelId: workspace.focusedPanelId,
    };
    if (!restoredWorkspaceIds.has(wsId) && !hasAnyTab(layout)) {
      const stored = yield* call(loadLayoutFromStorage, wsId);
      if (stored !== null && stored !== 'invalid' && hasAnyTab(stored)) return;
    }
    yield* call(setLocalStorageJSON, storageKey(wsId, yield* selectActiveBackendId()), layout);
  } catch {
    // Local layout persistence is best-effort.
  }
}

export function* persistHistoryToDisk(wsId: string): SagaGenerator<void> {
  try {
    const workspace = yield* selectPanelLayoutWorkspace.effect(wsId);
    if (workspace === emptyWorkspaceState) return;
    const data: PanelLayoutHistoryData = {
      version: 1,
      workspaceId: wsId,
      history: workspace.layoutHistory,
      historyIndex: workspace.historyIndex,
      lastUpdated: new Date().toISOString(),
    };
    // Namespace the on-disk history by active backend (read at save time) so
    // two backends sharing a workspace id keep separate undo/redo snapshots.
    yield* call(savePanelLayoutHistory, wsId, data, yield* selectActiveBackendId());
  } catch {
    // History is non-critical and can be rebuilt.
  }
}

function* saveHistoryAfterDelay(action: { payload?: unknown }): SagaGenerator<void> {
  const wsId = getWsId(action);
  if (!isValidWorkspaceId(wsId)) {
    pendingHistoryWorkspaceId = null;
    return;
  }
  pendingHistoryWorkspaceId = wsId;
  yield* delay(HISTORY_PERSIST_DEBOUNCE_MS);
  if (pendingHistoryWorkspaceId !== wsId) return;
  yield* call(persistHistoryToDisk, wsId);
  if (pendingHistoryWorkspaceId === wsId) pendingHistoryWorkspaceId = null;
}

function* loadHistoryForWorkspace(
  action: ReturnType<typeof initializeLayout>,
): SagaGenerator<void> {
  const wsId = action.payload.wsId;
  if (!isValidWorkspaceId(wsId)) return;
  try {
    const data = yield* call(loadPanelLayoutHistory, wsId, yield* selectActiveBackendId());
    if (data && Array.isArray(data.history) && typeof data.historyIndex === 'number') {
      const workspace = yield* selectPanelLayoutWorkspace.effect(wsId);
      if (workspace !== emptyWorkspaceState) {
        yield* put(loadLayoutHistory(wsId, data.history, data.historyIndex));
      }
    }
  } catch {
    // History is non-critical and can be rebuilt.
  }
}

function* handleWorkspaceUnmounted(
  action: ReturnType<typeof workspaceUnmounted>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  restoredWorkspaceIds.delete(wsId);
  if (pendingHistoryWorkspaceId === wsId) pendingHistoryWorkspaceId = null;
  try {
    yield* call(clearPanelLayoutAdapter, wsId);
  } catch {
    // Adapter cleanup is non-critical in environments without the adapter.
  }
}

function* clearPersistedLayout(action: ReturnType<typeof clearPanelLayout>): SagaGenerator<void> {
  const [wsId] = action.payload;
  if (!wsId) return;
  yield* call(removeLocalStorageItem, storageKey(wsId, yield* selectActiveBackendId()));
}

function* retroactiveRestore(): SagaGenerator<void> {
  const activeWsId = yield* selectActiveWorkspaceId.effect();
  if (isValidWorkspaceId(activeWsId)) {
    yield* call(handleWorkspaceMountedRestore, workspaceMounted(activeWsId));
  }
}

/**
 * Re-restore the active workspace after a backend switch. Unlike a fresh mount,
 * the store still holds the outgoing backend's tabs and history, so a backend
 * with nothing saved must be reset rather than left showing (and later
 * persisting) the previous backend's layout.
 */
function* restoreAfterBackendSwitch(): SagaGenerator<void> {
  const wsId = yield* selectActiveWorkspaceId.effect();
  if (!isValidWorkspaceId(wsId)) return;
  restoredWorkspaceIds.add(wsId);
  yield* put(setRestoreStatus(wsId, 'pending'));
  const stored = yield* call(loadLayoutFromStorage, wsId);
  if (stored === null || stored === 'invalid') {
    yield* put(resetLayout(wsId));
    yield* put(loadLayoutHistory(wsId, [], 0));
    yield* put(setRestoreStatus(wsId, stored === null ? 'empty' : 'invalid'));
  } else {
    yield* put(initializeLayout(wsId, stored));
    yield* put(setRestoreStatus(wsId, 'restored'));
  }
}

/**
 * Backend switched (activeId flips via the boot connections:list refresh after
 * the window reloads): re-restore the active workspace's layout from the
 * incoming backend's namespace.
 */
function* handleBackendSwitch(lastBackend: { id: string }): SagaGenerator<void> {
  const backendId = yield* selectActiveBackendId();
  if (backendId === lastBackend.id) return;
  lastBackend.id = backendId;
  restoredWorkspaceIds.clear();
  yield* call(restoreAfterBackendSwitch);
}

/** Unregistered until the S20 middleware cutover. */
export function* panelLayoutSaga(): SagaGenerator<void> {
  try {
    yield* takeEvery(PERSIST_ACTIONS, persistPanelLayout);
    yield* takeEvery(clearPanelLayout, clearPersistedLayout);
    const historyWatcher = yield* takeLatest(HISTORY_ACTIONS, saveHistoryAfterDelay);
    yield* takeLatest(initializeLayout, loadHistoryForWorkspace);
    yield* takeLeading(connectionsListReceived, handleBackendSwitch, {
      id: yield* selectActiveBackendId(),
    });
    yield* takeEvery(workspaceMounted, handleWorkspaceMountedRestore);
    yield* takeEvery(workspaceUnmounted, handleWorkspaceUnmounted);
    yield* call(retroactiveRestore);
    yield* join(historyWatcher);
  } finally {
    const flushHistory = yield* cancelled();
    const pendingWorkspaceId = pendingHistoryWorkspaceId;
    pendingHistoryWorkspaceId = null;
    if (flushHistory && pendingWorkspaceId) {
      yield* call(persistHistoryToDisk, pendingWorkspaceId);
    }
    restoredWorkspaceIds.clear();
  }
}
