/**
 * Panel Layout Types
 *
 * All types for the panel layout slice.
 * Safe to import from any process (renderer, main, shared, preload).
 */

import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { BrowserTabViewport } from '../../../../shared/ipc/workspace-command-payloads';

export type { BrowserTabViewport } from '../../../../shared/ipc/workspace-command-payloads';

/** Serializable icon descriptor understood by the renderer's icon adapter. */
interface PanelTabIcon {
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
  | 'hook-script'
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
  scriptId?: string;
  hookId?: string;
  diffPath?: string;
  browserUrl?: string;
  /**
   * Original URL as requested before the loopback/tunnel rewrite (e.g.
   * `http://daemon.localhost:3000/`); present only when `browserUrl` was
   * produced by a rewrite. Persisted so a restored tab can re-run the
   * rewrite and land on a live tunnel instead of a dead ephemeral forward
   * port (intent-hq/monorepo#2789).
   */
  browserRequestedUrl?: string;
  /**
   * Agent owning this browser tab (monorepo#2857); absent for user-opened
   * (unowned) tabs. Persisted with the layout so ownership survives restart;
   * main's ownership registry rehydrates from it.
   */
  ownerAgentId?: string;
  /**
   * Owning agent's display name as last reported by main (monorepo#3438);
   * absent for unowned tabs or when the name could not be resolved.
   * Persisted with the layout so the sidebar owner group can label the tab
   * even when the renderer's agent store does not have the owner loaded.
   * The live agent store, when it has the owner, takes precedence (renames).
   */
  ownerAgentName?: string;
  /** Persisted browser viewport mode. Absent legacy values default to fit. */
  viewport?: BrowserTabViewport;
  /**
   * Last exact/fallback emulated size of an agent-owned browser tab. Fit mode
   * uses this while hidden, and agent resize/open notifications keep it live.
   */
  emulatedSize?: { width: number; height: number };
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
  /** Inactive panes added by background activity and not yet selected by the user. */
  attentionTabIds?: string[];
  /** True for an untouched reusable blank panel that the next user item can consume. */
  pristine?: boolean;
}

export type PanelColumnCount = 1 | 2 | 3 | 4;

export function isPanelColumnCount(value: unknown): value is PanelColumnCount {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4;
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
  /** Version of the persisted fixed-column representation. */
  version?: number;
  root: PanelLayoutNode;
  panels: Record<string, PanelState>;
  focusedPanelId: string | null;
  /**
   * Agent-owned browser tabs the user "closed" (monorepo#2857): a user close
   * of an owned tab is a UI-level hide, not a destroy — the tab leaves its
   * panel but stays here with its webview alive (offscreen) and keeps
   * appearing in listTabs for its owner. Persisted so hidden tabs survive
   * restart; destroyed only on agent deletion or workspace archive/delete.
   */
  hiddenTabs?: PanelTab[];
  /** Workspace-scoped selected column count. */
  columnCount?: PanelColumnCount;
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
  /** One-shot request to reveal a reused panel without stealing DOM focus. */
  pendingPanelReveal?: PanelRevealRequest | null;
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

interface NewWorkspacePanelLifecycle {
  /** Coordinator creation fills the seeded reusable panel when Spec is first written. */
  coordinator?: boolean;
  initialAgentId: string | null;
  initialAgentPending: boolean;
  spec: {
    noteId: string;
    generation: string | null;
    state: 'deferred' | 'revealed';
  };
}

export interface PanelRevealRequest {
  panelId: string;
  tabId: string | null;
  requestId: string;
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

/** Exact serializable state needed to restore one explicit panel-column close. */
export interface RecentlyClosedPanelColumn {
  historyId: string;
  panelId: string;
  panel: PanelState;
  root: PanelLayoutNode;
  postCloseRoot: PanelLayoutNode;
  focusedPanelId: string | null;
  columnCount: PanelColumnCount;
  canvasWidth: number | null;
  canvasWidthSource: import('./panel-layout-width-provenance').PanelCanvasWidthSource | null;
  expandedPanelId: string | null;
  savedSizesBeforeExpand: SavedExpandSizes[];
  savedCanvasWidthBeforeExpand?: number | null;
  savedCanvasWidthSourceBeforeExpand?:
    import('./panel-layout-width-provenance').PanelCanvasWidthSource | null;
  pendingFocusTabId: string | null;
  closedTabIds: string[];
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
  columnCount?: PanelColumnCount;
  timestamp: number;
}

/** Focus history entry for navigating between previously focused tabs */
interface FocusHistoryEntry {
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
  /**
   * Hidden (user-closed) agent-owned browser tabs — see
   * WorkspacePanelLayout.hiddenTabs. Persisted as a plain array; stored here
   * as a Collection keyed by tab id.
   */
  hiddenTabs: Collection<PanelTab, 'id'>;
  /** Current horizontal panel canvas width in pixels; null uses the default column width. */
  canvasWidth: number | null;
  canvasWidthSource: import('./panel-layout-width-provenance').PanelCanvasWidthSource | null;
  columnCount: PanelColumnCount;
  /** Preserves an established count during same-backend restore and hydration. */
  columnCountInitialized?: boolean;
  restoreStatus: PanelLayoutRestoreStatus;
  pendingFocusTabId: string | null;
  pendingPanelReveal?: PanelRevealRequest | null;
  recentlyClosed: RecentlyClosedTab[];
  /** Optional for compatibility with transient states created before column-close history. */
  recentlyClosedColumns?: Collection<RecentlyClosedPanelColumn, 'historyId'>;
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
export const PANEL_LAYOUT_PERSISTENCE_VERSION = 2;
export const MAX_RECENTLY_CLOSED = 20;
export const MAX_LAYOUT_HISTORY = 50;
export const MAX_FOCUS_HISTORY = 100;
export const HISTORY_PERSIST_DEBOUNCE_MS = 2000;
