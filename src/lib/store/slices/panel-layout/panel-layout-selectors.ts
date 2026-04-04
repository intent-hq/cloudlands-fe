/**
 * Panel Layout Selectors
 *
 * Derived state selectors for the panel layout slice.
 */

import { createSelector } from "../../utils/create-selector";
import { emptyWorkspaceState } from "./panel-layout-slice";
import type {
  WorkspacePanelLayoutState,
  PanelLayoutNode,
  PanelState,
  PanelTab,
  RecentlyClosedTab,
  LayoutSnapshot,
  FocusHistoryEntry,
} from "./panel-layout-types";

// ============================================================================
// Workspace State
// ============================================================================

/** Select the full per-workspace panel layout state */
export const selectPanelLayoutWorkspace = createSelector<[wsId: string], WorkspacePanelLayoutState>(
  (state, wsId) => state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState,
);

// ============================================================================
// Layout Tree
// ============================================================================

/** Select the root layout node */
export const selectPanelLayoutRoot = createSelector<[wsId: string], PanelLayoutNode>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).root,
);

/** Select all panels */
export const selectPanels = createSelector<[wsId: string], Record<string, PanelState>>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).panels,
);

/** Select a specific panel by ID */
export const selectPanel = createSelector<[wsId: string, panelId: string], PanelState | undefined>(
  (state, wsId, panelId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).panels[panelId],
);

/** Select focused panel ID */
export const selectFocusedPanelId = createSelector<[wsId: string], string | null>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).focusedPanelId,
);

/** Select the focused panel state */
export const selectFocusedPanel = createSelector<[wsId: string], PanelState | undefined>(
  (state, wsId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return ws.focusedPanelId ? ws.panels[ws.focusedPanelId] : undefined;
  },
);

/** Select whether the layout has multiple panels */
export const selectHasMultiplePanels = createSelector<[wsId: string], boolean>(
  (state, wsId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return Object.keys(ws.panels).length > 1;
  },
);

// ============================================================================
// Tab Selectors
// ============================================================================

/** Select the active tab in the focused panel */
export const selectActiveTab = createSelector<[wsId: string], PanelTab | undefined>(
  (state, wsId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    if (!ws.focusedPanelId) return undefined;
    const panel = ws.panels[ws.focusedPanelId];
    if (!panel || !panel.activeTabId) return undefined;
    return panel.tabs.find((t) => t.id === panel.activeTabId);
  },
);

/** Select the active tab in a specific panel */
export const selectActiveTabInPanel = createSelector<
  [wsId: string, panelId: string],
  PanelTab | undefined
>((state, wsId, panelId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  const panel = ws.panels[panelId];
  if (!panel || !panel.activeTabId) return undefined;
  return panel.tabs.find((t) => t.id === panel.activeTabId);
});

/** Select all tabs across all panels (flattened) */
export const selectAllTabs = createSelector<[wsId: string], PanelTab[]>((state, wsId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  return Object.values(ws.panels).flatMap((p) => p.tabs);
});

/** Find a tab by ID across all panels. Returns [panelId, tab] or undefined. */
export const selectTabById = createSelector<
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
export const selectIsNoteOpen = createSelector<[wsId: string, noteId: string], boolean>(
  (state, wsId, noteId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return Object.values(ws.panels).some((p) =>
      p.tabs.some((t) => t.type === "note" && t.noteId === noteId),
    );
  },
);

/** Check if a specific file is open in any panel */
export const selectIsFileOpen = createSelector<[wsId: string, filePath: string], boolean>(
  (state, wsId, filePath) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return Object.values(ws.panels).some((p) =>
      p.tabs.some((t) => t.type === "file" && t.filePath === filePath),
    );
  },
);

/** Get all panel IDs */
export const selectPanelIds = createSelector<[wsId: string], string[]>(
  (state, wsId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return Object.keys(ws.panels);
  },
);



// ============================================================================
// History Selectors
// ============================================================================

/** Select recently closed tabs */
export const selectRecentlyClosed = createSelector<[wsId: string], RecentlyClosedTab[]>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).recentlyClosed,
);

/** Select whether there are any recently closed tabs */
export const selectHasRecentlyClosed = createSelector<[wsId: string], boolean>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).recentlyClosed.length > 0,
);

/** Select layout history snapshots */
export const selectLayoutHistory = createSelector<[wsId: string], LayoutSnapshot[]>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).layoutHistory,
);

/** Select current history index */
export const selectHistoryIndex = createSelector<[wsId: string], number>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).historyIndex,
);

/** Whether layout history has been loaded from disk */
export const selectHistoryLoaded = createSelector<[wsId: string], boolean>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).historyLoaded,
);

/** Select whether we can go back in layout history */
export const selectCanGoBack = createSelector<[wsId: string], boolean>((state, wsId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  return ws.historyIndex > 0 && ws.layoutHistory.length > 0;
});

/** Select whether we can go forward in layout history */
export const selectCanGoForward = createSelector<[wsId: string], boolean>((state, wsId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  return ws.historyIndex < ws.layoutHistory.length - 1;
});

// ============================================================================
// Focus History Selectors
// ============================================================================

/** Select focus history entries */
export const selectFocusHistory = createSelector<[wsId: string], FocusHistoryEntry[]>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).focusHistory,
);

/** Select current focus history index */
export const selectFocusHistoryIndex = createSelector<[wsId: string], number>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).focusHistoryIndex,
);

// ============================================================================
// Expand / Defer / Pending Focus
// ============================================================================

/** Select the currently expanded panel ID */
export const selectExpandedPanelId = createSelector<[wsId: string], string | null>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).expandedPanelId,
);

/** Select whether spec tab is being deferred */
export const selectDeferSpecTab = createSelector<[wsId: string], boolean>(
  (state, wsId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).deferSpecTab,
);

/** Select pending focus tab ID */
export const selectPendingFocusTabId = createSelector<[wsId: string], string | null>(
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
  storeState: { panelLayout: { byWorkspaceId: Record<string, WorkspacePanelLayoutState> } },
  wsId: string,
): WorkspacePanelLayoutState {
  return storeState.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}