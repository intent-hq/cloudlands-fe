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
import { removeScript } from '../scripts/scripts-slice';
import { removeTerminal } from '../terminals/terminals-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  BrowserTabViewport,
  PanelTab,
  PanelTabType,
  PanelState,
  PanelLayoutNode,
  PanelLayoutRestoreStatus,
  WorkspacePanelLayoutState,
  PanelLayoutSliceState,
  LayoutSnapshot,
  RecentlyClosedTab,
  RecentlyClosedPanelColumn,
  PanelDragLayoutSnapshot,
  PanelRevealRequest,
  PanelColumnCount,
  SavedExpandSizes,
} from './panel-layout-types';
import {
  MAX_RECENTLY_CLOSED,
  MAX_LAYOUT_HISTORY,
  MAX_FOCUS_HISTORY,
  isPanelColumnCount,
} from './panel-layout-types';
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
  getFixedColumnPanelIds,
  getPanelOrder,
  appendHorizontalPanelToLayout,
  insertFixedColumnInLayout,
  projectPaneMoveInLayout,
  removePanelPreservingHorizontalWidths,
  commitRootHorizontalPanelWidths,
  resizePanelTreeRightEdge,
  type PanelMovePosition,
} from './panel-layout-tabless';
import {
  canUseWideFirstChatLayout,
  DEFAULT_BROWSER_PANEL_WIDTH,
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
import { rebaseRequestedUrlForNavigation } from './browser-tab-rehydration';
import type { ContextLink } from '../../../../shared/types';

// ============================================================================
// ID Generation Helpers (used in payload modifiers)
// ============================================================================

/** Cap on browser tabs seeded from workspace context links at bootstrap. */
export const MAX_SEEDED_CONTEXT_LINK_TABS = 5;

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
  'root' | 'panels' | 'focusedPanelId' | 'canvasWidth' | 'canvasWidthSource' | 'columnCount'
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
    columnCount: 1,
  };
}

export const emptyWorkspaceState: WorkspacePanelLayoutState = {
  root: { type: 'panel', panelId: 'default' },
  panels: { default: { id: 'default', tabs: [], activeTabId: null } },
  focusedPanelId: 'default',
  canvasWidth: null,
  canvasWidthSource: null,
  hiddenTabs: createCollection('id'),
  columnCount: 1,
  columnCountInitialized: false,
  restoreStatus: 'idle',
  pendingFocusTabId: null,
  pendingPanelReveal: null,
  recentlyClosed: [],
  recentlyClosedColumns: createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId'),
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
      columnCount?: PanelColumnCount;
      deferSpecTab?: boolean;
      newWorkspaceLifecycle?: WorkspacePanelLayoutState['newWorkspaceLifecycle'];
    },
  ) => ({
    wsId,
    layout,
  }),
);

export const preparePanelLayoutBackendRestore = createAction(
  'panelLayout/preparePanelLayoutBackendRestore',
  (wsId: string) => [wsId] as const,
);

export const bootstrapNewWorkspaceLayout = createAction(
  'panelLayout/bootstrapNewWorkspaceLayout',
  (
    wsId: string,
    initialAgentId: string | null,
    initialAgentTitle: string,
    coordinator = false,
    timestamp?: number,
    contextLinks?: ContextLink[],
  ) => ({
    wsId,
    initialAgentId,
    initialAgentTitle,
    coordinator,
    panelId: generatePanelId(),
    placeholderPanelId: generatePanelId(),
    browserPanelId: generatePanelId(),
    contextLinkTabs: (contextLinks ?? [])
      .slice(0, MAX_SEEDED_CONTEXT_LINK_TABS)
      .map((link) => ({ link, tabId: generateTabId() })),
    tabId: generateTabId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

/**
 * Seed the agent-left / browser-right split into an already-mounted workspace
 * whose restore found no stored layout — a workspace created elsewhere (iOS,
 * chief-of-staff proposal, sibling workspace) opening on this device for the
 * first time. Mirrors the context-link seeding of bootstrapNewWorkspaceLayout
 * without the new-workspace lifecycle.
 */
export const seedContextLinkEmptyLayout = createAction(
  'panelLayout/seedContextLinkEmptyLayout',
  (wsId: string, contextLinks: ContextLink[]) => ({
    wsId,
    agentPanelId: generatePanelId(),
    browserPanelId: generatePanelId(),
    contextLinkTabs: contextLinks
      .slice(0, MAX_SEEDED_CONTEXT_LINK_TABS)
      .map((link) => ({ link, tabId: generateTabId() })),
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

/**
 * `preserveFocus` (agent-driven opens) activates the tab in the rightmost
 * column so its content paints, but keeps the current panel focus: agents
 * may show content without stealing the user's keyboard focus.
 */
export const openTabInRightmostColumn = createAction(
  'panelLayout/openTabInRightmostColumn',
  (
    wsId: string,
    tab: Omit<PanelTab, 'id'>,
    options?: {
      force?: boolean;
      allowDuplicate?: boolean;
      newTabId?: string;
      preserveFocus?: boolean;
    },
    timestamp?: number,
  ) => ({
    wsId,
    tab,
    force: options?.force ?? false,
    ...(options?.allowDuplicate === undefined ? {} : { allowDuplicate: options.allowDuplicate }),
    preserveFocus: options?.preserveFocus ?? false,
    newTabId: options?.newTabId ?? generateTabId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

export const openTabInRightmostColumnRequested = createAction(
  'panelLayout/openTabInRightmostColumnRequested',
  (
    wsId: string,
    tab: Omit<PanelTab, 'id'>,
    options?: {
      force?: boolean;
      allowDuplicate?: boolean;
      newTabId?: string;
      agentDriven?: boolean;
    },
    timestamp?: number,
  ) => ({
    wsId,
    tab,
    force: options?.force ?? false,
    ...(options?.allowDuplicate === undefined ? {} : { allowDuplicate: options.allowDuplicate }),
    ...(options?.agentDriven === undefined ? {} : { agentDriven: options.agentDriven }),
    newTabId: options?.newTabId ?? generateTabId(),
    timestamp: timestamp ?? Date.now(),
  }),
);

/** Open in the next stack to the right, creating it when below the four-column limit. */
export const openTabInAdjacentOrSplit = createAction(
  'panelLayout/openTabInAdjacentOrSplit',
  (
    wsId: string,
    tab: Omit<PanelTab, 'id'>,
    sourcePanelId?: string,
    options?: {
      animated?: boolean;
      force?: boolean;
      allowDuplicate?: boolean;
      newPanelId?: string;
      newTabId?: string;
    },
    timestamp?: number,
  ) => ({
    wsId,
    tab,
    sourcePanelId,
    animated: options?.animated ?? false,
    force: options?.force ?? false,
    ...(options?.allowDuplicate === undefined ? {} : { allowDuplicate: options.allowDuplicate }),
    newPanelId: options?.newPanelId ?? generatePanelId(),
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
  (
    wsId: string,
    tabId: string,
    panelId?: string,
    timestamp?: number,
    options?: { preservePanel?: boolean; destroy?: boolean } | boolean,
  ) => ({
    wsId,
    tabId,
    panelId,
    timestamp: timestamp ?? Date.now(),
    destroy: typeof options === 'boolean' ? options : options?.destroy === true,
    preservePanel: typeof options === 'object' ? (options.preservePanel ?? false) : false,
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

/** Close focused content, then remove its structural column only when already empty. */
export const closeFocusedPanelTab = createAction(
  'panelLayout/closeFocusedPanelTab',
  (wsId: string, timestamp?: number, availableCanvasWidth?: number, columnHistoryId?: string) => ({
    wsId,
    timestamp: timestamp ?? Date.now(),
    availableCanvasWidth,
    columnHistoryId: columnHistoryId ?? generateTabId(),
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

export const reopenClosedPanelColumn = createAction(
  'panelLayout/reopenClosedPanelColumn',
  (wsId: string, timestamp?: number, requestId?: string) => ({
    wsId,
    timestamp: timestamp ?? Date.now(),
    requestId: requestId ?? generateTabId(),
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
  (wsId: string, panelId: string, timestamp?: number, columnHistoryId?: string) => ({
    wsId,
    panelId,
    timestamp: timestamp ?? Date.now(),
    columnHistoryId: columnHistoryId ?? generateTabId(),
  }),
);

export const reconcilePanelColumnCount = createAction(
  'panelLayout/reconcilePanelColumnCount',
  (
    wsId: string,
    count: PanelColumnCount,
    timestamp?: number,
    recordHistory = true,
    availableCanvasWidth?: number,
  ) => ({
    wsId,
    count,
    newPanelIds: Array.from({ length: 3 }, () => generatePanelId()),
    timestamp: timestamp ?? Date.now(),
    recordHistory,
    availableCanvasWidth,
  }),
);

export const setPanelColumnCount = createAction(
  'panelLayout/setPanelColumnCount',
  (wsId: string, count: number, timestamp?: number, availableCanvasWidth?: number) => ({
    wsId,
    count,
    newPanelIds: Array.from({ length: 3 }, () => generatePanelId()),
    timestamp: timestamp ?? Date.now(),
    availableCanvasWidth,
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

const restorePanelDragLayout = createAction(
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

/** Resize a root divider while preserving the current total canvas width. */
export const resizePanelLayoutAtRootDivider = createAction<
  [wsId: string, previousPanelWidths: readonly number[], finalPanelWidths: readonly number[]]
>('panelLayout/resizePanelLayoutAtRootDivider');

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
    panelCount: Math.max(1, Math.min(4, panelCount)),
    panelIds: Array.from({ length: 4 }, () => generatePanelId()),
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

function clearTabAttention(panel: PanelState, tabId: string): PanelState {
  if (!panel.attentionTabIds?.includes(tabId)) return panel;
  return {
    ...panel,
    attentionTabIds: panel.attentionTabIds.filter((attentionTabId) => attentionTabId !== tabId),
  };
}

function updateEquivalentTabData(
  panel: PanelState,
  match: EquivalentPanelTab,
  requested: Omit<PanelTab, 'id'>,
): PanelTab[] {
  if (!requested.data) return panel.tabs;
  const updatedData = { ...match.tab.data, ...requested.data };
  return panel.tabs.map((tab) => (tab.id === match.tab.id ? { ...tab, data: updatedData } : tab));
}

function addBackgroundTab(
  ws: WorkspacePanelLayoutState,
  panelId: string,
  tab: Omit<PanelTab, 'id'>,
  tabId: string,
): WorkspacePanelLayoutState {
  const panel = ws.panels[panelId];
  if (!panel) return ws;
  return {
    ...ws,
    panels: {
      ...ws.panels,
      [panelId]: {
        ...panel,
        tabs: [...panel.tabs, { ...tab, id: tabId }],
        attentionTabIds: [...(panel.attentionTabIds ?? []), tabId],
        pristine: false,
      },
    },
  };
}

/**
 * Activate a new tab in `panelId` (so its content paints) while keeping the
 * current panel focus and focus history untouched; the queued reveal only
 * scrolls the panel into view (agent-driven visible opens, monorepo#3045).
 */
function activateTabPreservingFocus(
  ws: WorkspacePanelLayoutState,
  panelId: string,
  tab: Omit<PanelTab, 'id'>,
  tabId: string,
  timestamp: number,
): WorkspacePanelLayoutState {
  const panel = ws.panels[panelId];
  if (!panel) return ws;
  const next = saveToHistory(ws, timestamp);
  return {
    ...next,
    panels: {
      ...next.panels,
      [panelId]: {
        ...panel,
        tabs: [...panel.tabs, { ...tab, id: tabId }],
        activeTabId: tabId,
        pristine: false,
      },
    },
    pendingPanelReveal: createPanelRevealRequest(panelId, tabId, tabId),
  };
}

function activateEquivalentTabPreservingFocus(
  ws: WorkspacePanelLayoutState,
  match: EquivalentPanelTab,
  requested: Omit<PanelTab, 'id'>,
  requestId: string,
): WorkspacePanelLayoutState {
  const panel = ws.panels[match.panelId];
  if (!panel) return ws;
  return {
    ...ws,
    panels: {
      ...ws.panels,
      [match.panelId]: {
        ...clearTabAttention(panel, match.tab.id),
        activeTabId: match.tab.id,
        tabs: updateEquivalentTabData(panel, match, requested),
      },
    },
    pendingPanelReveal: createPanelRevealRequest(match.panelId, match.tab.id, requestId),
  };
}

function activateEquivalentTab(
  ws: WorkspacePanelLayoutState,
  match: EquivalentPanelTab,
  requested: Omit<PanelTab, 'id'>,
  requestId: string,
  timestamp: number,
): WorkspacePanelLayoutState {
  const panel = ws.panels[match.panelId];
  const activatedPanel = clearTabAttention(panel, match.tab.id);
  let next: WorkspacePanelLayoutState = {
    ...ws,
    panels: {
      ...ws.panels,
      [match.panelId]: {
        ...activatedPanel,
        activeTabId: match.tab.id,
        tabs: updateEquivalentTabData(panel, match, requested),
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
  const shouldSyncColumnCount =
    ws.columnCount === previousColumnCount && isPanelColumnCount(remainingColumnCount);
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
    columnCount: shouldSyncColumnCount ? remainingColumnCount : ws.columnCount,
    columnCountInitialized: shouldSyncColumnCount ? true : ws.columnCountInitialized,
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

function clonePanelLayoutNode(node: PanelLayoutNode): PanelLayoutNode {
  return JSON.parse(JSON.stringify(node)) as PanelLayoutNode;
}

function clonePanelState(panel: PanelState): PanelState {
  return JSON.parse(JSON.stringify(panel)) as PanelState;
}

function panelLayoutNodesEqual(left: PanelLayoutNode, right: PanelLayoutNode): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'panel' || right.type === 'panel') {
    return left.type === 'panel' && right.type === 'panel' && left.panelId === right.panelId;
  }
  return (
    left.direction === right.direction &&
    left.sizes.length === right.sizes.length &&
    left.sizes.every((size, index) => size === right.sizes[index]) &&
    left.children.length === right.children.length &&
    left.children.every((child, index) => panelLayoutNodesEqual(child, right.children[index]))
  );
}

export function isRecentlyClosedPanelColumnRestorable(
  workspace: WorkspacePanelLayoutState,
  closed: RecentlyClosedPanelColumn,
): boolean {
  if (workspace.panels[closed.panelId]) return false;
  if (!panelLayoutNodesEqual(workspace.root, closed.postCloseRoot)) return false;
  if (getPanelOrder(workspace.root).some((panelId) => !workspace.panels[panelId])) return false;

  const visibleTabIds = new Set(
    Object.values(workspace.panels).flatMap((panel) => panel.tabs.map((tab) => tab.id)),
  );
  return (
    closed.panel.tabs.every((tab) => !visibleTabIds.has(tab.id)) &&
    closed.closedTabIds.every((tabId) =>
      workspace.recentlyClosed.some(
        (entry) => entry.tab.id === tabId && entry.closedAt === closed.closedAt,
      ),
    )
  );
}

function recordClosedPanelColumn(
  before: WorkspacePanelLayoutState,
  after: WorkspacePanelLayoutState,
  historyId: string,
  panelId: string,
  closedAt: number,
  closedTabIds: string[],
): WorkspacePanelLayoutState {
  const panel = before.panels[panelId];
  if (!panel || after.panels[panelId]) return after;

  const closed: RecentlyClosedPanelColumn = {
    historyId,
    panelId,
    panel: clonePanelState(panel),
    root: clonePanelLayoutNode(before.root),
    postCloseRoot: clonePanelLayoutNode(after.root),
    focusedPanelId: before.focusedPanelId,
    columnCount: before.columnCount,
    canvasWidth: before.canvasWidth,
    canvasWidthSource: before.canvasWidthSource,
    expandedPanelId: before.expandedPanelId,
    savedSizesBeforeExpand: JSON.parse(
      JSON.stringify(before.savedSizesBeforeExpand),
    ) as SavedExpandSizes[],
    ...(before.savedCanvasWidthBeforeExpand === undefined
      ? {}
      : { savedCanvasWidthBeforeExpand: before.savedCanvasWidthBeforeExpand }),
    ...(before.savedCanvasWidthSourceBeforeExpand === undefined
      ? {}
      : { savedCanvasWidthSourceBeforeExpand: before.savedCanvasWidthSourceBeforeExpand }),
    pendingFocusTabId: before.pendingFocusTabId,
    closedTabIds: closedTabIds.filter((tabId) =>
      after.recentlyClosed.some((entry) => entry.tab.id === tabId && entry.closedAt === closedAt),
    ),
    closedAt,
  };
  return {
    ...after,
    recentlyClosedColumns: createCollection<RecentlyClosedPanelColumn, 'historyId'>(
      'historyId',
      [
        closed,
        ...getItems(
          after.recentlyClosedColumns ??
            createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId'),
        ).filter((entry) => entry.historyId !== historyId),
      ].slice(0, MAX_RECENTLY_CLOSED),
    ),
  };
}

function removeTabFromClosedPanelColumns(
  workspace: WorkspacePanelLayoutState,
  shouldRemove: (tab: PanelTab) => boolean,
): Collection<RecentlyClosedPanelColumn, 'historyId'> {
  const current =
    workspace.recentlyClosedColumns ??
    createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId');
  let changed = false;
  const columns = getItems(current).map((closed) => {
    const tabs = closed.panel.tabs.filter((tab) => !shouldRemove(tab));
    if (tabs.length === closed.panel.tabs.length) return closed;
    changed = true;
    const removedIds = new Set(
      closed.panel.tabs.filter((tab) => shouldRemove(tab)).map((tab) => tab.id),
    );
    return {
      ...closed,
      panel: {
        ...closed.panel,
        tabs,
        activeTabId: removedIds.has(closed.panel.activeTabId ?? '')
          ? (tabs[0]?.id ?? null)
          : closed.panel.activeTabId,
      },
      closedTabIds: closed.closedTabIds.filter((tabId) => !removedIds.has(tabId)),
      pendingFocusTabId:
        closed.pendingFocusTabId && removedIds.has(closed.pendingFocusTabId)
          ? null
          : closed.pendingFocusTabId,
    };
  });
  return changed
    ? createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId', columns)
    : current;
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

function getEqualFixedColumnCanvasWidth(
  columnCount: number,
  availableCanvasWidth: number | undefined,
  fallbackCanvasWidth: number | null,
): number | null {
  const availableWidth =
    typeof availableCanvasWidth === 'number' &&
    Number.isFinite(availableCanvasWidth) &&
    availableCanvasWidth > 0
      ? availableCanvasWidth
      : fallbackCanvasWidth;
  if (availableWidth === null || !Number.isFinite(availableWidth) || availableWidth <= 0) {
    return null;
  }
  return getAutomaticPanelCanvasWidth(columnCount, 'viewport', availableWidth);
}

function removeFixedColumnFromHistorySnapshot(
  snapshot: LayoutSnapshot,
  panelId: string,
  availableCanvasWidth: number | undefined,
): LayoutSnapshot {
  if (!snapshot.panels[panelId]) return snapshot;
  const originalOrder = getPanelOrder(snapshot.root).filter((id) => snapshot.panels[id]);
  const removedIndex = originalOrder.indexOf(panelId);
  const panelIds = originalOrder.filter((id) => id !== panelId);
  if (removedIndex < 0 || panelIds.length === 0) return snapshot;

  const neighborId = panelIds[Math.min(removedIndex, panelIds.length - 1)];
  const { [panelId]: removedPanel, ...panels } = snapshot.panels;
  const neighbor = panels[neighborId];
  if (neighbor && removedPanel.tabs.length > 0) {
    const seenTabIds = new Set(neighbor.tabs.map((tab) => tab.id));
    const restoredTabs = removedPanel.tabs.filter((tab) => !seenTabIds.has(tab.id));
    const tabs = [...neighbor.tabs, ...restoredTabs];
    panels[neighborId] = {
      ...neighbor,
      tabs,
      activeTabId: neighbor.activeTabId ?? removedPanel.activeTabId ?? tabs[0]?.id ?? null,
      pristine: tabs.length === 0 ? neighbor.pristine : false,
    };
  }

  const canvasWidth = getEqualFixedColumnCanvasWidth(
    panelIds.length,
    availableCanvasWidth,
    snapshot.canvasWidth ?? null,
  );
  return {
    ...snapshot,
    root: createFixedColumnRoot(panelIds),
    panels,
    focusedPanelId: snapshot.focusedPanelId === panelId ? neighborId : snapshot.focusedPanelId,
    columnCount: isPanelColumnCount(panelIds.length) ? panelIds.length : snapshot.columnCount,
    canvasWidth,
    canvasWidthSource: canvasWidth === null ? null : 'explicit',
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

function insertFixedColumn(
  workspace: WorkspacePanelLayoutState,
  targetPanelId: string,
  newPanel: PanelState,
  position: 'before' | 'after',
  requestedPanelWidth: number = DEFAULT_PANEL_WIDTH,
): WorkspacePanelLayoutState | null {
  const panelIds = getFixedColumnPanelIds(workspace);
  if (
    !panelIds ||
    panelIds.length >= 4 ||
    !panelIds.includes(targetPanelId) ||
    workspace.panels[newPanel.id]
  ) {
    return null;
  }
  const root = insertFixedColumnInLayout(
    workspace.root,
    newPanel.id,
    targetPanelId,
    position,
    workspace.canvasWidth,
    requestedPanelWidth,
  );
  const columnCount = panelIds.length + 1;
  if (!root || !isPanelColumnCount(columnCount)) return null;
  return {
    ...workspace,
    root,
    panels: { ...workspace.panels, [newPanel.id]: newPanel },
    focusedPanelId: newPanel.id,
    columnCount,
    columnCountInitialized: true,
    canvasWidth:
      (workspace.canvasWidth ?? getAutomaticPanelCanvasWidth(panelIds.length, 'content')) +
      requestedPanelWidth +
      PANEL_SPLIT_GUTTER_WIDTH,
    canvasWidthSource:
      workspace.canvasWidthSource === 'intrinsic' ? null : workspace.canvasWidthSource,
  };
}

function moveTabIntoFixedColumn(
  workspace: WorkspacePanelLayoutState,
  tabId: string,
  fromPanelId: string,
  targetPanelId: string,
  position: 'before' | 'after',
  newPanelId: string,
  timestamp: number,
): WorkspacePanelLayoutState | null {
  const projection = projectPaneMoveInLayout(
    workspace,
    tabId,
    fromPanelId,
    { kind: 'panel', targetPanelId, position },
    newPanelId,
  );
  if (!projection?.changed) return null;
  const saved = saveToHistory(workspace, timestamp);
  const columnCount = countHorizontalPanelColumns(projection.root);
  return {
    ...saved,
    root: projection.root,
    panels: projection.panels,
    focusedPanelId: projection.destinationPanelId,
    columnCount: isPanelColumnCount(columnCount) ? columnCount : saved.columnCount,
    columnCountInitialized: isPanelColumnCount(columnCount) ? true : saved.columnCountInitialized,
    canvasWidth: projection.canvasWidth ?? null,
    canvasWidthSource:
      workspace.canvasWidthSource === 'intrinsic' &&
      projection.canvasWidth !== workspace.canvasWidth
        ? null
        : workspace.canvasWidthSource,
  };
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
  availableCanvasWidth?: number,
): WorkspacePanelLayoutState {
  const restored = restoreExpandedWorkspaceLayout(workspace);
  const originalOrder = getPanelOrder(restored.root).filter((panelId) => restored.panels[panelId]);
  if (originalOrder.length === 0) return { ...restored, columnCount: count };
  const hasLegacyPin = Object.values(restored.panels).some((panel) => 'pinned' in panel);
  if (
    originalOrder.length === count &&
    isFixedColumnRoot(restored.root, originalOrder) &&
    !hasLegacyPin
  ) {
    return restored.columnCount === count ? restored : { ...restored, columnCount: count };
  }

  const next = recordHistory ? saveToHistory(restored, timestamp) : restored;
  const panels = Object.fromEntries(
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
    const activeTabId = survivor.activeTabId ?? fallbackActiveTabId ?? mergedTabs[0]?.id ?? null;
    const attentionTabIds = [
      ...(survivor.attentionTabIds ?? []),
      ...removedPanelIds.flatMap((panelId) => panels[panelId]?.attentionTabIds ?? []),
    ].filter((tabId, index, ids) => tabId !== activeTabId && ids.indexOf(tabId) === index);
    panels[survivingRightmostId] = {
      ...survivor,
      tabs: mergedTabs,
      activeTabId,
      attentionTabIds,
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
  const previousColumnCount = originalOrder.length;
  const nextColumnCount = panelIds.length;
  const addedColumns = nextColumnCount > previousColumnCount;
  const fitsAvailableCanvas =
    addedColumns &&
    typeof availableCanvasWidth === 'number' &&
    Number.isFinite(availableCanvasWidth) &&
    availableCanvasWidth > 0;
  const focusedPanelId = fitsAvailableCanvas
    ? (panelIds.at(-1) ?? null)
    : next.focusedPanelId && !removedSet.has(next.focusedPanelId)
      ? next.focusedPanelId
      : (survivingRightmostId ?? panelIds[0] ?? null);
  const canvasWidth = (() => {
    if (fitsAvailableCanvas) return null;
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
    canvasWidthSource: fitsAvailableCanvas
      ? null
      : next.canvasWidthSource === 'intrinsic'
        ? null
        : next.canvasWidthSource,
    columnCount: count,
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
    columnCount: ws.columnCount,
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

/** Strip matching tabs from history so navigation cannot resurrect deleted resources. */
function purgeTabsFromLayoutHistory(
  ws: WorkspacePanelLayoutState,
  shouldRemove: (tab: PanelTab) => boolean,
): WorkspacePanelLayoutState {
  let changed = false;
  const layoutHistory = ws.layoutHistory.map((snapshot) => {
    let snapshotChanged = false;
    const panels: Record<string, PanelState> = {};
    for (const [pId, panel] of Object.entries(snapshot.panels)) {
      if (panel.tabs.some(shouldRemove)) {
        snapshotChanged = true;
        const tabs = panel.tabs.filter((tab) => !shouldRemove(tab));
        panels[pId] = {
          ...panel,
          tabs,
          activeTabId: tabs.some((tab) => tab.id === panel.activeTabId)
            ? panel.activeTabId
            : (tabs[0]?.id ?? null),
          attentionTabIds: panel.attentionTabIds?.filter((tabId) =>
            tabs.some((tab) => tab.id === tabId),
          ),
        };
      } else {
        panels[pId] = panel;
      }
    }
    if (!snapshotChanged) return snapshot;
    changed = true;
    return { ...snapshot, panels };
  });
  const recentlyClosedColumns = removeTabFromClosedPanelColumns(ws, shouldRemove);
  if (
    ws.recentlyClosedColumns
      ? recentlyClosedColumns !== ws.recentlyClosedColumns
      : recentlyClosedColumns.ids.length > 0
  ) {
    changed = true;
  }
  return changed ? { ...ws, layoutHistory, recentlyClosedColumns } : ws;
}

function purgeTabFromLayoutHistory(
  ws: WorkspacePanelLayoutState,
  tabId: string,
): WorkspacePanelLayoutState {
  return purgeTabsFromLayoutHistory(ws, (tab) => tab.id === tabId);
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

export const updateTabViewport = createAction<
  [wsId: string, tabId: string, viewport: BrowserTabViewport]
>('panelLayout/updateTabViewport');

function browserTabViewportEqual(
  left: BrowserTabViewport | undefined,
  right: BrowserTabViewport,
): boolean {
  if (left?.mode !== right.mode) return false;
  if (right.mode === 'fit') return true;
  if (left.mode === 'fit') return false;
  return (
    left.width === right.width &&
    left.height === right.height &&
    (right.mode !== 'preset' || (left.mode === 'preset' && left.presetId === right.presetId))
  );
}

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
    ownerAgentName?: string,
    viewport?: BrowserTabViewport,
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
 * Create an agent-owned browser tab directly in `hiddenTabs` (monorepo#3045):
 * agent openTab is hidden by default — the tab is alive (webview mounted
 * offscreen, CDP-addressable) but never enters a panel and never moves focus
 * or the active tab. Reveal happens via restoreHiddenTab (or a later
 * showTab-driven path).
 */
export const openHiddenTab = createAction(
  'panelLayout/openHiddenTab',
  (wsId: string, tab: Omit<PanelTab, 'id'>, newTabId?: string) => ({
    wsId,
    tab,
    newTabId: newTabId ?? generateTabId(),
  }),
);

/**
 * Restore a hidden (user-closed) agent-owned browser tab back into a panel
 * (monorepo#2857), keeping its id so the live webview and main's
 * registrations stay attached. `focus` (default true) opens the tab in the
 * focused panel, activates it, and focuses/reveals its panel.
 * `focus: false` (agent showTab without focus, monorepo#3045) adds the pane
 * to another stack when available, marks it for attention, and preserves
 * both the active pane and panel focus.
 */
export const restoreHiddenTab = createAction(
  'panelLayout/restoreHiddenTab',
  (wsId: string, tabId: string, timestamp?: number, focus?: boolean) => ({
    wsId,
    tabId,
    timestamp: timestamp ?? Date.now(),
    focus: focus ?? true,
  }),
);

// `tabId` scopes the retarget to one specific tab (e.g. a candidate click in
// that tab's not-found panel); without it, every file tab at `oldPath`
// retargets (file renames and the read saga, which has no tab identity).
export const updateFileTabPath = createAction<
  [wsId: string, oldPath: string, newPath: string, tabId?: string]
>('panelLayout/updateFileTabPath');

/**
 * Reveal a hidden (user-closed) agent-owned browser tab WITHOUT displacing or
 * refocusing `avoidPanelId` (the panel hosting the agent conversation whose
 * footer initiated the reveal): the tab is restored and activated in the
 * first other fixed column in layout order. When no other column exists, it
 * activates in the sole column. Panel focus never moves.
 */
export const revealHiddenTabAvoidingPanel = createAction(
  'panelLayout/revealHiddenTabAvoidingPanel',
  (wsId: string, tabId: string, avoidPanelId: string | null, timestamp?: number) => ({
    wsId,
    tabId,
    avoidPanelId,
    timestamp: timestamp ?? Date.now(),
  }),
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

/**
 * Build the seeded agent-left / browser-right split for a workspace created
 * with context links (issues/PRs). Returns null when there are no links, so
 * plain creates keep the existing single-panel bootstrap byte-for-byte.
 */
function buildContextLinkBrowserSeed(
  wsId: string,
  agentPanelId: string,
  browserPanelId: string,
  contextLinkTabs: { link: ContextLink; tabId: string }[],
): { root: PanelLayoutNode; panels: Record<string, PanelState> } | null {
  if (contextLinkTabs.length === 0) return null;
  const browserTabs: PanelTab[] = contextLinkTabs.map(({ link, tabId }) => ({
    id: tabId,
    type: 'browser',
    title: `${link.owner}/${link.repo}#${link.number}`, // i18n-ignore (identifier: owner/repo#number; replaced by page title on load)
    browserUrl: link.url,
    workspaceId: wsId,
    closable: true,
  }));
  const totalWidth = DEFAULT_CHAT_PANEL_WIDTH + DEFAULT_BROWSER_PANEL_WIDTH;
  return {
    root: {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'panel', panelId: agentPanelId },
        { type: 'panel', panelId: browserPanelId },
      ],
      sizes: [
        (DEFAULT_CHAT_PANEL_WIDTH / totalWidth) * 100,
        (DEFAULT_BROWSER_PANEL_WIDTH / totalWidth) * 100,
      ],
    },
    panels: {
      [agentPanelId]: { id: agentPanelId, tabs: [], activeTabId: null, pristine: true },
      [browserPanelId]: {
        id: browserPanelId,
        tabs: browserTabs,
        activeTabId: browserTabs[0]?.id ?? null,
      },
    },
  };
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
  // A context-link-seeded panel still carrying browser tabs keeps its wider
  // browser tier — narrowing to the canonical chat+medium pair would degrade
  // those tabs once the user switches back from the revealed Spec.
  if (workspace.panels[specPanelId]?.tabs.some((tab) => tab.type === 'browser')) {
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
    columnCount: ws.columnCountInitialized
      ? ws.columnCount
      : isPanelColumnCount(layout.columnCount)
        ? layout.columnCount
        : (Math.min(4, Math.max(1, countHorizontalPanelColumns(layout.root))) as PanelColumnCount),
    columnCountInitialized: true,
    deferSpecTab: layout.deferSpecTab ?? false,
    newWorkspaceLifecycle: layout.newWorkspaceLifecycle ?? null,
    pendingFocusTabId: null,
    pendingPanelReveal: null,
  });
});
panelLayoutReducer.with(preparePanelLayoutBackendRestore, (state, { payload: [wsId] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, columnCountInitialized: false });
});
panelLayoutReducer.with(bootstrapNewWorkspaceLayout, (state, { payload }) => {
  const {
    wsId,
    initialAgentId,
    initialAgentTitle,
    coordinator,
    placeholderPanelId,
    browserPanelId,
    contextLinkTabs,
    tabId,
    timestamp,
  } = payload;
  const agentPanel: PanelState = {
    id: placeholderPanelId,
    tabs: [],
    activeTabId: null,
    pristine: true,
  };
  // Context links seed a two-column split: agent left, one browser panel
  // right with a tab per link (issues/PRs stack as tabs, never sub-splits).
  const contextLinkSeed = buildContextLinkBrowserSeed(
    wsId,
    placeholderPanelId,
    browserPanelId,
    contextLinkTabs ?? [],
  );
  const bootstrapped = setWorkspaceState(state, wsId, {
    ...emptyWorkspaceState,
    root: contextLinkSeed?.root ?? { type: 'panel', panelId: placeholderPanelId },
    panels: contextLinkSeed?.panels ?? { [placeholderPanelId]: agentPanel },
    focusedPanelId: placeholderPanelId,
    ...(contextLinkSeed
      ? {
          columnCount: 2 as PanelColumnCount,
          ...resolveIntrinsicPanelCanvasWidth(
            DEFAULT_CHAT_PANEL_WIDTH + DEFAULT_BROWSER_PANEL_WIDTH + PANEL_SPLIT_GUTTER_WIDTH,
          ),
        }
      : {}),
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
  const { wsId, agentId, title, tabId, timestamp } = payload;
  const ws = getWorkspaceState(state, wsId);
  const lifecycle = ws.newWorkspaceLifecycle;
  if (!lifecycle?.initialAgentPending) return state;
  return openNewWorkspaceInitialAgent(state, wsId, agentId, title, tabId, timestamp);
});
panelLayoutReducer.with(seedContextLinkEmptyLayout, (state, { payload }) => {
  const { wsId, agentPanelId, browserPanelId, contextLinkTabs } = payload;
  const ws = getWorkspaceState(state, wsId);
  // Only a genuinely empty workspace gets seeded: a fresh-create lifecycle,
  // any visible tab, or any hidden tab means a layout already exists (or is
  // being bootstrapped) and must win.
  if (ws.newWorkspaceLifecycle) return state;
  if (Object.values(ws.panels).some((panel) => panel.tabs.length > 0)) return state;
  if (ws.hiddenTabs.ids.length > 0) return state;
  const seed = buildContextLinkBrowserSeed(wsId, agentPanelId, browserPanelId, contextLinkTabs);
  if (!seed) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    root: seed.root,
    panels: seed.panels,
    focusedPanelId: agentPanelId,
    columnCount: 2 as PanelColumnCount,
    columnCountInitialized: true,
    ...resolveIntrinsicPanelCanvasWidth(
      DEFAULT_CHAT_PANEL_WIDTH + DEFAULT_BROWSER_PANEL_WIDTH + PANEL_SPLIT_GUTTER_WIDTH,
    ),
    pendingFocusTabId: null,
    pendingPanelReveal: null,
  });
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
  const { wsId, tab, force, allowDuplicate, newTabId, timestamp, preserveFocus } = payload;
  const ws = getWorkspaceState(state, wsId);
  const targetPanelId = getPanelOrder(ws.root)
    .filter((panelId) => ws.panels[panelId])
    .at(-1);
  if (!targetPanelId) return state;
  if (preserveFocus) {
    if (tab.workspaceId && tab.workspaceId !== wsId) return state;
    if (ws.deferSpecTab && tab.type === 'note' && tab.noteId === 'spec' && !force) return state;
    const existing = allowDuplicate ? null : findEquivalentPanelTab(wsId, ws, tab, targetPanelId);
    const next = existing
      ? activateEquivalentTabPreservingFocus(ws, existing, tab, newTabId)
      : activateTabPreservingFocus(ws, targetPanelId, tab, newTabId, timestamp);
    return next === ws ? state : setWorkspaceState(state, wsId, next);
  }
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

  const visiblePanelIds = getPanelOrder(ws.root).filter((panelId) => ws.panels[panelId]);
  if (visiblePanelIds.length >= 4) {
    return selfDispatch(
      state,
      openTabInAdjacentOrSplit(
        wsId,
        tab,
        payload.sourcePanelId ?? ws.focusedPanelId ?? visiblePanelIds.at(-1),
        { force, allowDuplicate: payload.allowDuplicate, newPanelId, newTabId },
        timestamp,
      ),
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
        columnCount: 2,
        columnCountInitialized: true,
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
  const nextColumnCount = visiblePanelIds.length + 1;
  ws = {
    ...ws,
    root: appendedRoot,
    panels: {
      ...ws.panels,
      [newPanelId]: { id: newPanelId, tabs: [newTab], activeTabId: newTabId },
    },
    focusedPanelId: newPanelId,
    columnCount: isPanelColumnCount(nextColumnCount) ? nextColumnCount : ws.columnCount,
    columnCountInitialized: true,
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
  const { wsId, tabId, panelId, timestamp, destroy, preservePanel } = payload;
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
        purgeTabFromLayoutHistory({ ...ws, hiddenTabs: removeItem(ws.hiddenTabs, tabId) }, tabId),
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
        purgeTabFromLayoutHistory({ ...ws, hiddenTabs: removeItem(ws.hiddenTabs, tabId) }, tabId),
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
  const panelWithoutClosedAttention = clearTabAttention(panel, tabId);
  const nextPanel = newActiveTabId
    ? clearTabAttention(panelWithoutClosedAttention, newActiveTabId)
    : panelWithoutClosedAttention;

  ws = {
    ...ws,
    panels: {
      ...ws.panels,
      [targetPanelId]: { ...nextPanel, tabs: newTabs, activeTabId: newActiveTabId },
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
  if (!preservePanel && newTabs.length === 0 && Object.keys(ws.panels).length > 1) {
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
// --- Close Focused Panel Content Or Its Already-Empty Column ---
panelLayoutReducer.with(closeFocusedPanelTab, (state, { payload }) => {
  const { wsId, timestamp, availableCanvasWidth, columnHistoryId } = payload;
  const ws = getWorkspaceState(state, wsId);
  const panelId = ws.focusedPanelId;
  if (!panelId || !ws.panels[panelId]) return state;

  const panel = ws.panels[panelId];
  if (!panel.activeTabId) {
    if (panel.tabs.length > 0 || ws.columnCount <= 1) return state;
    const panelIds = getPanelOrder(ws.root).filter((id) => ws.panels[id]);
    if (
      panelIds.length !== ws.columnCount ||
      !isFixedColumnRoot(ws.root, panelIds) ||
      panelIds.length <= 1
    ) {
      return state;
    }

    const removedIndex = panelIds.indexOf(panelId);
    if (removedIndex < 0) return state;
    const remainingPanelIds = panelIds.filter((id) => id !== panelId);
    const focusedPanelId = remainingPanelIds[Math.min(removedIndex, remainingPanelIds.length - 1)];
    const columnCount = (ws.columnCount - 1) as PanelColumnCount;
    const canvasWidth = getEqualFixedColumnCanvasWidth(
      columnCount,
      availableCanvasWidth,
      ws.canvasWidth,
    );
    const removed = closePanelHelper(ws, panelId);
    if (removed === ws) return state;

    const closedWorkspace = {
      ...removed,
      root: createFixedColumnRoot(remainingPanelIds),
      focusedPanelId,
      columnCount,
      columnCountInitialized: true,
      canvasWidth,
      canvasWidthSource: canvasWidth === null ? null : 'explicit',
      layoutHistory: removed.layoutHistory.map((snapshot) =>
        removeFixedColumnFromHistorySnapshot(snapshot, panelId, availableCanvasWidth),
      ),
    } satisfies WorkspacePanelLayoutState;
    return setWorkspaceState(
      state,
      wsId,
      recordClosedPanelColumn(ws, closedWorkspace, columnHistoryId, panelId, timestamp, []),
    );
  }

  const activeTab = panel.tabs.find((tab) => tab.id === panel.activeTabId);
  if (!activeTab || activeTab.closable === false) return state;

  return selfDispatch(
    state,
    closeTab(wsId, activeTab.id, panelId, timestamp, { preservePanel: true }),
  );
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
// --- Open Hidden Tab (monorepo#3045) ---
panelLayoutReducer.with(openHiddenTab, (state, { payload }) => {
  const { wsId, tab, newTabId } = payload;
  const ws = getWorkspaceState(state, wsId);
  // The id may already exist (a redelivered open): hiddenTabs is keyed by
  // id so addItem would replace, but treat it as a no-op instead — the
  // existing live tab (hidden or visible) must not be disturbed.
  if (getItem(ws.hiddenTabs, newTabId)) return state;
  for (const panel of Object.values(ws.panels)) {
    if (panel.tabs.some((t) => t.id === newTabId)) return state;
  }
  // No history save, no focus/active-tab change, no panel reveal: a hidden
  // open must be invisible to the user's layout (undo must not resurface
  // it, and it is not part of any snapshot until revealed).
  return setWorkspaceState(state, wsId, {
    ...ws,
    hiddenTabs: addItem(ws.hiddenTabs, { ...tab, id: newTabId }),
  });
});
// --- Restore Hidden Tab (monorepo#2857) ---
panelLayoutReducer.with(restoreHiddenTab, (state, { payload }) => {
  const { wsId, tabId, timestamp, focus } = payload;
  let ws = getWorkspaceState(state, wsId);
  const hiddenTab = getItem(ws.hiddenTabs, tabId);
  if (!hiddenTab) return state;

  if (focus) {
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
  }

  // focus: false (agent showTab without focus): add the pane to another stack
  // when available and signal it without replacing visible content or focus.
  const previousFocusedPanelId = ws.focusedPanelId;
  const order = getPanelOrder(ws.root);
  const targetPanelId =
    order.find((panelId) => panelId !== previousFocusedPanelId && ws.panels[panelId]) ??
    (previousFocusedPanelId && ws.panels[previousFocusedPanelId]
      ? previousFocusedPanelId
      : order.find((panelId) => ws.panels[panelId]));
  if (!targetPanelId) return state;
  ws = addBackgroundTab(
    { ...ws, hiddenTabs: removeItem(ws.hiddenTabs, tabId) },
    targetPanelId,
    hiddenTab,
    hiddenTab.id,
  );
  return setWorkspaceState(state, wsId, { ...ws, focusedPanelId: previousFocusedPanelId });
});
// --- Prune Recently Closed ---
panelLayoutReducer.with(pruneRecentlyClosed, (state, { payload: [wsId, match] }) => {
  const ws = getWorkspaceState(state, wsId);
  const { agentId, terminalId } = match;
  if (!agentId && !terminalId) return state;
  const shouldRemove = (tab: PanelTab) =>
    Boolean(
      (agentId && tab.type === 'agent' && tab.agentId === agentId) ||
      (terminalId && tab.type === 'terminal' && tab.terminalId === terminalId),
    );
  const filtered = ws.recentlyClosed.filter((entry) => {
    return !shouldRemove(entry.tab);
  });
  const recentlyClosedColumns = removeTabFromClosedPanelColumns(ws, shouldRemove);
  const columnsChanged = ws.recentlyClosedColumns
    ? recentlyClosedColumns !== ws.recentlyClosedColumns
    : recentlyClosedColumns.ids.length > 0;
  if (filtered.length === ws.recentlyClosed.length && !columnsChanged) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    recentlyClosed: filtered,
    recentlyClosedColumns,
  });
});
// --- Cross-slice: prune recentlyClosed when a terminal is removed ---
panelLayoutReducer.with(removeTerminal, (state, { payload: [wsId, termId] }) => {
  const ws = state.byWorkspaceId[wsId];
  if (!ws) return state;
  const shouldRemove = (tab: PanelTab) => tab.type === 'terminal' && tab.terminalId === termId;
  const filtered = ws.recentlyClosed.filter((entry) => !shouldRemove(entry.tab));
  const recentlyClosedColumns = removeTabFromClosedPanelColumns(ws, shouldRemove);
  const columnsChanged = ws.recentlyClosedColumns
    ? recentlyClosedColumns !== ws.recentlyClosedColumns
    : recentlyClosedColumns.ids.length > 0;
  if (filtered.length === ws.recentlyClosed.length && !columnsChanged) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    recentlyClosed: filtered,
    recentlyClosedColumns,
  });
});
// --- Cross-slice: destroy script-backed tabs when a script is removed ---
panelLayoutReducer.with(removeScript, (state, { payload: [wsId, scriptId] }) => {
  const current = state.byWorkspaceId[wsId];
  if (!current) return state;

  const shouldRemove = (tab: PanelTab) => tab.type === 'terminal' && tab.scriptId === scriptId;
  const removedTabIds = new Set<string>();
  const emptiedPanelIds: string[] = [];
  let panels = current.panels;

  for (const [panelId, panel] of Object.entries(current.panels)) {
    const tabs = panel.tabs.filter((tab) => {
      if (!shouldRemove(tab)) return true;
      removedTabIds.add(tab.id);
      return false;
    });
    if (tabs.length === panel.tabs.length) continue;
    if (panels === current.panels) panels = { ...current.panels };
    const activeIndex = panel.tabs.findIndex((tab) => tab.id === panel.activeTabId);
    const activeWasRemoved = activeIndex >= 0 && shouldRemove(panel.tabs[activeIndex]);
    const fallbackIndex = panel.tabs
      .slice(0, Math.max(0, activeIndex))
      .filter((tab) => !shouldRemove(tab)).length;
    panels[panelId] = {
      ...panel,
      tabs,
      activeTabId: activeWasRemoved
        ? (tabs[Math.min(fallbackIndex, tabs.length - 1)]?.id ?? null)
        : panel.activeTabId,
      attentionTabIds: panel.attentionTabIds?.filter((tabId) => !removedTabIds.has(tabId)),
    };
    if (tabs.length === 0) emptiedPanelIds.push(panelId);
  }

  const recentlyClosed = current.recentlyClosed.filter((entry) => !shouldRemove(entry.tab));
  let next = current;
  if (panels !== current.panels || recentlyClosed.length !== current.recentlyClosed.length) {
    next = {
      ...current,
      panels,
      recentlyClosed,
      pendingFocusTabId:
        current.pendingFocusTabId && removedTabIds.has(current.pendingFocusTabId)
          ? null
          : current.pendingFocusTabId,
      pendingPanelReveal:
        current.pendingPanelReveal?.tabId && removedTabIds.has(current.pendingPanelReveal.tabId)
          ? null
          : current.pendingPanelReveal,
      focusHistory: current.focusHistory.filter((entry) => !removedTabIds.has(entry.tabId)),
    };
  }
  next = purgeTabsFromLayoutHistory(next, shouldRemove);

  if (next === current) return state;

  for (const panelId of emptiedPanelIds) {
    if (next.panels[panelId] && Object.keys(next.panels).length > 1) {
      next = closePanelHelper(next, panelId);
    }
  }
  next = {
    ...next,
    focusHistoryIndex: Math.min(next.focusHistoryIndex, next.focusHistory.length - 1),
  };
  return setWorkspaceState(state, wsId, next);
});
// --- Reopen Closed Panel Column ---
panelLayoutReducer.with(reopenClosedPanelColumn, (state, { payload }) => {
  const { wsId, timestamp, requestId } = payload;
  let ws = getWorkspaceState(state, wsId);
  const closedColumns = getItems(
    ws.recentlyClosedColumns ??
      createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId'),
  );
  const closedIndex = closedColumns.findIndex((closed) =>
    isRecentlyClosedPanelColumnRestorable(ws, closed),
  );
  if (closedIndex < 0) return state;

  const closed = closedColumns[closedIndex];
  ws = saveToHistory(ws, timestamp);
  const panels = { ...ws.panels, [closed.panelId]: clonePanelState(closed.panel) };
  ws = {
    ...ws,
    root: clonePanelLayoutNode(closed.root),
    panels,
    focusedPanelId: closed.focusedPanelId,
    hiddenTabs: dropTabsPresentInPanels(ws.hiddenTabs ?? createCollection('id'), panels),
    columnCount: closed.columnCount,
    columnCountInitialized: true,
    canvasWidth: closed.canvasWidth,
    canvasWidthSource: closed.canvasWidthSource,
    expandedPanelId: closed.expandedPanelId,
    savedSizesBeforeExpand: JSON.parse(
      JSON.stringify(closed.savedSizesBeforeExpand),
    ) as SavedExpandSizes[],
    savedCanvasWidthBeforeExpand: closed.savedCanvasWidthBeforeExpand,
    savedCanvasWidthSourceBeforeExpand: closed.savedCanvasWidthSourceBeforeExpand,
    pendingFocusTabId:
      closed.pendingFocusTabId &&
      closed.panel.tabs.some((tab) => tab.id === closed.pendingFocusTabId)
        ? closed.pendingFocusTabId
        : ws.pendingFocusTabId,
    pendingPanelReveal:
      closed.focusedPanelId === closed.panelId
        ? createPanelRevealRequest(closed.panelId, closed.panel.activeTabId, requestId)
        : ws.pendingPanelReveal,
    recentlyClosed: ws.recentlyClosed.filter(
      (entry) => entry.closedAt !== closed.closedAt || !closed.closedTabIds.includes(entry.tab.id),
    ),
    recentlyClosedColumns: createCollection<RecentlyClosedPanelColumn, 'historyId'>(
      'historyId',
      closedColumns.filter((_, index) => index !== closedIndex),
    ),
  };
  if (closed.focusedPanelId === closed.panelId && closed.panel.activeTabId) {
    ws = addToFocusHistory(ws, closed.panelId, closed.panel.activeTabId, timestamp);
  }
  return setWorkspaceState(state, wsId, ws);
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
  // layout rehydration) and block other agents from claiming the tab. The
  // persisted owner name goes with it (monorepo#3438).
  const { ownerAgentId: _staleOwner, ownerAgentName: _staleOwnerName, ...closedTab } = closed.tab;
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
    panels: {
      ...ws.panels,
      [targetPanelId]: { ...clearTabAttention(panel, tabId), activeTabId: tabId },
    },
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
  if (fromPanelId === toPanelId) return state;
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
      [fromPanelId]: {
        ...fromPanel,
        tabs: newFromTabs,
        activeTabId: newFromActiveTabId,
        attentionTabIds: fromPanel.attentionTabIds?.filter((id) => id !== tab.id),
        pristine: newFromTabs.length === 0 ? true : fromPanel.pristine,
      },
      [toPanelId]: {
        ...toPanel,
        tabs: newToTabs,
        activeTabId: tab.id,
        attentionTabIds: toPanel.attentionTabIds?.filter((id) => id !== tab.id),
      },
    },
    focusedPanelId: toPanelId,
  };

  if (newFromTabs.length === 0) {
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
  (state, { payload: [wsId, tabId, ownerAgentId, emulatedSize, ownerAgentName, viewport] }) => {
    const ws = getWorkspaceState(state, wsId);
    const nextViewport =
      viewport ??
      (emulatedSize === undefined ? undefined : { mode: 'custom' as const, ...emulatedSize });
    for (const [pId, panel] of Object.entries(ws.panels)) {
      const tabIdx = panel.tabs.findIndex((t) => t.id === tabId && t.type === 'browser');
      if (tabIdx >= 0) {
        const tab = panel.tabs[tabIdx];
        const unchanged =
          tab.ownerAgentId === ownerAgentId &&
          (emulatedSize === undefined ||
            (tab.emulatedSize?.width === emulatedSize.width &&
              tab.emulatedSize?.height === emulatedSize.height)) &&
          (nextViewport === undefined || browserTabViewportEqual(tab.viewport, nextViewport)) &&
          (ownerAgentName === undefined || tab.ownerAgentName === ownerAgentName);
        if (unchanged) return state;
        const newTabs = panel.tabs.map((t, i) =>
          i === tabIdx
            ? {
                ...t,
                ownerAgentId,
                ...(emulatedSize === undefined ? {} : { emulatedSize }),
                ...(nextViewport === undefined ? {} : { viewport: nextViewport }),
                // An undefined name keeps any previously persisted one — a
                // notification that couldn't resolve the name must not erase
                // it (monorepo#3438).
                ...(ownerAgentName === undefined ? {} : { ownerAgentName }),
              }
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
            hiddenTab.emulatedSize?.height === emulatedSize.height)) &&
        (nextViewport === undefined || browserTabViewportEqual(hiddenTab.viewport, nextViewport)) &&
        (ownerAgentName === undefined || hiddenTab.ownerAgentName === ownerAgentName);
      if (unchanged) return state;
      return setWorkspaceState(state, wsId, {
        ...ws,
        hiddenTabs: updateItem(ws.hiddenTabs, {
          id: tabId,
          ownerAgentId,
          ...(emulatedSize === undefined ? {} : { emulatedSize }),
          ...(nextViewport === undefined ? {} : { viewport: nextViewport }),
          ...(ownerAgentName === undefined ? {} : { ownerAgentName }),
        }),
      });
    }
    return state;
  },
);
// --- Update Browser Tab Viewport ---
panelLayoutReducer.with(updateTabViewport, (state, { payload: [wsId, tabId, viewport] }) => {
  const ws = getWorkspaceState(state, wsId);
  for (const [pId, panel] of Object.entries(ws.panels)) {
    const tab = panel.tabs.find(
      (candidate) => candidate.id === tabId && candidate.type === 'browser',
    );
    if (!tab) continue;
    if (browserTabViewportEqual(tab.viewport, viewport)) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      panels: {
        ...ws.panels,
        [pId]: {
          ...panel,
          tabs: panel.tabs.map((candidate) =>
            candidate.id === tabId ? { ...candidate, viewport } : candidate,
          ),
        },
      },
    });
  }
  const hiddenTab = getItem(ws.hiddenTabs, tabId);
  if (!hiddenTab || hiddenTab.type !== 'browser') return state;
  if (browserTabViewportEqual(hiddenTab.viewport, viewport)) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    hiddenTabs: updateItem(ws.hiddenTabs, { id: tabId, viewport }),
  });
});
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
  const { wsId, panelId, direction, panelWidth, newPanelId, timestamp } = payload;
  if (direction !== 'horizontal') return state;
  const current = restoreExpandedWorkspaceLayout(getWorkspaceState(state, wsId));
  const panelIds = getFixedColumnPanelIds(current);
  if (
    !panelIds ||
    panelIds.length >= 4 ||
    !panelIds.includes(panelId) ||
    current.panels[newPanelId]
  ) {
    return state;
  }
  const newPanelWidth =
    typeof panelWidth === 'number' && Number.isFinite(panelWidth) && panelWidth > 0
      ? panelWidth
      : DEFAULT_PANEL_WIDTH;
  const saved = saveToHistory(current, timestamp);
  const inserted = insertFixedColumn(
    saved,
    panelId,
    { id: newPanelId, tabs: [], activeTabId: null },
    'after',
    newPanelWidth,
  );
  if (!inserted) return state;
  return setWorkspaceState(state, wsId, {
    ...inserted,
    expandedPanelId: null,
    savedSizesBeforeExpand: [],
    pendingPanelReveal: createPanelRevealRequest(newPanelId, null, newPanelId),
  });
});
panelLayoutReducer.with(openBlankWorkingPanel, (state, { payload }) => {
  const { wsId, newPanelId, timestamp } = payload;
  const current = restoreExpandedWorkspaceLayout(getWorkspaceState(state, wsId));
  const focusedPanelId = current.focusedPanelId;
  if (!focusedPanelId) return state;
  const inserted = insertFixedColumn(
    saveToHistory(current, timestamp),
    focusedPanelId,
    { id: newPanelId, tabs: [], activeTabId: null, pristine: true },
    'after',
  );
  if (!inserted) return state;
  return setWorkspaceState(state, wsId, {
    ...inserted,
    expandedPanelId: null,
    savedSizesBeforeExpand: [],
    pendingFocusTabId: null,
    pendingPanelReveal: createPanelRevealRequest(newPanelId, null, newPanelId),
  });
});
// --- Close Panel ---
panelLayoutReducer.with(closePanel, (state, { payload }) => {
  const { wsId, panelId, timestamp, columnHistoryId } = payload;
  const ws = getWorkspaceState(state, wsId);
  const panel = ws.panels[panelId];
  if (!panel) return state;

  // No-op if panel contains any non-closable tabs
  if (panel.tabs.some((tab) => tab.closable === false)) return state;

  let updatedWs = saveToHistory(ws, timestamp);
  updatedWs = closePanelHelper(updatedWs, panelId, timestamp);
  updatedWs = recordClosedPanelColumn(
    ws,
    updatedWs,
    columnHistoryId,
    panelId,
    timestamp,
    panel.tabs
      .filter((tab) => tab.closable !== false && !isHideOnCloseTab(tab))
      .map((tab) => tab.id),
  );
  return setWorkspaceState(state, wsId, updatedWs);
});
panelLayoutReducer.with(reconcilePanelColumnCount, (state, { payload }) => {
  const { wsId, count, newPanelIds, timestamp, recordHistory, availableCanvasWidth } = payload;
  const ws = getWorkspaceState(state, wsId);
  const reconciled = reconcileWorkspacePanelColumns(
    ws,
    count,
    newPanelIds,
    timestamp,
    recordHistory,
    availableCanvasWidth,
  );
  return setWorkspaceState(state, wsId, reconciled);
});
panelLayoutReducer.with(setPanelColumnCount, (state, { payload }) => {
  const { wsId, count, newPanelIds, timestamp, availableCanvasWidth } = payload;
  if (!isPanelColumnCount(count)) return state;
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...reconcileWorkspacePanelColumns(
      ws,
      count,
      newPanelIds,
      timestamp,
      true,
      availableCanvasWidth,
    ),
    columnCountInitialized: true,
  });
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
      resetToAutomatic
        ? nextCanvasWidth
        : getAutomaticPanelLayoutCanvasWidth(root, ws.panels, 'content'),
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
  resizePanelLayoutAtRootDivider,
  (state, { payload: [wsId, previousPanelWidths, finalPanelWidths] }) => {
    const ws = getWorkspaceState(state, wsId);
    const resized = commitRootHorizontalPanelWidths(ws.root, previousPanelWidths, finalPanelWidths);
    if (!resized.changed) return state;
    const acceptedCanvasWidth =
      resized.panelWidths.reduce((sum, width) => sum + width, 0) +
      PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, resized.panelWidths.length - 1);
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
    columnCountInitialized: true,
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
      columnCount: ws.columnCount,
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
    columnCount: snapshot.columnCount ?? ws.columnCount,
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
    columnCount: snapshot.columnCount ?? ws.columnCount,
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
  const { wsId, tab, sourcePanelId, force, allowDuplicate, newPanelId, newTabId, timestamp } =
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

  const panelOrder = getPanelOrder(ws.root).filter((panelId) => ws.panels[panelId]);
  const sourceIndex = effectiveSourcePanelId ? panelOrder.indexOf(effectiveSourcePanelId) : -1;
  if (sourceIndex >= 0 && panelOrder.length < 4 && effectiveSourcePanelId) {
    const saved = saveToHistory(ws, timestamp);
    const inserted = insertFixedColumn(
      saved,
      effectiveSourcePanelId,
      {
        id: newPanelId,
        tabs: [{ ...tab, id: newTabId }],
        activeTabId: newTabId,
      },
      'after',
      getPanelCreationWidthForType(tab.type),
    );
    if (inserted) {
      const next = addToFocusHistory(
        {
          ...inserted,
          pendingFocusTabId: newTabId,
          pendingPanelReveal: createPanelRevealRequest(newPanelId, newTabId, newTabId),
        },
        newPanelId,
        newTabId,
        timestamp,
      );
      return setWorkspaceState(state, wsId, next);
    }
  }

  const targetPanelId =
    sourceIndex >= 0 ? (panelOrder[sourceIndex + 1] ?? panelOrder[0]) : panelOrder.at(-1);
  if (!targetPanelId) return state;

  // Reuse the immediate right stack. At the four-column limit, wrap to the
  // first stack rather than creating an invalid fifth column.
  const result = selfDispatch(
    state,
    openTab(wsId, tab, targetPanelId, newTabId, force, timestamp, allowDuplicate),
  );
  const updatedWs = getWorkspaceState(result, wsId);
  return setWorkspaceState(result, wsId, { ...updatedWs, pendingFocusTabId: newTabId });
});
// --- Move Tab To Split ---
panelLayoutReducer.with(moveTabToSplit, (state, { payload }) => {
  const { wsId, tabId, fromPanelId, targetPanelId, zone, newPanelId, timestamp } = payload;
  if (zone !== 'left' && zone !== 'right') return state;
  const moved = moveTabIntoFixedColumn(
    getWorkspaceState(state, wsId),
    tabId,
    fromPanelId,
    targetPanelId,
    zone === 'left' ? 'before' : 'after',
    newPanelId,
    timestamp,
  );
  return moved ? setWorkspaceState(state, wsId, moved) : state;
});
// --- Move Tab To Split Level ---
panelLayoutReducer.with(moveTabToSplitLevel, (state, { payload }) => {
  const { wsId, tabId, fromPanelId, splitPath, position, direction, newPanelId, timestamp } =
    payload;
  if (direction !== 'horizontal') return state;
  const workspace = getWorkspaceState(state, wsId);
  const panelIds = getFixedColumnPanelIds(workspace);
  if (!panelIds) return state;
  let targetPanelId: string | undefined;
  if (splitPath.length === 0) {
    targetPanelId = position === 'before' ? panelIds[0] : panelIds.at(-1);
  } else if (splitPath.length === 1 && workspace.root.type === 'split') {
    const target = workspace.root.children[splitPath[0]];
    targetPanelId = target?.type === 'panel' ? target.panelId : undefined;
  }
  if (!targetPanelId) return state;
  const moved = moveTabIntoFixedColumn(
    workspace,
    tabId,
    fromPanelId,
    targetPanelId,
    position,
    newPanelId,
    timestamp,
  );
  return moved ? setWorkspaceState(state, wsId, moved) : state;
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

  ws = {
    ...ws,
    root: createFixedColumnRoot(usedIds),
    panels: newPanels,
    focusedPanelId: usedIds[0],
    columnCount: count as PanelColumnCount,
    columnCountInitialized: true,
  };
  return setWorkspaceState(state, wsId, ws);
});
panelLayoutReducer.with(applyPreset, (state, { payload }) => {
  const { wsId, preset, panelIds, timestamp } = payload;
  if (preset === 'split-vertical') return state;
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

  const columnCount = getPanelOrder(root).length as PanelColumnCount;
  ws = {
    ...ws,
    root,
    panels: newPanels,
    focusedPanelId: panelIds[0],
    columnCount,
    columnCountInitialized: true,
  };
  return setWorkspaceState(state, wsId, ws);
});

// --- Reveal Hidden Tab Avoiding a Panel (conversation footer reveal) ---
panelLayoutReducer.with(revealHiddenTabAvoidingPanel, (state, { payload }) => {
  const { wsId, tabId, avoidPanelId, timestamp } = payload;
  let ws = getWorkspaceState(state, wsId);
  const hiddenTab = getItem(ws.hiddenTabs, tabId);
  if (!hiddenTab) return state;

  const previousFocusedPanelId = ws.focusedPanelId;
  const order = getPanelOrder(ws.root);
  const targetPanelId =
    order.find((panelId) => panelId !== avoidPanelId && ws.panels[panelId]) ??
    (avoidPanelId && ws.panels[avoidPanelId]
      ? avoidPanelId
      : order.find((panelId) => ws.panels[panelId]));
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
    // Keep the existing panel focus while revealing the restored tab.
    focusedPanelId: previousFocusedPanelId,
    pendingPanelReveal: createPanelRevealRequest(targetPanelId, hiddenTab.id, hiddenTab.id),
  };
  return setWorkspaceState(state, wsId, ws);
});

// Wire up the mutable reference for recursive dispatch
_reducerRef = panelLayoutReducer;
