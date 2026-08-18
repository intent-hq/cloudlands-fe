/**
 * Panel Layout Slice
 *
 * Manages panel layout state (tabs, splits, focus, history) per workspace.
 * Migrated from features/layout/panel-layout-manager.svelte.ts
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  addItem,
  addItems,
  createCollection,
  getItem,
  getItems,
  removeItem,
  replaceItem,
  updateItem,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { removeTerminal } from '../terminals/terminals-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
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
  PanelDragLayoutSnapshot,
  PanelRevealRequest,
} from './panel-layout-types';
import { MAX_RECENTLY_CLOSED, MAX_LAYOUT_HISTORY, MAX_FOCUS_HISTORY } from './panel-layout-types';
import {
  getDominantPanelCanvasWidth,
  getDominantSplitGeometry,
  snapshotPanelSplitSizes,
} from './panel-dominant-expansion';
import {
  movePanelInLayout,
  movePanelToRootEdgeInLayout,
  countHorizontalPanelColumns,
  getAutomaticPanelLayoutCanvasWidth,
  getPanelOrder,
  appendHorizontalPanelToLayout,
  insertHorizontalPanelInLayout,
  removePanelPreservingHorizontalWidths,
  resizeRootHorizontalPanel,
  resizePanelTreeRightEdge,
  type PanelMovePosition,
} from './panel-layout-tabless';
import {
  canUseWideFirstChatLayout,
  DEFAULT_CHAT_PANEL_WIDTH,
  DEFAULT_MEDIUM_PANEL_WIDTH,
  DEFAULT_PANEL_WIDTH,
  getAutomaticPanelCanvasWidth,
  getWideFirstChatSizes,
  PANEL_SPLIT_GUTTER_WIDTH,
} from '../../../../shared/panel-layout-sizing';
import { getPanelCreationWidthForType } from '../../../../shared/panel-default-width-tiers';
import {
  initializePanelCanvasWidth,
  resolveIntrinsicPanelCanvasWidth,
  resolveUserPanelCanvasResize,
} from './panel-layout-width-provenance';
import { findEquivalentPanelTab, type EquivalentPanelTab } from './panel-tab-identity';
import type { PanelColumnCount } from '../user-preferences/user-preferences-slice';
import { rebaseRequestedUrlForNavigation } from './browser-tab-rehydration';

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
  'root' | 'panels' | 'focusedPanelId' | 'canvasWidth' | 'canvasWidthSource'
> {
  const panelId = generatePanelId();
  return {
    root: { type: 'panel', panelId },
    panels: {
      [panelId]: { id: panelId, tabs: [], activeTabId: null },
    },
    focusedPanelId: panelId,
    canvasWidth: null,
    canvasWidthSource: null,
  };
}

export const emptyWorkspaceState: WorkspacePanelLayoutState = {
  root: { type: 'panel', panelId: 'default' },
  panels: { default: { id: 'default', tabs: [], activeTabId: null } },
  focusedPanelId: 'default',
  canvasWidth: null,
  canvasWidthSource: null,
  hiddenTabs: createCollection('id'),
  restoreStatus: 'idle',
  pendingFocusTabId: null,
  pendingPanelReveal: null,
  recentlyClosed: [],
  layoutHistory: [],
  historyIndex: 0,
  historyLoaded: false,
  focusHistory: [],
  focusHistoryIndex: -1,
  expandedPanelId: null,
  savedSizesBeforeExpand: [],
  savedCanvasWidthBeforeExpand: undefined,
  savedCanvasWidthSourceBeforeExpand: undefined,
  deferSpecTab: false,
  newWorkspaceLifecycle: null,
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);

// ============================================================================
// Actions
// ============================================================================

// --- Initialization ---
export const initializeLayout = createAction(
  'panelLayout/initializeLayout',
  (
    wsId: string,
    layout: Pick<WorkspacePanelLayoutState, 'root' | 'panels' | 'focusedPanelId'> & {
      canvasWidth?: number | null;
      canvasWidthSource?: WorkspacePanelLayoutState['canvasWidthSource'];
      hiddenTabs?: PanelTab[];
      deferSpecTab?: boolean;
      newWorkspaceLifecycle?: WorkspacePanelLayoutState['newWorkspaceLifecycle'];
    },
  ) => ({
    wsId,
    layout,
  }),
);

export const bootstrapNewWorkspaceLayout = createAction(
  'panelLayout/bootstrapNewWorkspaceLayout',
  (
    wsId: string,
    initialAgentId: string | null,
    initialAgentTitle: string,
    coordinator = false,
    timestamp?: number,
  ) => ({
    wsId,
    initialAgentId,
    initialAgentTitle,
    coordinator,
    panelId: generatePanelId(),
    placeholderPanelId: generatePanelId(),
    tabId: generateTabId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const resolveNewWorkspaceInitialAgent = createAction(
  'panelLayout/resolveNewWorkspaceInitialAgent',
  (wsId: string, agentId: string, title: string, timestamp?: number) => ({
    wsId,
    agentId,
    title,
    panelId: generatePanelId(),
    tabId: generateTabId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const loadLayoutHistory = createAction(
  'panelLayout/loadLayoutHistory',
  (wsId: string, history: LayoutSnapshot[], historyIndex: number) => ({
    wsId,
    history,
    historyIndex,
  }),
);

export const setRestoreStatus = createAction<
  [wsId: string, restoreStatus: PanelLayoutRestoreStatus]
>('panelLayout/setRestoreStatus');

/** A rendered panel-layout scope is ready to restore from persisted UI state. */
export const panelLayoutScopeMounted = createAction<[layoutId: string]>('panelLayout/scopeMounted');

/** A rendered panel-layout scope has left the component tree. */
export const panelLayoutScopeUnmounted = createAction<[layoutId: string]>(
  'panelLayout/scopeUnmounted',
);

// --- Tab Operations ---
export const openTab = createAction(
  'panelLayout/openTab',
  (
    wsId: string,
    tab: Omit<PanelTab, 'id'>,
    panelId?: string,
    newTabId?: string,
    force?: boolean,
    timestamp?: number,
    allowDuplicate?: boolean,
  ) => ({
    wsId,
    tab,
    panelId,
    newTabId: newTabId ?? generateTabId(),
    force: force ?? false,
    timestamp: timestamp ?? Date.now(),
    ...(allowDuplicate === undefined ? {} : { allowDuplicate }),
  }),
);

export const openTabInRightmostColumn = createAction(
  'panelLayout/openTabInRightmostColumn',
  (
    wsId: string,
    tab: Omit<PanelTab, 'id'>,
    options?: { force?: boolean; allowDuplicate?: boolean; newTabId?: string },
    timestamp?: number,
  ) => ({
    wsId,
    tab,
    force: options?.force ?? false,
    ...(options?.allowDuplicate === undefined ? {} : { allowDuplicate: options.allowDuplicate }),
    newTabId: options?.newTabId ?? generateTabId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const openTabInRightmostColumnRequested = createAction(
  'panelLayout/openTabInRightmostColumnRequested',
  (
    wsId: string,
    tab: Omit<PanelTab, 'id'>,
    options?: { force?: boolean; allowDuplicate?: boolean; newTabId?: string },
    timestamp?: number,
  ) => ({
    wsId,
    tab,
    force: options?.force ?? false,
    ...(options?.allowDuplicate === undefined ? {} : { allowDuplicate: options.allowDuplicate }),
    newTabId: options?.newTabId ?? generateTabId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const openTabInAdjacentOrSplit = createAction(
  'panelLayout/openTabInAdjacentOrSplit',
  (
    wsId: string,
    tab: Omit<PanelTab, 'id'>,
    sourcePanelId?: string,
    options?: { animated?: boolean; force?: boolean; allowDuplicate?: boolean; newTabId?: string },
    timestamp?: number,
  ) => ({
    wsId,
    tab,
    sourcePanelId,
    animated: options?.animated ?? false,
    force: options?.force ?? false,
    ...(options?.allowDuplicate === undefined ? {} : { allowDuplicate: options.allowDuplicate }),
    newTabId: options?.newTabId ?? generateTabId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const openTabInNewRootColumn = createAction(
  'panelLayout/openTabInNewRootColumn',
  (
    wsId: string,
    tab: Omit<PanelTab, 'id'>,
    options?: {
      availableCanvasWidth?: number;
      adaptiveFirstChat?: boolean;
      force?: boolean;
      allowDuplicate?: boolean;
      newPanelId?: string;
      newTabId?: string;
      sourcePanelId?: string;
    },
    timestamp?: number,
  ) => ({
    wsId,
    tab,
    availableCanvasWidth: options?.availableCanvasWidth,
    adaptiveFirstChat: options?.adaptiveFirstChat ?? false,
    force: options?.force ?? false,
    ...(options?.allowDuplicate === undefined ? {} : { allowDuplicate: options.allowDuplicate }),
    sourcePanelId: options?.sourcePanelId,
    newPanelId: options?.newPanelId ?? generatePanelId(),
    newTabId: options?.newTabId ?? generateTabId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

/**
 * Close a tab. A user close of an agent-owned browser tab is a UI-level hide
 * (monorepo#2857): the tab moves to `hiddenTabs` with its webview kept alive
 * offscreen. `destroy: true` (agent/main-driven closes, agent deletion)
 * genuinely removes the tab — including from `hiddenTabs`.
 */
export const closeTab = createAction(
  'panelLayout/closeTab',
  (wsId: string, tabId: string, panelId?: string, timestamp?: number, destroy?: boolean) => ({
    wsId,
    tabId,
    panelId,
    timestamp: timestamp ?? Date.now(),
    destroy: destroy === true,
  }),
);

export const closeActiveTab = createAction(
  'panelLayout/closeActiveTab',
  (wsId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const reopenClosedTab = createAction(
  'panelLayout/reopenClosedTab',
  (wsId: string, timestamp?: number, closedTabId?: string) => ({
    wsId,
    newTabId: generateTabId(),
    closedTabId,
    timestamp: timestamp ?? Date.now(),
  }),
);

/**
 * Prune `recentlyClosed` entries that reference a deleted agent or a removed
 * terminal so the empty-state recent list and `reopenClosedTab` cannot resurrect
 * tombstoned entities. Match by `agentId` and/or `terminalId`.
 */
export const pruneRecentlyClosed = createAction<
  [wsId: string, match: { agentId?: string; terminalId?: string }]
>('panelLayout/pruneRecentlyClosed');

export const setActiveTab = createAction(
  'panelLayout/setActiveTab',
  (wsId: string, tabId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    tabId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const selectNextTab = createAction(
  'panelLayout/selectNextTab',
  (wsId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const selectPreviousTab = createAction(
  'panelLayout/selectPreviousTab',
  (wsId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const reorderTabs =
  createAction<[wsId: string, panelId: string, fromIndex: number, toIndex: number]>(
    'panelLayout/reorderTabs',
  );

export const moveTabToPanel = createAction(
  'panelLayout/moveTabToPanel',
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
  'panelLayout/moveTabToSplit',
  (
    wsId: string,
    tabId: string,
    fromPanelId: string,
    targetPanelId: string,
    zone: 'top' | 'bottom' | 'left' | 'right',
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
  'panelLayout/moveTabToSplitLevel',
  (
    wsId: string,
    tabId: string,
    fromPanelId: string,
    splitPath: number[],
    position: 'before' | 'after',
    direction: 'horizontal' | 'vertical',
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
  'panelLayout/closeOtherTabs',
  (wsId: string, tabId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    tabId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const closeTabsToRight = createAction(
  'panelLayout/closeTabsToRight',
  (wsId: string, tabId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    tabId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const closeAllTabs = createAction(
  'panelLayout/closeAllTabs',
  (wsId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const closeAllOthersEverywhere = createAction(
  'panelLayout/closeAllOthersEverywhere',
  (wsId: string, tabId: string, panelId?: string, timestamp?: number) => ({
    wsId,
    tabId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

// --- Panel Operations ---
export const focusPanel = createAction(
  'panelLayout/focusPanel',
  (wsId: string, panelId: string) => ({
    wsId,
    panelId,
    requestId: generateTabId(),
  }),
);

export const splitPanel = createAction(
  'panelLayout/splitPanel',
  (
    wsId: string,
    panelId: string,
    direction: 'horizontal' | 'vertical',
    options?: { animated?: boolean; panelWidth?: number },
    timestamp?: number,
  ) => ({
    wsId,
    panelId,
    direction,
    animated: options?.animated ?? false,
    panelWidth: options?.panelWidth,
    newPanelId: generatePanelId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const openBlankWorkingPanel = createAction(
  'panelLayout/openBlankWorkingPanel',
  (wsId: string, timestamp?: number) => ({
    wsId,
    newPanelId: generatePanelId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const closePanel = createAction(
  'panelLayout/closePanel',
  (wsId: string, panelId: string, timestamp?: number) => ({
    wsId,
    panelId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const reconcilePanelColumnCount = createAction(
  'panelLayout/reconcilePanelColumnCount',
  (wsId: string, count: PanelColumnCount, timestamp?: number, recordHistory = true) => ({
    wsId,
    count,
    newPanelIds: Array.from({ length: 3 }, () => generatePanelId()),
    timestamp: timestamp ?? Date.now(),
    recordHistory,
  }),
);

export const movePanel = createAction(
  'panelLayout/movePanel',
  (
    wsId: string,
    panelId: string,
    targetPanelId: string,
    position: PanelMovePosition,
    timestamp?: number,
  ) => ({ wsId, panelId, targetPanelId, position, timestamp: timestamp ?? Date.now() }),
);

export const movePanelToRootEdge = createAction(
  'panelLayout/movePanelToRootEdge',
  (wsId: string, panelId: string, position: PanelMovePosition, timestamp?: number) => ({
    wsId,
    panelId,
    position,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const restorePanelDragLayout = createAction(
  'panelLayout/restorePanelDragLayout',
  (wsId: string, snapshot: PanelDragLayoutSnapshot) => ({ wsId, snapshot }),
);

export const updateSizes =
  createAction<[wsId: string, nodePath: number[], sizes: number[]]>('panelLayout/updateSizes');

export const updateSplitSizes = createAction<[wsId: string, sizes: number[], splitPath?: number[]]>(
  'panelLayout/updateSplitSizes',
);

export const resizePanelLayoutRightEdge = createAction<
  [
    wsId: string,
    previousWidth: number,
    nextWidth: number,
    nextCanvasWidth: number,
    resetToAutomatic?: boolean,
  ]
>('panelLayout/resizePanelLayoutRightEdge');

/**
 * Grow a specific root-level horizontal panel by the delta implied by
 * `nextWidth - previousWidth` while preserving every other root-level
 * horizontal sibling's pixel width. Used by root middle-handle drags so a
 * panel can grow the intrinsic canvas instead of stealing width from a neighbour.
 */
export const resizePanelLayoutAtHorizontalPanel = createAction<
  [
    wsId: string,
    previousWidth: number,
    nextWidth: number,
    panelIndex: number,
    nextCanvasWidth: number,
    previousPanelWidths?: readonly number[],
  ]
>('panelLayout/resizePanelLayoutAtHorizontalPanel');

export const toggleExpandPanel = createAction<[wsId: string, panelId: string]>(
  'panelLayout/toggleExpandPanel',
);

export const resetLayout = createAction('panelLayout/resetLayout', (wsId: string) => ({
  wsId,
  defaultLayout: createDefaultLayout(),
}));

export const applyPreset = createAction(
  'panelLayout/applyPreset',
  (
    wsId: string,
    preset: 'single' | 'split-horizontal' | 'split-vertical' | 'three-column',
    timestamp?: number,
  ) => ({
    wsId,
    preset,
    panelIds: Array.from({ length: 3 }, () => generatePanelId()),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const createGridLayout = createAction(
  'panelLayout/createGridLayout',
  (wsId: string, panelCount: number, timestamp?: number) => ({
    wsId,
    panelCount: Math.max(1, Math.min(6, panelCount)),
    panelIds: Array.from({ length: 6 }, () => generatePanelId()),
    timestamp: timestamp ?? Date.now(),
  }),
);

// --- History ---
export const goBack = createAction('panelLayout/goBack', (wsId: string, timestamp?: number) => ({
  wsId,
  timestamp: timestamp ?? Date.now(),
}));
export const goForward = createAction<[wsId: string]>('panelLayout/goForward');
export const goBackInFocusHistory = createAction(
  'panelLayout/goBackInFocusHistory',
  (wsId: string) => ({ wsId, requestId: generateTabId() }),
);
export const goForwardInFocusHistory = createAction(
  'panelLayout/goForwardInFocusHistory',
  (wsId: string) => ({ wsId, requestId: generateTabId() }),
);

// --- Spec Tab Deferral ---
export const setDeferSpecTab = createAction<[wsId: string, value: boolean]>(
  'panelLayout/setDeferSpecTab',
);

export const markPanelTouched = createAction<[wsId: string, panelId: string]>(
  'panelLayout/markPanelTouched',
);

export const observeDeferredSpecGeneration = createAction<[wsId: string, generation: string]>(
  'panelLayout/observeDeferredSpecGeneration',
);

export const revealDeferredSpecTab = createAction(
  'panelLayout/revealDeferredSpecTab',
  (wsId: string, generation: string, title: string, timestamp?: number) => ({
    wsId,
    generation,
    title,
    panelId: generatePanelId(),
    tabId: generateTabId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

// --- Pending Focus ---
export const consumePendingFocus = createAction<[wsId: string, tabId: string]>(
  'panelLayout/consumePendingFocus',
);

export const consumePanelReveal = createAction<[wsId: string, requestId: string]>(
  'panelLayout/consumePanelReveal',
);

// --- Agent Reconciliation ---
export const reconcileStaleAgentTabs = createAction<
  [wsId: string, validAgentIds: string[], replacementAgentId: string, replacementTitle: string]
>('panelLayout/reconcileStaleAgentTabs');

// --- Clear workspace ---
export const clearPanelLayout = createAction<[wsId: string]>('panelLayout/clearPanelLayout');

export const closeTabsByType = createAction(
  'panelLayout/closeTabsByType',
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
  if (node.type === 'panel') {
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
    if (node.type === 'split' && node.children[idx]) {
      node = node.children[idx];
    } else {
      return null;
    }
  }
  return node;
}

function activateEquivalentTab(
  ws: WorkspacePanelLayoutState,
  match: EquivalentPanelTab,
  requested: Omit<PanelTab, 'id'>,
  requestId: string,
  timestamp: number,
): WorkspacePanelLayoutState {
  const panel = ws.panels[match.panelId];
  const updatedData = requested.data ? { ...match.tab.data, ...requested.data } : match.tab.data;
  let next: WorkspacePanelLayoutState = {
    ...ws,
    panels: {
      ...ws.panels,
      [match.panelId]: {
        ...panel,
        activeTabId: match.tab.id,
        tabs: requested.data
          ? panel.tabs.map((tab) => (tab.id === match.tab.id ? { ...tab, data: updatedData } : tab))
          : panel.tabs,
      },
    },
    focusedPanelId: match.panelId,
    pendingPanelReveal: { panelId: match.panelId, tabId: match.tab.id, requestId },
  };
  next = addToFocusHistory(next, match.panelId, match.tab.id, timestamp);
  return next;
}

function createPanelRevealRequest(
  panelId: string,
  tabId: string | null,
  requestId: string,
): PanelRevealRequest {
  return { panelId, tabId, requestId };
}

function restoreExpandedWorkspaceLayout(
  workspace: WorkspacePanelLayoutState,
): WorkspacePanelLayoutState {
  if (workspace.expandedPanelId === null) return workspace;
  const root = JSON.parse(JSON.stringify(workspace.root)) as PanelLayoutNode;
  for (const entry of workspace.savedSizesBeforeExpand) {
    const node = getSplitAtPath(root, entry.nodePath);
    if (node?.type === 'split') node.sizes = [...entry.sizes];
  }
  return {
    ...workspace,
    root,
    canvasWidth:
      workspace.savedCanvasWidthBeforeExpand !== undefined
        ? workspace.savedCanvasWidthBeforeExpand
        : workspace.canvasWidth,
    canvasWidthSource:
      workspace.savedCanvasWidthSourceBeforeExpand !== undefined
        ? workspace.savedCanvasWidthSourceBeforeExpand
        : workspace.canvasWidthSource,
    expandedPanelId: null,
    savedSizesBeforeExpand: [],
    savedCanvasWidthBeforeExpand: undefined,
    savedCanvasWidthSourceBeforeExpand: undefined,
  };
}

/** Close a panel, returning the updated workspace state */
function closePanelHelper(
  ws: WorkspacePanelLayoutState,
  panelId: string,
  timestamp?: number,
): WorkspacePanelLayoutState {
  if (Object.keys(ws.panels).length <= 1) return ws;
  ws = restoreExpandedWorkspaceLayout(ws);

  const removal = removePanelPreservingHorizontalWidths(ws.root, panelId);
  if (!removal.node || !removal.removed) return ws;
  const { [panelId]: removedPanel, ...remainingPanels } = ws.panels;
  const focusedPanelId =
    ws.focusedPanelId === panelId ? (Object.keys(remainingPanels)[0] ?? null) : ws.focusedPanelId;

  const closableRemovedTabs = removedPanel.tabs.filter((tab) => tab.closable !== false);
  // Owned browser tabs removed with their panel are hidden, not closed
  // (monorepo#2857) — kept alive in hiddenTabs, never in recentlyClosed.
  const { hidden: hiddenRemovedTabs, closed: closedRemovedTabs } =
    partitionRemovedTabs(closableRemovedTabs);
  const focusHistory = ws.focusHistory.filter((entry) => entry.panelId !== panelId);
  const newRecentlyClosed =
    closedRemovedTabs.length > 0 && timestamp !== undefined
      ? [
          ...closedRemovedTabs.map((tab) => ({
            tab: { ...tab },
            panelId,
            closedAt: timestamp,
          })),
          ...ws.recentlyClosed,
        ].slice(0, MAX_RECENTLY_CLOSED)
      : ws.recentlyClosed;
  const previousColumnCount = countHorizontalPanelColumns(ws.root);
  const remainingColumnCount = countHorizontalPanelColumns(removal.node);
  const canvasWidth = (() => {
    if (ws.canvasWidth === null || ws.canvasWidthSource === 'intrinsic') return null;
    const previousGutterWidth = PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, previousColumnCount - 1);
    const remainingGutterWidth = PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, remainingColumnCount - 1);
    const previousPanelWidth = Math.max(0, ws.canvasWidth - previousGutterWidth);
    return previousPanelWidth * removal.remainingWidthRatio + remainingGutterWidth;
  })();

  return {
    ...ws,
    root: removal.node,
    panels: remainingPanels,
    focusedPanelId,
    canvasWidth,
    canvasWidthSource: ws.canvasWidthSource === 'intrinsic' ? null : ws.canvasWidthSource,
    expandedPanelId: null,
    savedSizesBeforeExpand: [],
    savedCanvasWidthBeforeExpand: undefined,
    savedCanvasWidthSourceBeforeExpand: undefined,
    recentlyClosed: newRecentlyClosed,
    hiddenTabs: addItems(
      ws.hiddenTabs,
      hiddenRemovedTabs.map((tab) => ({ ...tab })),
    ),
    pendingPanelReveal: ws.pendingPanelReveal?.panelId === panelId ? null : ws.pendingPanelReveal,
    pendingFocusTabId: removedPanel.tabs.some((tab) => tab.id === ws.pendingFocusTabId)
      ? null
      : ws.pendingFocusTabId,
    focusHistory,
    focusHistoryIndex: Math.min(ws.focusHistoryIndex, focusHistory.length - 1),
  };
}

function createFixedColumnRoot(panelIds: string[]): PanelLayoutNode {
  if (panelIds.length === 1) return { type: 'panel', panelId: panelIds[0] };
  return {
    type: 'split',
    direction: 'horizontal',
    children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
    sizes: panelIds.map(() => 100 / panelIds.length),
  };
}

function isFixedColumnRoot(root: PanelLayoutNode, panelIds: string[]): boolean {
  if (panelIds.length === 1) return root.type === 'panel' && root.panelId === panelIds[0];
  return (
    root.type === 'split' &&
    root.direction === 'horizontal' &&
    root.children.length === panelIds.length &&
    root.children.every(
      (child, index) => child.type === 'panel' && child.panelId === panelIds[index],
    )
  );
}

function stripLegacyPanelPin(panel: PanelState): PanelState {
  const { pinned: _legacyPinned, ...clean } = panel as PanelState & { pinned?: unknown };
  return clean;
}

function reconcileWorkspacePanelColumns(
  workspace: WorkspacePanelLayoutState,
  count: PanelColumnCount,
  newPanelIds: string[],
  timestamp: number,
  recordHistory: boolean,
): WorkspacePanelLayoutState {
  const restored = restoreExpandedWorkspaceLayout(workspace);
  const originalOrder = getPanelOrder(restored.root).filter((panelId) => restored.panels[panelId]);
  if (originalOrder.length === 0) return restored;
  const hasLegacyPin = Object.values(restored.panels).some((panel) => 'pinned' in panel);
  if (
    originalOrder.length === count &&
    isFixedColumnRoot(restored.root, originalOrder) &&
    !hasLegacyPin
  ) {
    return restored;
  }

  const next = recordHistory ? saveToHistory(restored, timestamp) : restored;
  let panels = Object.fromEntries(
    Object.entries(next.panels).map(([panelId, panel]) => [panelId, stripLegacyPanelPin(panel)]),
  );
  const panelIds = originalOrder.slice(0, count);
  const removedPanelIds = originalOrder.slice(count);
  const survivingRightmostId = panelIds.at(-1);

  if (survivingRightmostId && removedPanelIds.length > 0) {
    const survivor = panels[survivingRightmostId];
    const seenTabIds = new Set(survivor.tabs.map((tab) => tab.id));
    const displacedTabs = removedPanelIds.flatMap((panelId) => panels[panelId]?.tabs ?? []);
    const mergedTabs = [...survivor.tabs];
    for (const tab of displacedTabs) {
      if (!seenTabIds.has(tab.id)) {
        seenTabIds.add(tab.id);
        mergedTabs.push(tab);
      }
    }
    const fallbackActiveTabId = removedPanelIds
      .map((panelId) => panels[panelId]?.activeTabId)
      .find((tabId): tabId is string => Boolean(tabId && seenTabIds.has(tabId)));
    panels[survivingRightmostId] = {
      ...survivor,
      tabs: mergedTabs,
      activeTabId: survivor.activeTabId ?? fallbackActiveTabId ?? mergedTabs[0]?.id ?? null,
      pristine: mergedTabs.length === 0 ? survivor.pristine : false,
    };
    for (const panelId of removedPanelIds) delete panels[panelId];
  }

  while (panelIds.length < count) {
    const panelId = newPanelIds[panelIds.length - originalOrder.length];
    if (!panelId) break;
    panelIds.push(panelId);
    panels[panelId] = { id: panelId, tabs: [], activeTabId: null, pristine: true };
  }

  const removedSet = new Set(removedPanelIds);
  const focusedPanelId =
    next.focusedPanelId && !removedSet.has(next.focusedPanelId)
      ? next.focusedPanelId
      : (survivingRightmostId ?? panelIds[0] ?? null);
  const previousColumnCount = originalOrder.length;
  const nextColumnCount = panelIds.length;
  const canvasWidth = (() => {
    if (next.canvasWidth === null || next.canvasWidthSource === 'intrinsic') return null;
    const contentWidth = Math.max(
      0,
      next.canvasWidth - PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, previousColumnCount - 1),
    );
    return (
      contentWidth * (nextColumnCount / previousColumnCount) +
      PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, nextColumnCount - 1)
    );
  })();
  const root = isFixedColumnRoot(next.root, panelIds) ? next.root : createFixedColumnRoot(panelIds);

  return {
    ...next,
    root,
    panels,
    focusedPanelId,
    canvasWidth,
    canvasWidthSource: next.canvasWidthSource === 'intrinsic' ? null : next.canvasWidthSource,
    recentlyClosed: next.recentlyClosed.map((entry) =>
      removedSet.has(entry.panelId) && survivingRightmostId
        ? { ...entry, panelId: survivingRightmostId }
        : entry,
    ),
    focusHistory: next.focusHistory.map((entry) =>
      removedSet.has(entry.panelId) && survivingRightmostId
        ? { ...entry, panelId: survivingRightmostId }
        : entry,
    ),
    expandedPanelId: null,
    savedSizesBeforeExpand: [],
    savedCanvasWidthBeforeExpand: undefined,
    savedCanvasWidthSourceBeforeExpand: undefined,
    pendingPanelReveal:
      next.pendingPanelReveal &&
      removedSet.has(next.pendingPanelReveal.panelId) &&
      survivingRightmostId
        ? { ...next.pendingPanelReveal, panelId: survivingRightmostId }
        : next.pendingPanelReveal,
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
function saveToHistory(
  ws: WorkspacePanelLayoutState,
  timestamp: number,
): WorkspacePanelLayoutState {
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
    canvasWidth: ws.canvasWidth,
    canvasWidthSource: ws.canvasWidthSource,
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

/**
 * A user close of an agent-owned browser tab is a UI-level hide, not a
 * destroy (monorepo#2857): the tab leaves its panel but stays alive in
 * `hiddenTabs` (webview kept mounted offscreen, still in listTabs for its
 * owner). Destruction happens only via explicit destroy closes (agent
 * closeTab, agent deletion) or workspace archive/delete.
 */
function isHideOnCloseTab(tab: PanelTab): boolean {
  return (
    tab.type === 'browser' && typeof tab.ownerAgentId === 'string' && tab.ownerAgentId.length > 0
  );
}

/**
 * Partition tabs removed by a user-driven bulk close: owned browser tabs are
 * hidden (kept alive), the rest genuinely close into `recentlyClosed`.
 */
function partitionRemovedTabs(removed: PanelTab[]): { hidden: PanelTab[]; closed: PanelTab[] } {
  const hidden: PanelTab[] = [];
  const closed: PanelTab[] = [];
  for (const tab of removed) {
    (isHideOnCloseTab(tab) ? hidden : closed).push(tab);
  }
  return { hidden, closed };
}

/** Drop hidden tabs that a restored snapshot re-added to a visible panel. */
function dropTabsPresentInPanels(
  hiddenTabs: Collection<PanelTab, 'id'>,
  panels: Record<string, PanelState>,
): Collection<PanelTab, 'id'> {
  if (hiddenTabs.ids.length === 0) return hiddenTabs;
  const visibleIds = new Set(
    Object.values(panels).flatMap((panel) => panel.tabs.map((tab) => tab.id)),
  );
  let result = hiddenTabs;
  for (const id of hiddenTabs.ids) {
    if (visibleIds.has(id)) result = removeItem(result, id);
  }
  return result;
}

/**
 * Strip a destroyed tab from every layout-history snapshot so goBack/goForward
 * can never resurrect it after its main-process registrations are gone
 * (monorepo#2857). Layout structure is left untouched — only the tab entry
 * (and a matching activeTabId) is removed.
 */
function purgeTabFromLayoutHistory(
  ws: WorkspacePanelLayoutState,
  tabId: string,
): WorkspacePanelLayoutState {
  if (ws.layoutHistory.length === 0) return ws;
  let changed = false;
  const layoutHistory = ws.layoutHistory.map((snapshot) => {
    let snapshotChanged = false;
    const panels: Record<string, PanelState> = {};
    for (const [pId, panel] of Object.entries(snapshot.panels)) {
      if (panel.tabs.some((tab) => tab.id === tabId)) {
        snapshotChanged = true;
        const tabs = panel.tabs.filter((tab) => tab.id !== tabId);
        panels[pId] = {
          ...panel,
          tabs,
          activeTabId: panel.activeTabId === tabId ? (tabs[0]?.id ?? null) : panel.activeTabId,
        };
      } else {
        panels[pId] = panel;
      }
    }
    if (!snapshotChanged) return snapshot;
    changed = true;
    return { ...snapshot, panels };
  });
  return changed ? { ...ws, layoutHistory } : ws;
}

/**
 * Reconcile `hiddenTabs` with a restored history snapshot (monorepo#2857):
 * hidden tabs the snapshot re-adds to a panel leave `hiddenTabs`, and owned
 * browser tabs currently visible but absent from the snapshot are re-hidden
 * instead of dropped — history navigation must never destroy an owned tab.
 */
function reconcileHiddenTabsWithRestoredPanels(
  ws: WorkspacePanelLayoutState,
  restoredPanels: Record<string, PanelState>,
): Collection<PanelTab, 'id'> {
  const hidden = dropTabsPresentInPanels(ws.hiddenTabs, restoredPanels);
  const restoredIds = new Set(
    Object.values(restoredPanels).flatMap((panel) => panel.tabs.map((tab) => tab.id)),
  );
  const displaced = Object.values(ws.panels)
    .flatMap((panel) => panel.tabs)
    .filter(
      (tab) =>
        isHideOnCloseTab(tab) && !restoredIds.has(tab.id) && getItem(hidden, tab.id) === undefined,
    );
  return addItems(hidden, displaced);
}

/** Strip spec tabs from panels if deferSpecTab is active */
function stripSpecTabs(panels: Record<string, PanelState>): Record<string, PanelState> {
  const result: Record<string, PanelState> = {};
  for (const [id, panel] of Object.entries(panels)) {
    const filteredTabs = panel.tabs.filter((t) => !(t.type === 'note' && t.noteId === 'spec'));
    if (filteredTabs.length === panel.tabs.length) {
      result[id] = panel;
    } else {
      const activeTabId =
        panel.activeTabId && filteredTabs.some((t) => t.id === panel.activeTabId)
          ? panel.activeTabId
          : (filteredTabs[0]?.id ?? null);
      result[id] = { ...panel, tabs: filteredTabs, activeTabId };
    }
  }
  return result;
}

export const closeTabsByAgentId = createAction(
  'panelLayout/closeTabsByAgentId',
  (wsId: string, agentId: string, timestamp?: number) => ({
    wsId,
    agentId,
    timestamp: timestamp ?? Date.now(),
  }),
);

export const updateTabTitle = createAction<[wsId: string, tabId: string, newTitle: string]>(
  'panelLayout/updateTabTitle',
);

/**
 * `requestedUrl` maintains the tab's persisted pre-rewrite URL
 * (intent-hq/monorepo#2789): a string records it (rewritten/tunneled opens),
 * `null` clears it (non-rewritten opens), and `undefined` (webview
 * navigations) rebases it onto the navigated path while the tab stays on the
 * same rewritten origin — see `rebaseRequestedUrlForNavigation`.
 */
export const updateTabBrowserUrl = createAction<
  [wsId: string, tabId: string, newUrl: string, requestedUrl?: string | null]
>('panelLayout/updateTabBrowserUrl');

export const updateTabFavicon = createAction<[wsId: string, tabId: string, faviconUrl: string]>(
  'panelLayout/updateTabFavicon',
);

/**
 * Record the agent owning a browser tab (claimTab / agent openTab adopting an
 * existing tab, monorepo#2857). Persisted with the layout so ownership
 * survives restart; main's ownership registry rehydrates from it.
 * `emulatedSize` records the owned tab's emulated viewport (claim size /
 * resizeTab) so the size survives restart too; omitting it preserves any
 * previously recorded size.
 */
export const setTabOwnerAgent = createAction<
  [
    wsId: string,
    tabId: string,
    ownerAgentId: string,
    emulatedSize?: { width: number; height: number },
  ]
>('panelLayout/setTabOwnerAgent');

/**
 * Destroy ALL browser tabs owned by an agent — visible and hidden alike
 * (monorepo#2857). Dispatched when the agent's deletion commits
 * (`agent:deleted`): owned tabs never outlive their owner, and there is no
 * release-to-unowned path.
 */
export const destroyTabsByOwnerAgent = createAction(
  'panelLayout/destroyTabsByOwnerAgent',
  (wsId: string, agentId: string, timestamp?: number) => ({
    wsId,
    agentId,
    timestamp: timestamp ?? Date.now(),
  }),
);

/**
 * Destroy every agent-owned browser tab in a workspace — visible and hidden
 * (monorepo#2857). Dispatched on workspace archive: the protocol contract
 * discards all tabs on archive/delete, and pinned owned webviews would
 * otherwise stay mounted offscreen for the archived workspace indefinitely.
 */
export const destroyOwnedTabsForWorkspace = createAction(
  'panelLayout/destroyOwnedTabsForWorkspace',
  (wsId: string, timestamp?: number) => ({
    wsId,
    timestamp: timestamp ?? Date.now(),
  }),
);

/**
 * Restore a hidden (user-closed) agent-owned browser tab back into a panel
 * (monorepo#2857): removed from `hiddenTabs` and opened in the focused panel,
 * keeping its id so the live webview and main's registrations stay attached.
 */
export const restoreHiddenTab = createAction(
  'panelLayout/restoreHiddenTab',
  (wsId: string, tabId: string, timestamp?: number) => ({
    wsId,
    tabId,
    timestamp: timestamp ?? Date.now(),
  }),
);

// `tabId` scopes the retarget to one specific tab (e.g. a candidate click in
// that tab's not-found panel); without it, every file tab at `oldPath`
// retargets (file renames and the read saga, which has no tab identity).
export const updateFileTabPath = createAction<
  [wsId: string, oldPath: string, newPath: string, tabId?: string]
>('panelLayout/updateFileTabPath');

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
let _reducerRef:
  | ((
      state: PanelLayoutSliceState,
      action: { type: string; payload: any },
    ) => PanelLayoutSliceState)
  | null = null;

function selfDispatch(
  state: PanelLayoutSliceState,
  action: { type: string; payload: any },
): PanelLayoutSliceState {
  if (!_reducerRef) {
    return state;
  }
  return _reducerRef(state, action);
}

function openNewWorkspaceInitialAgent(
  state: PanelLayoutSliceState,
  wsId: string,
  agentId: string,
  title: string,
  tabId: string,
  timestamp: number,
): PanelLayoutSliceState {
  const tab: Omit<PanelTab, 'id'> = {
    type: 'agent',
    title,
    agentId,
    workspaceId: wsId,
    closable: true,
  };
  const current = getWorkspaceState(state, wsId);
  const opened = selfDispatch(
    state,
    openTab(wsId, tab, current.focusedPanelId ?? undefined, tabId, true, timestamp),
  );
  const workspace = getWorkspaceState(opened, wsId);
  const lifecycle = workspace.newWorkspaceLifecycle;
  const nextWorkspace = {
    ...workspace,
    newWorkspaceLifecycle: lifecycle
      ? { ...lifecycle, initialAgentId: agentId, initialAgentPending: false }
      : lifecycle,
  };
  return setWorkspaceState(opened, wsId, nextWorkspace);
}

function applyCanonicalDefaultPairGeometry(
  workspace: WorkspacePanelLayoutState,
  initialAgentPanelId: string,
  specPanelId: string,
): WorkspacePanelLayoutState {
  if (workspace.canvasWidthSource === 'explicit') return workspace;
  if (
    workspace.root.type !== 'split' ||
    workspace.root.direction !== 'horizontal' ||
    workspace.root.children.length !== 2 ||
    workspace.root.children[0]?.type !== 'panel' ||
    workspace.root.children[0].panelId !== initialAgentPanelId ||
    workspace.root.children[1]?.type !== 'panel' ||
    workspace.root.children[1].panelId !== specPanelId
  ) {
    return workspace;
  }
  const panelWidth = DEFAULT_MEDIUM_PANEL_WIDTH + DEFAULT_CHAT_PANEL_WIDTH;
  return {
    ...workspace,
    root: {
      ...workspace.root,
      sizes: [
        (DEFAULT_CHAT_PANEL_WIDTH / panelWidth) * 100,
        (DEFAULT_MEDIUM_PANEL_WIDTH / panelWidth) * 100,
      ],
    },
    ...resolveIntrinsicPanelCanvasWidth(panelWidth + PANEL_SPLIT_GUTTER_WIDTH),
  };
}

export const panelLayoutReducer = createReducer<PanelLayoutSliceState>(initialState);
// --- Initialization ---
panelLayoutReducer.with(initializeLayout, (state, { payload }) => {
  const { wsId, layout } = payload;
  const ws = getWorkspaceState(state, wsId);
  const canvasWidthState = initializePanelCanvasWidth(layout.canvasWidth, layout.canvasWidthSource);
  return setWorkspaceState(state, wsId, {
    ...ws,
    root: layout.root,
    panels: layout.panels,
    focusedPanelId: layout.focusedPanelId,
    ...canvasWidthState,
    hiddenTabs: createCollection('id', layout.hiddenTabs ?? []),
    deferSpecTab: layout.deferSpecTab ?? false,
    newWorkspaceLifecycle: layout.newWorkspaceLifecycle ?? null,
    pendingFocusTabId: null,
    pendingPanelReveal: null,
  });
});
panelLayoutReducer.with(bootstrapNewWorkspaceLayout, (state, { payload }) => {
  const {
    wsId,
    initialAgentId,
    initialAgentTitle,
    coordinator,
    panelId,
    placeholderPanelId,
    tabId,
    timestamp,
  } = payload;
  const bootstrapped = setWorkspaceState(state, wsId, {
    ...emptyWorkspaceState,
    root: { type: 'panel', panelId: placeholderPanelId },
    panels: {
      [placeholderPanelId]: {
        id: placeholderPanelId,
        tabs: [],
        activeTabId: null,
        pristine: true,
      },
    },
    focusedPanelId: placeholderPanelId,
    restoreStatus: 'restored',
    pendingFocusTabId: null,
    deferSpecTab: true,
    newWorkspaceLifecycle: {
      coordinator,
      initialAgentId: null,
      initialAgentPending: true,
      spec: { noteId: 'spec', generation: null, state: 'deferred' },
    },
  });
  return initialAgentId
    ? openNewWorkspaceInitialAgent(
        bootstrapped,
        wsId,
        initialAgentId,
        initialAgentTitle,
        tabId,
        timestamp,
      )
    : bootstrapped;
});
panelLayoutReducer.with(resolveNewWorkspaceInitialAgent, (state, { payload }) => {
  const { wsId, agentId, title, panelId, tabId, timestamp } = payload;
  const ws = getWorkspaceState(state, wsId);
  const lifecycle = ws.newWorkspaceLifecycle;
  if (!lifecycle?.initialAgentPending) return state;
  return openNewWorkspaceInitialAgent(state, wsId, agentId, title, tabId, timestamp);
});
panelLayoutReducer.with(setRestoreStatus, (state, { payload: [wsId, restoreStatus] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    restoreStatus,
    ...(restoreStatus === 'pending' ? { pendingFocusTabId: null, pendingPanelReveal: null } : {}),
  });
});
panelLayoutReducer.with(loadLayoutHistory, (state, { payload }) => {
  const { wsId, history, historyIndex } = payload;
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    layoutHistory: history,
    historyIndex: Math.min(historyIndex, history.length),
    historyLoaded: true,
  });
});
// --- Open Tab ---
panelLayoutReducer.with(openTab, (state, { payload }) => {
  const { wsId, tab, panelId, newTabId, timestamp } = payload;
  if (tab.workspaceId && tab.workspaceId !== wsId) return state;
  let ws = getWorkspaceState(state, wsId);

  // Spec-note guard — bypass when force is true (user-initiated opens)
  if (ws.deferSpecTab && tab.type === 'note' && tab.noteId === 'spec' && !payload.force)
    return state;

  const targetPanelId = panelId ?? ws.focusedPanelId;
  const existing = payload.allowDuplicate
    ? null
    : findEquivalentPanelTab(wsId, ws, tab, targetPanelId);
  if (existing) {
    return setWorkspaceState(
      state,
      wsId,
      activateEquivalentTab(ws, existing, tab, newTabId, timestamp),
    );
  }
  if (!targetPanelId || !ws.panels[targetPanelId]) return state;

  const panel = ws.panels[targetPanelId];

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
        pristine: false,
      },
    },
    focusedPanelId: targetPanelId,
    pendingPanelReveal: createPanelRevealRequest(targetPanelId, newTabId, newTabId),
  };
  ws = addToFocusHistory(ws, targetPanelId, newTabId, timestamp);
  return setWorkspaceState(state, wsId, ws);
});
panelLayoutReducer.with(openTabInRightmostColumn, (state, { payload }) => {
  const { wsId, tab, force, allowDuplicate, newTabId, timestamp } = payload;
  const ws = getWorkspaceState(state, wsId);
  const targetPanelId = getPanelOrder(ws.root)
    .filter((panelId) => ws.panels[panelId])
    .at(-1);
  if (!targetPanelId) return state;
  return selfDispatch(
    state,
    openTab(wsId, tab, targetPanelId, newTabId, force, timestamp, allowDuplicate),
  );
});
panelLayoutReducer.with(openTabInNewRootColumn, (state, { payload }) => {
  const {
    wsId,
    tab,
    availableCanvasWidth,
    adaptiveFirstChat,
    force,
    newPanelId,
    newTabId,
    timestamp,
  } = payload;
  if (tab.workspaceId && tab.workspaceId !== wsId) return state;
  let ws = getWorkspaceState(state, wsId);
  if (ws.deferSpecTab && tab.type === 'note' && tab.noteId === 'spec' && !force) return state;

  const existing = payload.allowDuplicate
    ? null
    : findEquivalentPanelTab(wsId, ws, tab, ws.focusedPanelId);
  if (existing) {
    return setWorkspaceState(
      state,
      wsId,
      activateEquivalentTab(ws, existing, tab, newTabId, timestamp),
    );
  }

  const panelIds = Object.keys(ws.panels);
  const isPristineLayout =
    panelIds.length === 1 && ws.panels[panelIds[0]]?.tabs.length === 0 && ws.root.type === 'panel';
  const newTab: PanelTab = { ...tab, id: newTabId };
  ws = saveToHistory(ws, timestamp);

  if (isPristineLayout && adaptiveFirstChat) {
    const initialPanelId = panelIds[0];
    const initialPanel = ws.panels[initialPanelId];
    if (
      typeof availableCanvasWidth === 'number' &&
      canUseWideFirstChatLayout(availableCanvasWidth)
    ) {
      ws = {
        ...ws,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: initialPanelId },
            { type: 'panel', panelId: newPanelId },
          ],
          sizes: getWideFirstChatSizes(availableCanvasWidth),
        },
        panels: {
          ...ws.panels,
          [initialPanelId]: {
            ...initialPanel,
            tabs: [newTab],
            activeTabId: newTabId,
            pristine: false,
          },
          [newPanelId]: { id: newPanelId, tabs: [], activeTabId: null, pristine: true },
        },
        focusedPanelId: initialPanelId,
        canvasWidth: availableCanvasWidth,
        pendingFocusTabId: newTabId,
        pendingPanelReveal: createPanelRevealRequest(initialPanelId, newTabId, newTabId),
      };
    } else {
      ws = {
        ...ws,
        panels: {
          ...ws.panels,
          [initialPanelId]: {
            ...initialPanel,
            tabs: [newTab],
            activeTabId: newTabId,
            pristine: false,
          },
        },
        focusedPanelId: initialPanelId,
        pendingFocusTabId: newTabId,
        pendingPanelReveal: createPanelRevealRequest(initialPanelId, newTabId, newTabId),
      };
    }
    ws = addToFocusHistory(ws, initialPanelId, newTabId, timestamp);
    return setWorkspaceState(state, wsId, ws);
  }

  const existingCanvasWidth =
    ws.canvasWidth ?? getAutomaticPanelLayoutCanvasWidth(ws.root, ws.panels, 'content');
  const newPanelWidth = getPanelCreationWidthForType(tab.type);
  const appendedRoot = appendHorizontalPanelToLayout(
    ws.root,
    newPanelId,
    existingCanvasWidth,
    newPanelWidth,
  );
  ws = {
    ...ws,
    root: appendedRoot,
    panels: {
      ...ws.panels,
      [newPanelId]: { id: newPanelId, tabs: [newTab], activeTabId: newTabId },
    },
    focusedPanelId: newPanelId,
    canvasWidth: existingCanvasWidth + newPanelWidth + PANEL_SPLIT_GUTTER_WIDTH,
    canvasWidthSource: ws.canvasWidthSource === 'intrinsic' ? null : ws.canvasWidthSource,
    pendingFocusTabId: newTabId,
    pendingPanelReveal: createPanelRevealRequest(newPanelId, newTabId, newTabId),
  };
  ws = addToFocusHistory(ws, newPanelId, newTabId, timestamp);
  return setWorkspaceState(state, wsId, ws);
});
// --- Close Tab ---
panelLayoutReducer.with(closeTab, (state, { payload }) => {
  const { wsId, tabId, panelId, timestamp, destroy } = payload;
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
  if (!targetPanelId || !ws.panels[targetPanelId]) {
    // A destroy may target a tab that only lives in hiddenTabs (already
    // user-hidden); drop it from there (monorepo#2857).
    if (destroy && getItem(ws.hiddenTabs, tabId)) {
      return setWorkspaceState(
        state,
        wsId,
        purgeTabFromLayoutHistory(
          { ...ws, hiddenTabs: removeItem(ws.hiddenTabs, tabId) },
          tabId,
        ),
      );
    }
    return state;
  }

  const panel = ws.panels[targetPanelId];
  const tabIndex = panel.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex === -1) {
    if (destroy && getItem(ws.hiddenTabs, tabId)) {
      return setWorkspaceState(
        state,
        wsId,
        purgeTabFromLayoutHistory(
          { ...ws, hiddenTabs: removeItem(ws.hiddenTabs, tabId) },
          tabId,
        ),
      );
    }
    return state;
  }

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

  const hideInsteadOfClose = !destroy && isHideOnCloseTab(closedTab);
  // Owned browser tabs never enter recentlyClosed: hidden ones stay alive
  // and restorable in place (reopening would duplicate the live tab), and
  // destroyed ones die with their agent and are not resurrectable.
  const recentlyClosed = isHideOnCloseTab(closedTab)
    ? ws.recentlyClosed
    : [
        { tab: { ...closedTab }, panelId: targetPanelId, closedAt: timestamp },
        ...ws.recentlyClosed,
      ].slice(0, MAX_RECENTLY_CLOSED);

  ws = {
    ...ws,
    panels: {
      ...ws.panels,
      [targetPanelId]: { ...panel, tabs: newTabs, activeTabId: newActiveTabId },
    },
    recentlyClosed,
    hiddenTabs: hideInsteadOfClose ? addItem(ws.hiddenTabs, { ...closedTab }) : ws.hiddenTabs,
  };

  // A destroyed tab's main-process registrations are gone — strip it from
  // every history snapshot so undo/redo can't resurrect it (monorepo#2857).
  if (destroy) {
    ws = purgeTabFromLayoutHistory(ws, tabId);
  }

  // Close empty panel if there are others
  if (newTabs.length === 0 && Object.keys(ws.panels).length > 1) {
    ws = closePanelHelper(ws, targetPanelId);
  }

  return setWorkspaceState(state, wsId, ws);
});
// --- Close Active Tab ---
panelLayoutReducer.with(closeActiveTab, (state, { payload }) => {
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
});
// --- Close Tabs By Type ---
panelLayoutReducer.with(closeTabsByType, (state, { payload }) => {
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
});
// --- Close Tabs By Agent ID ---
panelLayoutReducer.with(closeTabsByAgentId, (state, { payload }) => {
  const { wsId, agentId, timestamp } = payload;
  const ws = getWorkspaceState(state, wsId);
  const tabsToClose: { tabId: string; panelId: string }[] = [];
  for (const [pId, panel] of Object.entries(ws.panels)) {
    for (const tab of panel.tabs) {
      if (tab.type === 'agent' && tab.agentId === agentId) {
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
});
// --- Destroy Tabs By Owner Agent (monorepo#2857) ---
panelLayoutReducer.with(destroyTabsByOwnerAgent, (state, { payload }) => {
  const { wsId, agentId, timestamp } = payload;
  const ws = getWorkspaceState(state, wsId);
  const tabsToDestroy: { tabId: string; panelId?: string }[] = [];
  for (const [pId, panel] of Object.entries(ws.panels)) {
    for (const tab of panel.tabs) {
      if (tab.type === 'browser' && tab.ownerAgentId === agentId) {
        tabsToDestroy.push({ tabId: tab.id, panelId: pId });
      }
    }
  }
  const hiddenOwned = getItems(ws.hiddenTabs).filter(
    (tab) => tab.type === 'browser' && tab.ownerAgentId === agentId,
  );
  if (tabsToDestroy.length === 0 && hiddenOwned.length === 0) return state;
  let result = state;
  if (hiddenOwned.length > 0) {
    let hiddenTabs = ws.hiddenTabs;
    for (const tab of hiddenOwned) {
      hiddenTabs = removeItem(hiddenTabs, tab.id);
    }
    let next: WorkspacePanelLayoutState = { ...ws, hiddenTabs };
    for (const tab of hiddenOwned) {
      next = purgeTabFromLayoutHistory(next, tab.id);
    }
    result = setWorkspaceState(result, wsId, next);
  }
  for (const { tabId, panelId } of tabsToDestroy) {
    result = selfDispatch(result, closeTab(wsId, tabId, panelId, timestamp, true));
  }
  return result;
});
// --- Destroy Owned Tabs For Workspace (monorepo#2857) ---
panelLayoutReducer.with(destroyOwnedTabsForWorkspace, (state, { payload }) => {
  const { wsId, timestamp } = payload;
  const ws = getWorkspaceState(state, wsId);
  const tabsToDestroy: { tabId: string; panelId?: string }[] = [];
  for (const [pId, panel] of Object.entries(ws.panels)) {
    for (const tab of panel.tabs) {
      if (tab.type === 'browser' && typeof tab.ownerAgentId === 'string') {
        tabsToDestroy.push({ tabId: tab.id, panelId: pId });
      }
    }
  }
  const hiddenOwned = getItems(ws.hiddenTabs).filter(
    (tab) => tab.type === 'browser' && typeof tab.ownerAgentId === 'string',
  );
  if (tabsToDestroy.length === 0 && hiddenOwned.length === 0) return state;
  let result = state;
  if (hiddenOwned.length > 0) {
    let hiddenTabs = ws.hiddenTabs;
    for (const tab of hiddenOwned) {
      hiddenTabs = removeItem(hiddenTabs, tab.id);
    }
    let next: WorkspacePanelLayoutState = { ...ws, hiddenTabs };
    for (const tab of hiddenOwned) {
      next = purgeTabFromLayoutHistory(next, tab.id);
    }
    result = setWorkspaceState(result, wsId, next);
  }
  for (const { tabId, panelId } of tabsToDestroy) {
    result = selfDispatch(result, closeTab(wsId, tabId, panelId, timestamp, true));
  }
  return result;
});
// --- Restore Hidden Tab (monorepo#2857) ---
panelLayoutReducer.with(restoreHiddenTab, (state, { payload }) => {
  const { wsId, tabId, timestamp } = payload;
  let ws = getWorkspaceState(state, wsId);
  const hiddenTab = getItem(ws.hiddenTabs, tabId);
  if (!hiddenTab) return state;
  const targetPanelId =
    ws.focusedPanelId && ws.panels[ws.focusedPanelId]
      ? ws.focusedPanelId
      : Object.keys(ws.panels)[0];
  if (!targetPanelId) return state;

  ws = saveToHistory(ws, timestamp);
  const panel = ws.panels[targetPanelId];
  ws = {
    ...ws,
    hiddenTabs: removeItem(ws.hiddenTabs, tabId),
    panels: {
      ...ws.panels,
      [targetPanelId]: {
        ...panel,
        tabs: [...panel.tabs, { ...hiddenTab }],
        activeTabId: hiddenTab.id,
        pristine: false,
      },
    },
    focusedPanelId: targetPanelId,
    pendingPanelReveal: createPanelRevealRequest(targetPanelId, hiddenTab.id, hiddenTab.id),
  };
  ws = addToFocusHistory(ws, targetPanelId, hiddenTab.id, timestamp);
  return setWorkspaceState(state, wsId, ws);
});
// --- Prune Recently Closed ---
panelLayoutReducer.with(pruneRecentlyClosed, (state, { payload: [wsId, match] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.recentlyClosed.length === 0) return state;
  const { agentId, terminalId } = match;
  if (!agentId && !terminalId) return state;
  const filtered = ws.recentlyClosed.filter((entry) => {
    if (agentId && entry.tab.type === 'agent' && entry.tab.agentId === agentId) return false;
    if (terminalId && entry.tab.type === 'terminal' && entry.tab.terminalId === terminalId)
      return false;
    return true;
  });
  if (filtered.length === ws.recentlyClosed.length) return state;
  return setWorkspaceState(state, wsId, { ...ws, recentlyClosed: filtered });
});
// --- Cross-slice: prune recentlyClosed when a terminal is removed ---
panelLayoutReducer.with(removeTerminal, (state, { payload: [wsId, termId] }) => {
  const ws = state.byWorkspaceId[wsId];
  if (!ws || ws.recentlyClosed.length === 0) return state;
  const filtered = ws.recentlyClosed.filter(
    (entry) => !(entry.tab.type === 'terminal' && entry.tab.terminalId === termId),
  );
  if (filtered.length === ws.recentlyClosed.length) return state;
  return setWorkspaceState(state, wsId, { ...ws, recentlyClosed: filtered });
});
// --- Reopen Closed Tab ---
panelLayoutReducer.with(reopenClosedTab, (state, { payload }) => {
  const { wsId, newTabId, closedTabId, timestamp } = payload;
  let ws = getWorkspaceState(state, wsId);
  if (ws.recentlyClosed.length === 0) return state;

  const closedIndex = closedTabId
    ? ws.recentlyClosed.findIndex((entry) => entry.tab.id === closedTabId)
    : 0;
  if (closedIndex < 0) return state;
  const next = ws.recentlyClosed[closedIndex];
  if (ws.deferSpecTab && next.tab.type === 'note' && next.tab.noteId === 'spec') return state;

  ws = saveToHistory(ws, timestamp);
  const closed = ws.recentlyClosed[closedIndex];
  const rest = ws.recentlyClosed.filter((_, index) => index !== closedIndex);
  const targetPanelId = ws.panels[closed.panelId] ? closed.panelId : ws.focusedPanelId;
  if (!targetPanelId || !ws.panels[targetPanelId]) return state;

  const panel = ws.panels[targetPanelId];
  // The genuine close cleared main's ownership of an agent-owned browser tab
  // (monorepo#2857); a reopen is a fresh, unowned tab — carrying the stale
  // ownerAgentId forward would resurrect ownership in main's registry (via
  // layout rehydration) and block other agents from claiming the tab.
  const { ownerAgentId: _staleOwner, ...closedTab } = closed.tab;
  const newTab: PanelTab = { ...closedTab, id: newTabId };

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
    focusedPanelId: targetPanelId,
    pendingPanelReveal: createPanelRevealRequest(targetPanelId, newTabId, newTabId),
  };
  return setWorkspaceState(state, wsId, ws);
});
// --- Set Active Tab ---
panelLayoutReducer.with(setActiveTab, (state, { payload }) => {
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
});
// --- Select Next/Previous Tab ---
panelLayoutReducer.with(selectNextTab, (state, { payload }) => {
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
});
panelLayoutReducer.with(selectPreviousTab, (state, { payload }) => {
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
});
// --- Reorder Tabs ---
panelLayoutReducer.with(reorderTabs, (state, { payload: [wsId, panelId, fromIndex, toIndex] }) => {
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
});
// --- Move Tab To Panel ---
panelLayoutReducer.with(moveTabToPanel, (state, { payload }) => {
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
    newFromActiveTabId =
      newFromTabs.length > 0 ? newFromTabs[Math.min(tabIndex, newFromTabs.length - 1)].id : null;
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
});
// --- Update Tab Title ---
panelLayoutReducer.with(updateTabTitle, (state, { payload: [wsId, tabId, newTitle] }) => {
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
  if (getItem(ws.hiddenTabs, tabId)) {
    return setWorkspaceState(state, wsId, {
      ...ws,
      hiddenTabs: updateItem(ws.hiddenTabs, { id: tabId, title: newTitle }),
    });
  }
  return state;
});
// --- Update Tab Browser URL ---
panelLayoutReducer.with(
  updateTabBrowserUrl,
  (state, { payload: [wsId, tabId, newUrl, requestedUrl] }) => {
    const ws = getWorkspaceState(state, wsId);
    for (const [pId, panel] of Object.entries(ws.panels)) {
      const tabIdx = panel.tabs.findIndex((t) => t.id === tabId && t.type === 'browser');
      if (tabIdx >= 0) {
        const newTabs = panel.tabs.map((t, i) => {
          if (i !== tabIdx) return t;
          const kept =
            requestedUrl === undefined
              ? rebaseRequestedUrlForNavigation(t.browserUrl, newUrl, t.browserRequestedUrl)
              : (requestedUrl ?? undefined);
          const { browserRequestedUrl: _dropped, ...rest } = t;
          return {
            ...rest,
            browserUrl: newUrl,
            ...(kept !== undefined ? { browserRequestedUrl: kept } : {}),
          };
        });
        return setWorkspaceState(state, wsId, {
          ...ws,
          panels: { ...ws.panels, [pId]: { ...panel, tabs: newTabs } },
        });
      }
    }
    // Hidden owned tabs keep a live webview, so agent-driven navigation must
    // keep syncing their persisted URL (monorepo#2857).
    const hiddenTab = getItem(ws.hiddenTabs, tabId);
    if (hiddenTab && hiddenTab.type === 'browser') {
      const kept =
        requestedUrl === undefined
          ? rebaseRequestedUrlForNavigation(
              hiddenTab.browserUrl,
              newUrl,
              hiddenTab.browserRequestedUrl,
            )
          : (requestedUrl ?? undefined);
      const { browserRequestedUrl: _dropped, ...rest } = hiddenTab;
      const newHiddenTab = {
        ...rest,
        browserUrl: newUrl,
        ...(kept !== undefined ? { browserRequestedUrl: kept } : {}),
      };
      return setWorkspaceState(state, wsId, {
        ...ws,
        hiddenTabs: replaceItem(ws.hiddenTabs, tabId, newHiddenTab),
      });
    }
    return state;
  },
);
// --- Set Tab Owner Agent (monorepo#2857) ---
panelLayoutReducer.with(
  setTabOwnerAgent,
  (state, { payload: [wsId, tabId, ownerAgentId, emulatedSize] }) => {
    const ws = getWorkspaceState(state, wsId);
    for (const [pId, panel] of Object.entries(ws.panels)) {
      const tabIdx = panel.tabs.findIndex((t) => t.id === tabId && t.type === 'browser');
      if (tabIdx >= 0) {
        const tab = panel.tabs[tabIdx];
        const unchanged =
          tab.ownerAgentId === ownerAgentId &&
          (emulatedSize === undefined ||
            (tab.emulatedSize?.width === emulatedSize.width &&
              tab.emulatedSize?.height === emulatedSize.height));
        if (unchanged) return state;
        const newTabs = panel.tabs.map((t, i) =>
          i === tabIdx
            ? { ...t, ownerAgentId, ...(emulatedSize === undefined ? {} : { emulatedSize }) }
            : t,
        );
        return setWorkspaceState(state, wsId, {
          ...ws,
          panels: { ...ws.panels, [pId]: { ...panel, tabs: newTabs } },
        });
      }
    }
    // Hidden (user-closed) owned tabs stay alive offscreen and their owner
    // can still resize them (monorepo#2857) — persist on them too.
    const hiddenTab = getItem(ws.hiddenTabs, tabId);
    if (hiddenTab && hiddenTab.type === 'browser') {
      const unchanged =
        hiddenTab.ownerAgentId === ownerAgentId &&
        (emulatedSize === undefined ||
          (hiddenTab.emulatedSize?.width === emulatedSize.width &&
            hiddenTab.emulatedSize?.height === emulatedSize.height));
      if (unchanged) return state;
      return setWorkspaceState(state, wsId, {
        ...ws,
        hiddenTabs: updateItem(ws.hiddenTabs, {
          id: tabId,
          ownerAgentId,
          ...(emulatedSize === undefined ? {} : { emulatedSize }),
        }),
      });
    }
    return state;
  },
);
// --- Update Tab Favicon ---
panelLayoutReducer.with(updateTabFavicon, (state, { payload: [wsId, tabId, faviconUrl] }) => {
  const ws = getWorkspaceState(state, wsId);
  for (const [pId, panel] of Object.entries(ws.panels)) {
    const tabIdx = panel.tabs.findIndex((t) => t.id === tabId && t.type === 'browser');
    if (tabIdx >= 0) {
      const newTabs = panel.tabs.map((t, i) => (i === tabIdx ? { ...t, faviconUrl } : t));
      return setWorkspaceState(state, wsId, {
        ...ws,
        panels: { ...ws.panels, [pId]: { ...panel, tabs: newTabs } },
      });
    }
  }
  const hiddenTab = getItem(ws.hiddenTabs, tabId);
  if (hiddenTab && hiddenTab.type === 'browser') {
    return setWorkspaceState(state, wsId, {
      ...ws,
      hiddenTabs: updateItem(ws.hiddenTabs, { id: tabId, faviconUrl }),
    });
  }
  return state;
});
// --- Update File Tab Path ---
panelLayoutReducer.with(
  updateFileTabPath,
  (state, { payload: [wsId, oldPath, newPath, tabId] }) => {
    const ws = getWorkspaceState(state, wsId);
    const newFileName = newPath.split('/').pop() || newPath;
    let updated = false;
    const newPanels: Record<string, PanelState> = {};
    for (const [pId, panel] of Object.entries(ws.panels)) {
      const newTabs = panel.tabs.map((t) => {
        if (t.type === 'file' && t.filePath === oldPath && (!tabId || t.id === tabId)) {
          updated = true;
          return { ...t, filePath: newPath, title: newFileName };
        }
        return t;
      });
      newPanels[pId] = newTabs !== panel.tabs ? { ...panel, tabs: newTabs } : panel;
    }
    if (!updated) return state;
    return setWorkspaceState(state, wsId, { ...ws, panels: newPanels });
  },
);
// --- Close Other Tabs ---
panelLayoutReducer.with(closeOtherTabs, (state, { payload }) => {
  const { wsId, tabId, panelId, timestamp } = payload;
  let ws = getWorkspaceState(state, wsId);
  const targetPanelId = panelId ?? ws.focusedPanelId;
  if (!targetPanelId || !ws.panels[targetPanelId]) return state;
  const panel = ws.panels[targetPanelId];
  if (!panel.tabs.find((t) => t.id === tabId)) return state;

  ws = saveToHistory(ws, timestamp);
  const removed = panel.tabs.filter((t) => t.id !== tabId && t.closable !== false);
  const { hidden, closed: genuinelyClosed } = partitionRemovedTabs(removed);
  const closed: RecentlyClosedTab[] = genuinelyClosed.map((t) => ({
    tab: { ...t },
    panelId: targetPanelId,
    closedAt: timestamp,
  }));
  const recentlyClosed = [...closed, ...ws.recentlyClosed].slice(0, MAX_RECENTLY_CLOSED);
  const keptTabs = panel.tabs.filter((t) => t.id === tabId || t.closable === false);

  ws = {
    ...ws,
    panels: { ...ws.panels, [targetPanelId]: { ...panel, tabs: keptTabs, activeTabId: tabId } },
    recentlyClosed,
    hiddenTabs: addItems(
      ws.hiddenTabs,
      hidden.map((t) => ({ ...t })),
    ),
  };
  return setWorkspaceState(state, wsId, ws);
});
// --- Close Tabs To Right ---
panelLayoutReducer.with(closeTabsToRight, (state, { payload }) => {
  const { wsId, tabId, panelId, timestamp } = payload;
  let ws = getWorkspaceState(state, wsId);
  const targetPanelId = panelId ?? ws.focusedPanelId;
  if (!targetPanelId || !ws.panels[targetPanelId]) return state;
  const panel = ws.panels[targetPanelId];
  const tabIndex = panel.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex === -1) return state;

  ws = saveToHistory(ws, timestamp);
  const removed = panel.tabs.slice(tabIndex + 1).filter((t) => t.closable !== false);
  const { hidden, closed: genuinelyClosed } = partitionRemovedTabs(removed);
  const closed: RecentlyClosedTab[] = genuinelyClosed.map((t) => ({
    tab: { ...t },
    panelId: targetPanelId,
    closedAt: timestamp,
  }));
  const recentlyClosed = [...closed, ...ws.recentlyClosed].slice(0, MAX_RECENTLY_CLOSED);
  const keptTabs = panel.tabs.filter((t, i) => i <= tabIndex || t.closable === false);
  const activeTabId = keptTabs.some((t) => t.id === panel.activeTabId)
    ? panel.activeTabId
    : (keptTabs[keptTabs.length - 1]?.id ?? null);

  ws = {
    ...ws,
    panels: { ...ws.panels, [targetPanelId]: { ...panel, tabs: keptTabs, activeTabId } },
    recentlyClosed,
    hiddenTabs: addItems(
      ws.hiddenTabs,
      hidden.map((t) => ({ ...t })),
    ),
  };
  return setWorkspaceState(state, wsId, ws);
});
// --- Close All Tabs ---
panelLayoutReducer.with(closeAllTabs, (state, { payload }) => {
  const { wsId, panelId, timestamp } = payload;
  let ws = getWorkspaceState(state, wsId);
  const targetPanelId = panelId ?? ws.focusedPanelId;
  if (!targetPanelId || !ws.panels[targetPanelId]) return state;
  const panel = ws.panels[targetPanelId];

  ws = saveToHistory(ws, timestamp);
  const removed = panel.tabs.filter((t) => t.closable !== false);
  const { hidden, closed: genuinelyClosed } = partitionRemovedTabs(removed);
  const closed: RecentlyClosedTab[] = genuinelyClosed.map((t) => ({
    tab: { ...t },
    panelId: targetPanelId,
    closedAt: timestamp,
  }));
  const recentlyClosed = [...closed, ...ws.recentlyClosed].slice(0, MAX_RECENTLY_CLOSED);
  const keptTabs = panel.tabs.filter((t) => t.closable === false);
  const activeTabId = keptTabs[0]?.id ?? null;

  ws = {
    ...ws,
    panels: { ...ws.panels, [targetPanelId]: { ...panel, tabs: keptTabs, activeTabId } },
    recentlyClosed,
    hiddenTabs: addItems(
      ws.hiddenTabs,
      hidden.map((t) => ({ ...t })),
    ),
  };

  if (keptTabs.length === 0 && Object.keys(ws.panels).length > 1) {
    ws = closePanelHelper(ws, targetPanelId);
  }
  return setWorkspaceState(state, wsId, ws);
});
// --- Close All Others Everywhere ---
panelLayoutReducer.with(closeAllOthersEverywhere, (state, { payload }) => {
  const { wsId, tabId, panelId, timestamp } = payload;
  let ws = getWorkspaceState(state, wsId);
  const targetPanelId = panelId ?? ws.focusedPanelId;
  if (!targetPanelId || !ws.panels[targetPanelId]) return state;
  if (!ws.panels[targetPanelId].tabs.find((t) => t.id === tabId)) return state;

  ws = saveToHistory(ws, timestamp);
  let allClosed: RecentlyClosedTab[] = [];
  let allHidden: PanelTab[] = [];

  // Close tabs in other panels
  const newPanels: Record<string, PanelState> = {};
  for (const [pId, panel] of Object.entries(ws.panels)) {
    const removed =
      pId === targetPanelId
        ? panel.tabs.filter((t) => t.id !== tabId && t.closable !== false)
        : panel.tabs.filter((t) => t.closable !== false);
    const { hidden, closed: genuinelyClosed } = partitionRemovedTabs(removed);
    allHidden = [...allHidden, ...hidden.map((t) => ({ ...t }))];
    allClosed = [
      ...allClosed,
      ...genuinelyClosed.map((t) => ({ tab: { ...t }, panelId: pId, closedAt: timestamp })),
    ];
    if (pId === targetPanelId) {
      const keptTabs = panel.tabs.filter((t) => t.id === tabId || t.closable === false);
      newPanels[pId] = { ...panel, tabs: keptTabs, activeTabId: tabId };
    } else {
      const keptTabs = panel.tabs.filter((t) => t.closable === false);
      newPanels[pId] = { ...panel, tabs: keptTabs, activeTabId: keptTabs[0]?.id ?? null };
    }
  }
  const recentlyClosed = [...allClosed, ...ws.recentlyClosed].slice(0, MAX_RECENTLY_CLOSED);
  ws = {
    ...ws,
    panels: newPanels,
    recentlyClosed,
    hiddenTabs: addItems(ws.hiddenTabs, allHidden),
  };

  // Clean up empty panels
  for (const pId of Object.keys(ws.panels)) {
    if (pId !== targetPanelId && ws.panels[pId].tabs.length === 0) {
      ws = closePanelHelper(ws, pId);
    }
  }
  return setWorkspaceState(state, wsId, ws);
});
// --- Focus Panel ---
panelLayoutReducer.with(focusPanel, (state, { payload }) => {
  const { wsId, panelId, requestId } = payload;
  const ws = getWorkspaceState(state, wsId);
  const panel = ws.panels[panelId];
  if (!panel) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    focusedPanelId: panelId,
    pendingPanelReveal: createPanelRevealRequest(panelId, panel.activeTabId, requestId),
  });
});
// --- Split Panel ---
panelLayoutReducer.with(splitPanel, (state, { payload }) => {
  const { wsId, panelId, direction, animated, panelWidth, newPanelId, timestamp } = payload;
  let ws = getWorkspaceState(state, wsId);

  ws = restoreExpandedWorkspaceLayout(ws);
  ws = saveToHistory(ws, timestamp);
  ws = { ...ws, expandedPanelId: null, savedSizesBeforeExpand: [] };

  // Create new empty panel
  const newPanel: PanelState = { id: newPanelId, tabs: [], activeTabId: null };

  if (direction === 'horizontal') {
    const newPanelWidth =
      typeof panelWidth === 'number' && Number.isFinite(panelWidth) && panelWidth > 0
        ? panelWidth
        : DEFAULT_PANEL_WIDTH;
    const root = insertHorizontalPanelInLayout(
      ws.root,
      newPanelId,
      panelId,
      ws.canvasWidth,
      newPanelWidth,
    );
    if (!root) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      root,
      panels: { ...ws.panels, [newPanelId]: newPanel },
      focusedPanelId: newPanelId,
      pendingPanelReveal: createPanelRevealRequest(newPanelId, null, newPanelId),
      canvasWidth:
        (ws.canvasWidth ??
          getAutomaticPanelCanvasWidth(countHorizontalPanelColumns(ws.root), 'content')) +
        newPanelWidth +
        PANEL_SPLIT_GUTTER_WIDTH,
      canvasWidthSource: ws.canvasWidthSource === 'intrinsic' ? null : ws.canvasWidthSource,
    });
  }

  const initialSizes = animated ? [100, 0] : [50, 50];

  // Find panel node and replace with split
  const findAndReplace = (
    node: PanelLayoutNode,
  ): { found: boolean; replacement: PanelLayoutNode } => {
    if (node.type === 'panel' && node.panelId === panelId) {
      return {
        found: true,
        replacement: {
          type: 'split',
          direction,
          children: [
            { type: 'panel', panelId },
            { type: 'panel', panelId: newPanelId },
          ],
          sizes: initialSizes,
        },
      };
    }
    if (node.type === 'split') {
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
      pendingPanelReveal: createPanelRevealRequest(newPanelId, null, newPanelId),
      canvasWidthSource: ws.canvasWidthSource === 'intrinsic' ? null : ws.canvasWidthSource,
    };
  }
  return setWorkspaceState(state, wsId, ws);
});
panelLayoutReducer.with(openBlankWorkingPanel, (state, { payload }) => {
  const { wsId, newPanelId, timestamp } = payload;
  const current = restoreExpandedWorkspaceLayout(getWorkspaceState(state, wsId));
  const rightmostPanelId = getPanelOrder(current.root).at(-1);
  if (!rightmostPanelId || !current.panels[rightmostPanelId]) return state;
  const rightmostPanel = current.panels[rightmostPanelId];
  if (rightmostPanel.tabs.length === 0 && rightmostPanel.pristine === true) {
    return setWorkspaceState(state, wsId, {
      ...current,
      focusedPanelId: rightmostPanelId,
      pendingPanelReveal: createPanelRevealRequest(rightmostPanelId, null, newPanelId),
    });
  }

  const ws = saveToHistory(current, timestamp);
  const closed = rightmostPanel.tabs.map((tab) => ({
    tab: { ...tab },
    panelId: rightmostPanelId,
    closedAt: timestamp,
  }));
  return setWorkspaceState(state, wsId, {
    ...ws,
    panels: {
      ...ws.panels,
      [rightmostPanelId]: {
        ...rightmostPanel,
        tabs: [],
        activeTabId: null,
        pristine: true,
      },
    },
    focusedPanelId: rightmostPanelId,
    pendingFocusTabId: null,
    pendingPanelReveal: createPanelRevealRequest(rightmostPanelId, null, newPanelId),
    recentlyClosed: [...closed, ...ws.recentlyClosed].slice(0, MAX_RECENTLY_CLOSED),
  });
});
// --- Close Panel ---
panelLayoutReducer.with(closePanel, (state, { payload }) => {
  const { wsId, panelId, timestamp } = payload;
  const ws = getWorkspaceState(state, wsId);
  const panel = ws.panels[panelId];
  if (!panel) return state;

  // No-op if panel contains any non-closable tabs
  if (panel.tabs.some((tab) => tab.closable === false)) return state;

  let updatedWs = saveToHistory(ws, timestamp);
  updatedWs = closePanelHelper(updatedWs, panelId, timestamp);
  return setWorkspaceState(state, wsId, updatedWs);
});
panelLayoutReducer.with(reconcilePanelColumnCount, (state, { payload }) => {
  const { wsId, count, newPanelIds, timestamp, recordHistory } = payload;
  const ws = getWorkspaceState(state, wsId);
  const reconciled = reconcileWorkspacePanelColumns(
    ws,
    count,
    newPanelIds,
    timestamp,
    recordHistory,
  );
  return setWorkspaceState(state, wsId, reconciled);
});
// --- Update Sizes ---
panelLayoutReducer.with(movePanel, (state, { payload }) => {
  const { wsId, panelId, targetPanelId, position, timestamp } = payload;
  let ws = restoreExpandedWorkspaceLayout(getWorkspaceState(state, wsId));
  if (panelId === targetPanelId || !ws.panels[panelId] || !ws.panels[targetPanelId]) return state;
  const root = movePanelInLayout(ws.root, panelId, targetPanelId, position);
  if (!root) return state;
  ws = saveToHistory(ws, timestamp);
  return setWorkspaceState(state, wsId, {
    ...ws,
    root,
    focusedPanelId: panelId,
    canvasWidthSource: ws.canvasWidthSource === 'intrinsic' ? null : ws.canvasWidthSource,
  });
});

panelLayoutReducer.with(movePanelToRootEdge, (state, { payload }) => {
  const { wsId, panelId, position, timestamp } = payload;
  let ws = restoreExpandedWorkspaceLayout(getWorkspaceState(state, wsId));
  if (!ws.panels[panelId]) return state;
  const root = movePanelToRootEdgeInLayout(ws.root, panelId, position);
  if (!root) return state;
  ws = saveToHistory(ws, timestamp);
  return setWorkspaceState(state, wsId, {
    ...ws,
    root,
    focusedPanelId: panelId,
    canvasWidthSource: ws.canvasWidthSource === 'intrinsic' ? null : ws.canvasWidthSource,
  });
});

panelLayoutReducer.with(restorePanelDragLayout, (state, { payload: { wsId, snapshot } }) => {
  const ws = state.byWorkspaceId[wsId];
  return ws ? setWorkspaceState(state, wsId, { ...ws, ...snapshot }) : state;
});

panelLayoutReducer.with(updateSizes, (state, { payload: [wsId, nodePath, sizes] }) => {
  const ws = getWorkspaceState(state, wsId);
  // Navigate to the node
  const newRoot = JSON.parse(JSON.stringify(ws.root));
  let current = newRoot;
  for (const index of nodePath) {
    if (current.type === 'split' && current.children[index]) {
      current = current.children[index];
    } else {
      return state;
    }
  }
  if (current.type === 'split') {
    current.sizes = sizes;
    return setWorkspaceState(state, wsId, { ...ws, root: newRoot });
  }
  return state;
});
// --- Update Split Sizes ---
panelLayoutReducer.with(updateSplitSizes, (state, { payload: [wsId, sizes, splitPath] }) => {
  const ws = getWorkspaceState(state, wsId);
  const path = splitPath ?? [];
  const newRoot = JSON.parse(JSON.stringify(ws.root));
  let node = newRoot;
  for (const index of path) {
    if (node.type === 'split' && node.children[index]) {
      node = node.children[index];
    } else {
      return state;
    }
  }
  if (node.type === 'split') {
    node.sizes = sizes;
    return setWorkspaceState(state, wsId, { ...ws, root: newRoot });
  }
  return state;
});
panelLayoutReducer.with(
  resizePanelLayoutRightEdge,
  (state, { payload: [wsId, previousWidth, nextWidth, nextCanvasWidth, resetToAutomatic] }) => {
    if (
      previousWidth <= 0 ||
      nextWidth <= 0 ||
      !Number.isFinite(previousWidth) ||
      !Number.isFinite(nextWidth) ||
      !Number.isFinite(nextCanvasWidth) ||
      nextCanvasWidth <= 0
    ) {
      return state;
    }
    const ws = getWorkspaceState(state, wsId);
    const root = resizePanelTreeRightEdge(ws.root, previousWidth, nextWidth);
    const canvasWidthState = resolveUserPanelCanvasResize(
      nextCanvasWidth,
      getAutomaticPanelLayoutCanvasWidth(root, ws.panels, 'content'),
      resetToAutomatic,
    );
    if (
      root === ws.root &&
      ws.canvasWidth === canvasWidthState.canvasWidth &&
      ws.canvasWidthSource === canvasWidthState.canvasWidthSource
    ) {
      return state;
    }
    return setWorkspaceState(state, wsId, { ...ws, root, ...canvasWidthState });
  },
);
panelLayoutReducer.with(
  resizePanelLayoutAtHorizontalPanel,
  (
    state,
    { payload: [wsId, previousWidth, nextWidth, panelIndex, nextCanvasWidth, previousPanelWidths] },
  ) => {
    if (
      previousWidth <= 0 ||
      nextWidth <= 0 ||
      !Number.isFinite(previousWidth) ||
      !Number.isFinite(nextWidth) ||
      !Number.isFinite(panelIndex) ||
      !Number.isFinite(nextCanvasWidth) ||
      nextCanvasWidth <= 0
    ) {
      return state;
    }
    const ws = getWorkspaceState(state, wsId);
    const resized = resizeRootHorizontalPanel(
      ws.root,
      previousWidth,
      nextWidth,
      panelIndex,
      previousPanelWidths,
    );
    const acceptedCanvasWidth = nextCanvasWidth + resized.nextWidth - nextWidth;
    if (!Number.isFinite(acceptedCanvasWidth) || acceptedCanvasWidth <= 0) return state;
    const canvasWidthState = resolveUserPanelCanvasResize(
      acceptedCanvasWidth,
      getAutomaticPanelLayoutCanvasWidth(resized.node, ws.panels, 'content'),
    );
    if (
      resized.node === ws.root &&
      ws.canvasWidth === canvasWidthState.canvasWidth &&
      ws.canvasWidthSource === canvasWidthState.canvasWidthSource
    ) {
      return state;
    }
    return setWorkspaceState(state, wsId, {
      ...ws,
      root: resized.node,
      ...canvasWidthState,
    });
  },
);
// --- Toggle Expand Panel ---
panelLayoutReducer.with(toggleExpandPanel, (state, { payload: [wsId, panelId] }) => {
  const ws = getWorkspaceState(state, wsId);

  if (ws.expandedPanelId === panelId) {
    return setWorkspaceState(state, wsId, restoreExpandedWorkspaceLayout(ws));
  }

  const restored = restoreExpandedWorkspaceLayout(ws);
  const newRoot = JSON.parse(JSON.stringify(restored.root)) as PanelLayoutNode;

  const panelPath = findPanelPath(newRoot, panelId);
  if (!panelPath || panelPath.length === 0) {
    return setWorkspaceState(state, wsId, restored);
  }

  const savedSizes = snapshotPanelSplitSizes(restored.root);
  const availableCanvasWidth =
    restored.canvasWidth ??
    getAutomaticPanelLayoutCanvasWidth(restored.root, restored.panels, 'content');
  const dominantCanvasWidth = getDominantPanelCanvasWidth(
    restored.root,
    restored.panels,
    panelId,
    availableCanvasWidth,
  );
  let currentNode: PanelLayoutNode = newRoot;
  let currentOuterWidth = dominantCanvasWidth;
  let changedHorizontalSplit = false;

  for (const childIndex of panelPath) {
    if (currentNode.type === 'split') {
      if (currentNode.direction === 'horizontal') {
        const geometry = getDominantSplitGeometry(currentNode, childIndex, currentOuterWidth);
        currentNode.sizes = geometry.sizes;
        currentOuterWidth = geometry.targetWidth;
        changedHorizontalSplit = true;
      }
      currentNode = currentNode.children[childIndex];
    }
  }

  if (!changedHorizontalSplit) return setWorkspaceState(state, wsId, restored);

  return setWorkspaceState(state, wsId, {
    ...restored,
    root: newRoot,
    canvasWidth:
      dominantCanvasWidth > availableCanvasWidth ? dominantCanvasWidth : restored.canvasWidth,
    expandedPanelId: panelId,
    savedSizesBeforeExpand: savedSizes,
    savedCanvasWidthBeforeExpand: restored.canvasWidth,
    savedCanvasWidthSourceBeforeExpand: restored.canvasWidthSource,
  });
});
// --- Reset Layout ---
panelLayoutReducer.with(resetLayout, (state, { payload }) => {
  const { wsId, defaultLayout } = payload;
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    ...defaultLayout,
    expandedPanelId: null,
    savedSizesBeforeExpand: [],
    savedCanvasWidthBeforeExpand: undefined,
    savedCanvasWidthSourceBeforeExpand: undefined,
    deferSpecTab: false,
    newWorkspaceLifecycle: null,
  });
});
// --- Go Back ---
panelLayoutReducer.with(goBack, (state, { payload: { wsId, timestamp } }) => {
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
      canvasWidth: ws.canvasWidth,
      canvasWidthSource: ws.canvasWidthSource,
      timestamp,
    });
  }

  historyIndex--;
  const snapshot = layoutHistory[historyIndex];
  if (!snapshot) return state;

  let panels = JSON.parse(JSON.stringify(snapshot.panels)) as Record<string, PanelState>;
  // Strip spec tabs if deferring
  if (ws.deferSpecTab) panels = stripSpecTabs(panels);
  const canvasWidthState = initializePanelCanvasWidth(
    snapshot.canvasWidth,
    snapshot.canvasWidthSource,
  );

  return setWorkspaceState(state, wsId, {
    ...ws,
    root: JSON.parse(JSON.stringify(snapshot.root)),
    panels,
    focusedPanelId: snapshot.focusedPanelId,
    ...canvasWidthState,
    // A snapshot that re-adds a since-hidden owned tab must not leave a
    // duplicate live in hiddenTabs, and owned tabs the snapshot displaces
    // from a panel are re-hidden, not destroyed (monorepo#2857).
    hiddenTabs: reconcileHiddenTabsWithRestoredPanels(ws, panels),
    layoutHistory,
    historyIndex,
  });
});
// --- Go Forward ---
panelLayoutReducer.with(goForward, (state, { payload: [wsId] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.historyIndex >= ws.layoutHistory.length - 1) return state;

  const historyIndex = ws.historyIndex + 1;
  const snapshot = ws.layoutHistory[historyIndex];
  if (!snapshot) return state;

  let panels = JSON.parse(JSON.stringify(snapshot.panels)) as Record<string, PanelState>;
  if (ws.deferSpecTab) panels = stripSpecTabs(panels);
  const canvasWidthState = initializePanelCanvasWidth(
    snapshot.canvasWidth,
    snapshot.canvasWidthSource,
  );

  return setWorkspaceState(state, wsId, {
    ...ws,
    root: JSON.parse(JSON.stringify(snapshot.root)),
    panels,
    focusedPanelId: snapshot.focusedPanelId,
    ...canvasWidthState,
    hiddenTabs: reconcileHiddenTabsWithRestoredPanels(ws, panels),
    historyIndex,
  });
});
// --- Go Back In Focus History ---
panelLayoutReducer.with(goBackInFocusHistory, (state, { payload }) => {
  const { wsId, requestId } = payload;
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
          pendingPanelReveal: createPanelRevealRequest(entry.panelId, entry.tabId, requestId),
        });
      }
    }
    idx--;
  }
  return state;
});
// --- Go Forward In Focus History ---
panelLayoutReducer.with(goForwardInFocusHistory, (state, { payload }) => {
  const { wsId, requestId } = payload;
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
          pendingPanelReveal: createPanelRevealRequest(entry.panelId, entry.tabId, requestId),
        });
      }
    }
    idx++;
  }
  return state;
});
// --- Set Defer Spec Tab ---
panelLayoutReducer.with(setDeferSpecTab, (state, { payload: [wsId, value] }) => {
  let ws = getWorkspaceState(state, wsId);
  ws = { ...ws, deferSpecTab: value };
  if (value) {
    ws = { ...ws, panels: stripSpecTabs(ws.panels) };
  }
  return setWorkspaceState(state, wsId, ws);
});
panelLayoutReducer.with(markPanelTouched, (state, { payload: [wsId, panelId] }) => {
  const ws = getWorkspaceState(state, wsId);
  const panel = ws.panels[panelId];
  if (!panel?.pristine) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    panels: { ...ws.panels, [panelId]: { ...panel, pristine: false } },
  });
});
panelLayoutReducer.with(observeDeferredSpecGeneration, (state, { payload: [wsId, generation] }) => {
  const ws = getWorkspaceState(state, wsId);
  const lifecycle = ws.newWorkspaceLifecycle;
  if (
    !lifecycle ||
    lifecycle.spec.state !== 'deferred' ||
    lifecycle.spec.generation === generation
  ) {
    return state;
  }
  return setWorkspaceState(state, wsId, {
    ...ws,
    newWorkspaceLifecycle: {
      ...lifecycle,
      spec: { ...lifecycle.spec, generation },
    },
  });
});
panelLayoutReducer.with(revealDeferredSpecTab, (state, { payload }) => {
  const { wsId, generation, title, panelId, tabId, timestamp } = payload;
  let ws = getWorkspaceState(state, wsId);
  const lifecycle = ws.newWorkspaceLifecycle;
  if (!lifecycle?.coordinator || lifecycle.spec.state !== 'deferred') return state;
  ws = reconcileWorkspacePanelColumns(ws, 2, [panelId], timestamp, true);
  const reconciledState = setWorkspaceState(state, wsId, ws);

  const revealedLifecycle = {
    ...lifecycle,
    spec: { ...lifecycle.spec, generation, state: 'revealed' as const },
  };
  const finalizeReveal = (
    currentState: PanelLayoutSliceState,
    specPanelId: string,
    specTabId: string,
  ) => {
    const current = getWorkspaceState(currentState, wsId);
    const initialAgentPanelId = Object.values(current.panels).find((panel) =>
      panel.tabs.some(
        (candidate) => candidate.type === 'agent' && candidate.agentId === lifecycle.initialAgentId,
      ),
    )?.id;
    const root = movePanelToRootEdgeInLayout(current.root, specPanelId, 'after') ?? current.root;
    const normalized: WorkspacePanelLayoutState = {
      ...current,
      ...(ws.canvasWidthSource === 'explicit'
        ? { canvasWidth: ws.canvasWidth, canvasWidthSource: 'explicit' as const }
        : {}),
      root,
      focusedPanelId: specPanelId,
      pendingFocusTabId: specTabId,
      pendingPanelReveal: createPanelRevealRequest(specPanelId, specTabId, tabId),
      deferSpecTab: false,
      newWorkspaceLifecycle: revealedLifecycle,
    };
    return setWorkspaceState(
      currentState,
      wsId,
      initialAgentPanelId
        ? applyCanonicalDefaultPairGeometry(normalized, initialAgentPanelId, specPanelId)
        : normalized,
    );
  };
  const rightmostPanelId = getPanelOrder(ws.root).at(-1);
  if (!rightmostPanelId) return state;
  for (const [existingPanelId, panel] of Object.entries(ws.panels)) {
    const existing = panel.tabs.find(
      (tab) => tab.type === 'note' && tab.noteId === lifecycle.spec.noteId,
    );
    if (!existing) continue;
    if (existingPanelId !== rightmostPanelId) {
      const moved = selfDispatch(
        reconciledState,
        moveTabToPanel(wsId, existing.id, existingPanelId, rightmostPanelId, undefined, timestamp),
      );
      return finalizeReveal(moved, rightmostPanelId, existing.id);
    }
    const activated = setWorkspaceState(reconciledState, wsId, {
      ...ws,
      panels: { ...ws.panels, [existingPanelId]: { ...panel, activeTabId: existing.id } },
    });
    return finalizeReveal(activated, existingPanelId, existing.id);
  }

  const tab: Omit<PanelTab, 'id'> = {
    type: 'note',
    title,
    noteId: lifecycle.spec.noteId,
    workspaceId: wsId,
    closable: true,
  };
  const opened = selfDispatch(
    reconciledState,
    openTab(wsId, tab, rightmostPanelId, tabId, true, timestamp),
  );
  const openedWorkspace = getWorkspaceState(opened, wsId);
  const specPanelId = Object.values(openedWorkspace.panels).find((panel) =>
    panel.tabs.some(
      (candidate) => candidate.type === 'note' && candidate.noteId === lifecycle.spec.noteId,
    ),
  )?.id;
  return specPanelId ? finalizeReveal(opened, specPanelId, tabId) : state;
});
// --- Consume Pending Focus ---
panelLayoutReducer.with(consumePendingFocus, (state, { payload: [wsId, tabId] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.pendingFocusTabId !== tabId) return state;
  return setWorkspaceState(state, wsId, { ...ws, pendingFocusTabId: null });
});
panelLayoutReducer.with(consumePanelReveal, (state, { payload: [wsId, requestId] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.pendingPanelReveal?.requestId !== requestId) return state;
  return setWorkspaceState(state, wsId, { ...ws, pendingPanelReveal: null });
});
// --- Reconcile Stale Agent Tabs ---
panelLayoutReducer.with(
  reconcileStaleAgentTabs,
  (state, { payload: [wsId, validAgentIds, replacementAgentId, replacementTitle] }) => {
    const ws = getWorkspaceState(state, wsId);
    const validSet = new Set(validAgentIds);

    // Check if replacement already exists
    let replacementAlreadyExists = false;
    for (const panel of Object.values(ws.panels)) {
      if (panel.tabs.some((t) => t.type === 'agent' && t.agentId === replacementAgentId)) {
        replacementAlreadyExists = true;
        break;
      }
    }

    let hasReplaced = false;
    const newPanels: Record<string, PanelState> = {};
    for (const [pId, panel] of Object.entries(ws.panels)) {
      const newTabs: PanelTab[] = [];
      for (const tab of panel.tabs) {
        if (tab.type === 'agent' && tab.agentId && !validSet.has(tab.agentId)) {
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
        : (newTabs[0]?.id ?? null);
      newPanels[pId] = { ...panel, tabs: newTabs, activeTabId };
    }
    return setWorkspaceState(state, wsId, { ...ws, panels: newPanels });
  },
);
// --- Clear Panel Layout ---
panelLayoutReducer.with(clearPanelLayout, (state, { payload: [wsId] }) => {
  return clearWorkspaceState(state, wsId);
});
// --- Cross-slice: workspace deletion drops the whole layout entry ---
// Unlike `workspaceUnmounted` (state persists for workspace switching), a
// permanent delete must remove the entry — otherwise pinned agent-owned
// webviews (visible or hidden, exempt from cap eviction; monorepo#2857)
// would stay mounted offscreen forever for a workspace that no longer exists.
panelLayoutReducer.with(workspaceDeleted, (state, { payload: [wsId] }) => {
  if (!state.byWorkspaceId[wsId]) return state;
  return clearWorkspaceState(state, wsId);
});
// --- Open Tab In Adjacent Or Split ---
panelLayoutReducer.with(openTabInAdjacentOrSplit, (state, { payload }) => {
  const { wsId, tab, sourcePanelId, animated, force, allowDuplicate, newTabId, timestamp } =
    payload;
  if (tab.workspaceId && tab.workspaceId !== wsId) return state;
  const ws = getWorkspaceState(state, wsId);

  // Spec-note guard — bypass when force is true (user-initiated opens)
  if (ws.deferSpecTab && tab.type === 'note' && tab.noteId === 'spec' && !force) return state;

  const effectiveSourcePanelId = sourcePanelId ?? ws.focusedPanelId;
  const sourcePanel = effectiveSourcePanelId ? ws.panels[effectiveSourcePanelId] : undefined;

  const existing = allowDuplicate
    ? null
    : findEquivalentPanelTab(wsId, ws, tab, effectiveSourcePanelId);
  if (existing) {
    return setWorkspaceState(
      state,
      wsId,
      activateEquivalentTab(ws, existing, tab, newTabId, timestamp),
    );
  }

  if (sourcePanel && sourcePanel.tabs.length === 0) {
    const result = selfDispatch(
      state,
      openTab(wsId, tab, sourcePanel.id, newTabId, force, timestamp, allowDuplicate),
    );
    const updatedWs = getWorkspaceState(result, wsId);
    return setWorkspaceState(result, wsId, { ...updatedWs, pendingFocusTabId: newTabId });
  }

  // Adjacent tabs always receive a fresh column. Reusing an arbitrary neighbor
  // makes the result depend on object insertion order and replaces its content.
  if (!effectiveSourcePanelId) {
    const result = selfDispatch(
      state,
      openTab(wsId, tab, undefined, newTabId, force, timestamp, allowDuplicate),
    );
    const updatedWs = getWorkspaceState(result, wsId);
    return setWorkspaceState(result, wsId, { ...updatedWs, pendingFocusTabId: newTabId });
  }

  // Split then open in new panel
  let result = selfDispatch(
    state,
    splitPanel(
      wsId,
      effectiveSourcePanelId,
      'horizontal',
      { animated, panelWidth: getPanelCreationWidthForType(tab.type) },
      timestamp,
    ),
  );
  // The new panel is now focused; open tab there
  result = selfDispatch(
    result,
    openTab(wsId, tab, undefined, newTabId, force, timestamp, allowDuplicate),
  );
  const updatedWs = getWorkspaceState(result, wsId);
  return setWorkspaceState(result, wsId, { ...updatedWs, pendingFocusTabId: newTabId });
});
// --- Move Tab To Split ---
panelLayoutReducer.with(moveTabToSplit, (state, { payload }) => {
  const { wsId, tabId, fromPanelId, targetPanelId, zone, newPanelId, timestamp } = payload;
  let ws = getWorkspaceState(state, wsId);
  const fromPanel = ws.panels[fromPanelId];
  if (!fromPanel) return state;
  const tabIndex = fromPanel.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex === -1) return state;

  ws = saveToHistory(ws, timestamp);
  const direction = zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
  const insertBefore = zone === 'left' || zone === 'top';
  const tab = fromPanel.tabs[tabIndex];
  const newFromTabs = fromPanel.tabs.filter((_, i) => i !== tabIndex);
  let newFromActiveTabId = fromPanel.activeTabId;
  if (fromPanel.activeTabId === tabId) {
    newFromActiveTabId =
      newFromTabs.length > 0 ? newFromTabs[Math.min(tabIndex, newFromTabs.length - 1)].id : null;
  }

  // Create new panel with the tab
  const newPanel: PanelState = { id: newPanelId, tabs: [tab], activeTabId: tab.id };

  // Replace target panel node with split
  const findAndReplace = (
    node: PanelLayoutNode,
  ): { found: boolean; replacement: PanelLayoutNode } => {
    if (node.type === 'panel' && node.panelId === targetPanelId) {
      const children = insertBefore
        ? [{ type: 'panel' as const, panelId: newPanelId }, node]
        : [node, { type: 'panel' as const, panelId: newPanelId }];
      return { found: true, replacement: { type: 'split', direction, children, sizes: [50, 50] } };
    }
    if (node.type === 'split') {
      const newChildren: PanelLayoutNode[] = [];
      let found = false;
      for (const child of node.children) {
        const result = findAndReplace(child);
        if (result.found) {
          found = true;
          newChildren.push(result.replacement);
        } else {
          newChildren.push(child);
        }
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
});
// --- Move Tab To Split Level ---
panelLayoutReducer.with(moveTabToSplitLevel, (state, { payload }) => {
  const { wsId, tabId, fromPanelId, splitPath, position, direction, newPanelId, timestamp } =
    payload;
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
    newFromActiveTabId =
      newFromTabs.length > 0 ? newFromTabs[Math.min(tabIndex, newFromTabs.length - 1)].id : null;
  }

  const newPanel: PanelState = { id: newPanelId, tabs: [tab], activeTabId: tab.id };
  const newPanelNode: PanelLayoutNode = { type: 'panel', panelId: newPanelId };
  let newRoot = JSON.parse(JSON.stringify(ws.root)) as PanelLayoutNode;

  if (splitPath.length === 0) {
    const children = position === 'before' ? [newPanelNode, newRoot] : [newRoot, newPanelNode];
    newRoot = { type: 'split', direction, children, sizes: [50, 50] };
  } else {
    let parent: PanelLayoutNode = newRoot;
    for (let i = 0; i < splitPath.length - 1; i++) {
      if (parent.type === 'split' && parent.children[splitPath[i]]) {
        parent = parent.children[splitPath[i]];
      } else return state;
    }
    if (parent.type !== 'split') return state;
    const targetIndex = splitPath[splitPath.length - 1];
    const targetNode = parent.children[targetIndex];
    if (!targetNode) return state;
    const children =
      position === 'before' ? [newPanelNode, targetNode] : [targetNode, newPanelNode];
    parent.children[targetIndex] = { type: 'split', direction, children, sizes: [50, 50] };
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
});
panelLayoutReducer.with(createGridLayout, (state, { payload }) => {
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
    root = { type: 'panel', panelId: usedIds[0] };
  } else if (count === 2) {
    root = {
      type: 'split',
      direction: 'horizontal',
      children: usedIds.map((id) => ({ type: 'panel' as const, panelId: id })),
      sizes: [50, 50],
    };
  } else if (count === 3) {
    root = {
      type: 'split',
      direction: 'horizontal',
      children: usedIds.map((id) => ({ type: 'panel' as const, panelId: id })),
      sizes: [33.33, 33.34, 33.33],
    };
  } else if (count === 4) {
    root = {
      type: 'split',
      direction: 'vertical',
      children: [
        {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: usedIds[0] },
            { type: 'panel', panelId: usedIds[1] },
          ],
          sizes: [50, 50],
        },
        {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: usedIds[2] },
            { type: 'panel', panelId: usedIds[3] },
          ],
          sizes: [50, 50],
        },
      ],
      sizes: [50, 50],
    };
  } else {
    // 5-6: top row 3, bottom row remainder
    const topIds = usedIds.slice(0, 3);
    const bottomIds = usedIds.slice(3);
    const topSizes = topIds.map(() => 100 / topIds.length);
    const bottomSizes = bottomIds.map(() => 100 / bottomIds.length);
    root = {
      type: 'split',
      direction: 'vertical',
      children: [
        {
          type: 'split',
          direction: 'horizontal',
          children: topIds.map((id) => ({ type: 'panel' as const, panelId: id })),
          sizes: topSizes,
        },
        {
          type: 'split',
          direction: 'horizontal',
          children: bottomIds.map((id) => ({ type: 'panel' as const, panelId: id })),
          sizes: bottomSizes,
        },
      ],
      sizes: [50, 50],
    };
  }

  ws = { ...ws, root, panels: newPanels, focusedPanelId: usedIds[0] };
  return setWorkspaceState(state, wsId, ws);
});
panelLayoutReducer.with(applyPreset, (state, { payload }) => {
  const { wsId, preset, panelIds, timestamp } = payload;
  let ws = getWorkspaceState(state, wsId);
  ws = saveToHistory(ws, timestamp);

  const newPanels: Record<string, PanelState> = {};
  let root: PanelLayoutNode;
  if (preset === 'single') {
    const id = panelIds[0];
    newPanels[id] = { id, tabs: [], activeTabId: null };
    root = { type: 'panel', panelId: id };
  } else if (preset === 'split-horizontal') {
    const ids = [panelIds[0], panelIds[1]];
    ids.forEach((id) => {
      newPanels[id] = { id, tabs: [], activeTabId: null };
    });
    root = {
      type: 'split',
      direction: 'horizontal',
      children: ids.map((id) => ({ type: 'panel' as const, panelId: id })),
      sizes: [50, 50],
    };
  } else if (preset === 'split-vertical') {
    const ids = [panelIds[0], panelIds[1]];
    ids.forEach((id) => {
      newPanels[id] = { id, tabs: [], activeTabId: null };
    });
    root = {
      type: 'split',
      direction: 'vertical',
      children: ids.map((id) => ({ type: 'panel' as const, panelId: id })),
      sizes: [50, 50],
    };
  } else {
    // three-column
    const ids = [panelIds[0], panelIds[1], panelIds[2]];
    ids.forEach((id) => {
      newPanels[id] = { id, tabs: [], activeTabId: null };
    });
    root = {
      type: 'split',
      direction: 'horizontal',
      children: ids.map((id) => ({ type: 'panel' as const, panelId: id })),
      sizes: [33.33, 33.34, 33.33],
    };
  }

  ws = { ...ws, root, panels: newPanels, focusedPanelId: panelIds[0] };
  return setWorkspaceState(state, wsId, ws);
});

// Wire up the mutable reference for recursive dispatch
_reducerRef = panelLayoutReducer;
