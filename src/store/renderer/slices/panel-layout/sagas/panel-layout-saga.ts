import {
  call,
  cancelled,
  delay,
  fork,
  join,
  put,
  takeEvery,
  takeLatest,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';
import { buffers, channel, type Channel } from 'redux-saga';

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
import { normalizeTablessPanelLayout, removeForeignWorkspaceTabs } from '../panel-layout-tabless';
import { migratePanelCanvasWidth } from '../panel-layout-width-provenance';
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
  movePanel,
  movePanelToRootEdge,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  openTab,
  openTabInAdjacentOrSplit,
  panelLayoutScopeMounted,
  panelLayoutScopeUnmounted,
  reconcileStaleAgentTabs,
  reorderTabs,
  reopenClosedTab,
  resetLayout,
  resizePanelLayoutAtHorizontalPanel,
  resizePanelLayoutRightEdge,
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
  type WorkspacePanelLayoutState,
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
  resizePanelLayoutRightEdge,
  resizePanelLayoutAtHorizontalPanel,
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
  movePanel,
  movePanelToRootEdge,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  setActiveTab,
  goBack,
  goForward,
  resetLayout,
];

const restoredWorkspaceIds = new Set<string>();

type HistorySaveMessage = {
  action: { type: string; payload?: unknown };
  generation: number;
  kind: 'save';
};

type HistoryMailboxMessage = HistorySaveMessage | { kind: 'cancel' };

type HistoryMailbox = {
  backendId: string;
  channel: Channel<HistoryMailboxMessage>;
  generation: number;
  key: string;
  pending: boolean;
  workspaceId: string;
};

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
    if (
      layout.canvasWidth !== undefined &&
      layout.canvasWidth !== null &&
      (!Number.isFinite(layout.canvasWidth) || layout.canvasWidth <= 0)
    ) {
      return false;
    }
    if (
      layout.canvasWidthSource !== undefined &&
      layout.canvasWidthSource !== null &&
      layout.canvasWidthSource !== 'explicit'
    ) {
      return false;
    }
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


function getPersistableRoot(workspace: WorkspacePanelLayoutState): PanelLayoutNode {
  if (workspace.expandedPanelId === null || workspace.savedSizesBeforeExpand.length === 0) {
    return workspace.root;
  }
  const root = JSON.parse(JSON.stringify(workspace.root)) as PanelLayoutNode;
  for (const entry of workspace.savedSizesBeforeExpand) {
    let node = root;
    for (const index of entry.nodePath) {
      if (node.type !== 'split' || !node.children[index]) return workspace.root;
      node = node.children[index];
    }
    if (node.type !== 'split') return workspace.root;
    node.sizes = [...entry.sizes];
  }
  return root;
}

function normalizeLayoutForWorkspace(
  workspaceId: string,
  layout: WorkspacePanelLayout,
): WorkspacePanelLayout {
  const normalized = normalizeTablessPanelLayout(removeForeignWorkspaceTabs(layout, workspaceId));
  return {
    ...normalized,
    ...migratePanelCanvasWidth(layout.canvasWidth, layout.canvasWidthSource),
  };
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
  action: ReturnType<typeof workspaceMounted> | ReturnType<typeof panelLayoutScopeMounted>,
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
    yield* put(initializeLayout(wsId, normalizeLayoutForWorkspace(wsId, stored)));
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
      root: getPersistableRoot(workspace),
      panels: workspace.panels,
      focusedPanelId: workspace.focusedPanelId,
      canvasWidth:
        workspace.expandedPanelId !== null && workspace.savedCanvasWidthBeforeExpand !== undefined
          ? workspace.savedCanvasWidthBeforeExpand
          : workspace.canvasWidth,
      canvasWidthSource:
        workspace.expandedPanelId !== null &&
        workspace.savedCanvasWidthSourceBeforeExpand !== undefined
          ? workspace.savedCanvasWidthSourceBeforeExpand
          : workspace.canvasWidthSource,
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

export function* persistHistoryToDisk(wsId: string, backendId?: string): SagaGenerator<void> {
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
    const targetBackendId = backendId ?? (yield* selectActiveBackendId());
    yield* call(savePanelLayoutHistory, wsId, data, targetBackendId);
  } catch {
    // History is non-critical and can be rebuilt.
  }
}

function* saveHistoryAfterDelay(
  mailbox: HistoryMailbox,
  message: HistoryMailboxMessage,
): SagaGenerator<void> {
  if (message.kind === 'cancel') return;
  try {
    if (
      message.action.type === movePanel.type ||
      message.action.type === movePanelToRootEdge.type
    ) {
      yield* call(persistPanelLayout, message.action);
    }
    yield* delay(HISTORY_PERSIST_DEBOUNCE_MS);
    if (mailbox.backendId !== (yield* selectActiveBackendId())) return;
    yield* call(persistHistoryToDisk, mailbox.workspaceId, mailbox.backendId);
  } finally {
    if (!(yield* cancelled()) && mailbox.generation === message.generation) {
      mailbox.pending = false;
    }
  }
}

function* watchHistoryMailbox(mailbox: HistoryMailbox): SagaGenerator<void> {
  yield* takeLatest(mailbox.channel, saveHistoryAfterDelay, mailbox);
}

function* queueHistorySave(
  mailboxes: Map<string, HistoryMailbox>,
  action: { type: string; payload?: unknown },
): SagaGenerator<void> {
  const wsId = getWsId(action);
  if (!isValidWorkspaceId(wsId)) return;
  const backendId = yield* selectActiveBackendId();
  const key = storageKey(wsId, backendId);
  let mailbox = mailboxes.get(key);
  if (!mailbox) {
    mailbox = {
      backendId,
      channel: channel<HistoryMailboxMessage>(buffers.expanding()),
      generation: 0,
      key,
      pending: false,
      workspaceId: wsId,
    };
    mailboxes.set(key, mailbox);
    yield* fork(watchHistoryMailbox, mailbox);
  }
  mailbox.generation += 1;
  mailbox.pending = true;
  yield* put(mailbox.channel, {
    action,
    generation: mailbox.generation,
    kind: 'save',
  });
}

function* cancelHistoryForWorkspace(
  mailboxes: Map<string, HistoryMailbox>,
  workspaceId: string,
): SagaGenerator<void> {
  for (const [key, mailbox] of mailboxes) {
    if (mailbox.workspaceId !== workspaceId) continue;
    mailboxes.delete(key);
    yield* put(mailbox.channel, { kind: 'cancel' });
    mailbox.channel.close();
  }
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
        const history = data.history.map((snapshot) => ({
          ...normalizeLayoutForWorkspace(wsId, snapshot),
          timestamp: snapshot.timestamp,
        }));
        yield* put(loadLayoutHistory(wsId, history, data.historyIndex));
      }
    }
  } catch {
    // History is non-critical and can be rebuilt.
  }
}

function* handleWorkspaceUnmounted(
  historyMailboxes: Map<string, HistoryMailbox>,
  action: ReturnType<typeof workspaceUnmounted> | ReturnType<typeof panelLayoutScopeUnmounted>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  restoredWorkspaceIds.delete(wsId);
  yield* call(cancelHistoryForWorkspace, historyMailboxes, wsId);
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
    yield* put(initializeLayout(wsId, normalizeLayoutForWorkspace(wsId, stored)));
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
  const historyMailboxes = new Map<string, HistoryMailbox>();
  function* queueHistorySaveForAction(action: {
    type: string;
    payload?: unknown;
  }): SagaGenerator<void> {
    yield* queueHistorySave(historyMailboxes, action);
  }
  function* handleWorkspaceUnmountedAction(
    action: ReturnType<typeof workspaceUnmounted> | ReturnType<typeof panelLayoutScopeUnmounted>,
  ): SagaGenerator<void> {
    yield* handleWorkspaceUnmounted(historyMailboxes, action);
  }
  try {
    yield* takeEvery(PERSIST_ACTIONS, persistPanelLayout);
    yield* takeEvery(clearPanelLayout, clearPersistedLayout);
    const historyWatcher = yield* takeEvery(HISTORY_ACTIONS, queueHistorySaveForAction);
    yield* takeLatest(initializeLayout, loadHistoryForWorkspace);
    yield* takeLeading(connectionsListReceived, handleBackendSwitch, {
      id: yield* selectActiveBackendId(),
    });
    yield* takeEvery([workspaceMounted, panelLayoutScopeMounted], handleWorkspaceMountedRestore);
    yield* takeEvery(
      [workspaceUnmounted, panelLayoutScopeUnmounted],
      handleWorkspaceUnmountedAction,
    );
    yield* call(retroactiveRestore);
    yield* join(historyWatcher);
  } finally {
    const flushHistory = yield* cancelled();
    const mailboxes = [...historyMailboxes.values()];
    historyMailboxes.clear();
    for (const mailbox of mailboxes) mailbox.channel.close();
    if (flushHistory) {
      const activeBackendId = yield* selectActiveBackendId();
      for (const mailbox of mailboxes) {
        if (mailbox.pending && mailbox.backendId === activeBackendId) {
          yield* call(persistHistoryToDisk, mailbox.workspaceId, mailbox.backendId);
        }
      }
    }
    restoredWorkspaceIds.clear();
  }
}
