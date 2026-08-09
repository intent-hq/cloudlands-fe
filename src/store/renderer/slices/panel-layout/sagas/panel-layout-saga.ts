import type { Task } from 'redux-saga';
import {
  call,
  cancel,
  cancelled,
  delay,
  fork,
  put,
  take,
  takeEvery,
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
const pendingHistoryTasks = new Map<string, Task>();
const pendingHistoryGenerations = new Map<string, number>();
const pendingHistoryWorkspaceIds = new Set<string>();
const historyLoadTasks = new Map<string, Task>();
const historyLoadGenerations = new Map<string, number>();

// Layout keys hold backend-specific workspace IDs, so two backends surfacing
// the same workspace id would clobber each other without a per-backend
// namespace (local keeps the legacy un-prefixed key).
function storageKey(wsId: string, backendId: string): string {
  return namespaceBackendKey(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${wsId}`, backendId);
}

function isValidWorkspaceId(wsId: string | null | undefined): wsId is string {
  return Boolean(
    wsId && wsId !== 'new' && wsId !== 'undefined' && !wsId.startsWith('optimistic-'),
  );
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
      if (!panel.tabs.every((tab) => tab && typeof tab === 'object' && typeof tab.id === 'string')) {
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

function* saveHistoryAfterDelay(wsId: string, generation: number): SagaGenerator<void> {
  yield* delay(HISTORY_PERSIST_DEBOUNCE_MS);
  yield* call(persistHistoryToDisk, wsId);
  if (pendingHistoryGenerations.get(wsId) === generation) {
    pendingHistoryTasks.delete(wsId);
    pendingHistoryGenerations.delete(wsId);
    pendingHistoryWorkspaceIds.delete(wsId);
  }
}

function* scheduleHistorySave(action: { payload?: unknown }): SagaGenerator<void> {
  const wsId = getWsId(action);
  if (!isValidWorkspaceId(wsId)) return;
  const existing = pendingHistoryTasks.get(wsId);
  if (existing) yield* cancel(existing);
  const generation = (pendingHistoryGenerations.get(wsId) ?? 0) + 1;
  pendingHistoryGenerations.set(wsId, generation);
  pendingHistoryWorkspaceIds.add(wsId);
  const task = yield* fork(saveHistoryAfterDelay, wsId, generation);
  pendingHistoryTasks.set(wsId, task);
}

function* watchHistoryPersistence(): SagaGenerator<void> {
  yield* takeEvery(HISTORY_ACTIONS, scheduleHistorySave);
}

function* loadHistoryForWorkspace(wsId: string, generation: number): SagaGenerator<void> {
  try {
    const data = yield* call(loadPanelLayoutHistory, wsId, yield* selectActiveBackendId());
    if (
      historyLoadGenerations.get(wsId) === generation &&
      data &&
      Array.isArray(data.history) &&
      typeof data.historyIndex === 'number'
    ) {
      const workspace = yield* selectPanelLayoutWorkspace.effect(wsId);
      if (workspace !== emptyWorkspaceState) {
        yield* put(loadLayoutHistory(wsId, data.history, data.historyIndex));
      }
    }
  } catch {
    // History is non-critical and can be rebuilt.
  }
  if (historyLoadGenerations.get(wsId) === generation) {
    historyLoadTasks.delete(wsId);
    historyLoadGenerations.delete(wsId);
  }
}

function* watchHistoryLoads(): SagaGenerator<void> {
  while (true) {
    const action = yield* take(initializeLayout);
    const wsId = action.payload.wsId;
    if (!isValidWorkspaceId(wsId)) continue;
    const existing = historyLoadTasks.get(wsId);
    if (existing) yield* cancel(existing);
    const generation = (historyLoadGenerations.get(wsId) ?? 0) + 1;
    historyLoadGenerations.set(wsId, generation);
    const task = yield* fork(loadHistoryForWorkspace, wsId, generation);
    historyLoadTasks.set(wsId, task);
  }
}

function* handleWorkspaceUnmounted(action: ReturnType<typeof workspaceUnmounted>): SagaGenerator<void> {
  const [wsId] = action.payload;
  restoredWorkspaceIds.delete(wsId);
  const historyTask = pendingHistoryTasks.get(wsId);
  if (historyTask) yield* cancel(historyTask);
  pendingHistoryTasks.delete(wsId);
  pendingHistoryGenerations.delete(wsId);
  pendingHistoryWorkspaceIds.delete(wsId);
  const loadTask = historyLoadTasks.get(wsId);
  if (loadTask) yield* cancel(loadTask);
  historyLoadTasks.delete(wsId);
  historyLoadGenerations.delete(wsId);
  try {
    yield* call(clearPanelLayoutAdapter, wsId);
  } catch {
    // Adapter cleanup is non-critical in environments without the adapter.
  }
}

function* watchWorkspaceLifecycle(): SagaGenerator<void> {
  while (true) {
    const action = yield* take([workspaceMounted, workspaceUnmounted]);
    if (action.type === workspaceMounted.type) {
      yield* fork(handleWorkspaceMountedRestore, action as ReturnType<typeof workspaceMounted>);
    } else {
      yield* call(handleWorkspaceUnmounted, action as ReturnType<typeof workspaceUnmounted>);
    }
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
function* watchBackendSwitch(): SagaGenerator<void> {
  let lastBackendId = yield* selectActiveBackendId();
  while (true) {
    yield* take(connectionsListReceived);
    const backendId = yield* selectActiveBackendId();
    if (backendId === lastBackendId) continue;
    lastBackendId = backendId;
    restoredWorkspaceIds.clear();
    yield* call(restoreAfterBackendSwitch);
  }
}

function* cancelTasks(tasks: Iterable<Task>): SagaGenerator<void> {
  for (const task of tasks) yield* cancel(task);
}

/** Unregistered until the S20 middleware cutover. */
export function* panelLayoutSaga(): SagaGenerator<void> {
  try {
    yield* takeEvery(PERSIST_ACTIONS, persistPanelLayout);
    yield* takeEvery(clearPanelLayout, clearPersistedLayout);
    yield* fork(watchHistoryPersistence);
    yield* fork(watchHistoryLoads);
    yield* fork(watchBackendSwitch);
    yield* call(retroactiveRestore);
    yield* call(watchWorkspaceLifecycle);
  } finally {
    const flushHistory = yield* cancelled();
    const pendingWorkspaceIds = [...pendingHistoryWorkspaceIds];
    yield* call(cancelTasks, pendingHistoryTasks.values());
    yield* call(cancelTasks, historyLoadTasks.values());
    if (flushHistory) {
      for (const wsId of pendingWorkspaceIds) {
        yield* call(persistHistoryToDisk, wsId);
      }
    }
    restoredWorkspaceIds.clear();
    pendingHistoryTasks.clear();
    pendingHistoryGenerations.clear();
    pendingHistoryWorkspaceIds.clear();
    historyLoadTasks.clear();
    historyLoadGenerations.clear();
  }
}