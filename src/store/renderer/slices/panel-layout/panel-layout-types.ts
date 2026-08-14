/**
 * Panel Layout Types
 *
 * All types for the panel layout slice.
 * Safe to import from any process (renderer, main, shared, preload).
 */

/** Serializable icon descriptor understood by the renderer's icon adapter. */
export interface PanelTabIcon {
  iconName: string;
  prefix?: string;
  icon?: readonly [number, number, readonly string[], string, string | readonly string[]];
}

// ============================================================================
// Core Panel Types
// ============================================================================

/** Types of content that can be displayed in a panel tab */
export type PanelTabType =
  | 'note'
  | 'file'
  | 'diff'
  | 'changes'
  | 'local-changes'
  | 'chat-changes'
  | 'agent'
  | 'terminal'
  | 'settings'
  | 'overview'
  | 'browser'
  | 'activity'
  | 'activity-changes'
  | 'code-review'
  | 'agent-overview';

/** A single tab within a panel */
export interface PanelTab {
  id: string;
  type: PanelTabType;
  title: string;
  icon?: PanelTabIcon;
  closable: boolean;
  hasUnsavedChanges?: boolean;

  // Type-specific identifiers
  workspaceId?: string;
  noteId?: string;
  filePath?: string;
  agentId?: string;
  terminalId?: string;
  diffPath?: string;
  browserUrl?: string;
  faviconUrl?: string;
  contextItemId?: string;

  // Additional data for rendering
  data?: Record<string, unknown>;
}

/** State of a single panel */
export interface PanelState {
  id: string;
  tabs: PanelTab[];
  activeTabId: string | null;
  /** True only for the untouched placeholder seeded beside a new coordinator chat. */
  pristine?: boolean;
}

/** Node in the panel layout tree - either a panel or a split container */
export type PanelLayoutNode =
  | { type: 'panel'; panelId: string }
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      children: PanelLayoutNode[];
      /** Percentage sizes of children (should sum to 100) */
      sizes: number[];
    };

/** Complete layout state for a workspace */
export interface WorkspacePanelLayout {
  root: PanelLayoutNode;
  panels: Record<string, PanelState>;
  focusedPanelId: string | null;
  /** User-resized intrinsic horizontal canvas width; null/absent uses automatic sizing. */
  canvasWidth?: number | null;
  /** Identifies a width that must survive restore; absent is a legacy automatic width. */
  canvasWidthSource?: import('./panel-layout-width-provenance').PanelCanvasWidthSource | null;
  /** Tab ID that should receive focus when it mounts (consumed when focus is applied) */
  pendingFocusTabId?: string | null;
  /** Persisted one-shot lifecycle for a workspace created by the compact initializer. */
  newWorkspaceLifecycle?: NewWorkspacePanelLifecycle | null;
  /** Compatibility guard used while the seeded Spec is intentionally empty. */
  deferSpecTab?: boolean;
  detachedPanels?: Record<
    string,
    {
      panelId: string;
      windowId: string;
      alwaysOnTop: boolean;
      bounds?: { x: number; y: number; width: number; height: number };
    }
  >;
}

export interface NewWorkspacePanelLifecycle {
  /** Coordinator creation uses the seeded pristine placeholder flow. */
  coordinator?: boolean;
  initialAgentId: string | null;
  initialAgentPending: boolean;
  spec: {
    noteId: string;
    generation: string | null;
    state: 'deferred' | 'revealed';
  };
}

export type PanelLayoutRestoreStatus = 'idle' | 'pending' | 'restored' | 'empty' | 'invalid';

// ============================================================================
// Internal State Types
// ============================================================================

/** Recently closed tab with panel info for reopening */
export interface RecentlyClosedTab {
  tab: PanelTab;
  panelId: string;
  closedAt: number;
}

/** Layout snapshot for undo/redo navigation */
export interface LayoutSnapshot {
  root: PanelLayoutNode;
  panels: Record<string, PanelState>;
  focusedPanelId: string | null;
  /** Optional for backward compatibility with existing persisted history. */
  canvasWidth?: number | null;
  canvasWidthSource?: import('./panel-layout-width-provenance').PanelCanvasWidthSource | null;
  timestamp: number;
}

/** Focus history entry for navigating between previously focused tabs */
export interface FocusHistoryEntry {
  panelId: string;
  tabId: string;
  timestamp: number;
}

/** Saved sizes for panel expansion restore */
export interface SavedExpandSizes {
  nodePath: number[];
  sizes: number[];
}

// ============================================================================
// Workspace-Scoped State
// ============================================================================

/** Per-workspace panel layout state */
export interface WorkspacePanelLayoutState {
  root: PanelLayoutNode;
  panels: Record<string, PanelState>;
  focusedPanelId: string | null;
  /** Current horizontal panel canvas width in pixels; null uses the default column width. */
  canvasWidth: number | null;
  canvasWidthSource: import('./panel-layout-width-provenance').PanelCanvasWidthSource | null;
  restoreStatus: PanelLayoutRestoreStatus;
  pendingFocusTabId: string | null;
  recentlyClosed: RecentlyClosedTab[];
  layoutHistory: LayoutSnapshot[];
  historyIndex: number;
  historyLoaded: boolean;
  focusHistory: FocusHistoryEntry[];
  focusHistoryIndex: number;
  expandedPanelId: string | null;
  savedSizesBeforeExpand: SavedExpandSizes[];
  /** Exact pre-expand canvas width; `null` preserves automatic-width provenance. */
  savedCanvasWidthBeforeExpand?: number | null;
  /** Exact pre-expand width source; preserved across transient expanded-state resizes. */
  savedCanvasWidthSourceBeforeExpand?:
    import('./panel-layout-width-provenance').PanelCanvasWidthSource | null;
  deferSpecTab: boolean;
  newWorkspaceLifecycle: NewWorkspacePanelLifecycle | null;
}

export type PanelDragLayoutSnapshot = Pick<
  WorkspacePanelLayoutState,
  'root' | 'focusedPanelId' | 'layoutHistory' | 'historyIndex'
>;

/** Top-level panel layout slice state */
export type PanelLayoutSliceState = {
  byWorkspaceId: Record<string, WorkspacePanelLayoutState>;
};

// ============================================================================
// Constants
// ============================================================================

export const PANEL_LAYOUT_STORAGE_KEY_PREFIX = 'panel-layout-';
export const MAX_RECENTLY_CLOSED = 20;
export const MAX_LAYOUT_HISTORY = 50;
export const MAX_FOCUS_HISTORY = 100;
export const HISTORY_PERSIST_DEBOUNCE_MS = 2000;
