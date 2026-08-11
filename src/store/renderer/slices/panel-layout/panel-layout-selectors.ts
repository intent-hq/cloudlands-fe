/**
 * Panel Layout Selectors
 *
 * Derived state selectors for the panel layout slice.
 */

import { store } from '../../store';
import { emptyWorkspaceState } from './panel-layout-slice';
import { countHorizontalPanelColumns, DEFAULT_PANEL_COLUMN_WIDTH } from './panel-layout-tabless';
import type {
  WorkspacePanelLayoutState,
  PanelLayoutNode,
  PanelLayoutRestoreStatus,
  PanelState,
  PanelTab,
  RecentlyClosedTab,
} from './panel-layout-types';

const emptyFileContentPrunePaths: string[] = [];

function isValidActiveWorkspaceId(wsId: string | null | undefined): wsId is string {
  return !!wsId && wsId !== 'new' && !wsId.startsWith('optimistic-') && wsId !== 'undefined';
}

// ============================================================================
// Workspace State
// ============================================================================

/** Select the full per-workspace panel layout state */
export const selectPanelLayoutWorkspace = store.createSelector<
  [wsId: string],
  WorkspacePanelLayoutState
>((state, wsId) => state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState);

// ============================================================================
// Layout Tree
// ============================================================================

/** Select the root layout node */
export const selectPanelLayoutRoot = store.createSelector<[wsId: string], PanelLayoutNode>(
  (state, wsId) => (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).root,
);

/** Select all panels */
export const selectPanels = store.createSelector<[wsId: string], Record<string, PanelState>>(
  (state, wsId) => (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).panels,
);

/** Select a specific panel by ID */
export const selectPanel = store.createSelector<
  [wsId: string, panelId: string],
  PanelState | undefined
>(
  (state, wsId, panelId) =>
    (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).panels[panelId],
);

/** Select focused panel ID */
export const selectFocusedPanelId = store.createSelector<[wsId: string], string | null>(
  (state, wsId) => (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).focusedPanelId,
);

/** Select the focused panel state */
export const selectFocusedPanel = store.createSelector<[wsId: string], PanelState | undefined>(
  (state, wsId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return ws.focusedPanelId ? ws.panels[ws.focusedPanelId] : undefined;
  },
);

/** Focused panel + active tab per layout, for cross-layout navigation surfaces. */
export const selectFocusedPanelTargetsByWorkspaceId = store.createSelector((state) =>
  Object.fromEntries(
    Object.entries(state.panelLayout.byWorkspaceId).map(([workspaceId, layout]) => {
      const panelId = layout.focusedPanelId;
      const panel = panelId ? layout.panels[panelId] : undefined;
      return [
        workspaceId,
        {
          panelId: panel ? panelId : null,
          activeTabId: panel?.activeTabId ?? null,
        },
      ];
    }),
  ),
);

/** Select the per-workspace restore lifecycle status */
export const selectRestoreStatus = store.createSelector<[wsId: string], PanelLayoutRestoreStatus>(
  (state, wsId) => (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).restoreStatus,
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

export const selectPanelTabCountsByWorkspaceId = store.createSelector((state) => {
  return Object.fromEntries(
    Object.entries(state.panelLayout.byWorkspaceId).map(([workspaceId, layout]) => [
      workspaceId,
      Object.values(layout.panels).reduce((count, panel) => count + panel.tabs.length, 0),
    ]),
  );
});

/** Select visible horizontal panel-column counts for workspace width reservation. */
export const selectPanelColumnCountsByWorkspaceId = store.createSelector((state) => {
  return Object.fromEntries(
    Object.entries(state.panelLayout.byWorkspaceId).map(([workspaceId, layout]) => {
      const hasVisibleContent = Object.values(layout.panels).some((panel) => panel.tabs.length > 0);
      return [workspaceId, hasVisibleContent ? countHorizontalPanelColumns(layout.root) : 0];
    }),
  );
});

export const selectPanelCanvasWidthsByWorkspaceId = store.createSelector((state) => {
  return Object.fromEntries(
    Object.entries(state.panelLayout.byWorkspaceId).map(([workspaceId, layout]) => [
      workspaceId,
      layout.canvasWidth ?? countHorizontalPanelColumns(layout.root) * DEFAULT_PANEL_COLUMN_WIDTH,
    ]),
  );
});

/**
 * Select the persisted canvas width for a workspace, or `null` when the user
 * has not resized the canvas yet. Consumers use `null` to fall back to a
 * viewport-derived default (e.g. filling the viewport in tab mode).
 */
export const selectPanelCanvasWidth = store.createSelector<[wsId: string], number | null>(
  (state, wsId) => (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).canvasWidth,
);

/** Select the horizontal column count for one mounted layout scope. */
export const selectPanelColumnCount = store.createSelector<[wsId: string], number>(
  (state, wsId) => {
    const layout = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return countHorizontalPanelColumns(layout.root);
  },
);

/** Select restore lifecycle status for every mounted panel-layout scope. */
export const selectPanelRestoreStatusesByWorkspaceId = store.createSelector((state) => {
  return Object.fromEntries(
    Object.entries(state.panelLayout.byWorkspaceId).map(([workspaceId, layout]) => [
      workspaceId,
      layout.restoreStatus,
    ]),
  );
});

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
      if (tab.type === 'file' && typeof tab.filePath === 'string' && tab.filePath.length > 0) {
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
export const selectPanelIds = store.createSelector<[wsId: string], string[]>((state, wsId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  return Object.keys(ws.panels);
});

// ============================================================================
// History Selectors
// ============================================================================

/** Select recently closed tabs */
export const selectRecentlyClosed = store.createSelector<[wsId: string], RecentlyClosedTab[]>(
  (state, wsId) => (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).recentlyClosed,
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
