/**
 * Panel Layout Slice
 *
 * Manages panel layout state (tabs, splits, focus, history) per workspace.
 * Migrated from features/layout/panel-layout-manager.svelte.ts
 */

import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { removeTerminal } from "../terminals/terminals-slice";
import type {
  PanelTab,
  PanelTabType,
  PanelState,
  PanelLayoutNode,
  PanelLayoutRestoreStatus,
  WorkspacePanelLayoutState,
  PanelLayoutSliceState,
  LayoutSnapshot,
  RecentlyClosedTab,
  SavedExpandSizes,
} from "./panel-layout-types";
import {
  MAX_RECENTLY_CLOSED,
  MAX_LAYOUT_HISTORY,
  MAX_FOCUS_HISTORY,
  EXPANDED_SHARE,
} from "./panel-layout-types";

// ============================================================================
// ID Generation Helpers (used in payload modifiers)
// ============================================================================

let panelIdCounter = 0;

function generatePanelId(): string {
  return `panel-${Date.now()}-${++panelIdCounter}`;
}

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================================
// Default State Factory
// ============================================================================

export function createDefaultLayout(): Pick<
  WorkspacePanelLayoutState,
  "root" | "panels" | "focusedPanelId"
> {
  const panelId = generatePanelId();
  return {
    root: { type: "panel", panelId },
    panels: {
      [panelId]: { id: panelId, tabs: [], activeTabId: null },
    },
    focusedPanelId: panelId,
  };
}

export const emptyWorkspaceState: WorkspacePanelLayoutState = {
  root: { type: "panel", panelId: "default" },
  panels: { default: { id: "default", tabs: [], activeTabId: null } },
  focusedPanelId: "default",
  restoreStatus: "idle",
  pendingFocusTabId: null,
  recentlyClosed: [],
  layoutHistory: [],
  historyIndex: 0,
  historyLoaded: false,
  focusHistory: [],
  focusHistoryIndex: -1,
  expandedPanelId: null,
  savedSizesBeforeExpand: [],
  deferSpecTab: false,
};

const {
  getWorkspaceState,
  setWorkspaceState,
  clearWorkspaceState,
} = createWorkspaceScopedHelpers(emptyWorkspaceState);

// ============================================================================
// Actions
// ============================================================================

// --- Initialization ---
export const initializeLayout = createAction(
  "panelLayout/initializeLayout",
  (wsId: string, layout: Pick<WorkspacePanelLayoutState, "root" | "panels" | "focusedPanelId">) => ({
    wsId,
    layout,
  }),
);

export const loadLayoutHistory = createAction(
  "panelLayout/loadLayoutHistory",
  (wsId: string, history: LayoutSnapshot[], historyIndex: number) => ({
    wsId,
    history,
    historyIndex,
  }),
);

export const setRestoreStatus = createAction<[
  wsId: string,
  restoreStatus: PanelLayoutRestoreStatus,
]>("panelLayout/setRestoreStatus");

// --- Tab Operations ---
export const openTab = createAction(
  "panelLayout/openTab",
  (
    wsId: string,
    tab: Omit<PanelTab, "id">,
    panelId?: string,
    newTabId?: string,
    force?: boolean,
    timestamp?: number,
  ) => ({
    wsId,
    tab,
    panelId,
    newTabId: newTabId ?? generateTabId(),
    force: force ?? false,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const openTabInAdjacentOrSplit = createAction(
  "panelLayout/openTabInAdjacentOrSplit",
  (
    wsId: string,
    tab: Omit<PanelTab, "id">,
    sourcePanelId?: string,
    options?: { animated?: boolean; force?: boolean },
    timestamp?: number,
  ) => ({
    wsId,
    tab,
    sourcePanelId,
    animated: options?.animated ?? false,
    force: options?.force ?? false,
    newTabId: generateTabId(),
    newPanelId: generatePanelId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const closeTab = createAction(
  "panelLayout/closeTab",
  (wsId: string, tabId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    tabId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const closeActiveTab = createAction(
  "panelLayout/closeActiveTab",
  (wsId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);


export const reopenClosedTab = createAction(
  "panelLayout/reopenClosedTab",
  (wsId: string, timestamp?: number) => ({
    wsId,
    newTabId: generateTabId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

/**
 * Prune `recentlyClosed` entries that reference a deleted agent or a removed
 * terminal so the empty-state recent list and `reopenClosedTab` cannot resurrect
 * tombstoned entities. Match by `agentId` and/or `terminalId`.
 */
export const pruneRecentlyClosed = createAction<[
  wsId: string,
  match: { agentId?: string; terminalId?: string },
]>("panelLayout/pruneRecentlyClosed");

export const setActiveTab = createAction(
  "panelLayout/setActiveTab",
  (wsId: string, tabId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    tabId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const selectNextTab = createAction(
  "panelLayout/selectNextTab",
  (wsId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const selectPreviousTab = createAction(
  "panelLayout/selectPreviousTab",
  (wsId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const reorderTabs = createAction<
  [wsId: string, panelId: string, fromIndex: number, toIndex: number]
>("panelLayout/reorderTabs");

export const moveTabToPanel = createAction(
  "panelLayout/moveTabToPanel",
  (
    wsId: string,
    tabId: string,
    fromPanelId: string,
    toPanelId: string,
    insertIndex?: number,
    timestamp?: number,
  ) => ({
    wsId,
    tabId,
    fromPanelId,
    toPanelId,
    insertIndex,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const moveTabToSplit = createAction(
  "panelLayout/moveTabToSplit",
  (
    wsId: string,
    tabId: string,
    fromPanelId: string,
    targetPanelId: string,
    zone: "top" | "bottom" | "left" | "right",
    timestamp?: number,
  ) => ({
    wsId,
    tabId,
    fromPanelId,
    targetPanelId,
    zone,
    newPanelId: generatePanelId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const moveTabToSplitLevel = createAction(
  "panelLayout/moveTabToSplitLevel",
  (
    wsId: string,
    tabId: string,
    fromPanelId: string,
    splitPath: number[],
    position: "before" | "after",
    direction: "horizontal" | "vertical",
    timestamp?: number,
  ) => ({
    wsId,
    tabId,
    fromPanelId,
    splitPath,
    position,
    direction,
    newPanelId: generatePanelId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

// --- Close operations ---
export const closeOtherTabs = createAction(
  "panelLayout/closeOtherTabs",
  (wsId: string, tabId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    tabId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const closeTabsToRight = createAction(
  "panelLayout/closeTabsToRight",
  (wsId: string, tabId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    tabId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const closeAllTabs = createAction(
  "panelLayout/closeAllTabs",
  (wsId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const closeAllOthersEverywhere = createAction(
  "panelLayout/closeAllOthersEverywhere",
  (wsId: string, tabId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    tabId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

// --- Panel Operations ---
export const focusPanel = createAction<[wsId: string, panelId: string]>(
  "panelLayout/focusPanel",
);

export const splitPanel = createAction(
  "panelLayout/splitPanel",
  (
    wsId: string,
    panelId: string,
    direction: "horizontal" | "vertical",
    options?: { animated?: boolean },
    timestamp?: number,
  ) => ({
    wsId,
    panelId,
    direction,
    animated: options?.animated ?? false,
    newPanelId: generatePanelId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const closePanel = createAction(
  "panelLayout/closePanel",
  (wsId: string, panelId: string, timestamp?: number) => ({
    wsId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const updateSizes = createAction<[wsId: string, nodePath: number[], sizes: number[]]>(
  "panelLayout/updateSizes",
);

export const updateSplitSizes = createAction<
  [wsId: string, sizes: number[], splitPath?: number[]]
>("panelLayout/updateSplitSizes");

export const toggleExpandPanel = createAction<[wsId: string, panelId: string]>(
  "panelLayout/toggleExpandPanel",
);

export const resetLayout = createAction(
  "panelLayout/resetLayout",
  (wsId: string) => ({ wsId, defaultLayout: createDefaultLayout() }),
);

export const applyPreset = createAction(
  "panelLayout/applyPreset",
  (
    wsId: string,
    preset: "single" | "split-horizontal" | "split-vertical" | "three-column",
    timestamp?: number,
  ) => ({
    wsId,
    preset,
    panelIds: Array.from({ length: 3 }, () => generatePanelId()),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const createGridLayout = createAction(
  "panelLayout/createGridLayout",
  (wsId: string, panelCount: number, timestamp?: number) => ({
    wsId,
    panelCount: Math.max(1, Math.min(6, panelCount)),
    panelIds: Array.from({ length: 6 }, () => generatePanelId()),
    timestamp: timestamp ?? Date.now(),
  }),
);

// --- History ---
export const goBack = createAction(
  "panelLayout/goBack",
  (wsId: string, timestamp?: number) => ({ wsId, timestamp: timestamp ?? Date.now() }),
);
export const goForward = createAction<[wsId: string]>("panelLayout/goForward");
export const goBackInFocusHistory = createAction<[wsId: string]>(
  "panelLayout/goBackInFocusHistory",
);
export const goForwardInFocusHistory = createAction<[wsId: string]>(
  "panelLayout/goForwardInFocusHistory",
);

// --- Spec Tab Deferral ---
export const setDeferSpecTab = createAction<[wsId: string, value: boolean]>(
  "panelLayout/setDeferSpecTab",
);

// --- Pending Focus ---
export const consumePendingFocus = createAction<[wsId: string, tabId: string]>(
  "panelLayout/consumePendingFocus",
);

// --- Agent Reconciliation ---
export const reconcileStaleAgentTabs = createAction<
  [wsId: string, validAgentIds: string[], replacementAgentId: string, replacementTitle: string]
>("panelLayout/reconcileStaleAgentTabs");

// --- Clear workspace ---
export const clearPanelLayout = createAction<[wsId: string]>("panelLayout/clearPanelLayout");

export const closeTabsByType = createAction(
  "panelLayout/closeTabsByType",
  (
    wsId: string,
    tabType: PanelTabType,
    matchField?: string,
    matchValue?: string,
    timestamp?: number,
  ) => ({
    wsId,
    tabType,
    matchField,
    matchValue,
    timestamp: timestamp ?? Date.now(),
  }),
);

// ============================================================================
// Internal Helpers (pure functions used by reducer)
// ============================================================================

/** Find the path of child indices from root to a panel */
function findPanelPath(node: PanelLayoutNode, panelId: string): number[] | null {
  if (node.type === "panel") {
    return node.panelId === panelId ? [] : null;
  }
  for (let i = 0; i < node.children.length; i++) {
    const childPath = findPanelPath(node.children[i], panelId);
    if (childPath !== null) return [i, ...childPath];
  }
  return null;
}

/** Navigate to a split node using a path of child indices from root */
function getSplitAtPath(root: PanelLayoutNode, path: number[]): PanelLayoutNode | null {
  let node: PanelLayoutNode = root;
  for (const idx of path) {
    if (node.type === "split" && node.children[idx]) {
      node = node.children[idx];
    } else {
      return null;
    }
  }
  return node;
}

/** Find an existing tab by type/content match across all panels. Returns [panelId, tab] or null. */
function findExistingTab(
  panels: Record<string, PanelState>,
  tab: Omit<PanelTab, "id">,
): [string, PanelTab] | null {
  const isSingletonTab =
    tab.type === "agent-overview" ||
    tab.type === "local-changes" ||
    tab.type === "code-review" ||
    tab.type === "settings" ||
    tab.type === "overview";
  const isAgentTab = tab.type === "agent" && tab.agentId;

  // Check across ALL panels for singleton/agent tabs
  if (isSingletonTab || isAgentTab) {
    for (const [panelId, panel] of Object.entries(panels)) {
      const existing = panel.tabs.find((t) => {
        if (isSingletonTab) return t.type === tab.type;
        return t.type === "agent" && t.agentId === tab.agentId;
      });
      if (existing) return [panelId, existing];
    }
  }
  return null;
}

/** Find duplicate tab in a specific panel by content */
function findDuplicateTabInPanel(
  panel: PanelState,
  tab: Omit<PanelTab, "id">,
): PanelTab | null {
  return panel.tabs.find((t) => {
    if (t.type !== tab.type) return false;
    switch (tab.type) {
      case "note": return t.noteId === tab.noteId;
      case "file": return t.filePath === tab.filePath;
      case "agent": return t.agentId === tab.agentId;
      case "terminal": return t.terminalId === tab.terminalId;
      case "diff": {
        const tabHash = (tab.data?.change as { commitHash?: string })?.commitHash;
        const existingHash = (t.data?.change as { commitHash?: string })?.commitHash;
        return t.diffPath === tab.diffPath && tabHash === existingHash;
      }
      case "browser":
        if (t.contextItemId && tab.contextItemId) return t.contextItemId === tab.contextItemId;
        return t.browserUrl === tab.browserUrl;
      case "changes": {
        const tabHash = (tab.data as { commitHash?: string })?.commitHash;
        const existingHash = (t.data as { commitHash?: string })?.commitHash;
        return !!tabHash && tabHash === existingHash;
      }
      case "activity-changes": return t.filePath === tab.filePath;
      case "chat-changes": {
        const tabMsgId = (tab.data as { messageId?: string })?.messageId;
        const existMsgId = (t.data as { messageId?: string })?.messageId;
        return !!tabMsgId && tabMsgId === existMsgId;
      }
      case "activity":
      case "code-review":
      case "settings":
      case "overview":
      case "agent-overview":
      case "local-changes":
        return true;
      default:
        return false;
    }
  }) ?? null;
}

/** Remove a panel from the layout tree. Returns null if panel was the only one. */
function removeFromTree(node: PanelLayoutNode, panelId: string): PanelLayoutNode | null {
  if (node.type === "panel") {
    return node.panelId === panelId ? null : node;
  }

  const newChildren: PanelLayoutNode[] = [];
  const keptIndices: number[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const result = removeFromTree(node.children[i], panelId);
    if (result) {
      newChildren.push(result);
      keptIndices.push(i);
    }
  }

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];

  const totalSize = keptIndices.reduce((sum, i) => sum + node.sizes[i], 0);
  const newSizes = keptIndices.map((i) => (node.sizes[i] / totalSize) * 100);

  return { ...node, children: newChildren, sizes: newSizes };
}

/** Close a panel, returning the updated workspace state */
function closePanelHelper(ws: WorkspacePanelLayoutState, panelId: string): WorkspacePanelLayoutState {
  if (Object.keys(ws.panels).length <= 1) return ws;

  const newRoot = removeFromTree(ws.root, panelId);
  if (!newRoot) return ws;

   
  const { [panelId]: _removed, ...remainingPanels } = ws.panels;
  const focusedPanelId =
    ws.focusedPanelId === panelId
      ? Object.keys(remainingPanels)[0] ?? null
      : ws.focusedPanelId;

  return {
    ...ws,
    root: newRoot,
    panels: remainingPanels,
    focusedPanelId,
    expandedPanelId: null,
    savedSizesBeforeExpand: [],
  };
}

/** Add an entry to focus history using the timestamp generated before dispatch. */
function addToFocusHistory(
  ws: WorkspacePanelLayoutState,
  panelId: string,
  tabId: string,
  timestamp: number,
): WorkspacePanelLayoutState {
  const lastEntry = ws.focusHistory[ws.focusHistory.length - 1];
  if (lastEntry && lastEntry.panelId === panelId && lastEntry.tabId === tabId) {
    return ws;
  }

  let focusHistory = [...ws.focusHistory];
  const focusHistoryIndex = ws.focusHistoryIndex;

  // Truncate forward history if navigated back
  if (focusHistoryIndex >= 0 && focusHistoryIndex < focusHistory.length - 1) {
    focusHistory = focusHistory.slice(0, focusHistoryIndex + 1);
  }

  focusHistory.push({ panelId, tabId, timestamp });

  if (focusHistory.length > MAX_FOCUS_HISTORY) {
    focusHistory = focusHistory.slice(focusHistory.length - MAX_FOCUS_HISTORY);
  }

  return {
    ...ws,
    focusHistory,
    focusHistoryIndex: focusHistory.length - 1,
  };
}

/** Save current layout state to history before mutation using the timestamp generated before dispatch. */
function saveToHistory(ws: WorkspacePanelLayoutState, timestamp: number): WorkspacePanelLayoutState {
  let layoutHistory = [...ws.layoutHistory];
  let historyIndex = ws.historyIndex;

  // Truncate forward history
  if (historyIndex < layoutHistory.length) {
    layoutHistory = layoutHistory.slice(0, historyIndex);
  }

  // Save snapshot
  const snapshot: LayoutSnapshot = {
    root: JSON.parse(JSON.stringify(ws.root)),
    panels: JSON.parse(JSON.stringify(ws.panels)),
    focusedPanelId: ws.focusedPanelId,
    timestamp,
  };
  layoutHistory.push(snapshot);
  historyIndex = layoutHistory.length;

  // Limit history
  if (layoutHistory.length > MAX_LAYOUT_HISTORY) {
    const toRemove = layoutHistory.length - MAX_LAYOUT_HISTORY;
    layoutHistory = layoutHistory.slice(toRemove);
    historyIndex = Math.max(0, historyIndex - toRemove);
  }

  return { ...ws, layoutHistory, historyIndex };
}

/** Strip spec tabs from panels if deferSpecTab is active */
function stripSpecTabs(panels: Record<string, PanelState>): Record<string, PanelState> {
  const result: Record<string, PanelState> = {};
  for (const [id, panel] of Object.entries(panels)) {
    const filteredTabs = panel.tabs.filter((t) => !(t.type === "note" && t.noteId === "spec"));
    if (filteredTabs.length === panel.tabs.length) {
      result[id] = panel;
    } else {
      const activeTabId =
        panel.activeTabId && filteredTabs.some((t) => t.id === panel.activeTabId)
          ? panel.activeTabId
          : filteredTabs[0]?.id ?? null;
      result[id] = { ...panel, tabs: filteredTabs, activeTabId };
    }
  }
  return result;
}

export const closeTabsByAgentId = createAction(
  "panelLayout/closeTabsByAgentId",
  (wsId: string, agentId: string, timestamp?: number) => ({
    wsId,
    agentId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const updateTabTitle = createAction<[wsId: string, tabId: string, newTitle: string]>(
  "panelLayout/updateTabTitle",
);

export const updateTabBrowserUrl = createAction<[wsId: string, tabId: string, newUrl: string]>(
  "panelLayout/updateTabBrowserUrl",
);

export const updateTabFavicon = createAction<[wsId: string, tabId: string, faviconUrl: string]>(
  "panelLayout/updateTabFavicon",
);

export const updateFileTabPath = createAction<[wsId: string, oldPath: string, newPath: string]>(
  "panelLayout/updateFileTabPath",
);

// ============================================================================
// Initial State
// ============================================================================

export const initialState: PanelLayoutSliceState = {
  byWorkspaceId: {},
};

// ============================================================================
// Reducer
// ============================================================================

/** Mutable reference for recursive reducer dispatch (set after creation) */
let _reducerRef: ((state: PanelLayoutSliceState, action: { type: string; payload: any }) => PanelLayoutSliceState) | null = null;

function selfDispatch(state: PanelLayoutSliceState, action: { type: string; payload: any }): PanelLayoutSliceState {
  if (!_reducerRef) {
    return state;
  }
  return _reducerRef(state, action);
}

export const panelLayoutReducer = createReducer<PanelLayoutSliceState>(initialState)
  // --- Initialization ---
  .with(initializeLayout, (state, { payload }) => {
    const { wsId, layout } = payload;
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      root: layout.root,
      panels: layout.panels,
      focusedPanelId: layout.focusedPanelId,
    });
  })
  .with(setRestoreStatus, (state, { payload: [wsId, restoreStatus] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, restoreStatus });
  })
  .with(loadLayoutHistory, (state, { payload }) => {
    const { wsId, history, historyIndex } = payload;
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      layoutHistory: history,
      historyIndex: Math.min(historyIndex, history.length),
      historyLoaded: true,
    });
  })
  // --- Open Tab ---
  .with(openTab, (state, { payload }) => {
    const { wsId, tab, panelId, newTabId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);

    // Spec-note guard — bypass when force is true (user-initiated opens)
    if (ws.deferSpecTab && tab.type === "note" && tab.noteId === "spec" && !payload.force) return state;

    // Check for existing singleton/agent tab across panels
    const existing = findExistingTab(ws.panels, tab);
    if (existing) {
      const [existPanelId, existTab] = existing;
      const panel = ws.panels[existPanelId];
      ws = saveToHistory(ws, timestamp);
      ws = {
        ...ws,
        panels: {
          ...ws.panels,
          [existPanelId]: { ...panel, activeTabId: existTab.id },
        },
        focusedPanelId: existPanelId,
      };
      ws = addToFocusHistory(ws, existPanelId, existTab.id, timestamp);
      return setWorkspaceState(state, wsId, ws);
    }

    const targetPanelId = panelId ?? ws.focusedPanelId;
    if (!targetPanelId || !ws.panels[targetPanelId]) return state;

    const panel = ws.panels[targetPanelId];

    // Check for duplicate in target panel
    const dupTab = findDuplicateTabInPanel(panel, tab);
    if (dupTab) {
      ws = saveToHistory(ws, timestamp);
      const updatedData = tab.data ? { ...dupTab.data, ...tab.data } : dupTab.data;
      ws = {
        ...ws,
        panels: {
          ...ws.panels,
          [targetPanelId]: {
            ...panel,
            activeTabId: dupTab.id,
            tabs: tab.data
              ? panel.tabs.map((t) => (t.id === dupTab.id ? { ...t, data: updatedData } : t))
              : panel.tabs,
          },
        },
      };
      ws = addToFocusHistory(ws, targetPanelId, dupTab.id, timestamp);
      return setWorkspaceState(state, wsId, ws);
    }

    // Create new tab
    ws = saveToHistory(ws, timestamp);
    const newTab: PanelTab = { ...tab, id: newTabId };
    ws = {
      ...ws,
      panels: {
        ...ws.panels,
        [targetPanelId]: {
          ...panel,
          tabs: [...panel.tabs, newTab],
          activeTabId: newTabId,
        },
      },
    };
    ws = addToFocusHistory(ws, targetPanelId, newTabId, timestamp);
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Close Tab ---
  .with(closeTab, (state, { payload }) => {
    const { wsId, tabId, panelId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);

    // Find the panel containing this tab
    let targetPanelId = panelId;
    if (!targetPanelId) {
      for (const [pId, panel] of Object.entries(ws.panels)) {
        if (panel.tabs.some((t) => t.id === tabId)) {
          targetPanelId = pId;
          break;
        }
      }
    }
    if (!targetPanelId || !ws.panels[targetPanelId]) return state;

    const panel = ws.panels[targetPanelId];
    const tabIndex = panel.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return state;

    ws = saveToHistory(ws, timestamp);
    const closedTab = panel.tabs[tabIndex];
    const newTabs = panel.tabs.filter((_, i) => i !== tabIndex);

    let newActiveTabId = panel.activeTabId;
    if (panel.activeTabId === tabId) {
      if (newTabs.length > 0) {
        const newIndex = Math.min(tabIndex, newTabs.length - 1);
        newActiveTabId = newTabs[newIndex].id;
      } else {
        newActiveTabId = null;
      }
    }

    // Add to recently closed
    const recentlyClosed = [
      { tab: { ...closedTab }, panelId: targetPanelId, closedAt: timestamp },
      ...ws.recentlyClosed,
    ].slice(0, MAX_RECENTLY_CLOSED);

    ws = {
      ...ws,
      panels: { ...ws.panels, [targetPanelId]: { ...panel, tabs: newTabs, activeTabId: newActiveTabId } },
      recentlyClosed,
    };

    // Close empty panel if there are others
    if (newTabs.length === 0 && Object.keys(ws.panels).length > 1) {
      ws = closePanelHelper(ws, targetPanelId);
    }

    return setWorkspaceState(state, wsId, ws);
  })
  // --- Close Active Tab ---
  .with(closeActiveTab, (state, { payload }) => {
    const { wsId, panelId, timestamp } = payload;
    const ws = getWorkspaceState(state, wsId);
    const targetPanelId = panelId ?? ws.focusedPanelId;
    if (!targetPanelId || !ws.panels[targetPanelId]) return state;

    const panel = ws.panels[targetPanelId];
    if (!panel.activeTabId) return state;

    const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId);
    if (activeTab && activeTab.closable === false) return state;

    // Delegate to closeTab reducer by dispatching inline
    return selfDispatch(state, closeTab(wsId, panel.activeTabId, targetPanelId, timestamp));
  })
  // --- Close Tabs By Type ---
  .with(closeTabsByType, (state, { payload }) => {
    const { wsId, tabType, matchField, matchValue, timestamp } = payload;
    const ws = getWorkspaceState(state, wsId);
    const tabsToClose: { tabId: string; panelId: string }[] = [];

    for (const [pId, panel] of Object.entries(ws.panels)) {
      for (const tab of panel.tabs) {
        if (tab.type === tabType) {
          if (!matchField || !matchValue) {
            tabsToClose.push({ tabId: tab.id, panelId: pId });
          } else if ((tab as unknown as Record<string, unknown>)[matchField] === matchValue) {
            tabsToClose.push({ tabId: tab.id, panelId: pId });
          }
        }
      }
    }

    if (tabsToClose.length === 0) return state;

    let result = state;
    for (const { tabId, panelId } of tabsToClose) {
      result = selfDispatch(result, closeTab(wsId, tabId, panelId, timestamp));
    }
    return result;
  })
  // --- Close Tabs By Agent ID ---
  .with(closeTabsByAgentId, (state, { payload }) => {
    const { wsId, agentId, timestamp } = payload;
    const ws = getWorkspaceState(state, wsId);
    const tabsToClose: { tabId: string; panelId: string }[] = [];
    for (const [pId, panel] of Object.entries(ws.panels)) {
      for (const tab of panel.tabs) {
        if (tab.type === "agent" && tab.agentId === agentId) {
          tabsToClose.push({ tabId: tab.id, panelId: pId });
        }
      }
    }
    if (tabsToClose.length === 0) return state;
    let result = state;
    for (const { tabId, panelId } of tabsToClose) {
      result = selfDispatch(result, closeTab(wsId, tabId, panelId, timestamp));
    }
    return result;
  })
  // --- Prune Recently Closed ---
  .with(pruneRecentlyClosed, (state, { payload: [wsId, match] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.recentlyClosed.length === 0) return state;
    const { agentId, terminalId } = match;
    if (!agentId && !terminalId) return state;
    const filtered = ws.recentlyClosed.filter((entry) => {
      if (agentId && entry.tab.type === "agent" && entry.tab.agentId === agentId) return false;
      if (terminalId && entry.tab.type === "terminal" && entry.tab.terminalId === terminalId) return false;
      return true;
    });
    if (filtered.length === ws.recentlyClosed.length) return state;
    return setWorkspaceState(state, wsId, { ...ws, recentlyClosed: filtered });
  })
  // --- Cross-slice: prune recentlyClosed when a terminal is removed ---
  .with(removeTerminal, (state, { payload: [wsId, termId] }) => {
    const ws = state.byWorkspaceId[wsId];
    if (!ws || ws.recentlyClosed.length === 0) return state;
    const filtered = ws.recentlyClosed.filter(
      (entry) => !(entry.tab.type === "terminal" && entry.tab.terminalId === termId),
    );
    if (filtered.length === ws.recentlyClosed.length) return state;
    return setWorkspaceState(state, wsId, { ...ws, recentlyClosed: filtered });
  })
  // --- Reopen Closed Tab ---
  .with(reopenClosedTab, (state, { payload }) => {
    const { wsId, newTabId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    if (ws.recentlyClosed.length === 0) return state;

    const next = ws.recentlyClosed[0];
    if (ws.deferSpecTab && next.tab.type === "note" && next.tab.noteId === "spec") return state;

    ws = saveToHistory(ws, timestamp);
    const [closed, ...rest] = ws.recentlyClosed;
    const targetPanelId = ws.panels[closed.panelId] ? closed.panelId : ws.focusedPanelId;
    if (!targetPanelId || !ws.panels[targetPanelId]) return state;

    const panel = ws.panels[targetPanelId];
    const newTab: PanelTab = { ...closed.tab, id: newTabId };

    ws = {
      ...ws,
      recentlyClosed: rest,
      panels: {
        ...ws.panels,
        [targetPanelId]: {
          ...panel,
          tabs: [...panel.tabs, newTab],
          activeTabId: newTabId,
        },
      },
    };
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Set Active Tab ---
  .with(setActiveTab, (state, { payload }) => {
    const { wsId, tabId, panelId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    const targetPanelId = panelId ?? ws.focusedPanelId;
    if (!targetPanelId || !ws.panels[targetPanelId]) return state;

    const panel = ws.panels[targetPanelId];
    if (!panel.tabs.some((t) => t.id === tabId)) return state;
    if (panel.activeTabId === tabId) return state;

    ws = saveToHistory(ws, timestamp);
    ws = {
      ...ws,
      panels: { ...ws.panels, [targetPanelId]: { ...panel, activeTabId: tabId } },
    };
    ws = addToFocusHistory(ws, targetPanelId, tabId, timestamp);
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Select Next/Previous Tab ---
  .with(selectNextTab, (state, { payload }) => {
    const { wsId, panelId, timestamp } = payload;
    const ws = getWorkspaceState(state, wsId);
    const targetPanelId = panelId ?? ws.focusedPanelId;
    if (!targetPanelId || !ws.panels[targetPanelId]) return state;
    const panel = ws.panels[targetPanelId];
    if (panel.tabs.length === 0) return state;
    const currentIndex = panel.tabs.findIndex((t) => t.id === panel.activeTabId);
    const nextIndex = (currentIndex + 1) % panel.tabs.length;
    const nextTab = panel.tabs[nextIndex];
    if (!nextTab || nextTab.id === panel.activeTabId) return state;
    return selfDispatch(state, setActiveTab(wsId, nextTab.id, targetPanelId, timestamp));
  })
  .with(selectPreviousTab, (state, { payload }) => {
    const { wsId, panelId, timestamp } = payload;
    const ws = getWorkspaceState(state, wsId);
    const targetPanelId = panelId ?? ws.focusedPanelId;
    if (!targetPanelId || !ws.panels[targetPanelId]) return state;
    const panel = ws.panels[targetPanelId];
    if (panel.tabs.length === 0) return state;
    const currentIndex = panel.tabs.findIndex((t) => t.id === panel.activeTabId);
    const prevIndex = currentIndex <= 0 ? panel.tabs.length - 1 : currentIndex - 1;
    const prevTab = panel.tabs[prevIndex];
    if (!prevTab || prevTab.id === panel.activeTabId) return state;
    return selfDispatch(state, setActiveTab(wsId, prevTab.id, targetPanelId, timestamp));
  })
  // --- Reorder Tabs ---
  .with(reorderTabs, (state, { payload: [wsId, panelId, fromIndex, toIndex] }) => {
    const ws = getWorkspaceState(state, wsId);
    const panel = ws.panels[panelId];
    if (!panel) return state;
    if (fromIndex < 0 || fromIndex >= panel.tabs.length) return state;
    if (toIndex < 0 || toIndex >= panel.tabs.length) return state;
    if (fromIndex === toIndex) return state;
    const newTabs = [...panel.tabs];
    const [tab] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, tab);
    return setWorkspaceState(state, wsId, {
      ...ws,
      panels: { ...ws.panels, [panelId]: { ...panel, tabs: newTabs } },
    });
  })
  // --- Move Tab To Panel ---
  .with(moveTabToPanel, (state, { payload }) => {
    const { wsId, tabId, fromPanelId, toPanelId, insertIndex, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    const fromPanel = ws.panels[fromPanelId];
    const toPanel = ws.panels[toPanelId];
    if (!fromPanel || !toPanel) return state;
    const tabIndex = fromPanel.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return state;

    ws = saveToHistory(ws, timestamp);
    const tab = fromPanel.tabs[tabIndex];
    const newFromTabs = fromPanel.tabs.filter((_, i) => i !== tabIndex);
    let newFromActiveTabId = fromPanel.activeTabId;
    if (fromPanel.activeTabId === tabId) {
      newFromActiveTabId = newFromTabs.length > 0 ? newFromTabs[Math.min(tabIndex, newFromTabs.length - 1)].id : null;
    }

    const targetIdx = insertIndex ?? toPanel.tabs.length;
    const newToTabs = [...toPanel.tabs.slice(0, targetIdx), tab, ...toPanel.tabs.slice(targetIdx)];

    ws = {
      ...ws,
      panels: {
        ...ws.panels,
        [fromPanelId]: { ...fromPanel, tabs: newFromTabs, activeTabId: newFromActiveTabId },
        [toPanelId]: { ...toPanel, tabs: newToTabs, activeTabId: tab.id },
      },
      focusedPanelId: toPanelId,
    };

    // Close empty panel
    if (newFromTabs.length === 0 && Object.keys(ws.panels).length > 1) {
      ws = closePanelHelper(ws, fromPanelId);
    }
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Update Tab Title ---
  .with(updateTabTitle, (state, { payload: [wsId, tabId, newTitle] }) => {
    const ws = getWorkspaceState(state, wsId);
    for (const [pId, panel] of Object.entries(ws.panels)) {
      const tabIdx = panel.tabs.findIndex((t) => t.id === tabId);
      if (tabIdx >= 0) {
        const newTabs = panel.tabs.map((t, i) => (i === tabIdx ? { ...t, title: newTitle } : t));
        return setWorkspaceState(state, wsId, {
          ...ws,
          panels: { ...ws.panels, [pId]: { ...panel, tabs: newTabs } },
        });
      }
    }
    return state;
  })
  // --- Update Tab Browser URL ---
  .with(updateTabBrowserUrl, (state, { payload: [wsId, tabId, newUrl] }) => {
    const ws = getWorkspaceState(state, wsId);
    for (const [pId, panel] of Object.entries(ws.panels)) {
      const tabIdx = panel.tabs.findIndex((t) => t.id === tabId && t.type === "browser");
      if (tabIdx >= 0) {
        const newTabs = panel.tabs.map((t, i) => (i === tabIdx ? { ...t, browserUrl: newUrl } : t));
        return setWorkspaceState(state, wsId, {
          ...ws,
          panels: { ...ws.panels, [pId]: { ...panel, tabs: newTabs } },
        });
      }
    }
    return state;
  })
  // --- Update Tab Favicon ---
  .with(updateTabFavicon, (state, { payload: [wsId, tabId, faviconUrl] }) => {
    const ws = getWorkspaceState(state, wsId);
    for (const [pId, panel] of Object.entries(ws.panels)) {
      const tabIdx = panel.tabs.findIndex((t) => t.id === tabId && t.type === "browser");
      if (tabIdx >= 0) {
        const newTabs = panel.tabs.map((t, i) => (i === tabIdx ? { ...t, faviconUrl } : t));
        return setWorkspaceState(state, wsId, {
          ...ws,
          panels: { ...ws.panels, [pId]: { ...panel, tabs: newTabs } },
        });
      }
    }
    return state;
  })
  // --- Update File Tab Path ---
  .with(updateFileTabPath, (state, { payload: [wsId, oldPath, newPath] }) => {
    const ws = getWorkspaceState(state, wsId);
    const newFileName = newPath.split("/").pop() || newPath;
    let updated = false;
    const newPanels: Record<string, PanelState> = {};
    for (const [pId, panel] of Object.entries(ws.panels)) {
      const newTabs = panel.tabs.map((t) => {
        if (t.type === "file" && t.filePath === oldPath) {
          updated = true;
          return { ...t, filePath: newPath, title: newFileName };
        }
        return t;
      });
      newPanels[pId] = newTabs !== panel.tabs ? { ...panel, tabs: newTabs } : panel;
    }
    if (!updated) return state;
    return setWorkspaceState(state, wsId, { ...ws, panels: newPanels });
  })
  // --- Close Other Tabs ---
  .with(closeOtherTabs, (state, { payload }) => {
    const { wsId, tabId, panelId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    const targetPanelId = panelId ?? ws.focusedPanelId;
    if (!targetPanelId || !ws.panels[targetPanelId]) return state;
    const panel = ws.panels[targetPanelId];
    if (!panel.tabs.find((t) => t.id === tabId)) return state;

    ws = saveToHistory(ws, timestamp);
    const closed: RecentlyClosedTab[] = panel.tabs
      .filter((t) => t.id !== tabId && t.closable !== false)
      .map((t) => ({ tab: { ...t }, panelId: targetPanelId, closedAt: timestamp }));
    const recentlyClosed = [...closed, ...ws.recentlyClosed].slice(0, MAX_RECENTLY_CLOSED);
    const keptTabs = panel.tabs.filter((t) => t.id === tabId || t.closable === false);

    ws = {
      ...ws,
      panels: { ...ws.panels, [targetPanelId]: { ...panel, tabs: keptTabs, activeTabId: tabId } },
      recentlyClosed,
    };
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Close Tabs To Right ---
  .with(closeTabsToRight, (state, { payload }) => {
    const { wsId, tabId, panelId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    const targetPanelId = panelId ?? ws.focusedPanelId;
    if (!targetPanelId || !ws.panels[targetPanelId]) return state;
    const panel = ws.panels[targetPanelId];
    const tabIndex = panel.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return state;

    ws = saveToHistory(ws, timestamp);
    const closed: RecentlyClosedTab[] = panel.tabs
      .slice(tabIndex + 1)
      .filter((t) => t.closable !== false)
      .map((t) => ({ tab: { ...t }, panelId: targetPanelId, closedAt: timestamp }));
    const recentlyClosed = [...closed, ...ws.recentlyClosed].slice(0, MAX_RECENTLY_CLOSED);
    const keptTabs = panel.tabs.filter((t, i) => i <= tabIndex || t.closable === false);
    const activeTabId = keptTabs.some((t) => t.id === panel.activeTabId)
      ? panel.activeTabId
      : keptTabs[keptTabs.length - 1]?.id ?? null;

    ws = {
      ...ws,
      panels: { ...ws.panels, [targetPanelId]: { ...panel, tabs: keptTabs, activeTabId } },
      recentlyClosed,
    };
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Close All Tabs ---
  .with(closeAllTabs, (state, { payload }) => {
    const { wsId, panelId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    const targetPanelId = panelId ?? ws.focusedPanelId;
    if (!targetPanelId || !ws.panels[targetPanelId]) return state;
    const panel = ws.panels[targetPanelId];

    ws = saveToHistory(ws, timestamp);
    const closed: RecentlyClosedTab[] = panel.tabs
      .filter((t) => t.closable !== false)
      .map((t) => ({ tab: { ...t }, panelId: targetPanelId, closedAt: timestamp }));
    const recentlyClosed = [...closed, ...ws.recentlyClosed].slice(0, MAX_RECENTLY_CLOSED);
    const keptTabs = panel.tabs.filter((t) => t.closable === false);
    const activeTabId = keptTabs[0]?.id ?? null;

    ws = {
      ...ws,
      panels: { ...ws.panels, [targetPanelId]: { ...panel, tabs: keptTabs, activeTabId } },
      recentlyClosed,
    };

    if (keptTabs.length === 0 && Object.keys(ws.panels).length > 1) {
      ws = closePanelHelper(ws, targetPanelId);
    }
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Close All Others Everywhere ---
  .with(closeAllOthersEverywhere, (state, { payload }) => {
    const { wsId, tabId, panelId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    const targetPanelId = panelId ?? ws.focusedPanelId;
    if (!targetPanelId || !ws.panels[targetPanelId]) return state;
    if (!ws.panels[targetPanelId].tabs.find((t) => t.id === tabId)) return state;

    ws = saveToHistory(ws, timestamp);
    let allClosed: RecentlyClosedTab[] = [];

    // Close tabs in other panels
    const newPanels: Record<string, PanelState> = {};
    for (const [pId, panel] of Object.entries(ws.panels)) {
      if (pId === targetPanelId) {
        const closed = panel.tabs
          .filter((t) => t.id !== tabId && t.closable !== false)
          .map((t) => ({ tab: { ...t }, panelId: pId, closedAt: timestamp }));
        allClosed = [...allClosed, ...closed];
        const keptTabs = panel.tabs.filter((t) => t.id === tabId || t.closable === false);
        newPanels[pId] = { ...panel, tabs: keptTabs, activeTabId: tabId };
      } else {
        const closed = panel.tabs
          .filter((t) => t.closable !== false)
          .map((t) => ({ tab: { ...t }, panelId: pId, closedAt: timestamp }));
        allClosed = [...allClosed, ...closed];
        const keptTabs = panel.tabs.filter((t) => t.closable === false);
        newPanels[pId] = { ...panel, tabs: keptTabs, activeTabId: keptTabs[0]?.id ?? null };
      }
    }
    const recentlyClosed = [...allClosed, ...ws.recentlyClosed].slice(0, MAX_RECENTLY_CLOSED);
    ws = { ...ws, panels: newPanels, recentlyClosed };

    // Clean up empty panels
    for (const pId of Object.keys(ws.panels)) {
      if (pId !== targetPanelId && ws.panels[pId].tabs.length === 0) {
        ws = closePanelHelper(ws, pId);
      }
    }
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Focus Panel ---
  .with(focusPanel, (state, { payload: [wsId, panelId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!ws.panels[panelId] || ws.focusedPanelId === panelId) return state;
    return setWorkspaceState(state, wsId, { ...ws, focusedPanelId: panelId });
  })
  // --- Split Panel ---
  .with(splitPanel, (state, { payload }) => {
    const { wsId, panelId, direction, animated, newPanelId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);

    ws = saveToHistory(ws, timestamp);
    ws = { ...ws, expandedPanelId: null, savedSizesBeforeExpand: [] };

    // Create new empty panel
    const newPanel: PanelState = { id: newPanelId, tabs: [], activeTabId: null };
    const initialSizes = animated ? [100, 0] : [50, 50];

    // Find panel node and replace with split
    const findAndReplace = (
      node: PanelLayoutNode,
    ): { found: boolean; replacement: PanelLayoutNode } => {
      if (node.type === "panel" && node.panelId === panelId) {
        return {
          found: true,
          replacement: {
            type: "split",
            direction,
            children: [
              { type: "panel", panelId },
              { type: "panel", panelId: newPanelId },
            ],
            sizes: initialSizes,
          },
        };
      }
      if (node.type === "split") {
        for (let i = 0; i < node.children.length; i++) {
          const result = findAndReplace(node.children[i]);
          if (result.found) {
            const newChildren = [...node.children];
            newChildren[i] = result.replacement;
            return { found: true, replacement: { ...node, children: newChildren } };
          }
        }
      }
      return { found: false, replacement: node };
    };

    const result = findAndReplace(ws.root);
    if (result.found) {
      ws = {
        ...ws,
        root: result.replacement,
        panels: { ...ws.panels, [newPanelId]: newPanel },
        focusedPanelId: newPanelId,
      };
    }
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Close Panel ---
  .with(closePanel, (state, { payload }) => {
    const { wsId, panelId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    ws = saveToHistory(ws, timestamp);
    ws = closePanelHelper(ws, panelId);
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Update Sizes ---
  .with(updateSizes, (state, { payload: [wsId, nodePath, sizes] }) => {
    const ws = getWorkspaceState(state, wsId);
    // Navigate to the node
    const newRoot = JSON.parse(JSON.stringify(ws.root));
    let current = newRoot;
    for (const index of nodePath) {
      if (current.type === "split" && current.children[index]) {
        current = current.children[index];
      } else {
        return state;
      }
    }
    if (current.type === "split") {
      current.sizes = sizes;
      return setWorkspaceState(state, wsId, { ...ws, root: newRoot });
    }
    return state;
  })
  // --- Update Split Sizes ---
  .with(updateSplitSizes, (state, { payload: [wsId, sizes, splitPath] }) => {
    const ws = getWorkspaceState(state, wsId);
    const path = splitPath ?? [];
    const newRoot = JSON.parse(JSON.stringify(ws.root));
    let node = newRoot;
    for (const index of path) {
      if (node.type === "split" && node.children[index]) {
        node = node.children[index];
      } else {
        return state;
      }
    }
    if (node.type === "split") {
      node.sizes = sizes;
      return setWorkspaceState(state, wsId, { ...ws, root: newRoot });
    }
    return state;
  })
  // --- Toggle Expand Panel ---
  .with(toggleExpandPanel, (state, { payload: [wsId, panelId] }) => {
    const ws = getWorkspaceState(state, wsId);
    const newRoot = JSON.parse(JSON.stringify(ws.root)) as PanelLayoutNode;

    if (ws.expandedPanelId === panelId) {
      // Collapse: restore saved sizes
      for (const entry of ws.savedSizesBeforeExpand) {
        const node = getSplitAtPath(newRoot, entry.nodePath);
        if (node && node.type === "split") node.sizes = entry.sizes;
      }
      return setWorkspaceState(state, wsId, {
        ...ws,
        root: newRoot,
        expandedPanelId: null,
        savedSizesBeforeExpand: [],
      });
    }

    // If different panel was expanded, restore first
    if (ws.expandedPanelId !== null) {
      for (const entry of ws.savedSizesBeforeExpand) {
        const node = getSplitAtPath(newRoot, entry.nodePath);
        if (node && node.type === "split") node.sizes = entry.sizes;
      }
    }

    const panelPath = findPanelPath(newRoot, panelId);
    if (!panelPath || panelPath.length === 0) {
      return setWorkspaceState(state, wsId, { ...ws, root: newRoot, expandedPanelId: null, savedSizesBeforeExpand: [] });
    }

    const savedSizes: SavedExpandSizes[] = [];
    let currentNode: PanelLayoutNode = newRoot;
    const currentNodePath: number[] = [];

    for (const childIndex of panelPath) {
      if (currentNode.type === "split") {
        savedSizes.push({ nodePath: [...currentNodePath], sizes: [...currentNode.sizes] });
        const siblingCount = currentNode.children.length - 1;
        const siblingShare = siblingCount > 0 ? (100 - EXPANDED_SHARE) / siblingCount : 0;
        currentNode.sizes = currentNode.sizes.map((_, i) =>
          i === childIndex ? EXPANDED_SHARE : siblingShare,
        );
        currentNodePath.push(childIndex);
        currentNode = currentNode.children[childIndex];
      }
    }

    return setWorkspaceState(state, wsId, {
      ...ws,
      root: newRoot,
      expandedPanelId: panelId,
      savedSizesBeforeExpand: savedSizes,
    });
  })
  // --- Reset Layout ---
  .with(resetLayout, (state, { payload }) => {
    const { wsId, defaultLayout } = payload;
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      ...defaultLayout,
      expandedPanelId: null,
      savedSizesBeforeExpand: [],
    });
  })
  // --- Go Back ---
  .with(goBack, (state, { payload: { wsId, timestamp } }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.historyIndex <= 0 || ws.layoutHistory.length === 0) return state;

    const layoutHistory = [...ws.layoutHistory];
    let historyIndex = ws.historyIndex;

    // If at "live" position, save current state so we can go forward
    if (historyIndex === layoutHistory.length) {
      layoutHistory.push({
        root: JSON.parse(JSON.stringify(ws.root)),
        panels: JSON.parse(JSON.stringify(ws.panels)),
        focusedPanelId: ws.focusedPanelId,
        timestamp,
      });
    }

    historyIndex--;
    const snapshot = layoutHistory[historyIndex];
    if (!snapshot) return state;

    let panels = JSON.parse(JSON.stringify(snapshot.panels)) as Record<string, PanelState>;
    // Strip spec tabs if deferring
    if (ws.deferSpecTab) panels = stripSpecTabs(panels);

    return setWorkspaceState(state, wsId, {
      ...ws,
      root: JSON.parse(JSON.stringify(snapshot.root)),
      panels,
      focusedPanelId: snapshot.focusedPanelId,
      layoutHistory,
      historyIndex,
    });
  })
  // --- Go Forward ---
  .with(goForward, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.historyIndex >= ws.layoutHistory.length - 1) return state;

    const historyIndex = ws.historyIndex + 1;
    const snapshot = ws.layoutHistory[historyIndex];
    if (!snapshot) return state;

    let panels = JSON.parse(JSON.stringify(snapshot.panels)) as Record<string, PanelState>;
    if (ws.deferSpecTab) panels = stripSpecTabs(panels);

    return setWorkspaceState(state, wsId, {
      ...ws,
      root: JSON.parse(JSON.stringify(snapshot.root)),
      panels,
      focusedPanelId: snapshot.focusedPanelId,
      historyIndex,
    });
  })
  // --- Go Back In Focus History ---
  .with(goBackInFocusHistory, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.focusHistoryIndex <= 0) return state;

    // Find previous valid entry
    let idx = ws.focusHistoryIndex - 1;
    while (idx >= 0) {
      const entry = ws.focusHistory[idx];
      if (entry) {
        const panel = ws.panels[entry.panelId];
        if (panel && panel.tabs.some((t) => t.id === entry.tabId)) {
          return setWorkspaceState(state, wsId, {
            ...ws,
            focusedPanelId: entry.panelId,
            panels: {
              ...ws.panels,
              [entry.panelId]: { ...panel, activeTabId: entry.tabId },
            },
            focusHistoryIndex: idx,
          });
        }
      }
      idx--;
    }
    return state;
  })
  // --- Go Forward In Focus History ---
  .with(goForwardInFocusHistory, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.focusHistoryIndex >= ws.focusHistory.length - 1) return state;

    let idx = ws.focusHistoryIndex + 1;
    while (idx < ws.focusHistory.length) {
      const entry = ws.focusHistory[idx];
      if (entry) {
        const panel = ws.panels[entry.panelId];
        if (panel && panel.tabs.some((t) => t.id === entry.tabId)) {
          return setWorkspaceState(state, wsId, {
            ...ws,
            focusedPanelId: entry.panelId,
            panels: {
              ...ws.panels,
              [entry.panelId]: { ...panel, activeTabId: entry.tabId },
            },
            focusHistoryIndex: idx,
          });
        }
      }
      idx++;
    }
    return state;
  })
  // --- Set Defer Spec Tab ---
  .with(setDeferSpecTab, (state, { payload: [wsId, value] }) => {
    let ws = getWorkspaceState(state, wsId);
    ws = { ...ws, deferSpecTab: value };
    if (value) {
      ws = { ...ws, panels: stripSpecTabs(ws.panels) };
    }
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Consume Pending Focus ---
  .with(consumePendingFocus, (state, { payload: [wsId, tabId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.pendingFocusTabId !== tabId) return state;
    return setWorkspaceState(state, wsId, { ...ws, pendingFocusTabId: null });
  })
  // --- Reconcile Stale Agent Tabs ---
  .with(reconcileStaleAgentTabs, (state, { payload: [wsId, validAgentIds, replacementAgentId, replacementTitle] }) => {
    const ws = getWorkspaceState(state, wsId);
    const validSet = new Set(validAgentIds);

    // Check if replacement already exists
    let replacementAlreadyExists = false;
    for (const panel of Object.values(ws.panels)) {
      if (panel.tabs.some((t) => t.type === "agent" && t.agentId === replacementAgentId)) {
        replacementAlreadyExists = true;
        break;
      }
    }

    let hasReplaced = false;
    const newPanels: Record<string, PanelState> = {};
    for (const [pId, panel] of Object.entries(ws.panels)) {
      const newTabs: PanelTab[] = [];
      for (const tab of panel.tabs) {
        if (tab.type === "agent" && tab.agentId && !validSet.has(tab.agentId)) {
          if (!replacementAlreadyExists && !hasReplaced) {
            newTabs.push({ ...tab, agentId: replacementAgentId, title: replacementTitle });
            hasReplaced = true;
          }
          // else: skip (remove) the stale tab
        } else {
          newTabs.push(tab);
        }
      }
      const activeTabId = newTabs.some((t) => t.id === panel.activeTabId)
        ? panel.activeTabId
        : newTabs[0]?.id ?? null;
      newPanels[pId] = { ...panel, tabs: newTabs, activeTabId };
    }
    return setWorkspaceState(state, wsId, { ...ws, panels: newPanels });
  })
  // --- Clear Panel Layout ---
  .with(clearPanelLayout, (state, { payload: [wsId] }) => {
    return clearWorkspaceState(state, wsId);
  })
  // --- Open Tab In Adjacent Or Split ---
  .with(openTabInAdjacentOrSplit, (state, { payload }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { wsId, tab, sourcePanelId, animated, force, newTabId, newPanelId, timestamp } = payload;
    const ws = getWorkspaceState(state, wsId);

    // Spec-note guard — bypass when force is true (user-initiated opens)
    if (ws.deferSpecTab && tab.type === "note" && tab.noteId === "spec" && !force) return state;

    const effectiveSourcePanelId = sourcePanelId ?? ws.focusedPanelId;
    const panelIds = Object.keys(ws.panels);
    const otherPanelId =
      panelIds.length >= 2
        ? panelIds.find((id) => id !== effectiveSourcePanelId) ?? null
        : null;

    if (otherPanelId) {
      // Open in existing other panel
      let result = selfDispatch(state, openTab(wsId, tab, otherPanelId, newTabId, force, timestamp));
      result = selfDispatch(result, focusPanel(wsId, otherPanelId));
      // Set pending focus
      const updatedWs = getWorkspaceState(result, wsId);
      return setWorkspaceState(result, wsId, { ...updatedWs, pendingFocusTabId: newTabId });
    }

    // Need to split
    if (!effectiveSourcePanelId) {
      const result = selfDispatch(state, openTab(wsId, tab, undefined, newTabId, force, timestamp));
      const updatedWs = getWorkspaceState(result, wsId);
      return setWorkspaceState(result, wsId, { ...updatedWs, pendingFocusTabId: newTabId });
    }

    // Split then open in new panel
    let result = selfDispatch(
      state,
      splitPanel(wsId, effectiveSourcePanelId, "horizontal", { animated }, timestamp),
    );
    // The new panel is now focused; open tab there
    result = selfDispatch(result, openTab(wsId, tab, undefined, newTabId, force, timestamp));
    const updatedWs = getWorkspaceState(result, wsId);
    return setWorkspaceState(result, wsId, { ...updatedWs, pendingFocusTabId: newTabId });
  })
  // --- Move Tab To Split ---
  .with(moveTabToSplit, (state, { payload }) => {
    const { wsId, tabId, fromPanelId, targetPanelId, zone, newPanelId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    const fromPanel = ws.panels[fromPanelId];
    if (!fromPanel) return state;
    const tabIndex = fromPanel.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return state;

    ws = saveToHistory(ws, timestamp);
    const direction = zone === "left" || zone === "right" ? "horizontal" : "vertical";
    const insertBefore = zone === "left" || zone === "top";
    const tab = fromPanel.tabs[tabIndex];
    const newFromTabs = fromPanel.tabs.filter((_, i) => i !== tabIndex);
    let newFromActiveTabId = fromPanel.activeTabId;
    if (fromPanel.activeTabId === tabId) {
      newFromActiveTabId = newFromTabs.length > 0 ? newFromTabs[Math.min(tabIndex, newFromTabs.length - 1)].id : null;
    }

    // Create new panel with the tab
    const newPanel: PanelState = { id: newPanelId, tabs: [tab], activeTabId: tab.id };

    // Replace target panel node with split
    const findAndReplace = (node: PanelLayoutNode): { found: boolean; replacement: PanelLayoutNode } => {
      if (node.type === "panel" && node.panelId === targetPanelId) {
        const children = insertBefore
          ? [{ type: "panel" as const, panelId: newPanelId }, node]
          : [node, { type: "panel" as const, panelId: newPanelId }];
        return { found: true, replacement: { type: "split", direction, children, sizes: [50, 50] } };
      }
      if (node.type === "split") {
        const newChildren: PanelLayoutNode[] = [];
        let found = false;
        for (const child of node.children) {
          const result = findAndReplace(child);
          if (result.found) { found = true; newChildren.push(result.replacement); }
          else { newChildren.push(child); }
        }
        return { found, replacement: { ...node, children: newChildren } };
      }
      return { found: false, replacement: node };
    };

    const result = findAndReplace(ws.root);
    ws = {
      ...ws,
      root: result.found ? result.replacement : ws.root,
      panels: {
        ...ws.panels,
        [fromPanelId]: { ...fromPanel, tabs: newFromTabs, activeTabId: newFromActiveTabId },
        [newPanelId]: newPanel,
      },
      focusedPanelId: newPanelId,
    };

    if (newFromTabs.length === 0 && Object.keys(ws.panels).length > 1) {
      ws = closePanelHelper(ws, fromPanelId);
    }
    return setWorkspaceState(state, wsId, ws);
  })
  // --- Move Tab To Split Level ---
  .with(moveTabToSplitLevel, (state, { payload }) => {
    const { wsId, tabId, fromPanelId, splitPath, position, direction, newPanelId, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    const fromPanel = ws.panels[fromPanelId];
    if (!fromPanel) return state;
    const tabIndex = fromPanel.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return state;

    ws = saveToHistory(ws, timestamp);
    const tab = fromPanel.tabs[tabIndex];
    const newFromTabs = fromPanel.tabs.filter((_, i) => i !== tabIndex);
    let newFromActiveTabId = fromPanel.activeTabId;
    if (fromPanel.activeTabId === tabId) {
      newFromActiveTabId = newFromTabs.length > 0 ? newFromTabs[Math.min(tabIndex, newFromTabs.length - 1)].id : null;
    }

    const newPanel: PanelState = { id: newPanelId, tabs: [tab], activeTabId: tab.id };
    const newPanelNode: PanelLayoutNode = { type: "panel", panelId: newPanelId };
    let newRoot = JSON.parse(JSON.stringify(ws.root)) as PanelLayoutNode;

    if (splitPath.length === 0) {
      const children = position === "before" ? [newPanelNode, newRoot] : [newRoot, newPanelNode];
      newRoot = { type: "split", direction, children, sizes: [50, 50] };
    } else {
      let parent: PanelLayoutNode = newRoot;
      for (let i = 0; i < splitPath.length - 1; i++) {
        if (parent.type === "split" && parent.children[splitPath[i]]) {
          parent = parent.children[splitPath[i]];
        } else return state;
      }
      if (parent.type !== "split") return state;
      const targetIndex = splitPath[splitPath.length - 1];
      const targetNode = parent.children[targetIndex];
      if (!targetNode) return state;
      const children = position === "before" ? [newPanelNode, targetNode] : [targetNode, newPanelNode];
      parent.children[targetIndex] = { type: "split", direction, children, sizes: [50, 50] };
    }

    ws = {
      ...ws,
      root: newRoot,
      panels: {
        ...ws.panels,
        [fromPanelId]: { ...fromPanel, tabs: newFromTabs, activeTabId: newFromActiveTabId },
        [newPanelId]: newPanel,
      },
      focusedPanelId: newPanelId,
    };

    if (newFromTabs.length === 0 && Object.keys(ws.panels).length > 1) {
      ws = closePanelHelper(ws, fromPanelId);
    }
    return setWorkspaceState(state, wsId, ws);
  })
  .with(createGridLayout, (state, { payload }) => {
    const { wsId, panelCount, panelIds, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    ws = saveToHistory(ws, timestamp);
    const count = panelCount; // already clamped in action creator

    const newPanels: Record<string, PanelState> = {};
    const usedIds = panelIds.slice(0, count);
    for (const id of usedIds) {
      newPanels[id] = { id, tabs: [], activeTabId: null };
    }

    let root: PanelLayoutNode;
    if (count === 1) {
      root = { type: "panel", panelId: usedIds[0] };
    } else if (count === 2) {
      root = { type: "split", direction: "horizontal", children: usedIds.map(id => ({ type: "panel" as const, panelId: id })), sizes: [50, 50] };
    } else if (count === 3) {
      root = { type: "split", direction: "horizontal", children: usedIds.map(id => ({ type: "panel" as const, panelId: id })), sizes: [33.33, 33.34, 33.33] };
    } else if (count === 4) {
      root = {
        type: "split", direction: "vertical", children: [
          { type: "split", direction: "horizontal", children: [{ type: "panel", panelId: usedIds[0] }, { type: "panel", panelId: usedIds[1] }], sizes: [50, 50] },
          { type: "split", direction: "horizontal", children: [{ type: "panel", panelId: usedIds[2] }, { type: "panel", panelId: usedIds[3] }], sizes: [50, 50] },
        ], sizes: [50, 50],
      };
    } else {
      // 5-6: top row 3, bottom row remainder
      const topIds = usedIds.slice(0, 3);
      const bottomIds = usedIds.slice(3);
      const topSizes = topIds.map(() => 100 / topIds.length);
      const bottomSizes = bottomIds.map(() => 100 / bottomIds.length);
      root = {
        type: "split", direction: "vertical", children: [
          { type: "split", direction: "horizontal", children: topIds.map(id => ({ type: "panel" as const, panelId: id })), sizes: topSizes },
          { type: "split", direction: "horizontal", children: bottomIds.map(id => ({ type: "panel" as const, panelId: id })), sizes: bottomSizes },
        ], sizes: [50, 50],
      };
    }

    ws = { ...ws, root, panels: newPanels, focusedPanelId: usedIds[0] };
    return setWorkspaceState(state, wsId, ws);
  })
  .with(applyPreset, (state, { payload }) => {
    const { wsId, preset, panelIds, timestamp } = payload;
    let ws = getWorkspaceState(state, wsId);
    ws = saveToHistory(ws, timestamp);

    const newPanels: Record<string, PanelState> = {};
    let root: PanelLayoutNode;
    if (preset === "single") {
      const id = panelIds[0];
      newPanels[id] = { id, tabs: [], activeTabId: null };
      root = { type: "panel", panelId: id };
    } else if (preset === "split-horizontal") {
      const ids = [panelIds[0], panelIds[1]];
      ids.forEach(id => { newPanels[id] = { id, tabs: [], activeTabId: null }; });
      root = { type: "split", direction: "horizontal", children: ids.map(id => ({ type: "panel" as const, panelId: id })), sizes: [50, 50] };
    } else if (preset === "split-vertical") {
      const ids = [panelIds[0], panelIds[1]];
      ids.forEach(id => { newPanels[id] = { id, tabs: [], activeTabId: null }; });
      root = { type: "split", direction: "vertical", children: ids.map(id => ({ type: "panel" as const, panelId: id })), sizes: [50, 50] };
    } else {
      // three-column
      const ids = [panelIds[0], panelIds[1], panelIds[2]];
      ids.forEach(id => { newPanels[id] = { id, tabs: [], activeTabId: null }; });
      root = { type: "split", direction: "horizontal", children: ids.map(id => ({ type: "panel" as const, panelId: id })), sizes: [33.33, 33.34, 33.33] };
    }

    ws = { ...ws, root, panels: newPanels, focusedPanelId: panelIds[0] };
    return setWorkspaceState(state, wsId, ws);
  });

// Wire up the mutable reference for recursive dispatch
_reducerRef = panelLayoutReducer;