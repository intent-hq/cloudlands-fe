/**
 * Panel Layout Selectors
 *
 * Derived state selectors for the panel layout slice.
 */

import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';
import { emptyWorkspaceState, isRecentlyClosedPanelColumnRestorable } from './panel-layout-slice';
import {
  countHorizontalPanelColumns,
  getAutomaticPanelLayoutCanvasWidth,
  getHorizontalPanelColumnDefaultWidthTiers,
  getPanelOrder,
} from './panel-layout-tabless';
import { panelTabsAreEquivalent } from './panel-tab-identity';
import type { PanelDefaultWidthTier } from '../../../../shared/panel-layout-sizing';
import type {
  WorkspacePanelLayoutState,
  PanelLayoutNode,
  PanelLayoutRestoreStatus,
  PanelState,
  PanelTab,
  PanelTabType,
  RecentlyClosedTab,
  RecentlyClosedPanelColumn,
  PanelColumnCount,
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

export const selectPendingPanelReveal = store.createSelector((state, wsId: string) => {
  const workspace = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  return workspace.pendingPanelReveal ?? null;
});

export type PanelTabIdentityRequest = Pick<PanelTab, 'type'> &
  Partial<Omit<PanelTab, 'id' | 'type'>>;

export interface PanelTabOpenState {
  count: number;
  isOpen: boolean;
  isActive: boolean;
  isOpenElsewhere: boolean;
}

const closedPanelTabState: PanelTabOpenState = {
  count: 0,
  isOpen: false,
  isActive: false,
  isOpenElsewhere: false,
};

export function getPanelTabOpenState(
  tabs: PanelTab[],
  activeTab: PanelTab | null | undefined,
  workspaceId: string,
  requested: PanelTabIdentityRequest,
): PanelTabOpenState {
  if (requested.workspaceId && requested.workspaceId !== workspaceId) return closedPanelTabState;
  const identity = requested as Omit<PanelTab, 'id'>;
  const matches = tabs.filter(
    (tab) =>
      (!tab.workspaceId || tab.workspaceId === workspaceId) &&
      panelTabsAreEquivalent(tab, identity),
  );
  if (matches.length === 0) return closedPanelTabState;
  const isActive =
    !!activeTab &&
    (!activeTab.workspaceId || activeTab.workspaceId === workspaceId) &&
    panelTabsAreEquivalent(activeTab, identity);
  return {
    count: matches.length,
    isOpen: true,
    isActive,
    isOpenElsewhere: !isActive,
  };
}

/** Select workspace layouts by ID for post-reducer reference checks. */
export const selectPanelLayoutWorkspaces = store.createSelector(
  (state) => state.panelLayout.byWorkspaceId,
);

// ============================================================================
// Layout Tree
// ============================================================================

/** Select the root layout node */
export const selectPanelLayoutRoot = store.createSelector<[wsId: string], PanelLayoutNode>(
  (state, wsId) => (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).root,
);

/** Select the session-only panel whose rendered width owns the live remainder. */
export const selectExpandedPanelId = store.createSelector<[wsId: string], string | null>(
  (state, wsId) => (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).expandedPanelId,
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

/** Most recently focused agent tab, ignoring later browser/tool focus and stale history entries. */
export const selectMostRecentAgentTab = store.createSelector<[wsId: string], PanelTab | undefined>(
  (state, wsId) => {
    const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    for (let index = ws.focusHistory.length - 1; index >= 0; index -= 1) {
      const entry = ws.focusHistory[index];
      const tab = ws.panels[entry.panelId]?.tabs.find((candidate) => candidate.id === entry.tabId);
      if (tab?.type === 'agent') return tab;
    }
    return undefined;
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

/** Hidden (user-closed) agent-owned browser tabs, kept alive offscreen (monorepo#2857). */
export const selectHiddenTabs = store.createSelector<[wsId: string], PanelTab[]>((state, wsId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  // Pre-#2857 persisted/test states may lack the field.
  return getItems(ws.hiddenTabs ?? emptyWorkspaceState.hiddenTabs);
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

export const selectPanelColumnDefaultWidthTiers = store.createSelector<
  [wsId: string],
  PanelDefaultWidthTier[]
>((state, wsId) => {
  const layout = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  return getHorizontalPanelColumnDefaultWidthTiers(layout.root, layout.panels);
});

export const selectPanelCanvasWidthsByWorkspaceId = store.createSelector((state) => {
  return Object.fromEntries(
    Object.entries(state.panelLayout.byWorkspaceId).map(([workspaceId, layout]) => [
      workspaceId,
      layout.canvasWidth ??
        getAutomaticPanelLayoutCanvasWidth(layout.root, layout.panels, 'content'),
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

export const selectPanelCanvasWidthSource = store.createSelector<
  [wsId: string],
  WorkspacePanelLayoutState['canvasWidthSource']
>(
  (state, wsId) => (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).canvasWidthSource,
);

/** Select the horizontal column count for one mounted layout scope. */
export const selectPanelColumnCount = store.createSelector<[wsId: string], PanelColumnCount>(
  (state, wsId) => {
    const layout = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
    return layout.columnCount;
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
export const selectFileContentPrunePayload = store.createSelector<
  [activeWsId: string | null, clearLayout?: boolean],
  string[]
>((state, activeWsId, clearLayout = false) => {
  if (!isValidActiveWorkspaceId(activeWsId)) {
    return emptyFileContentPrunePaths;
  }

  const ws = state.panelLayout.byWorkspaceId[activeWsId];
  const filesWorkspace = state.files.byWorkspaceId[activeWsId];
  if (!filesWorkspace) {
    return emptyFileContentPrunePaths;
  }
  if (!ws) {
    if (!clearLayout) return emptyFileContentPrunePaths;
    return [...filesWorkspace.files.ids].sort((left, right) => left.localeCompare(right));
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

/** Get all panel IDs in canonical rendered order. */
export const selectPanelIds = store.createSelector<[wsId: string], string[]>((state, wsId) => {
  const ws = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  return getPanelOrder(ws.root);
});

export interface PanelColumnStack {
  panelId: string;
  panes: PanelTab[];
  activePaneId: string | null;
  attentionPaneIds: string[];
}

function getPanelColumnStacks(layout: WorkspacePanelLayoutState): PanelColumnStack[] {
  return getPanelOrder(layout.root).flatMap((panelId) => {
    const panel = layout.panels[panelId];
    if (!panel) return [];
    return [
      {
        panelId,
        panes: panel.tabs,
        activePaneId: panel.activeTabId,
        attentionPaneIds: panel.attentionTabIds ?? [],
      },
    ];
  });
}

/** Ordered pane stacks for every workspace panel layout. */
export const selectPanelColumnStacks = store.createSelector<[wsId: string], PanelColumnStack[]>(
  (state, wsId) =>
    getPanelColumnStacks(state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState),
);

/** Pane stack for one workspace panel layout. */
export const selectPanelColumnStack = store.createSelector<
  [wsId: string, panelId: string],
  PanelColumnStack | undefined
>((state, wsId, panelId) =>
  getPanelColumnStacks(state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).find(
    (stack) => stack.panelId === panelId,
  ),
);

function getPanelNavigatorItems(layout: WorkspacePanelLayoutState) {
  return getPanelOrder(layout.root).flatMap((panelId) => {
    const panel = layout.panels[panelId];
    if (!panel) return [];
    const activeTab = panel.tabs.find((tab) => tab.id === panel.activeTabId);
    const navigatorTab = activeTab ?? panel.tabs[0];
    return [{ id: panelId, title: navigatorTab?.title ?? '', type: navigatorTab?.type }];
  });
}

/** Generic panel order and titles for proportional navigation surfaces. */
export const selectPanelNavigatorItems = store.createSelector<
  [wsId: string],
  { id: string; title: string; type?: PanelTabType }[]
>((state, wsId) =>
  getPanelNavigatorItems(state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState),
);

// ============================================================================
// History Selectors
// ============================================================================

/** Select recently closed tabs */
export const selectRecentlyClosed = store.createSelector<[wsId: string], RecentlyClosedTab[]>(
  (state, wsId) => (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).recentlyClosed,
);

/** Select the newest column close that can be applied to the current layout. */
export const selectLastClosedPanelColumn = store.createSelector<
  [wsId: string],
  RecentlyClosedPanelColumn | null
>((state, wsId) => {
  const workspace = state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;
  return (
    getItems(
      workspace.recentlyClosedColumns ??
        createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId'),
    ).find((closed) => isRecentlyClosedPanelColumnRestorable(workspace, closed)) ?? null
  );
});

/** Select whether the newest restorable panel close was a column or a tab. */
export const selectLastPanelClose = store.createSelector<
  [wsId: string],
  { kind: 'column' | 'tab'; closedAt: number } | null
>((state, wsId) => {
  const lastClosedPanelTab = selectRecentlyClosed.select(state, wsId)[0] ?? null;
  const lastClosedPanelColumn = selectLastClosedPanelColumn.select(state, wsId);
  return lastClosedPanelColumn &&
    (!lastClosedPanelTab || lastClosedPanelColumn.closedAt >= lastClosedPanelTab.closedAt)
    ? { kind: 'column', closedAt: lastClosedPanelColumn.closedAt }
    : lastClosedPanelTab
      ? { kind: 'tab', closedAt: lastClosedPanelTab.closedAt }
      : null;
});
