import {
  call,
  cancelled,
  delay,
  fork,
  join,
  put,
  spawn,
  takeEvery,
  takeLatest,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';
import { buffers, channel, type Channel } from 'redux-saga';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { deepEqual } from 'fast-equals';

import { clearPanelLayoutAdapter } from '$features/layout/panel-layout-adapter';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession } from '$shared/types';
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
import { removeScript } from '../../scripts/scripts-slice';
import {
  workspaceDeleted,
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  resolveCanonicalInitialAgent,
  resolveEmptyLayoutAgent,
  selectAllWorkspaceAgents,
} from '../../workspace-agents/workspace-agents-selectors';
import { setAgents, setInitialAgentId } from '../../workspace-agents/workspace-agents-slice';
import {
  selectWorkspaceById,
  selectWorkspaceListLoadedForBackend,
} from '../../workspace/workspace-selectors';
import { setWorkspaceEntity, setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import { selectSpec } from '../../workspace-notes/workspace-notes-selectors';
import {
  applyNoteCreated,
  applyNoteUpdated,
  loadWorkspaceNotesSucceeded,
} from '../../workspace-notes/workspace-notes-slice';
import { resolveBrowserLinkUrl } from '$lib/utils/browser-url-resolution';
import {
  collectRehydratableBrowserTabs,
  type RehydratableBrowserTab,
} from '../browser-tab-rehydration';
import { selectPanelLayoutWorkspace } from '../panel-layout-selectors';
import { migratePanelLayoutForWorkspace } from '../panel-layout-migration';
import {
  clearPanelLayout,
  bootstrapNewWorkspaceLayout,
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
  destroyOwnedTabsForWorkspace,
  destroyTabsByOwnerAgent,
  emptyWorkspaceState,
  focusPanel,
  goBack,
  goBackInFocusHistory,
  goForward,
  goForwardInFocusHistory,
  initializeLayout,
  loadLayoutHistory,
  markPanelTouched,
  movePanel,
  movePanelToRootEdge,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  openHiddenTab,
  openTab,
  openBlankWorkingPanel,
  openTabInAdjacentOrSplit,
  openTabInNewRootColumn,
  openTabInRightmostColumn,
  openTabInRightmostColumnRequested,
  observeDeferredSpecGeneration,
  panelLayoutScopeMounted,
  panelLayoutScopeUnmounted,
  preparePanelLayoutBackendRestore,
  reconcileStaleAgentTabs,
  reconcilePanelColumnCount,
  setPanelColumnCount,
  reorderTabs,
  reopenClosedPanelColumn,
  reopenClosedTab,
  resetLayout,
  restoreHiddenTab,
  resolveNewWorkspaceInitialAgent,
  seedContextLinkEmptyLayout,
  revealDeferredSpecTab,
  revealHiddenTabAvoidingPanel,
  resizePanelLayoutAtRootDivider,
  resizePanelLayoutRightEdge,
  selectNextTab,
  selectPreviousTab,
  setActiveTab,
  setDeferSpecTab,
  setRestoreStatus,
  setTabOwnerAgent,
  splitPanel,
  toggleExpandPanel,
  updateFileTabPath,
  updateSizes,
  updateSplitSizes,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateTabTitle,
  updateTabViewport,
} from '../panel-layout-slice';
import {
  HISTORY_PERSIST_DEBOUNCE_MS,
  PANEL_LAYOUT_STORAGE_KEY_PREFIX,
  PANEL_LAYOUT_PERSISTENCE_VERSION,
  type PanelLayoutNode,
  type WorkspacePanelLayout,
  type WorkspacePanelLayoutState,
} from '../panel-layout-types';
import { countHorizontalPanelColumns } from '../panel-layout-tabless';
import { selectPanelColumnCount } from '../panel-layout-selectors';
import { dropRevealIfWorkspaceNotDisplayed } from './reveal-suppression';

const PERSIST_ACTIONS = [
  initializeLayout,
  openTab,
  openTabInAdjacentOrSplit,
  openTabInNewRootColumn,
  openTabInRightmostColumn,
  closeTab,
  closeActiveTab,
  closeTabsByType,
  closeTabsByAgentId,
  destroyTabsByOwnerAgent,
  destroyOwnedTabsForWorkspace,
  restoreHiddenTab,
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
  markPanelTouched,
  splitPanel,
  closePanel,
  updateSizes,
  updateSplitSizes,
  resizePanelLayoutRightEdge,
  resizePanelLayoutAtRootDivider,
  toggleExpandPanel,
  resetLayout,
  goBack,
  goForward,
  goBackInFocusHistory,
  goForwardInFocusHistory,
  setDeferSpecTab,
  observeDeferredSpecGeneration,
  revealDeferredSpecTab,
  resolveNewWorkspaceInitialAgent,
  reconcileStaleAgentTabs,
  seedContextLinkEmptyLayout,
  updateTabTitle,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateTabViewport,
  updateFileTabPath,
  consumePendingFocus,
  reconcilePanelColumnCount,
  setPanelColumnCount,
];

const HISTORY_ACTIONS = [
  openTab,
  openTabInAdjacentOrSplit,
  openTabInRightmostColumn,
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
// Workspaces whose layout has been restored under the current backend
// namespace this session. Unlike restoredWorkspaceIds (mount-lifecycle dedup,
// cleared on unmount so a remount re-restores), this set survives unmounts: a
// parked column's post-restore state stays authoritative, so background
// mutations to it must keep persisting. Cleared only when the namespace's
// provenance is void — backend switch, clearPanelLayout, saga teardown.
const restoredUnderBackendIds = new Set<string>();
// Workspaces with a mounted panel-layout scope. Backend switches re-restore
// every mounted workspace (not just the active one): with the columns UI
// several workspaces mount at boot, and their initial restore may have read
// the wrong backend namespace when it ran before the boot connections:list.
// (retroactiveRestore and hydrateWorkspaceLayout also add workspaces here
// without a real mount event; harmless — a later real unmount removes it, and
// membership keeps backend switches re-restoring their layouts too.)
const mountedWorkspaceIds = new Set<string>();
// Restores currently in flight, so on-demand hydration callers can await a
// restore another trigger already started instead of answering with
// pre-restore state (monorepo#2789).
const inflightRestores: Map<string, Promise<void>> = new Map();

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

function* routeTabToRightmostColumn(
  action: ReturnType<typeof openTabInRightmostColumnRequested>,
): SagaGenerator<void> {
  const { wsId, tab, force, allowDuplicate, newTabId, timestamp, agentDriven } = action.payload;
  yield* put(
    reconcilePanelColumnCount(wsId, yield* selectPanelColumnCount.effect(wsId), timestamp),
  );
  yield* put(
    openTabInRightmostColumn(
      wsId,
      tab,
      { force, allowDuplicate, newTabId, preserveFocus: agentDriven === true },
      timestamp,
    ),
  );
  // An agent-driven open activates the tab without moving focus; the queued
  // reveal only scrolls the panel into view and must not fire later if the
  // workspace is not the one this window displays (monorepo#3045).
  if (agentDriven === true) {
    yield* dropRevealIfWorkspaceNotDisplayed(wsId, newTabId);
  }
}

export function* watchRightmostColumnRequests(): SagaGenerator<void> {
  yield* takeEvery(openTabInRightmostColumnRequested, routeTabToRightmostColumn);
}

function collectPanelIds(node: PanelLayoutNode, panelIds: Set<string>): boolean {
  if (node.type === 'panel') {
    if (typeof node.panelId !== 'string' || node.panelId.length === 0) return false;
    panelIds.add(node.panelId);
    return true;
  }
  if (
    !Array.isArray(node.children) ||
    node.children.length === 0 ||
    (node.direction !== 'horizontal' && node.direction !== 'vertical')
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
      layout.canvasWidthSource !== 'explicit' &&
      layout.canvasWidthSource !== 'intrinsic'
    ) {
      return false;
    }
    if (layout.deferSpecTab !== undefined && typeof layout.deferSpecTab !== 'boolean') return false;
    if (layout.hiddenTabs !== undefined) {
      if (
        !Array.isArray(layout.hiddenTabs) ||
        !layout.hiddenTabs.every(
          (tab) => tab && typeof tab === 'object' && typeof tab.id === 'string',
        )
      ) {
        return false;
      }
    }
    if (layout.newWorkspaceLifecycle !== undefined && layout.newWorkspaceLifecycle !== null) {
      const lifecycle = layout.newWorkspaceLifecycle;
      if (
        (lifecycle.coordinator !== undefined && typeof lifecycle.coordinator !== 'boolean') ||
        typeof lifecycle.initialAgentPending !== 'boolean' ||
        (lifecycle.initialAgentId !== null && typeof lifecycle.initialAgentId !== 'string') ||
        lifecycle.spec?.noteId !== 'spec' ||
        !['deferred', 'revealed'].includes(lifecycle.spec.state) ||
        (lifecycle.spec.generation !== null && typeof lifecycle.spec.generation !== 'string')
      ) {
        return false;
      }
    }
    const panelIds = new Set<string>();
    if (!collectPanelIds(layout.root, panelIds) || panelIds.size === 0) return false;
    if (Object.keys(layout.panels).length === 0) return false;
    if (layout.focusedPanelId !== null && typeof layout.focusedPanelId !== 'string') return false;
    for (const [panelId, panel] of Object.entries(layout.panels)) {
      if (!panel || panel.id !== panelId || !Array.isArray(panel.tabs)) return false;
      if (panel.pristine !== undefined && typeof panel.pristine !== 'boolean') return false;
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

function hasAnyTab(layout: WorkspacePanelLayout | WorkspacePanelLayoutState): boolean {
  const hidden = layout.hiddenTabs;
  const hiddenCount = Array.isArray(hidden) ? hidden.length : (hidden?.ids.length ?? 0);
  return Object.values(layout.panels).some((panel) => panel.tabs.length > 0) || hiddenCount > 0;
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
  return migratePanelLayoutForWorkspace(workspaceId, layout);
}

function* reconcileEmptyRestoredLayout(wsId: string, agents?: AgentSession[]): SagaGenerator<void> {
  if (!restoredWorkspaceIds.has(wsId)) return;
  const layout = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (layout.newWorkspaceLifecycle || hasAnyTab(layout)) return;
  const availableAgents = agents ?? (yield* selectAllWorkspaceAgents.effect(wsId));
  const firstOpen = layout.restoreStatus === 'empty';
  const agent = resolveEmptyLayoutAgent(availableAgents, wsId, firstOpen);
  if (!agent) return;
  // First open on this device of a workspace created elsewhere (iOS,
  // chief-of-staff proposal, sibling workspace): nothing was ever stored
  // ('empty', not 'invalid' or a restored-but-tabless layout the user
  // emptied), so a workspace carrying context links gets the same
  // agent-left / browser-right seed as a local create. Seeding and the
  // agent-tab open happen together so a pre-agent-snapshot run leaves the
  // layout untouched and the setAgents retrigger seeds the whole shape.
  let focusedPanelId = layout.focusedPanelId;
  if (firstOpen) {
    const workspace = yield* selectWorkspaceById.effect(wsId);
    if (!workspace) {
      // The workspace record may simply not have landed yet (the mount can
      // race the workspace-list load). Opening the plain agent tab now would
      // persist a linkless layout and permanently lose the seed, so defer
      // until either the entity arrives (setWorkspaceEntity) or the list
      // load for this backend completes (setWorkspaceHasLoaded) — both
      // retrigger this reconcile. A missing record AFTER the load is a
      // workspace that genuinely has no entry (e.g. the chief virtual
      // workspace) and proceeds with no links.
      const backendId = yield* selectActiveBackendId();
      const listLoaded = yield* selectWorkspaceListLoadedForBackend.effect(backendId);
      if (!listLoaded) return;
    }
    const contextLinks = workspace?.contextLinks ?? [];
    if (contextLinks.length > 0) {
      yield* put(seedContextLinkEmptyLayout(wsId, contextLinks));
      const seeded = yield* selectPanelLayoutWorkspace.effect(wsId);
      focusedPanelId = seeded.focusedPanelId;
    }
  }
  yield* put(
    openTabInAdjacentOrSplit(
      wsId,
      {
        type: 'agent',
        title: agent.name,
        agentId: String(agent.id),
        workspaceId: wsId,
        closable: true,
      },
      focusedPanelId ?? undefined,
      { force: true },
    ),
  );
}

/**
 * Re-resolve restored browser tabs that carry a persisted pre-rewrite
 * requested URL (intent-hq/monorepo#2789). The persisted final URL may embed
 * a previous session's ephemeral tunnel forward port, which is dead after a
 * restart — re-running the rewrite (rewrite → probe → tunnel via
 * `browser:resolve-url`) points the tab at a live endpoint for this session.
 * Tabs without a requested URL (legacy layouts, never-rewritten URLs) are
 * untouched. Failures are truthful: when the rewrite cannot be established
 * (daemon not connected, web build) the tab falls back to its requested URL
 * and the browser's normal navigation error path shows, instead of silently
 * keeping the dead port. The requested URL is re-recorded either way so a
 * later restart can retry.
 *
 * Runs detached (spawned) from the restore, so a resolution can land seconds
 * later — after the user navigated the tab, or after a backend switch
 * replaced the layout. Each retarget therefore re-checks that the tab still
 * sits on the exact stored/requested pair the probe started from and is
 * dropped as stale otherwise.
 */
function* rehydrateTunneledBrowserTabs(
  wsId: string,
  tabs: RehydratableBrowserTab[],
): SagaGenerator<void> {
  for (const tab of tabs) {
    try {
      const resolved = yield* call(
        resolveBrowserLinkUrl,
        tab.requestedUrl,
        typeof window !== 'undefined' ? window.electronAPI?.invoke : undefined,
      );
      if (resolved.url === tab.storedUrl) continue;
      const workspace = yield* selectPanelLayoutWorkspace.effect(wsId);
      const current = Object.values(workspace.panels)
        .flatMap((panel) => panel.tabs)
        .find((candidate) => candidate.id === tab.tabId);
      if (
        !current ||
        current.browserUrl !== tab.storedUrl ||
        current.browserRequestedUrl !== tab.requestedUrl
      ) {
        continue;
      }
      yield* put(updateTabBrowserUrl(wsId, tab.tabId, resolved.url, tab.requestedUrl));
    } catch {
      // Best-effort: a failed resolution leaves the tab on its stored URL.
    }
  }
}

function* loadLayoutFromStorage(
  wsId: string,
): SagaGenerator<WorkspacePanelLayout | 'invalid' | null> {
  const backendId = yield* selectActiveBackendId();
  const stored = yield* call(getLocalStorageJSON<unknown>, storageKey(wsId, backendId));
  if (!stored) return null;
  return isStoredLayoutValid(stored) ? stored : 'invalid';
}

function* reconcileRestoredPanelColumns(wsId: string): SagaGenerator<boolean> {
  const workspace = yield* selectPanelLayoutWorkspace.effect(wsId);
  const restoredColumnCount = countHorizontalPanelColumns(workspace.root);
  if (restoredColumnCount >= workspace.columnCount) return false;
  yield* put(reconcilePanelColumnCount(wsId, workspace.columnCount, undefined, false));
  return true;
}

function* handleWorkspaceMountedRestore(
  action: ReturnType<typeof workspaceMounted> | ReturnType<typeof panelLayoutScopeMounted>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  if (!isValidWorkspaceId(wsId)) return;
  mountedWorkspaceIds.add(wsId);
  if (restoredWorkspaceIds.has(wsId)) return;
  const current = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (current.newWorkspaceLifecycle && current.restoreStatus === 'restored') {
    // A fresh workspace can reduce its bootstrap before this saga starts or
    // reattaches. That in-memory lifecycle is authoritative: restoring a
    // missing storage entry here would replace it with a visually empty layout.
    restoredWorkspaceIds.add(wsId);
    restoredUnderBackendIds.add(wsId);
    yield* call(resolvePendingInitialAgent, wsId);
    yield* call(persistPanelLayout, action);
    yield* call(reconcileDeferredSpec, wsId);
    return;
  }
  restoredWorkspaceIds.add(wsId);
  let settleInflight!: () => void;
  inflightRestores.set(
    wsId,
    new Promise<void>((resolve) => {
      settleInflight = resolve;
    }),
  );
  let completed = false;
  let repairedColumns = false;
  let repairedLayout = false;
  try {
    restoredUnderBackendIds.delete(wsId);
    yield* put(setRestoreStatus(wsId, 'pending'));
    const stored = yield* call(loadLayoutFromStorage, wsId);
    if (stored === null) {
      yield* put(resetLayout(wsId));
      yield* put(setRestoreStatus(wsId, 'empty'));
    } else if (stored === 'invalid') {
      yield* put(resetLayout(wsId));
      yield* put(setRestoreStatus(wsId, 'invalid'));
    } else {
      const normalized = normalizeLayoutForWorkspace(wsId, stored);
      repairedLayout = !deepEqual(normalized, stored);
      if (current.columnCountInitialized) {
        yield* put(preparePanelLayoutBackendRestore(wsId));
      }
      yield* put(initializeLayout(wsId, normalized));
      repairedColumns = yield* call(reconcileRestoredPanelColumns, wsId);
      yield* put(setRestoreStatus(wsId, 'restored'));
      // Detached (spawn, not fork): re-resolving tunneled tabs goes over IPC
      // (rewrite → reachability probe → tunnel fallback, 1.5s+ per dead
      // port) and must not delay the restore settling. An attached fork
      // would: `call(handleWorkspaceMountedRestore)` from
      // `hydrateWorkspaceLayout` only returns once attached forks finish,
      // leaving browser IPC callers blocked in waitForWorkspaceLayoutRestore
      // past main's 500ms listTabs timeout (monorepo#2789).
      yield* spawn(rehydrateTunneledBrowserTabs, wsId, collectRehydratableBrowserTabs(normalized));
    }
    restoredUnderBackendIds.add(wsId);
    yield* call(reconcileEmptyRestoredLayout, wsId);
    if (repairedLayout || repairedColumns) {
      yield* call(persistPanelLayout, { payload: { wsId } });
    }
    completed = true;
  } finally {
    // A failed or cancelled restore releases the dedup guard so a later
    // trigger can retry instead of trusting a restore that never finished.
    // The inflight promise resolves (never rejects) even then: waiters must
    // re-read the restore state afterwards — a workspace left on
    // restoreStatus 'pending' with no inflight restore was never restored,
    // and hydration callers retry it instead of answering from it.
    if (!completed) restoredWorkspaceIds.delete(wsId);
    inflightRestores.delete(wsId);
    settleInflight();
  }
}

/**
 * Wait for a restore of this workspace's layout that another trigger (mount,
 * hydration, backend switch) already has in flight. No-op when none is
 * running. Callers that read the layout right after a
 * `setRestoreStatus('pending')` entry appeared use this to answer with
 * post-restore state (monorepo#2789). Resolves even when the restore failed
 * or was cancelled — callers judge success by re-reading the restore status,
 * not by this returning.
 */
export function* waitForWorkspaceLayoutRestore(wsId: string): SagaGenerator<void> {
  const inflight = inflightRestores.get(wsId);
  if (inflight) yield* call(() => inflight);
}

/**
 * Restore a workspace's persisted layout on demand, without a UI mount — for
 * a workspace sitting in this window's tab bar that has not been visited this
 * session (monorepo#2789). Idempotent: an already-restored workspace is left
 * untouched, and a restore another trigger has in flight is awaited instead
 * of duplicated. Reuses the mount-restore path, so the workspace also joins
 * mountedWorkspaceIds and backend switches re-restore its layout.
 */
export function* hydrateWorkspaceLayout(wsId: string): SagaGenerator<void> {
  if (!isValidWorkspaceId(wsId)) return;
  // Wait out any restore already in flight (mount, another hydration, or a
  // backend switch that pre-registered this workspace) before judging state:
  // starting a second restore concurrently would duplicate work against the
  // same namespace. After the wait, membership in restoredWorkspaceIds tells
  // whether that restore delivered — a failed one released it, so retry.
  yield* call(waitForWorkspaceLayoutRestore, wsId);
  if (restoredWorkspaceIds.has(wsId)) return;
  yield* call(handleWorkspaceMountedRestore, panelLayoutScopeMounted(wsId));
}

function* persistPanelLayout(action: { payload?: unknown }): SagaGenerator<void> {
  try {
    const wsId = getWsId(action);
    if (!isValidWorkspaceId(wsId)) return;
    const workspace = yield* selectPanelLayoutWorkspace.effect(wsId);
    if (workspace === emptyWorkspaceState) return;
    const layout: WorkspacePanelLayout = {
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      root: getPersistableRoot(workspace),
      panels: workspace.panels,
      focusedPanelId: workspace.focusedPanelId,
      columnCount: workspace.columnCount,
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
    const hiddenTabs = getItems(workspace.hiddenTabs);
    if (hiddenTabs.length > 0) layout.hiddenTabs = hiddenTabs;
    if (workspace.deferSpecTab) layout.deferSpecTab = true;
    if (workspace.newWorkspaceLifecycle) {
      layout.newWorkspaceLifecycle = workspace.newWorkspaceLifecycle;
    }
    // Until this workspace's restore has run under the current backend
    // namespace, a persist would clobber the saved layout with pre-restore
    // in-memory state — and the pending restore will replace that in-memory
    // state anyway. When the store still holds tabs (e.g. state hydrated
    // under a different backend namespace at boot), an early write here
    // permanently loses the saved tabs, so skip the write whenever the
    // stored layout still has any tab to lose. Provenance is tracked in
    // restoredUnderBackendIds (survives unmounts) rather than
    // restoredWorkspaceIds, so a parked column's post-restore mutations
    // (e.g. closeTabsByAgentId, updateTabTitle) still persist.
    if (!restoredUnderBackendIds.has(wsId)) {
      const stored = yield* call(loadLayoutFromStorage, wsId);
      if (stored !== null && stored !== 'invalid' && hasAnyTab(stored)) return;
    }
    yield* call(setLocalStorageJSON, storageKey(wsId, yield* selectActiveBackendId()), layout);
  } catch {
    // Local layout persistence is best-effort.
  }
}

function* persistHistoryToDisk(wsId: string, backendId?: string): SagaGenerator<void> {
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
  mountedWorkspaceIds.delete(wsId);
  yield* call(cancelHistoryForWorkspace, historyMailboxes, wsId);
  try {
    yield* call(clearPanelLayoutAdapter, wsId);
  } catch {
    // Adapter cleanup is non-critical in environments without the adapter.
  }
}

function* clearPersistedLayout(
  action: ReturnType<typeof clearPanelLayout> | ReturnType<typeof workspaceDeleted>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  if (!wsId) return;
  restoredUnderBackendIds.delete(wsId);
  yield* call(removeLocalStorageItem, storageKey(wsId, yield* selectActiveBackendId()));
}

function specGeneration(note: { id: unknown; createdAt: Date | string }): string {
  const createdAt = note.createdAt instanceof Date ? note.createdAt.toISOString() : note.createdAt;
  return `${String(note.id)}:${createdAt}`;
}

function* reconcileDeferredSpec(workspaceId: string): SagaGenerator<void> {
  const layout = yield* selectPanelLayoutWorkspace.effect(workspaceId);
  if (
    !layout.newWorkspaceLifecycle?.coordinator ||
    layout.newWorkspaceLifecycle.spec.state !== 'deferred'
  )
    return;
  const spec = yield* selectSpec.effect(workspaceId);
  if (!spec) return;
  const generation = specGeneration(spec);
  if (spec.content.trim().length > 0) {
    yield* put(revealDeferredSpecTab(workspaceId, generation, m.layout_shared_spec_title()));
  } else if (layout.newWorkspaceLifecycle.spec.generation !== generation) {
    yield* put(observeDeferredSpecGeneration(workspaceId, generation));
  }
}

function noteActionWorkspaceIds(action: { type: string; payload?: unknown }): string[] {
  if (!Array.isArray(action.payload)) return [];
  if (action.type === loadWorkspaceNotesSucceeded.type) {
    return Array.isArray(action.payload[0])
      ? action.payload[0].filter((id): id is string => typeof id === 'string')
      : [];
  }
  return typeof action.payload[0] === 'string' ? [action.payload[0]] : [];
}

function* reconcileSpecFromNoteAction(action: {
  type: string;
  payload?: unknown;
}): SagaGenerator<void> {
  for (const workspaceId of noteActionWorkspaceIds(action)) {
    yield* call(reconcileDeferredSpec, workspaceId);
  }
}

function* resolveInitialAgentFromSnapshot(
  action: ReturnType<typeof setAgents>,
): SagaGenerator<void> {
  const [workspaceId, agents] = action.payload;
  const layout = yield* selectPanelLayoutWorkspace.effect(workspaceId);
  if (!layout.newWorkspaceLifecycle?.initialAgentPending) return;
  const initial = resolveCanonicalInitialAgent(agents);
  if (!initial) return;
  const agentId = String(initial.id);
  yield* put(setInitialAgentId(workspaceId, agentId));
  yield* put(resolveNewWorkspaceInitialAgent(workspaceId, agentId, initial.name));
}

function* reconcileAgentsFromSnapshot(action: ReturnType<typeof setAgents>): SagaGenerator<void> {
  yield* call(resolveInitialAgentFromSnapshot, action);
  const [workspaceId, agents] = action.payload;
  yield* call(reconcileEmptyRestoredLayout, workspaceId, agents);
}

// A first-open reconcile that found no workspace record defers rather than
// opening a linkless agent tab (see reconcileEmptyRestoredLayout). These two
// actions are how the record can arrive afterwards; each re-runs the cheap,
// fully-guarded reconcile so the deferred seed eventually resolves.
function* reconcileWorkspaceEntityArrived(
  action: ReturnType<typeof setWorkspaceEntity>,
): SagaGenerator<void> {
  const [workspace] = action.payload;
  yield* call(reconcileEmptyRestoredLayout, String(workspace.id));
}

function* reconcileWorkspaceListLoaded(): SagaGenerator<void> {
  for (const wsId of restoredWorkspaceIds) {
    yield* call(reconcileEmptyRestoredLayout, wsId);
  }
}

function* resolvePendingInitialAgent(wsId: string): SagaGenerator<void> {
  const workspace = yield* selectPanelLayoutWorkspace.effect(wsId);
  if (!workspace.newWorkspaceLifecycle?.initialAgentPending) return;
  const initial = resolveCanonicalInitialAgent(yield* selectAllWorkspaceAgents.effect(wsId));
  if (!initial) return;
  const agentId = String(initial.id);
  yield* put(setInitialAgentId(wsId, agentId));
  yield* put(resolveNewWorkspaceInitialAgent(wsId, agentId, initial.name));
}

function* handleNewWorkspaceBootstrap(
  action: ReturnType<typeof bootstrapNewWorkspaceLayout>,
): SagaGenerator<void> {
  const { wsId } = action.payload;
  yield* call(resolvePendingInitialAgent, wsId);
  restoredWorkspaceIds.add(wsId);
  restoredUnderBackendIds.add(wsId);
  yield* call(persistPanelLayout, action);
  yield* call(reconcileDeferredSpec, wsId);
}

function* retroactiveRestore(activeWsId: string | null): SagaGenerator<void> {
  if (isValidWorkspaceId(activeWsId)) {
    yield* call(handleWorkspaceMountedRestore, workspaceMounted(activeWsId));
  }
}

/**
 * Re-restore one workspace after a backend switch. Unlike a fresh mount,
 * the store still holds the outgoing backend's tabs and history, so a backend
 * with nothing saved must be reset rather than left showing (and later
 * persisting) the previous backend's layout.
 */
function* restoreAfterBackendSwitch(wsId: string | null): SagaGenerator<void> {
  if (!isValidWorkspaceId(wsId)) return;
  restoredWorkspaceIds.add(wsId);
  let completed = false;
  let repairedColumns = false;
  let repairedLayout = false;
  try {
    yield* put(preparePanelLayoutBackendRestore(wsId));
    yield* put(setRestoreStatus(wsId, 'pending'));
    const stored = yield* call(loadLayoutFromStorage, wsId);
    if (stored === null || stored === 'invalid') {
      yield* put(resetLayout(wsId));
      yield* put(loadLayoutHistory(wsId, [], 0));
      yield* put(setRestoreStatus(wsId, stored === null ? 'empty' : 'invalid'));
    } else {
      const normalized = normalizeLayoutForWorkspace(wsId, stored);
      repairedLayout = !deepEqual(normalized, stored);
      yield* put(initializeLayout(wsId, normalized));
      repairedColumns = yield* call(reconcileRestoredPanelColumns, wsId);
      yield* put(setRestoreStatus(wsId, 'restored'));
      // Mirror the mount path: restored tunneled tabs re-resolve against the
      // incoming backend's live tunnel state (monorepo#2789). Detached
      // (spawn, not fork): handleBackendSwitch `call`s this generator once
      // per mounted workspace with every workspace's inflightRestores entry
      // pre-registered, so an attached fork would serialize dead-port probes
      // into the restore loop and leave later workspaces' waiters (browser
      // IPC listTabs) blocked past main's 500ms timeout.
      yield* spawn(rehydrateTunneledBrowserTabs, wsId, collectRehydratableBrowserTabs(normalized));
    }
    restoredUnderBackendIds.add(wsId);
    yield* call(reconcileEmptyRestoredLayout, wsId);
    if (repairedLayout || repairedColumns) {
      yield* call(persistPanelLayout, { payload: { wsId } });
    }
    completed = true;
  } finally {
    // Mirror the mount path: a failed or cancelled re-restore releases the
    // dedup guard so a later trigger (hydration) can retry it.
    if (!completed) restoredWorkspaceIds.delete(wsId);
  }
}

/**
 * Backend switched (activeId flips via the boot connections:list refresh after
 * the window reloads): re-restore every mounted workspace's layout from the
 * incoming backend's namespace. In the columns UI multiple workspaces mount
 * at boot — possibly before the boot connections:list resolves the actual
 * backend — so restoring only the active workspace would leave the others on
 * the wrong namespace's (usually empty) layout.
 */
function* handleBackendSwitch(lastBackend: { id: string }): SagaGenerator<void> {
  const backendId = yield* selectActiveBackendId();
  if (backendId === lastBackend.id) return;
  lastBackend.id = backendId;
  restoredWorkspaceIds.clear();
  restoredUnderBackendIds.clear();
  // Register every re-restore as in flight up front: until a workspace's
  // turn in the loop completes, the store still holds the OUTGOING backend's
  // layout, so an on-demand hydration caller (browser IPC) must wait here
  // rather than answer with the previous backend's tabs (monorepo#2789).
  const pending = new Map<string, { promise: Promise<void>; settle: () => void }>();
  for (const wsId of [...mountedWorkspaceIds]) {
    if (!isValidWorkspaceId(wsId)) continue;
    let settle!: () => void;
    const promise = new Promise<void>((resolve) => {
      settle = resolve;
    });
    pending.set(wsId, { promise, settle });
    inflightRestores.set(wsId, promise);
  }
  // Settle one workspace's entry; only remove the map slot when it still
  // holds OUR promise — a concurrent mount restore may have replaced it.
  const release = (wsId: string) => {
    const entry = pending.get(wsId);
    if (!entry) return;
    pending.delete(wsId);
    if (inflightRestores.get(wsId) === entry.promise) inflightRestores.delete(wsId);
    entry.settle();
  };
  try {
    for (const wsId of [...pending.keys()]) {
      try {
        yield* call(restoreAfterBackendSwitch, wsId);
      } finally {
        release(wsId);
      }
    }
  } finally {
    // A restore that threw or was cancelled mid-loop must not leave the
    // remaining workspaces' waiters hanging forever.
    for (const wsId of [...pending.keys()]) release(wsId);
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* panelLayoutSaga(options?: {
  activeWorkspaceId?: string | null;
}): SagaGenerator<void> {
  let workspaceIdContext = options?.activeWorkspaceId ?? null;
  const historyMailboxes = new Map<string, HistoryMailbox>();
  function* queueHistorySaveForAction(action: {
    type: string;
    payload?: unknown;
  }): SagaGenerator<void> {
    yield* queueHistorySave(historyMailboxes, action);
  }
  function* handleBlankWorkingPanel(
    action: ReturnType<typeof openBlankWorkingPanel>,
  ): SagaGenerator<void> {
    yield* fork(persistPanelLayout, action);
    yield* queueHistorySaveForAction(action);
  }
  function* handleScriptRemoved(action: ReturnType<typeof removeScript>): SagaGenerator<void> {
    yield* fork(persistPanelLayout, action);
    yield* queueHistorySaveForAction(action);
  }
  function* handleReopenedPanelColumn(
    action: ReturnType<typeof reopenClosedPanelColumn>,
  ): SagaGenerator<void> {
    yield* fork(persistPanelLayout, action);
    yield* queueHistorySaveForAction(action);
  }
  function* handleWorkspaceUnmountedAction(
    action: ReturnType<typeof workspaceUnmounted> | ReturnType<typeof panelLayoutScopeUnmounted>,
  ): SagaGenerator<void> {
    yield* handleWorkspaceUnmounted(historyMailboxes, action);
  }
  function* handleWorkspaceMountedAction(
    action: ReturnType<typeof workspaceMounted> | ReturnType<typeof panelLayoutScopeMounted>,
  ): SagaGenerator<void> {
    const [workspaceId] = action.payload;
    workspaceIdContext = workspaceId;
    yield* handleWorkspaceMountedRestore(action);
  }
  try {
    yield* takeEvery(bootstrapNewWorkspaceLayout, handleNewWorkspaceBootstrap);
    yield* takeEvery(setAgents, reconcileAgentsFromSnapshot);
    yield* takeEvery(setWorkspaceEntity, reconcileWorkspaceEntityArrived);
    yield* takeEvery(setWorkspaceHasLoaded, reconcileWorkspaceListLoaded);
    yield* takeEvery(
      [applyNoteCreated, applyNoteUpdated, loadWorkspaceNotesSucceeded],
      reconcileSpecFromNoteAction,
    );
    yield* takeEvery(PERSIST_ACTIONS, persistPanelLayout);
    yield* takeEvery(setTabOwnerAgent, persistPanelLayout);
    // Hidden opens must persist across relaunch without changing panel history.
    yield* takeEvery(openHiddenTab, persistPanelLayout);
    // Sidebar/footer reveals must persist so a restored owned tab does not
    // revert to hidden on restart (monorepo#3112).
    yield* takeEvery(revealHiddenTabAvoidingPanel, persistPanelLayout);
    yield* takeEvery(openBlankWorkingPanel, handleBlankWorkingPanel);
    yield* takeEvery(removeScript, handleScriptRemoved);
    yield* takeEvery(reopenClosedPanelColumn, handleReopenedPanelColumn);
    yield* fork(watchRightmostColumnRequests);
    yield* takeEvery([clearPanelLayout, workspaceDeleted], clearPersistedLayout);
    const historyWatcher = yield* takeEvery(HISTORY_ACTIONS, queueHistorySaveForAction);
    yield* takeLatest(initializeLayout, loadHistoryForWorkspace);
    yield* takeLeading(connectionsListReceived, handleBackendSwitch, {
      id: yield* selectActiveBackendId(),
    });
    yield* takeEvery([workspaceMounted, panelLayoutScopeMounted], handleWorkspaceMountedAction);
    yield* takeEvery(
      [workspaceUnmounted, panelLayoutScopeUnmounted],
      handleWorkspaceUnmountedAction,
    );
    yield* call(retroactiveRestore, workspaceIdContext);
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
    restoredUnderBackendIds.clear();
    mountedWorkspaceIds.clear();
  }
}
