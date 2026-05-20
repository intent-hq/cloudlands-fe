/**
 * Panel Layout Selectors
 *
 * Derived state selectors for the panel layout slice.
 */

import { store } from "../../store";
import { emptyWorkspaceState } from "./panel-layout-slice";
import type {
  WorkspacePanelLayoutState,
  PanelLayoutNode,
  PanelLayoutRestoreStatus,
  PanelState,
  PanelTab,
  RecentlyClosedTab,
  LayoutSnapshot,
  FocusHistoryEntry,
} from "./panel-layout-types";

const emptyFileContentPrunePaths: string[] = [];

function isValidActiveWorkspaceId(wsId: string | null | undefined): wsId is string {
  return !!wsId && wsId !== "new" && !wsId.startsWith("optimistic-") && wsId !== "undefined";
}

// ============================================================================
// Workspace State
// ============================================================================

/** Select the full per-workspace panel layout state */
export const selectPanelLayoutWorkspace = store.createSelector<[wsId: string], WorkspacePanelLayoutState>(
  (state, wsId) => state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState,
);

// ============================================================================
// Layout Tree
// ============================================================================

/** Select the root layout node */
export const selectPanelLayoutRoot = store.createSelector<[wsId: string], PanelLayoutNode>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).root,
);

/** Select all panels */
export const selectPanels = store.createSelector<[wsId: string], Record<string, PanelState>>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).panels,
);

/** Select a specific panel by ID */
export const selectPanel = store.createSelector<[wsId: string, panelId: string], PanelState | undefined>(
  (state, wsId, panelId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).panels[panelId],
);

/** Select focused panel ID */
export const selectFocusedPanelId = store.createSelector<[wsId: string], string | null>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).focusedPanelId,
);

/** Select the focused panel state */
export const selectFocusedPanel = store.createSelector<[wsId: string], PanelState | undefined>(
  (state, wsId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return ws.focusedPanelId ? ws.panels[ws.focusedPanelId] : undefined;
  },
);

/** Select the per-workspace restore lifecycle status */
export const selectRestoreStatus = store.createSelector<[wsId: string], PanelLayoutRestoreStatus>(
  (state, wsId) => (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).restoreStatus,
);

/** Select whether the layout has multiple panels */
export const selectHasMultiplePanels = store.createSelector<[wsId: string], boolean>(
  (state, wsId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return Object.keys(ws.panels).length > 1;
  },
);

// ============================================================================
// Tab Selectors
// ============================================================================

/** Select the active tab in the focused panel */
export const selectActiveTab = store.createSelector<[wsId: string], PanelTab | undefined>(
  (state, wsId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    if (!ws.focusedPanelId) return undefined;
    const panel = ws.panels[ws.focusedPanelId];
    if (!panel || !panel.activeTabId) return undefined;
    return panel.tabs.find((t) => t.id === panel.activeTabId);
  },
);

/** Select the active tab in a specific panel */
export const selectActiveTabInPanel = store.createSelector<
  [wsId: string, panelId: string],
  PanelTab | undefined
>((state, wsId, panelId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  const panel = ws.panels[panelId];
  if (!panel || !panel.activeTabId) return undefined;
  return panel.tabs.find((t) => t.id === panel.activeTabId);
});

/** Select all tabs across all panels (flattened) */
export const selectAllTabs = store.createSelector<[wsId: string], PanelTab[]>((state, wsId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  return Object.values(ws.panels).flatMap((p) => p.tabs);
});

/** Find a tab by ID across all panels. Returns [panelId, tab] or undefined. */
export const selectTabById = store.createSelector<
  [wsId: string, tabId: string],
  { panelId: string; tab: PanelTab } | undefined
>((state, wsId, tabId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  for (const [panelId, panel] of Object.entries(ws.panels)) {
    const tab = panel.tabs.find((t) => t.id === tabId);
    if (tab) return { panelId, tab };
  }
  return undefined;
});

/** Check if a specific note is open in any panel */
export const selectIsNoteOpen = store.createSelector<[wsId: string, noteId: string], boolean>(
  (state, wsId, noteId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return Object.values(ws.panels).some((p) =>
      p.tabs.some((t) => t.type === "note" && t.noteId === noteId),
    );
  },
);

/** Check if a specific file is open in any panel */
export const selectIsFileOpen = store.createSelector<[wsId: string, filePath: string], boolean>(
  (state, wsId, filePath) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return Object.values(ws.panels).some((p) =>
      p.tabs.some((t) => t.type === "file" && t.filePath === filePath),
    );
  },
);

/** Select active-workspace file-content paths no longer represented by any open file tab. */
export const selectFileContentPrunePayload = store.createSelector((state): string[] => {
  const activeWsId = state.workspace.activeWorkspaceId;
  if (!isValidActiveWorkspaceId(activeWsId)) {
    return emptyFileContentPrunePaths;
  }

  const ws = state.panelLayout.byWorkspaceId[activeWsId];
  const filesWorkspace = state.files.byWorkspaceId[activeWsId];
  if (!ws || !filesWorkspace) {
    return emptyFileContentPrunePaths;
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
    return emptyFileContentPrunePaths;
  }

  stalePaths.sort((left, right) => left.localeCompare(right));
  return stalePaths;
});

/** Get all panel IDs */
export const selectPanelIds = store.createSelector<[wsId: string], string[]>(
  (state, wsId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return Object.keys(ws.panels);
  },
);



// ============================================================================
// History Selectors
// ============================================================================

/** Select recently closed tabs */
export const selectRecentlyClosed = store.createSelector<[wsId: string], RecentlyClosedTab[]>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).recentlyClosed,
);

/** Select whether there are any recently closed tabs */
export const selectHasRecentlyClosed = store.createSelector<[wsId: string], boolean>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).recentlyClosed.length > 0,
);

/** Select layout history snapshots */
export const selectLayoutHistory = store.createSelector<[wsId: string], LayoutSnapshot[]>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).layoutHistory,
);

/** Select current history index */
export const selectHistoryIndex = store.createSelector<[wsId: string], number>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).historyIndex,
);

/** Whether layout history has been loaded from disk */
export const selectHistoryLoaded = store.createSelector<[wsId: string], boolean>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).historyLoaded,
);

/** Select whether we can go back in layout history */
export const selectCanGoBack = store.createSelector<[wsId: string], boolean>((state, wsId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  return ws.historyIndex > 0 && ws.layoutHistory.length > 0;
});

/** Select whether we can go forward in layout history */
export const selectCanGoForward = store.createSelector<[wsId: string], boolean>((state, wsId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  return ws.historyIndex < ws.layoutHistory.length - 1;
});

// ============================================================================
// Focus History Selectors
// ============================================================================

/** Select focus history entries */
export const selectFocusHistory = store.createSelector<[wsId: string], FocusHistoryEntry[]>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).focusHistory,
);

/** Select current focus history index */
export const selectFocusHistoryIndex = store.createSelector<[wsId: string], number>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).focusHistoryIndex,
);

// ============================================================================
// Expand / Defer / Pending Focus
// ============================================================================

/** Select the currently expanded panel ID */
export const selectExpandedPanelId = store.createSelector<[wsId: string], string | null>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).expandedPanelId,
);

/** Select whether spec tab is being deferred */
export const selectDeferSpecTab = store.createSelector<[wsId: string], boolean>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).deferSpecTab,
);

/** Select pending focus tab ID */
export const selectPendingFocusTabId = store.createSelector<[wsId: string], string | null>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).pendingFocusTabId,
);

// ============================================================================
// Compatibility helpers (for use in non-component code like sagas)
// ============================================================================

/**
 * Get the workspace panel layout state from the store state.
 * Use this for direct state reads in sagas/callbacks instead of selectors.
 */
export function getWorkspacePanelLayout(
  state: { panelLayout: { byWorkspaceId: Record<string, WorkspacePanelLayoutState> } },
  wsId: string,
): WorkspacePanelLayoutState {
  return state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}