/**
 * Panel Layout Manager
 *
 * Manages the state of splittable panels within a workspace.
 * Each workspace has its own panel layout that can be split horizontally or vertically.
 * Each panel can have multiple tabs, similar to VS Code.
 */

import { createLogger } from '$lib/utils/client-logger';
import { track } from '$lib/services/analytics';
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import {
  panelLayoutHistoryClient,
  type PanelLayoutHistoryData,
} from './panel-layout-history.client';

const logger = createLogger('PanelLayoutManager');

// Debounce timeout for persisting history to disk
const HISTORY_PERSIST_DEBOUNCE_MS = 2000;

// ============================================================================
// Types
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
  icon?: IconDefinition;
  closable: boolean;
  hasUnsavedChanges?: boolean;

  // Type-specific identifiers
  workspaceId?: string;
  noteId?: string;
  filePath?: string;
  agentId?: string;
  terminalId?: string;
  diffPath?: string;
  browserUrl?: string; // URL for browser tabs
  faviconUrl?: string; // Favicon URL for browser tabs (from page-favicon-updated event)
  contextItemId?: string; // ID of the context item associated with this tab (for browser tabs)

  // Additional data for rendering
  data?: Record<string, unknown>;
}

/** State of a single panel */
export interface PanelState {
  id: string;
  tabs: PanelTab[];
  activeTabId: string | null;
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
  /** Tab ID that should receive focus when it mounts (consumed when focus is applied) */
  pendingFocusTabId?: string | null;

  /**
   * Detached panels (for future pop-out window feature)
   *
   * Maps panel IDs to their detached window state.
   * When a panel is detached, it's removed from the layout tree
   * and tracked here instead.
   *
   * @future This will be used when implementing pop-out panels.
   * Each detached panel will have its own window with a single panel.
   */
  detachedPanels?: Record<
    string,
    {
      /** Panel ID */
      panelId: string;
      /** Window ID (from Electron) */
      windowId: string;
      /** Whether window should stay on top */
      alwaysOnTop: boolean;
      /** Window position and size */
      bounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    }
  >;
}

// ============================================================================
// Storage
// ============================================================================

const STORAGE_KEY_PREFIX = 'panel-layout-';

function getStorageKey(workspaceId: string): string {
  return `${STORAGE_KEY_PREFIX}${workspaceId}`;
}

function loadLayout(workspaceId: string): WorkspacePanelLayout | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = getStorageKey(workspaceId);
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      logger.info('[loadLayout] Successfully loaded layout from localStorage', {
        workspaceId,
        panelCount: Object.keys(parsed.panels || {}).length,
        hasRoot: !!parsed.root,
        rootType: parsed.root?.type,
      });
      return parsed;
    }
    logger.info('[loadLayout] No stored layout found, will use default', { workspaceId, key });
  } catch (error) {
    logger.error('[loadLayout] Failed to load layout', { workspaceId, error });
  }
  return null;
}

function saveLayout(workspaceId: string, layout: WorkspacePanelLayout) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(layout));
  } catch {
    // Ignore storage errors
  }
}

// ============================================================================
// Default Layout Factory
// ============================================================================

let panelIdCounter = 0;

function generatePanelId(): string {
  return `panel-${Date.now()}-${++panelIdCounter}`;
}

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createDefaultLayout(): WorkspacePanelLayout {
  // Create a single panel layout by default.
  // For new workspaces with a spec-writer agent, the spec panel will be
  // added dynamically (with a slide-in animation) once spec generation begins.
  const panelId = generatePanelId();

  return {
    root: {
      type: 'panel',
      panelId,
    },
    panels: {
      [panelId]: {
        id: panelId,
        tabs: [],
        activeTabId: null,
      },
    },
    focusedPanelId: panelId,
  };
}

// ============================================================================
// Panel Layout Manager
// ============================================================================

/** Type for the panel layout manager */
export type PanelLayoutManager = ReturnType<typeof createPanelLayoutManagerInternal>;

/** Cache of managers by workspace ID */
const managerCache = new Map<string, PanelLayoutManager>();

/** Recently closed tab with panel info for reopening */
interface RecentlyClosedTab {
  tab: PanelTab;
  panelId: string;
  closedAt: number;
}

/** Layout snapshot for undo/redo navigation */
interface LayoutSnapshot {
  root: PanelLayoutNode;
  panels: Record<string, PanelState>;
  focusedPanelId: string | null;
  timestamp: number;
}

/** Focus history entry for navigating between previously focused tabs (like browser back/forward) */
interface FocusHistoryEntry {
  panelId: string;
  tabId: string;
  timestamp: number;
}

/** Options for mutate function */
interface MutateOptions {
  /** Whether to add to history before this mutation (default: true) */
  addToHistory?: boolean;
  /** Whether to persist after this mutation (default: true) */
  persist?: boolean;
}

const MAX_RECENTLY_CLOSED = 20;
const MAX_LAYOUT_HISTORY = 50;
const MAX_FOCUS_HISTORY = 100; // Maximum focus history entries

function createPanelLayoutManagerInternal(workspaceId: string) {
  // Load or create layout
  const loadedLayout = loadLayout(workspaceId);
  const layout = loadedLayout ?? createDefaultLayout();

  // If we created a default layout, save it immediately so it persists
  if (!loadedLayout) {
    saveLayout(workspaceId, layout);
    logger.info('[PanelLayoutManager] Saved default layout to localStorage', { workspaceId });
  }

  // Debug: Log loaded layout tabs
  const allTabs = Object.values(layout.panels).flatMap((p) => p.tabs);
  const agentTabs = allTabs.filter((t) => t.type === 'agent');
  logger.info('[PanelLayoutManager] Initialized layout', {
    workspaceId,
    wasLoaded: !!loadedLayout,
    usedDefault: !loadedLayout,
    panelCount: Object.keys(layout.panels).length,
    totalTabs: allTabs.length,
    agentTabs: agentTabs.length,
    agentIds: agentTabs.map((t) => t.agentId),
  });

  const state = $state<WorkspacePanelLayout>(layout);
  const recentlyClosed = $state<RecentlyClosedTab[]>([]);

  // Layout history for back/forward (undo/redo)
  // History stores snapshots that we can go back to.
  // historyIndex points to the current position in history.
  // When historyIndex == layoutHistory.length, we're at the "live" state (not in history).
  const layoutHistory = $state<LayoutSnapshot[]>([]);
  let historyIndex = $state(0); // Points past the last snapshot when at live state
  let isRestoring = $state(false); // Flag to prevent adding to history during restore
  let historyLoaded = $state(false); // Track if history has been loaded from disk

  // Focus history for navigating between previously focused tabs (like browser back/forward)
  // This is separate from layout history which tracks structural changes
  const focusHistory = $state<FocusHistoryEntry[]>([]);
  let focusHistoryIndex = $state(-1); // -1 means at the end (no navigation yet)
  let isNavigatingFocusHistory = $state(false); // Flag to prevent adding during navigation

  // Debounced history persistence to disk
  let historyPersistTimeout: ReturnType<typeof setTimeout> | null = null;

  function persistState() {
    saveLayout(workspaceId, state);
  }

  /** Persist history to disk (debounced) */
  function persistHistoryToDisk() {
    if (historyPersistTimeout) {
      clearTimeout(historyPersistTimeout);
    }
    historyPersistTimeout = setTimeout(() => {
      const data: PanelLayoutHistoryData = {
        version: 1,
        workspaceId,
        history: $state.snapshot(layoutHistory),
        historyIndex,
        lastUpdated: new Date().toISOString(),
      };
      panelLayoutHistoryClient.save(workspaceId as any, data).catch((err) => {
        logger.error('Failed to persist history to disk', err);
      });
    }, HISTORY_PERSIST_DEBOUNCE_MS);
  }

  /** Load history from disk (async, called on manager creation) */
  async function loadHistoryFromDisk() {
    try {
      const data = await panelLayoutHistoryClient.load(workspaceId as any);
      if (data && data.history && Array.isArray(data.history)) {
        // Replace history with loaded data
        layoutHistory.splice(0, layoutHistory.length, ...data.history);
        historyIndex = Math.min(data.historyIndex, data.history.length);
        logger.debug('Loaded history from disk', {
          historyLength: data.history.length,
          historyIndex,
        });
      }
    } catch (err) {
      logger.error('Failed to load history from disk', err);
    } finally {
      historyLoaded = true;
    }
  }

  // Start loading history asynchronously
  loadHistoryFromDisk();

  /** Deep clone the current layout state for history */
  function cloneLayoutState(): LayoutSnapshot {
    return {
      root: JSON.parse(JSON.stringify(state.root)),
      panels: JSON.parse(JSON.stringify(state.panels)),
      focusedPanelId: state.focusedPanelId,
      timestamp: Date.now(),
    };
  }

  /** Save current state to history before a mutation */
  function saveToHistory() {
    // If we're in the middle of history (not at the end), truncate forward history
    if (historyIndex < layoutHistory.length) {
      layoutHistory.splice(historyIndex);
    }

    // Save the current state before mutation
    layoutHistory.push(cloneLayoutState());
    // Move index past the saved state (we're now at "live" state which is about to be mutated)
    historyIndex = layoutHistory.length;

    // Limit history size
    if (layoutHistory.length > MAX_LAYOUT_HISTORY) {
      const toRemove = layoutHistory.length - MAX_LAYOUT_HISTORY;
      layoutHistory.splice(0, toRemove);
      historyIndex = Math.max(0, historyIndex - toRemove);
    }

    logger.debug('Saved to history', {
      historyIndex,
      historyLength: layoutHistory.length,
      canGoBack: historyIndex > 0,
    });

    // Persist history to disk (debounced)
    persistHistoryToDisk();
  }

  /** Restore layout from a snapshot */
  function restoreFromSnapshot(snapshot: LayoutSnapshot) {
    state.root = JSON.parse(JSON.stringify(snapshot.root));
    state.panels = JSON.parse(JSON.stringify(snapshot.panels));
    state.focusedPanelId = snapshot.focusedPanelId;

    // If spec-tab deferral is active, strip any spec tabs that were in the snapshot.
    // Without this, undo/redo could restore spec tabs that the deferral mechanism
    // intentionally removed, breaking the slide-in animation flow.
    if (deferSpecTab) {
      for (const panel of Object.values(state.panels)) {
        const before = panel.tabs.length;
        panel.tabs = panel.tabs.filter(
          (t) => !(t.type === 'note' && t.noteId === 'spec'),
        );
        if (panel.tabs.length < before && panel.activeTabId) {
          if (!panel.tabs.find((t) => t.id === panel.activeTabId)) {
            panel.activeTabId = panel.tabs[0]?.id ?? null;
          }
        }
      }
    }

    persistState();
  }

  /** Add a focus entry to focus history (for tab/panel focus navigation) */
  function addToFocusHistory(panelId: string, tabId: string) {
    // Don't add if we're currently navigating through focus history
    if (isNavigatingFocusHistory) return;

    // Don't add duplicate consecutive entries
    const lastEntry = focusHistory[focusHistory.length - 1];
    if (lastEntry && lastEntry.panelId === panelId && lastEntry.tabId === tabId) {
      return;
    }

    // If we navigated back and are now making a new focus, truncate forward history
    if (focusHistoryIndex >= 0 && focusHistoryIndex < focusHistory.length - 1) {
      focusHistory.splice(focusHistoryIndex + 1);
    }

    // Add new entry
    focusHistory.push({
      panelId,
      tabId,
      timestamp: Date.now(),
    });

    // Limit history size
    if (focusHistory.length > MAX_FOCUS_HISTORY) {
      focusHistory.splice(0, focusHistory.length - MAX_FOCUS_HISTORY);
    }

    // Reset index to end (we're at the latest position)
    focusHistoryIndex = focusHistory.length - 1;

    logger.debug('Added to focus history', {
      panelId,
      tabId,
      focusHistoryLength: focusHistory.length,
      focusHistoryIndex,
    });
  }

  // Batch operation tracking - when > 0, only the first mutation saves to history
  let batchDepth = 0;
  let batchHistorySaved = false;

  /**
   * Central mutation function - all layout changes should go through this.
   * Automatically handles history and persistence.
   *
   * @param fn - The mutation function to execute
   * @param options - Options for history and persistence
   * @returns The return value of the mutation function
   */
  function mutate<T>(fn: () => T, options: MutateOptions = {}): T {
    const { addToHistory = true, persist = true } = options;

    // Save to history before mutation (unless restoring, explicitly disabled, or already saved in this batch)
    if (addToHistory && !isRestoring) {
      if (batchDepth > 0) {
        // We're in a batch - only save history once at the start
        if (!batchHistorySaved) {
          saveToHistory();
          batchHistorySaved = true;
        }
      } else {
        // Not in a batch - save history normally
        saveToHistory();
      }
    }

    // Execute the mutation
    const result = fn();

    // Persist after mutation (unless explicitly disabled)
    if (persist) {
      persistState();
    }

    return result;
  }

  /**
   * Execute multiple mutations as a single history entry.
   * All mutations within the batch will be grouped into one undo/redo step.
   * Supports both sync and async functions.
   *
   * @param fn - Function containing multiple mutations to batch together
   * @returns The return value of fn (or Promise if fn is async)
   */
  function batchMutations<T>(fn: () => T): T {
    batchDepth++;
    if (batchDepth === 1) {
      batchHistorySaved = false;
    }

    try {
      const result = fn();

      // Handle async functions - wait for promise to resolve before decrementing depth
      if (result instanceof Promise) {
        return result.finally(() => {
          batchDepth--;
        }) as T;
      }

      batchDepth--;
      return result;
    } catch (error) {
      batchDepth--;
      throw error;
    }
  }

  /**
   * Helper to close a panel - performs the state mutation only.
   * Does NOT handle history or persistence - caller should use mutate().
   * @returns true if the panel was closed, false otherwise
   */
  function closePanelInternal(panelId: string): boolean {
    // Don't close if it's the only panel
    if (Object.keys(state.panels).length <= 1) return false;

    // Clear expand state — closing any panel can restructure the tree,
    // making saved split paths stale
    expandedPanelId = null;
    savedSizesBeforeExpand = [];

    const removeFromTree = (node: PanelLayoutNode): PanelLayoutNode | null => {
      if (node.type === 'panel') {
        return node.panelId === panelId ? null : node;
      }

      const newChildren: PanelLayoutNode[] = [];
      for (const child of node.children) {
        const result = removeFromTree(child);
        if (result) newChildren.push(result);
      }

      if (newChildren.length === 0) return null;
      if (newChildren.length === 1) return newChildren[0];

      // Redistribute sizes
      const totalSize = node.sizes
        .filter((_, i) => {
          const child = node.children[i];
          return child.type !== 'panel' || child.panelId !== panelId;
        })
        .reduce((a, b) => a + b, 0);

      node.children = newChildren;
      node.sizes = node.sizes
        .filter((_, i) => {
          const child = node.children[i];
          return child !== undefined;
        })
        .map((s) => (s / totalSize) * 100);

      return node;
    };

    const newRoot = removeFromTree(state.root);
    if (newRoot) {
      state.root = newRoot;
      delete state.panels[panelId];

      // Update focused panel if needed
      if (state.focusedPanelId === panelId) {
        const remainingPanelIds = Object.keys(state.panels);
        state.focusedPanelId = remainingPanelIds[0] ?? null;
      }

      logger.debug('Closed panel', { panelId });
      return true;
    }
    return false;
  }

  // ============================================================================
  // Panel Expand (soft zoom: 85/15 split sizes instead of hiding panels)
  // ============================================================================

  const EXPANDED_SHARE = 80; // Percentage given to the expanded panel's branch

  /** ID of the currently expanded panel, or null */
  let expandedPanelId: string | null = null;

  /** Saved original sizes at each split level before expansion, for restore */
  let savedSizesBeforeExpand: { nodePath: number[]; sizes: number[] }[] = [];

  /**
   * Find the path of child indices from root to a panel.
   * Returns an array of indices (one per split level), or null if not found.
   */
  function findPanelPath(node: PanelLayoutNode, panelId: string): number[] | null {
    if (node.type === 'panel') {
      return node.panelId === panelId ? [] : null;
    }
    for (let i = 0; i < node.children.length; i++) {
      const childPath = findPanelPath(node.children[i], panelId);
      if (childPath !== null) {
        return [i, ...childPath];
      }
    }
    return null;
  }

  /**
   * Navigate to a split node using a path of child indices from root.
   * An empty path returns root itself.
   */
  function getSplitAtPath(path: number[]): PanelLayoutNode | null {
    let node: PanelLayoutNode = state.root;
    for (const idx of path) {
      if (node.type === 'split' && node.children[idx]) {
        node = node.children[idx];
      } else {
        return null;
      }
    }
    return node;
  }

  // When true, openTab / openTabInAdjacentOrSplit / reopenClosedTab silently
  // reject spec-note tabs.  The workspace page sets this to `true` when a
  // spec-writer agent is pending and clears it right before triggering the
  // animated slide-in.
  //
  // IMPORTANT: Every method that can add a tab to a panel must check this flag.
  // Currently guarded: openTab, openTabInAdjacentOrSplit, reopenClosedTab.
  // Methods that move existing tabs (moveTabToPanel, etc.) don't need the guard.
  let deferSpecTab = false;

  const manager = {
    get layout() {
      return state;
    },

    get focusedPanelId() {
      return state.focusedPanelId;
    },

    /** Get the tab ID that should receive focus when it mounts */
    get pendingFocusTabId() {
      return state.pendingFocusTabId ?? null;
    },

    /**
     * Check if a tab should receive focus on mount and consume the pending focus.
     * Returns true if the tab should focus itself.
     */
    consumePendingFocus(tabId: string): boolean {
      if (state.pendingFocusTabId === tabId) {
        logger.debug('[consumePendingFocus] Consumed pending focus for tab', { tabId });
        state.pendingFocusTabId = null;
        return true;
      }
      return false;
    },

    /**
     * Block (true) or allow (false) spec-note tabs from being opened.
     * When enabling deferral, also strips any spec-note tabs that are
     * already present in the layout (e.g. loaded from localStorage).
     */
    setDeferSpecTab(value: boolean) {
      deferSpecTab = value;
      logger.info('[PanelLayoutManager] setDeferSpecTab', { workspaceId, deferSpecTab: value });

      // When activating the guard, remove any spec tabs already in the layout
      if (value) {
        let removed = false;
        for (const panel of Object.values(state.panels)) {
          const before = panel.tabs.length;
          panel.tabs = panel.tabs.filter(
            (t) => !(t.type === 'note' && t.noteId === 'spec'),
          );
          if (panel.tabs.length < before) {
            removed = true;
            // Fix activeTabId if the removed tab was active
            if (panel.activeTabId && !panel.tabs.find((t) => t.id === panel.activeTabId)) {
              panel.activeTabId = panel.tabs[0]?.id ?? null;
            }
          }
        }
        if (removed) {
          logger.info('[PanelLayoutManager] Stripped existing spec tabs from layout', { workspaceId });
          persistState();
        }
      }
    },

    /** Whether spec-note tabs are currently being deferred. */
    get isDeferringSpecTab() {
      return deferSpecTab;
    },

    get focusedPanel(): PanelState | null {
      if (!state.focusedPanelId) return null;
      return state.panels[state.focusedPanelId] ?? null;
    },

    /** Get the active tab in the focused panel */
    get focusedTab(): PanelTab | null {
      const panel = this.focusedPanel;
      if (!panel || !panel.activeTabId) return null;
      return panel.tabs.find((t) => t.id === panel.activeTabId) ?? null;
    },

    /** Get focused content info for sidebar/dock synchronization */
    get focusedContent(): {
      type: PanelTabType | null;
      noteId: string | null;
      filePath: string | null;
      agentId: string | null;
      terminalId: string | null;
      diffPath: string | null;
      browserUrl: string | null;
      contextItemId: string | null;
    } {
      const tab = this.focusedTab;
      return {
        type: tab?.type ?? null,
        noteId: tab?.noteId ?? null,
        filePath: tab?.filePath ?? null,
        agentId: tab?.agentId ?? null,
        terminalId: tab?.terminalId ?? null,
        diffPath: tab?.diffPath ?? null,
        browserUrl: tab?.browserUrl ?? null,
        contextItemId: tab?.contextItemId ?? null,
      };
    },

    /** Get all open tabs across all panels (for agent context) */
    get allOpenTabs(): PanelTab[] {
      const tabs: PanelTab[] = [];
      for (const panel of Object.values(state.panels)) {
        tabs.push(...panel.tabs);
      }
      return tabs;
    },

    /** Whether we can go back in layout history */
    get canGoBack() {
      // We can go back if there's at least one snapshot and we're past it
      // historyIndex = 1 means we have 1 snapshot saved (at index 0), and we can go back to it
      const canGo = historyIndex > 0 && layoutHistory.length > 0;
      logger.debug('canGoBack check', { historyIndex, historyLength: layoutHistory.length, canGo });
      return canGo;
    },

    /** Whether we can go forward in layout history */
    get canGoForward() {
      // We can go forward if there are snapshots ahead of current position
      // Must match goForward() check: historyIndex >= layoutHistory.length - 1 means can't go forward
      // So we can go forward when: historyIndex < layoutHistory.length - 1
      return historyIndex < layoutHistory.length - 1;
    },

    /** Go back to the previous layout state */
    goBack() {
      if (historyIndex <= 0 || layoutHistory.length === 0) {
        logger.debug('goBack: at start of history, cannot go back', {
          historyIndex,
          historyLength: layoutHistory.length,
        });
        return false;
      }

      isRestoring = true;

      // If we're at the "live" position (past all snapshots), save current state first
      // so we can go forward back to it
      if (historyIndex === layoutHistory.length) {
        layoutHistory.push(cloneLayoutState());
      }

      // Go back to the previous snapshot
      historyIndex--;
      const snapshot = layoutHistory[historyIndex];

      if (snapshot) {
        logger.debug('goBack: restoring snapshot', {
          historyIndex,
          historyLength: layoutHistory.length,
          panelCount: Object.keys(snapshot.panels).length,
        });
        restoreFromSnapshot(snapshot);
      }

      isRestoring = false;
      // Persist updated history index to disk
      persistHistoryToDisk();
      return true;
    },

    /** Go forward to the next layout state */
    goForward() {
      if (historyIndex >= layoutHistory.length - 1) {
        logger.debug('goForward: at end of history, cannot go forward', {
          historyIndex,
          historyLength: layoutHistory.length,
        });
        return false;
      }

      isRestoring = true;
      historyIndex++;
      const snapshot = layoutHistory[historyIndex];

      if (snapshot) {
        logger.debug('goForward: restoring snapshot', {
          historyIndex,
          historyLength: layoutHistory.length,
          panelCount: Object.keys(snapshot.panels).length,
        });
        restoreFromSnapshot(snapshot);
      }

      isRestoring = false;
      // Persist updated history index to disk
      persistHistoryToDisk();
      return true;
    },

    // =========================================================================
    // Focus History (navigating between previously focused tabs)
    // =========================================================================

    /** Whether we can go back in focus history */
    get canGoBackInFocusHistory() {
      return focusHistoryIndex > 0;
    },

    /** Whether we can go forward in focus history */
    get canGoForwardInFocusHistory() {
      return focusHistoryIndex >= 0 && focusHistoryIndex < focusHistory.length - 1;
    },

    /** Go back to the previously focused tab */
    goBackInFocusHistory(): boolean {
      if (focusHistoryIndex <= 0) {
        logger.debug('goBackInFocusHistory: at start of history, cannot go back', {
          focusHistoryIndex,
          focusHistoryLength: focusHistory.length,
        });
        return false;
      }

      isNavigatingFocusHistory = true;
      focusHistoryIndex--;
      const entry = focusHistory[focusHistoryIndex];

      if (entry) {
        logger.debug('goBackInFocusHistory: restoring focus', {
          focusHistoryIndex,
          focusHistoryLength: focusHistory.length,
          panelId: entry.panelId,
          tabId: entry.tabId,
        });

        // Navigate to the tab if it still exists
        const panel = state.panels[entry.panelId];
        if (panel && panel.tabs.some((t) => t.id === entry.tabId)) {
          state.focusedPanelId = entry.panelId;
          panel.activeTabId = entry.tabId;
          persistState();
        } else {
          // Tab no longer exists, skip this entry and try again
          isNavigatingFocusHistory = false;
          return this.goBackInFocusHistory();
        }
      }

      isNavigatingFocusHistory = false;
      return true;
    },

    /** Go forward to the next focused tab in history */
    goForwardInFocusHistory(): boolean {
      if (focusHistoryIndex >= focusHistory.length - 1) {
        logger.debug('goForwardInFocusHistory: at end of history, cannot go forward', {
          focusHistoryIndex,
          focusHistoryLength: focusHistory.length,
        });
        return false;
      }

      isNavigatingFocusHistory = true;
      focusHistoryIndex++;
      const entry = focusHistory[focusHistoryIndex];

      if (entry) {
        logger.debug('goForwardInFocusHistory: restoring focus', {
          focusHistoryIndex,
          focusHistoryLength: focusHistory.length,
          panelId: entry.panelId,
          tabId: entry.tabId,
        });

        // Navigate to the tab if it still exists
        const panel = state.panels[entry.panelId];
        if (panel && panel.tabs.some((t) => t.id === entry.tabId)) {
          state.focusedPanelId = entry.panelId;
          panel.activeTabId = entry.tabId;
          persistState();
        } else {
          // Tab no longer exists, skip this entry and try again
          isNavigatingFocusHistory = false;
          return this.goForwardInFocusHistory();
        }
      }

      isNavigatingFocusHistory = false;
      return true;
    },

    /** Focus a panel - does not add to history */
    focusPanel(panelId: string) {
      if (state.panels[panelId]) {
        state.focusedPanelId = panelId;
        persistState();
      }
    },

    /** Get a panel by ID */
    getPanel(panelId: string): PanelState | null {
      return state.panels[panelId] ?? null;
    },

    /** Get all panel IDs */
    getPanelIds(): string[] {
      return Object.keys(state.panels);
    },

    /** Find the panel ID containing a note with the given ID */
    findPanelWithNote(noteId: string): string | null {
      for (const [panelId, panel] of Object.entries(state.panels)) {
        if (panel.tabs.some((t) => t.type === 'note' && t.noteId === noteId)) {
          return panelId;
        }
      }
      return null;
    },

    /** Get the "other" panel (first non-focused panel) for split layouts */
    getOtherPanelId(): string | null {
      const panelIds = Object.keys(state.panels);
      if (panelIds.length < 2) return null;
      return panelIds.find((id) => id !== state.focusedPanelId) ?? null;
    },

    /** Open a tab in the "other" panel (for split layouts) */
    openTabInOtherPanel(tab: Omit<PanelTab, 'id'>): string {
      const otherPanelId = this.getOtherPanelId();
      if (!otherPanelId) {
        // Fall back to focused panel if no other panel exists
        return this.openTab(tab);
      }
      return this.openTab(tab, otherPanelId);
    },

    /**
     * Open a tab in an adjacent panel, creating a horizontal split if needed.
     *
     * This is the preferred method for cmd+click behavior:
     * - If there's already another panel, opens the tab there
     * - If there's only one panel, creates a horizontal split and opens in the new panel
     *
     * @param tab - The tab to open
     * @param sourcePanelId - Optional panel ID where the click originated (to find the "other" panel relative to it)
     * @param options.animated - If true and a split is created, the new panel slides in with an animation
     * @returns The ID of the opened tab
     */
    openTabInAdjacentOrSplit(
      tab: Omit<PanelTab, 'id'>,
      sourcePanelId?: string,
      options?: { animated?: boolean },
    ): string {
      // ── Universal spec-note guard (same as openTab) ──
      if (deferSpecTab && tab.type === 'note' && tab.noteId === 'spec') {
        logger.info(
          '[openTabInAdjacentOrSplit] BLOCKED spec-note tab — deferSpecTab is active',
          { workspaceId },
        );
        return '';
      }

      // If a source panel ID is provided, find the other panel relative to it
      // Otherwise, use the focused panel as the source
      const effectiveSourcePanelId = sourcePanelId ?? state.focusedPanelId;
      const panelIds = Object.keys(state.panels);
      const otherPanelId =
        panelIds.length >= 2
          ? (panelIds.find((id) => id !== effectiveSourcePanelId) ?? null)
          : null;

      let tabId: string;
      if (otherPanelId) {
        // There's already another panel - open there and focus it
        tabId = this.openTab(tab, otherPanelId);
        this.focusPanel(otherPanelId);
        logger.info('[openTabInAdjacentOrSplit] Opened tab in existing adjacent panel', {
          tabId,
          otherPanelId,
          sourcePanelId: effectiveSourcePanelId,
        });
      } else {
        // No other panel exists - create a horizontal split
        const splitSourceId = effectiveSourcePanelId;
        if (!splitSourceId) {
          logger.warn('No panel to split');
          tabId = this.openTab(tab);
          // Set pending focus for the new tab
          state.pendingFocusTabId = tabId;
          logger.info('[openTabInAdjacentOrSplit] Set pending focus (no source panel)', {
            pendingFocusTabId: tabId,
          });
          return tabId;
        }

        // Split the source panel horizontally
        this.splitPanel(splitSourceId, 'horizontal', {
          animated: options?.animated,
        });

        // After splitting, the new panel is now focused (splitPanel focuses the new panel)
        // Open the tab in the newly focused panel
        tabId = this.openTab(tab);
        logger.info('[openTabInAdjacentOrSplit] Opened tab after split', {
          tabId,
          splitSourceId,
        });
      }

      // Set pending focus for the new tab
      // PanelContentRenderer uses queueMicrotask to check this after we set it
      state.pendingFocusTabId = tabId;
      logger.info('[openTabInAdjacentOrSplit] Set pending focus for tab', {
        pendingFocusTabId: tabId,
      });
      return tabId;
    },

    /** Open a tab in the focused panel (or specified panel) */
    openTab(tab: Omit<PanelTab, 'id'>, panelId?: string): string {
      // ── Universal spec-note guard ──
      // When deferSpecTab is true, silently reject any attempt to open the
      // spec note — regardless of which caller initiates it.  The workspace
      // page will clear the flag right before triggering the animated slide-in.
      if (deferSpecTab && tab.type === 'note' && tab.noteId === 'spec') {
        logger.info(
          '[openTab] BLOCKED spec-note tab — deferSpecTab is active, waiting for slide-in animation',
          { workspaceId },
        );
        return '';
      }

      const targetPanelId = panelId ?? state.focusedPanelId;
      if (!targetPanelId || !state.panels[targetPanelId]) {
        logger.warn('No panel to open tab in', { panelId, focusedPanelId: state.focusedPanelId });
        return '';
      }

      // For certain tab types, check ALL panels first to prevent duplicates across different panels
      // This is important for:
      // - Agent tabs: prevent race conditions where multiple effects try to open the same agent
      // - Singleton tabs (agent-overview, local-changes): only one should exist per workspace
      const isSingletonTab =
        tab.type === 'agent-overview' ||
        tab.type === 'local-changes' ||
        tab.type === 'code-review' ||
        tab.type === 'settings' ||
        tab.type === 'overview';
      const isAgentTab = tab.type === 'agent' && tab.agentId;

      if (isSingletonTab || isAgentTab) {
        for (const [existingPanelId, existingPanel] of Object.entries(state.panels)) {
          const existingTab = existingPanel.tabs.find((t) => {
            if (isSingletonTab) {
              // For singleton tabs, just match by type
              return t.type === tab.type;
            }
            // For agent tabs, match by type and agentId
            return t.type === 'agent' && t.agentId === tab.agentId;
          });

          if (existingTab) {
            logger.info('Tab already exists in another panel, focusing existing tab', {
              type: tab.type,
              agentId: isAgentTab ? tab.agentId : undefined,
              existingPanelId,
              existingTabId: existingTab.id,
              requestedPanelId: targetPanelId,
            });
            // Focus the existing tab instead of creating a duplicate
            const tabId = mutate(() => {
              existingPanel.activeTabId = existingTab.id;
              state.focusedPanelId = existingPanelId;
              return existingTab.id;
            });
            addToFocusHistory(existingPanelId, tabId);
            return tabId;
          }
        }
      }

      const panel = state.panels[targetPanelId];

      // Check if tab with same content already exists in target panel
      const existingTab = panel.tabs.find((t) => {
        if (t.type !== tab.type) return false;
        switch (tab.type) {
          case 'note':
            return t.noteId === tab.noteId;
          case 'file':
            return t.filePath === tab.filePath;
          case 'agent':
            return t.agentId === tab.agentId;
          case 'terminal':
            return t.terminalId === tab.terminalId;
          case 'diff': {
            // For diffs, also check commitHash - same file in different commits are different diffs
            const tabCommitHash = (tab.data?.change as { commitHash?: string })?.commitHash;
            const existingCommitHash = (t.data?.change as { commitHash?: string })?.commitHash;
            return t.diffPath === tab.diffPath && tabCommitHash === existingCommitHash;
          }
          case 'browser':
            // If both tabs have contextItemId, match by that (allows URL updates)
            if (t.contextItemId && tab.contextItemId) {
              return t.contextItemId === tab.contextItemId;
            }
            // Fall back to URL matching
            return t.browserUrl === tab.browserUrl;
          case 'changes': {
            // Match by commitHash - reuse existing tab for the same commit changeset
            const tabHash = (tab.data as { commitHash?: string })?.commitHash;
            const existingHash = (t.data as { commitHash?: string })?.commitHash;
            return !!tabHash && tabHash === existingHash;
          }
          case 'activity-changes':
            // Match by filePath - reuse existing tab for same file
            return t.filePath === tab.filePath;
          case 'chat-changes': {
            // Match by messageId - reuse existing tab for same chat message's changes
            const tabMessageId = (tab.data as { messageId?: string })?.messageId;
            const existingMessageId = (t.data as { messageId?: string })?.messageId;
            return !!tabMessageId && tabMessageId === existingMessageId;
          }
          // Singleton tabs - only one per workspace, match by type alone
          case 'activity':
          case 'code-review':
          case 'settings':
          case 'overview':
          case 'agent-overview':
          case 'local-changes':
            return true;
          default: {
            // Exhaustive check: if a new PanelTabType is added to the union
            // without a dedup case here, TypeScript will error on this line.
            const _exhaustive: never = tab.type;
            logger.warn(`[openTab] No dedup logic for tab type: ${_exhaustive}`);
            return false;
          }
        }
      });

      if (existingTab) {
        // Focus the existing tab and update its data if provided (e.g., for line navigation)
        const tabId = mutate(() => {
          panel.activeTabId = existingTab.id;
          // Update data if new data is provided (e.g., line number for navigation)
          if (tab.data) {
            existingTab.data = { ...existingTab.data, ...tab.data };
          }
          return existingTab.id;
        });
        // Track in focus history
        addToFocusHistory(targetPanelId, tabId);
        return tabId;
      }

      // Create and add new tab
      const newTabId = mutate(() => {
        const newTab: PanelTab = {
          ...tab,
          id: generateTabId(),
        };

        panel.tabs.push(newTab);
        panel.activeTabId = newTab.id;

        logger.debug('Opened tab', { tabId: newTab.id, type: tab.type, panelId: targetPanelId });
        return newTab.id;
      });
      // Track in focus history
      addToFocusHistory(targetPanelId, newTabId);
      return newTabId;
    },

    /** Open a browser panel */
    openBrowserPanel(url?: string, contextItemId?: string): string {
      // Track analytics event
      try {
        const urlDomain = url ? new URL(url).hostname : 'google.com';
        track('Opened Browser Panel', {
          url_domain: urlDomain,
          source: 'direct',
        });
      } catch {
        // Analytics should not break functionality
      }

      return this.openTab({
        type: 'browser',
        title: 'Browser',
        browserUrl: url ?? 'https://google.com',
        contextItemId,
        closable: true,
      });
    },

    /** Close a tab */
    closeTab(tabId: string, panelId?: string) {
      // Find the panel containing this tab
      let targetPanelId = panelId;
      if (!targetPanelId) {
        for (const [pId, panel] of Object.entries(state.panels)) {
          if (panel.tabs.some((t) => t.id === tabId)) {
            targetPanelId = pId;
            break;
          }
        }
      }

      if (!targetPanelId || !state.panels[targetPanelId]) return;

      const panel = state.panels[targetPanelId];
      const tabIndex = panel.tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return;

      mutate(() => {
        // Save the tab to recently closed before removing
        const closedTab = panel.tabs[tabIndex];
        recentlyClosed.unshift({
          tab: { ...closedTab },
          panelId: targetPanelId!,
          closedAt: Date.now(),
        });
        // Keep only the most recent tabs
        if (recentlyClosed.length > MAX_RECENTLY_CLOSED) {
          recentlyClosed.splice(MAX_RECENTLY_CLOSED);
        }

        panel.tabs.splice(tabIndex, 1);

        // Update active tab if needed
        if (panel.activeTabId === tabId) {
          if (panel.tabs.length > 0) {
            // Focus the next tab, or previous if at end
            const newIndex = Math.min(tabIndex, panel.tabs.length - 1);
            panel.activeTabId = panel.tabs[newIndex].id;
          } else {
            panel.activeTabId = null;
          }
        }

        logger.debug('Closed tab', {
          tabId,
          panelId: targetPanelId,
          remainingTabs: panel.tabs.length,
        });

        // If panel is now empty and there are other panels, close it
        if (panel.tabs.length === 0) {
          const panelIds = Object.keys(state.panels);
          logger.debug('Panel is now empty', {
            panelId: targetPanelId,
            totalPanels: panelIds.length,
          });
          if (panelIds.length > 1) {
            // Close this empty panel using the internal function
            closePanelInternal(targetPanelId!);
            logger.debug('Closed empty panel', { panelId: targetPanelId });
          }
        }
      });
    },

    /** Close the active tab in the focused panel (or specified panel) */
    closeActiveTab(panelId?: string): boolean {
      const targetPanelId = panelId ?? state.focusedPanelId;
      if (!targetPanelId || !state.panels[targetPanelId]) return false;

      const panel = state.panels[targetPanelId];
      if (!panel.activeTabId) return false;

      // Check if the tab is closable
      const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId);
      if (activeTab && activeTab.closable === false) {
        logger.debug('Active tab is not closable', { tabId: panel.activeTabId });
        return false;
      }

      this.closeTab(panel.activeTabId, targetPanelId);
      return true;
    },

    /** Close all tabs matching a predicate across all panels.
     * Useful for closing tabs when their content is deleted (e.g., deleting an agent closes its tabs).
     */
    closeTabsMatching(predicate: (tab: PanelTab) => boolean) {
      // Collect all matching tabs first to avoid mutation during iteration
      const tabsToClose: { tabId: string; panelId: string }[] = [];
      for (const [panelId, panel] of Object.entries(state.panels)) {
        for (const tab of panel.tabs) {
          if (predicate(tab)) {
            tabsToClose.push({ tabId: tab.id, panelId });
          }
        }
      }
      for (const { tabId, panelId } of tabsToClose) {
        this.closeTab(tabId, panelId);
      }
    },

    /** Update a tab's title */
    updateTabTitle(tabId: string, newTitle: string) {
      // Find the panel containing this tab
      for (const panel of Object.values(state.panels)) {
        const tab = panel.tabs.find((t) => t.id === tabId);
        if (tab) {
          mutate(() => {
            tab.title = newTitle;
            logger.debug('Updated tab title', { tabId, newTitle });
          });
          return;
        }
      }
      logger.warn('Tab not found for title update', { tabId });
    },

    /**
     * Reconcile stale agent tabs in the layout.
     * Replaces agent tabs that reference non-existent agent IDs with a valid agent ID.
     * Only the first stale tab is replaced; additional stale tabs are removed to avoid
     * duplicates (e.g., two tabs pointing to the same replacement agent).
     * If the replacement agent already has a tab in the layout, all stale tabs are removed.
     *
     * This fixes blank chat panels caused by localStorage layout referencing deleted/old agents.
     *
     * @param validAgentIds - Set of agent IDs that actually exist (restored from disk)
     * @param replacementAgentId - The agent ID to use as replacement (e.g., the most recent agent)
     * @param replacementTitle - The title for the replacement tab
     * @returns Number of tabs that were reconciled (replaced or removed)
     */
    reconcileStaleAgentTabs(
      validAgentIds: Set<string>,
      replacementAgentId: string,
      replacementTitle: string,
    ): number {
      // Check if the replacement agent already has a tab somewhere in the layout
      let replacementAlreadyExists = false;
      for (const panel of Object.values(state.panels)) {
        if (panel.tabs.some((t) => t.type === 'agent' && t.agentId === replacementAgentId)) {
          replacementAlreadyExists = true;
          break;
        }
      }

      let reconciledCount = 0;
      let hasReplaced = false;

      // Use addToHistory: false — this is an automatic repair, not a user action
      mutate(() => {
        for (const panel of Object.values(state.panels)) {
          const tabsToRemove: string[] = [];

          for (const tab of panel.tabs) {
            if (tab.type === 'agent' && tab.agentId && !validAgentIds.has(tab.agentId)) {
              if (!replacementAlreadyExists && !hasReplaced) {
                // Replace the first stale tab with the valid agent
                logger.info('Reconciling stale agent tab (replacing)', {
                  tabId: tab.id,
                  staleAgentId: tab.agentId,
                  replacementAgentId,
                });
                tab.agentId = replacementAgentId;
                tab.title = replacementTitle;
                hasReplaced = true;
              } else {
                // Remove additional stale tabs to avoid duplicates
                logger.info('Reconciling stale agent tab (removing duplicate)', {
                  tabId: tab.id,
                  staleAgentId: tab.agentId,
                  replacementAlreadyExists,
                });
                tabsToRemove.push(tab.id);
              }
              reconciledCount++;
            }
          }

          // Remove stale tabs that weren't replaced
          if (tabsToRemove.length > 0) {
            panel.tabs = panel.tabs.filter((t) => !tabsToRemove.includes(t.id));
            // Fix activeTabId if it was pointing to a removed tab
            if (panel.activeTabId && tabsToRemove.includes(panel.activeTabId)) {
              panel.activeTabId = panel.tabs[0]?.id ?? null;
            }
          }
        }
      }, { addToHistory: false });

      return reconciledCount;
    },

    /** Update a browser tab's URL - called when user navigates within the webview */
    updateTabBrowserUrl(tabId: string, newUrl: string) {
      // Find the panel containing this tab
      for (const panel of Object.values(state.panels)) {
        const tab = panel.tabs.find((t) => t.id === tabId);
        if (tab && tab.type === 'browser') {
          mutate(() => {
            tab.browserUrl = newUrl;
            logger.debug('Updated tab browserUrl', { tabId, newUrl });
          });
          return;
        }
      }
      logger.warn('Tab not found for browserUrl update', { tabId });
    },

    /** Update a browser tab's favicon URL */
    updateTabFavicon(tabId: string, faviconUrl: string) {
      for (const panel of Object.values(state.panels)) {
        const tab = panel.tabs.find((t) => t.id === tabId);
        if (tab && tab.type === 'browser') {
          mutate(() => {
            tab.faviconUrl = faviconUrl;
          });
          return;
        }
      }
    },

    /** Update file tabs when a file is renamed - updates filePath and title */
    updateFileTabPath(oldPath: string, newPath: string) {
      const newFileName = newPath.split('/').pop() || newPath;
      let updated = false;

      mutate(() => {
        for (const panel of Object.values(state.panels)) {
          for (const tab of panel.tabs) {
            if (tab.type === 'file' && tab.filePath === oldPath) {
              tab.filePath = newPath;
              tab.title = newFileName;
              updated = true;
              logger.debug('Updated file tab path', { tabId: tab.id, oldPath, newPath });
            }
          }
        }
      });

      if (updated) {
        logger.info('Updated file tab(s) for renamed file', { oldPath, newPath });
      }
      return updated;
    },

    /** Reopen the most recently closed tab */
    reopenClosedTab(): boolean {
      if (recentlyClosed.length === 0) {
        logger.debug('No recently closed tabs to reopen');
        return false;
      }

      // ── Spec-note guard ──
      // Peek at the tab before removing it from the queue. If it's a spec-note
      // and deferral is active, leave it in the queue and skip it.
      const next = recentlyClosed[0];
      if (deferSpecTab && next.tab.type === 'note' && next.tab.noteId === 'spec') {
        logger.info(
          '[reopenClosedTab] BLOCKED spec-note tab — deferSpecTab is active',
          { workspaceId },
        );
        return false;
      }

      const { tab, panelId } = recentlyClosed.shift()!;

      // Check if the panel still exists, otherwise use the focused panel
      const targetPanelId = state.panels[panelId] ? panelId : state.focusedPanelId;
      if (!targetPanelId || !state.panels[targetPanelId]) {
        logger.warn('No valid panel to reopen tab in');
        return false;
      }

      return mutate(() => {
        const panel = state.panels[targetPanelId];

        // Give it a new ID to avoid conflicts
        const newTab: PanelTab = {
          ...tab,
          id: generateTabId(),
        };

        panel.tabs.push(newTab);
        panel.activeTabId = newTab.id;

        logger.debug('Reopened tab', { tabId: newTab.id, type: tab.type, panelId: targetPanelId });
        return true;
      });
    },

    /** Get list of recently closed tabs */
    get recentlyClosedTabs() {
      return recentlyClosed;
    },

    /** Set active tab in a panel */
    setActiveTab(tabId: string, panelId?: string) {
      const targetPanelId = panelId ?? state.focusedPanelId;
      if (!targetPanelId || !state.panels[targetPanelId]) return;

      const panel = state.panels[targetPanelId];
      if (panel.tabs.some((t) => t.id === tabId)) {
        // Only add to history if actually changing the active tab
        if (panel.activeTabId !== tabId) {
          mutate(() => {
            panel.activeTabId = tabId;
          });
          // Track in focus history for back/forward navigation
          addToFocusHistory(targetPanelId, tabId);
        }
      }
    },

    /** Select the next tab in the focused panel (wraps around) */
    selectNextTab(panelId?: string) {
      const targetPanelId = panelId ?? state.focusedPanelId;
      if (!targetPanelId || !state.panels[targetPanelId]) return;

      const panel = state.panels[targetPanelId];
      if (panel.tabs.length === 0) return;

      const currentIndex = panel.tabs.findIndex((t) => t.id === panel.activeTabId);
      const nextIndex = (currentIndex + 1) % panel.tabs.length;
      const nextTab = panel.tabs[nextIndex];
      if (nextTab) {
        this.setActiveTab(nextTab.id, targetPanelId);
        logger.debug('Selected next tab', { panelId: targetPanelId, tabId: nextTab.id });
      }
    },

    /** Select the previous tab in the focused panel (wraps around) */
    selectPreviousTab(panelId?: string) {
      const targetPanelId = panelId ?? state.focusedPanelId;
      if (!targetPanelId || !state.panels[targetPanelId]) return;

      const panel = state.panels[targetPanelId];
      if (panel.tabs.length === 0) return;

      const currentIndex = panel.tabs.findIndex((t) => t.id === panel.activeTabId);
      const prevIndex = currentIndex <= 0 ? panel.tabs.length - 1 : currentIndex - 1;
      const prevTab = panel.tabs[prevIndex];
      if (prevTab) {
        this.setActiveTab(prevTab.id, targetPanelId);
        logger.debug('Selected previous tab', { panelId: targetPanelId, tabId: prevTab.id });
      }
    },

    /** Reorder tabs within a panel - does not add to history */
    reorderTabs(panelId: string, fromIndex: number, toIndex: number) {
      const panel = state.panels[panelId];
      if (!panel) return;
      if (fromIndex < 0 || fromIndex >= panel.tabs.length) return;
      if (toIndex < 0 || toIndex >= panel.tabs.length) return;
      if (fromIndex === toIndex) return;

      mutate(
        () => {
          const [tab] = panel.tabs.splice(fromIndex, 1);
          panel.tabs.splice(toIndex, 0, tab);
          logger.debug('Reordered tabs', { panelId, fromIndex, toIndex });
        },
        { addToHistory: false },
      );
    },

    /** Move a tab from one panel to another */
    moveTabToPanel(tabId: string, fromPanelId: string, toPanelId: string, insertIndex?: number) {
      const fromPanel = state.panels[fromPanelId];
      const toPanel = state.panels[toPanelId];
      if (!fromPanel || !toPanel) return;

      const tabIndex = fromPanel.tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return;

      mutate(() => {
        // Remove from source panel
        const [tab] = fromPanel.tabs.splice(tabIndex, 1);

        // Insert into target panel
        const targetIndex = insertIndex ?? toPanel.tabs.length;
        toPanel.tabs.splice(targetIndex, 0, tab);
        toPanel.activeTabId = tab.id;

        // Update active tab in source if needed
        if (fromPanel.activeTabId === tabId) {
          if (fromPanel.tabs.length > 0) {
            const newIndex = Math.min(tabIndex, fromPanel.tabs.length - 1);
            fromPanel.activeTabId = fromPanel.tabs[newIndex].id;
          } else {
            fromPanel.activeTabId = null;
          }
        }

        // Focus the target panel
        state.focusedPanelId = toPanelId;

        // If source panel is now empty and there are other panels, close it
        if (fromPanel.tabs.length === 0 && Object.keys(state.panels).length > 1) {
          closePanelInternal(fromPanelId);
        }

        logger.debug('Moved tab to panel', { tabId, fromPanelId, toPanelId, insertIndex });
      });
    },

    /** Move a tab to a new split of another panel */
    moveTabToSplit(
      tabId: string,
      fromPanelId: string,
      targetPanelId: string,
      zone: 'top' | 'bottom' | 'left' | 'right',
    ) {
      const fromPanel = state.panels[fromPanelId];
      if (!fromPanel) return;

      const tabIndex = fromPanel.tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return;

      mutate(() => {
        // Determine split direction based on zone
        const direction = zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
        const insertBefore = zone === 'left' || zone === 'top';

        // Remove tab from source panel
        const [tab] = fromPanel.tabs.splice(tabIndex, 1);

        // Update active tab in source if needed
        if (fromPanel.activeTabId === tabId) {
          if (fromPanel.tabs.length > 0) {
            const newIndex = Math.min(tabIndex, fromPanel.tabs.length - 1);
            fromPanel.activeTabId = fromPanel.tabs[newIndex].id;
          } else {
            fromPanel.activeTabId = null;
          }
        }

        // Create a new panel with the tab
        const newPanelId = generatePanelId();
        state.panels[newPanelId] = {
          id: newPanelId,
          tabs: [tab],
          activeTabId: tab.id,
        };

        // Find the target panel node and replace it with a split
        const findAndReplace = (
          node: PanelLayoutNode,
        ): { found: boolean; replacement: PanelLayoutNode } => {
          if (node.type === 'panel' && node.panelId === targetPanelId) {
            const children = insertBefore
              ? [{ type: 'panel' as const, panelId: newPanelId }, node]
              : [node, { type: 'panel' as const, panelId: newPanelId }];

            return {
              found: true,
              replacement: {
                type: 'split',
                direction,
                children,
                sizes: [50, 50],
              },
            };
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

        const result = findAndReplace(state.root);
        if (result.found) {
          state.root = result.replacement;
        }

        // Focus the new panel
        state.focusedPanelId = newPanelId;

        // If source panel is now empty and there are other panels, close it
        if (fromPanel.tabs.length === 0 && Object.keys(state.panels).length > 1) {
          closePanelInternal(fromPanelId);
        }

        logger.debug('Moved tab to split', { tabId, fromPanelId, targetPanelId, zone, newPanelId });
      });
    },

    /**
     * Insert a new panel at a split level (wrapping existing content)
     *
     * This is used when dropping a tab on a split handle to create a new row/column
     * that spans all children of that split.
     */
    moveTabToSplitLevel(
      tabId: string,
      fromPanelId: string,
      splitPath: number[],
      position: 'before' | 'after',
      direction: 'horizontal' | 'vertical',
    ) {
      const fromPanel = state.panels[fromPanelId];
      if (!fromPanel) return;

      const tabIndex = fromPanel.tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return;

      mutate(() => {
        // Remove tab from source panel
        const [tab] = fromPanel.tabs.splice(tabIndex, 1);

        // Update active tab in source if needed
        if (fromPanel.activeTabId === tabId) {
          if (fromPanel.tabs.length > 0) {
            const newIndex = Math.min(tabIndex, fromPanel.tabs.length - 1);
            fromPanel.activeTabId = fromPanel.tabs[newIndex].id;
          } else {
            fromPanel.activeTabId = null;
          }
        }

        // Create a new panel with the tab
        const newPanelId = generatePanelId();
        state.panels[newPanelId] = {
          id: newPanelId,
          tabs: [tab],
          activeTabId: tab.id,
        };

        const newPanelNode: PanelLayoutNode = { type: 'panel', panelId: newPanelId };

        // Navigate to the target node using the path
        // If path is empty, we're wrapping the root
        if (splitPath.length === 0) {
          // Wrap the entire root
          const children =
            position === 'before' ? [newPanelNode, state.root] : [state.root, newPanelNode];

          state.root = {
            type: 'split',
            direction,
            children,
            sizes: [50, 50],
          };
        } else {
          // Navigate to the parent of the target node
          let parent: PanelLayoutNode = state.root;
          for (let i = 0; i < splitPath.length - 1; i++) {
            if (parent.type === 'split' && parent.children[splitPath[i]]) {
              parent = parent.children[splitPath[i]];
            } else {
              return; // Invalid path
            }
          }

          if (parent.type !== 'split') return;

          const targetIndex = splitPath[splitPath.length - 1];
          const targetNode = parent.children[targetIndex];
          if (!targetNode) return;

          // Wrap the target node with a new split
          const children =
            position === 'before' ? [newPanelNode, targetNode] : [targetNode, newPanelNode];

          parent.children[targetIndex] = {
            type: 'split',
            direction,
            children,
            sizes: [50, 50],
          };
        }

        // Focus the new panel
        state.focusedPanelId = newPanelId;

        // If source panel is now empty and there are other panels, close it
        if (fromPanel.tabs.length === 0 && Object.keys(state.panels).length > 1) {
          closePanelInternal(fromPanelId);
        }

        logger.debug('Moved tab to split level', {
          tabId,
          fromPanelId,
          splitPath,
          position,
          direction,
          newPanelId,
        });
      });
    },

    /** Close all tabs except the specified one */
    closeOtherTabs(tabId: string, panelId?: string) {
      const targetPanelId = panelId ?? state.focusedPanelId;
      if (!targetPanelId) return;

      const panel = state.panels[targetPanelId];
      if (!panel) return;

      const tab = panel.tabs.find((t) => t.id === tabId);
      if (!tab) return;

      mutate(() => {
        // Save closed tabs to recently closed
        for (const t of panel.tabs) {
          if (t.id !== tabId && t.closable !== false) {
            recentlyClosed.unshift({
              tab: { ...t },
              panelId: targetPanelId!,
              closedAt: Date.now(),
            });
          }
        }
        if (recentlyClosed.length > MAX_RECENTLY_CLOSED) {
          recentlyClosed.splice(MAX_RECENTLY_CLOSED);
        }

        // Keep only the specified tab (and any non-closable tabs)
        panel.tabs = panel.tabs.filter((t) => t.id === tabId || t.closable === false);
        panel.activeTabId = tabId;
        logger.debug('Closed other tabs', { keptTabId: tabId, panelId: targetPanelId });
      });
    },

    /** Close all tabs to the right of the specified one */
    closeTabsToRight(tabId: string, panelId?: string) {
      const targetPanelId = panelId ?? state.focusedPanelId;
      if (!targetPanelId) return;

      const panel = state.panels[targetPanelId];
      if (!panel) return;

      const tabIndex = panel.tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return;

      mutate(() => {
        // Save closed tabs to recently closed
        for (let i = tabIndex + 1; i < panel.tabs.length; i++) {
          const t = panel.tabs[i];
          if (t.closable !== false) {
            recentlyClosed.unshift({
              tab: { ...t },
              panelId: targetPanelId!,
              closedAt: Date.now(),
            });
          }
        }
        if (recentlyClosed.length > MAX_RECENTLY_CLOSED) {
          recentlyClosed.splice(MAX_RECENTLY_CLOSED);
        }

        // Keep only tabs up to and including the specified tab (and any non-closable tabs to the right)
        panel.tabs = panel.tabs.filter((t, i) => i <= tabIndex || t.closable === false);

        // Update active tab if it was closed
        if (!panel.tabs.some((t) => t.id === panel.activeTabId)) {
          panel.activeTabId = panel.tabs[panel.tabs.length - 1]?.id ?? null;
        }

        logger.debug('Closed tabs to right', { fromTabId: tabId, panelId: targetPanelId });
      });
    },

    /** Close all tabs in the panel */
    closeAllTabs(panelId?: string) {
      const targetPanelId = panelId ?? state.focusedPanelId;
      if (!targetPanelId) return;

      const panel = state.panels[targetPanelId];
      if (!panel) return;

      mutate(() => {
        // Save closed tabs to recently closed
        for (const t of panel.tabs) {
          if (t.closable !== false) {
            recentlyClosed.unshift({
              tab: { ...t },
              panelId: targetPanelId!,
              closedAt: Date.now(),
            });
          }
        }
        if (recentlyClosed.length > MAX_RECENTLY_CLOSED) {
          recentlyClosed.splice(MAX_RECENTLY_CLOSED);
        }

        // Keep only non-closable tabs
        panel.tabs = panel.tabs.filter((t) => t.closable === false);
        panel.activeTabId = panel.tabs[0]?.id ?? null;

        // If panel is now empty and there are other panels, close it
        if (panel.tabs.length === 0 && Object.keys(state.panels).length > 1) {
          closePanelInternal(targetPanelId!);
        }

        logger.debug('Closed all tabs', { panelId: targetPanelId });
      });
    },

    /** Close all tabs in all panels except the specified one */
    closeAllOthersEverywhere(tabId: string, panelId?: string) {
      const targetPanelId = panelId ?? state.focusedPanelId;
      if (!targetPanelId) return;

      const targetPanel = state.panels[targetPanelId];
      if (!targetPanel) return;

      const tab = targetPanel.tabs.find((t) => t.id === tabId);
      if (!tab) return;

      mutate(() => {
        // Close all tabs in other panels first
        const panelIds = Object.keys(state.panels);
        for (const pId of panelIds) {
          if (pId === targetPanelId) continue;
          const panel = state.panels[pId];
          if (!panel) continue;

          // Save closed tabs to recently closed
          for (const t of panel.tabs) {
            if (t.closable !== false) {
              recentlyClosed.unshift({
                tab: { ...t },
                panelId: pId,
                closedAt: Date.now(),
              });
            }
          }

          // Keep only non-closable tabs
          panel.tabs = panel.tabs.filter((t) => t.closable === false);
          panel.activeTabId = panel.tabs[0]?.id ?? null;
        }

        // Now close other tabs in the target panel
        for (const t of targetPanel.tabs) {
          if (t.id !== tabId && t.closable !== false) {
            recentlyClosed.unshift({
              tab: { ...t },
              panelId: targetPanelId!,
              closedAt: Date.now(),
            });
          }
        }

        // Trim recently closed list
        if (recentlyClosed.length > MAX_RECENTLY_CLOSED) {
          recentlyClosed.splice(MAX_RECENTLY_CLOSED);
        }

        // Keep only the specified tab (and any non-closable tabs)
        targetPanel.tabs = targetPanel.tabs.filter((t) => t.id === tabId || t.closable === false);
        targetPanel.activeTabId = tabId;

        // Clean up empty panels
        for (const pId of panelIds) {
          if (pId === targetPanelId) continue;
          const panel = state.panels[pId];
          if (panel && panel.tabs.length === 0) {
            closePanelInternal(pId);
          }
        }

        logger.debug('Closed all others everywhere', { keptTabId: tabId, panelId: targetPanelId });
      });
    },

    /**
     * Split a panel.
     * @param animated - If true, the new panel slides in from 0% to 50% via a JS animation.
     */
    splitPanel(
      panelId: string,
      direction: 'horizontal' | 'vertical',
      options?: { animated?: boolean },
    ) {
      const animated = options?.animated ?? false;
      // Clear expand state — splitting changes the tree structure,
      // making saved split paths stale
      expandedPanelId = null;
      savedSizesBeforeExpand = [];
      mutate(() => {
        // Track the new panel ID created during the split
        let createdPanelId: string | null = null;

        // Find the node containing this panel in the tree
        const findAndReplace = (
          node: PanelLayoutNode,
        ): { found: boolean; replacement: PanelLayoutNode } => {
          if (node.type === 'panel' && node.panelId === panelId) {
            // Create a new panel for the split
            const newPanelId = generatePanelId();
            createdPanelId = newPanelId;
            state.panels[newPanelId] = {
              id: newPanelId,
              tabs: [],
              activeTabId: null,
            };

            // When animated, start with [100, 0] so the new panel slides in from nothing.
            // A follow-up rAF will transition sizes to [50, 50].
            const initialSizes = animated ? [100, 0] : [50, 50];

            // Replace this panel node with a split containing both panels
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
                node.children[i] = result.replacement;
                return { found: true, replacement: node };
              }
            }
          }

          return { found: false, replacement: node };
        };

        const result = findAndReplace(state.root);
        if (result.found) {
          state.root = result.replacement;
          // Focus the new panel
          if (createdPanelId) {
            state.focusedPanelId = createdPanelId;
          }
          logger.debug('Split panel', {
            panelId,
            direction,
            newPanelId: createdPanelId,
            animated,
          });
        }
      });

      // When animated, smoothly interpolate sizes from [100, 0] to [50, 50]
      // using a JavaScript rAF loop. This avoids CSS transitions (which would
      // affect every flex-basis change globally, including expand/collapse).
      if (animated) {
        const DURATION_MS = 500;
        // cubic-bezier(0.4, 0, 0.2, 1) approximation (Material standard easing)
        const ease = (t: number) =>
          t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        // Find the split node that contains the source panel
        const findSplitNode = (node: PanelLayoutNode): (PanelLayoutNode & { type: 'split' }) | null => {
          if (node.type === 'split') {
            for (const child of node.children) {
              if (child.type === 'panel' && child.panelId === panelId) {
                return node;
              }
              const deeper = findSplitNode(child);
              if (deeper) return deeper;
            }
          }
          return null;
        };

        // Wait one frame so the DOM renders with [100, 0] first
        requestAnimationFrame(() => {
          const startTime = performance.now();

          const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / DURATION_MS, 1);
            const eased = ease(progress);
            const newPanelSize = 50 * eased; // 0 → 50

            const splitNode = findSplitNode(state.root)
              ?? (state.root.type === 'split' ? state.root as PanelLayoutNode & { type: 'split' } : null);

            if (splitNode) {
              // Direct mutation — Svelte 5's deep $state proxy detects this
              // and re-renders the component. We skip mutate() to avoid
              // persisting to localStorage on every frame (~30 writes).
              splitNode.sizes = [100 - newPanelSize, newPanelSize];
            }

            if (progress < 1) {
              requestAnimationFrame(animate);
            } else {
              // Final frame — persist the final sizes to localStorage
              persistState();
            }
          };

          requestAnimationFrame(animate);
        });
      }
    },

    /** Update split sizes - does not add to history */
    updateSplitSizes(sizes: number[], splitPath: number[] = []) {
      mutate(
        () => {
          // Navigate to the split node and update its sizes
          let node = state.root;
          for (const index of splitPath) {
            if (node.type === 'split' && node.children[index]) {
              node = node.children[index];
            } else {
              return;
            }
          }

          if (node.type === 'split') {
            node.sizes = sizes;
          }
        },
        { addToHistory: false },
      );
    },

    /** Close a panel (removes it from the split) */
    closePanel(panelId: string) {
      mutate(() => {
        closePanelInternal(panelId);
      });
    },

    /** Update sizes in a split node - does not add to history */
    updateSizes(nodePath: number[], sizes: number[]) {
      mutate(
        () => {
          // Navigate to the node using the path (empty means root)
          let current: PanelLayoutNode = state.root;
          for (const index of nodePath) {
            if (current.type === 'split' && current.children[index]) {
              current = current.children[index];
            } else {
              return; // Invalid path
            }
          }

          // Update sizes if the target node is a split
          if (current.type === 'split') {
            current.sizes = sizes;
            logger.debug('Updated sizes', { nodePath, sizes });
          }
        },
        { addToHistory: false },
      );
    },

    /** Whether a panel is currently expanded */
    get expandedPanelId(): string | null {
      return expandedPanelId;
    },

    /**
     * Toggle "expand" on a panel: give it ~85% of the space at each split level
     * along the path from root to the panel, or restore original sizes if already expanded.
     * Unlike zoom, this keeps all panels visible — the others just get smaller.
     */
    toggleExpandPanel(panelId: string) {
      mutate(
        () => {
          if (expandedPanelId === panelId) {
            // Collapse: restore saved sizes
            for (const entry of savedSizesBeforeExpand) {
              const node = getSplitAtPath(entry.nodePath);
              if (node && node.type === 'split') {
                node.sizes = entry.sizes;
              }
            }
            expandedPanelId = null;
            savedSizesBeforeExpand = [];
            logger.debug('Panel collapsed (expand toggled off)', { panelId });
          } else {
            // If a different panel was expanded, restore first
            if (expandedPanelId !== null) {
              for (const entry of savedSizesBeforeExpand) {
                const node = getSplitAtPath(entry.nodePath);
                if (node && node.type === 'split') {
                  node.sizes = entry.sizes;
                }
              }
              savedSizesBeforeExpand = [];
            }

            // Find path from root to the target panel
            const panelPath = findPanelPath(state.root, panelId);
            if (!panelPath || panelPath.length === 0) {
              // Panel is the root (only panel) — nothing to expand
              expandedPanelId = null;
              return;
            }

            // Walk down the tree, saving sizes and expanding at each split level
            let currentNode: PanelLayoutNode = state.root;
            const currentNodePath: number[] = [];

            for (const childIndex of panelPath) {
              if (currentNode.type === 'split') {
                // Save original sizes at this split
                savedSizesBeforeExpand.push({
                  nodePath: [...currentNodePath],
                  sizes: [...currentNode.sizes],
                });

                // Set new sizes: EXPANDED_SHARE for the target branch,
                // distribute the rest among siblings
                const siblingCount = currentNode.children.length - 1;
                const siblingShare =
                  siblingCount > 0 ? (100 - EXPANDED_SHARE) / siblingCount : 0;
                currentNode.sizes = currentNode.sizes.map((_, i) =>
                  i === childIndex ? EXPANDED_SHARE : siblingShare,
                );

                currentNodePath.push(childIndex);
                currentNode = currentNode.children[childIndex];
              }
            }

            expandedPanelId = panelId;
            logger.debug('Panel expanded', { panelId, levelsAdjusted: savedSizesBeforeExpand.length });
          }
        },
        { addToHistory: false },
      );
    },

    /** Reset to default layout */
    reset() {
      expandedPanelId = null;
      savedSizesBeforeExpand = [];
      mutate(() => {
        const defaultLayout = createDefaultLayout();
        Object.assign(state, defaultLayout);
      });
    },

    /** Apply a preset layout while preserving existing tabs */
    applyPreset(preset: 'single' | 'split-horizontal' | 'split-vertical' | 'three-column') {
      expandedPanelId = null;
      savedSizesBeforeExpand = [];
      mutate(() => {
        // Collect all tabs from all panels
        const allTabs: PanelTab[] = [];
        for (const panel of Object.values(state.panels)) {
          allTabs.push(...panel.tabs);
        }

        // Clear existing panels
        state.panels = {};

        switch (preset) {
          case 'single': {
            const panelId = generatePanelId();
            state.panels[panelId] = {
              id: panelId,
              tabs: allTabs,
              activeTabId: allTabs[0]?.id ?? null,
            };
            state.root = { type: 'panel', panelId };
            state.focusedPanelId = panelId;
            break;
          }

          case 'split-horizontal': {
            const leftId = generatePanelId();
            const rightId = generatePanelId();
            const midpoint = Math.ceil(allTabs.length / 2);
            state.panels[leftId] = {
              id: leftId,
              tabs: allTabs.slice(0, midpoint),
              activeTabId: allTabs[0]?.id ?? null,
            };
            state.panels[rightId] = {
              id: rightId,
              tabs: allTabs.slice(midpoint),
              activeTabId: allTabs[midpoint]?.id ?? null,
            };
            state.root = {
              type: 'split',
              direction: 'horizontal',
              children: [
                { type: 'panel', panelId: leftId },
                { type: 'panel', panelId: rightId },
              ],
              sizes: [50, 50],
            };
            state.focusedPanelId = leftId;
            break;
          }

          case 'split-vertical': {
            const topId = generatePanelId();
            const bottomId = generatePanelId();
            const midpoint = Math.ceil(allTabs.length / 2);
            state.panels[topId] = {
              id: topId,
              tabs: allTabs.slice(0, midpoint),
              activeTabId: allTabs[0]?.id ?? null,
            };
            state.panels[bottomId] = {
              id: bottomId,
              tabs: allTabs.slice(midpoint),
              activeTabId: allTabs[midpoint]?.id ?? null,
            };
            state.root = {
              type: 'split',
              direction: 'vertical',
              children: [
                { type: 'panel', panelId: topId },
                { type: 'panel', panelId: bottomId },
              ],
              sizes: [50, 50],
            };
            state.focusedPanelId = topId;
            break;
          }

          case 'three-column': {
            const leftId = generatePanelId();
            const centerId = generatePanelId();
            const rightId = generatePanelId();
            const third = Math.ceil(allTabs.length / 3);
            state.panels[leftId] = {
              id: leftId,
              tabs: allTabs.slice(0, third),
              activeTabId: allTabs[0]?.id ?? null,
            };
            state.panels[centerId] = {
              id: centerId,
              tabs: allTabs.slice(third, third * 2),
              activeTabId: allTabs[third]?.id ?? null,
            };
            state.panels[rightId] = {
              id: rightId,
              tabs: allTabs.slice(third * 2),
              activeTabId: allTabs[third * 2]?.id ?? null,
            };
            state.root = {
              type: 'split',
              direction: 'horizontal',
              children: [
                { type: 'panel', panelId: leftId },
                { type: 'panel', panelId: centerId },
                { type: 'panel', panelId: rightId },
              ],
              sizes: [33.33, 33.34, 33.33],
            };
            state.focusedPanelId = centerId;
            break;
          }
        }

        logger.debug('Applied layout preset', { preset });
      });
    },

    /**
     * Create a fresh grid layout with empty panels.
     * Unlike applyPreset, this does NOT preserve existing tabs.
     *
     * @param panelCount - Number of panels to create (1-6)
     * @returns Array of panel IDs in order
     */
    createGridLayout(panelCount: number): string[] {
      const count = Math.max(1, Math.min(6, panelCount));

      return mutate(() => {
        // Clear existing panels completely
        state.panels = {};

        const panelIds: string[] = [];

        if (count === 1) {
          // Single panel
          const panelId = generatePanelId();
          panelIds.push(panelId);
          state.panels[panelId] = { id: panelId, tabs: [], activeTabId: null };
          state.root = { type: 'panel', panelId };
          state.focusedPanelId = panelId;
        } else if (count === 2) {
          // Horizontal split
          const leftId = generatePanelId();
          const rightId = generatePanelId();
          panelIds.push(leftId, rightId);
          state.panels[leftId] = { id: leftId, tabs: [], activeTabId: null };
          state.panels[rightId] = { id: rightId, tabs: [], activeTabId: null };
          state.root = {
            type: 'split',
            direction: 'horizontal',
            children: [
              { type: 'panel', panelId: leftId },
              { type: 'panel', panelId: rightId },
            ],
            sizes: [50, 50],
          };
          state.focusedPanelId = leftId;
        } else if (count === 3) {
          // Three columns
          const ids = [generatePanelId(), generatePanelId(), generatePanelId()];
          panelIds.push(...ids);
          ids.forEach((id) => {
            state.panels[id] = { id, tabs: [], activeTabId: null };
          });
          state.root = {
            type: 'split',
            direction: 'horizontal',
            children: ids.map((panelId) => ({ type: 'panel' as const, panelId })),
            sizes: [33.33, 33.34, 33.33],
          };
          state.focusedPanelId = ids[0];
        } else if (count === 4) {
          // 2x2 grid
          const ids = [generatePanelId(), generatePanelId(), generatePanelId(), generatePanelId()];
          panelIds.push(...ids);
          ids.forEach((id) => {
            state.panels[id] = { id, tabs: [], activeTabId: null };
          });
          state.root = {
            type: 'split',
            direction: 'vertical',
            children: [
              {
                type: 'split',
                direction: 'horizontal',
                children: [
                  { type: 'panel', panelId: ids[0] },
                  { type: 'panel', panelId: ids[1] },
                ],
                sizes: [50, 50],
              },
              {
                type: 'split',
                direction: 'horizontal',
                children: [
                  { type: 'panel', panelId: ids[2] },
                  { type: 'panel', panelId: ids[3] },
                ],
                sizes: [50, 50],
              },
            ],
            sizes: [50, 50],
          };
          state.focusedPanelId = ids[0];
        } else if (count === 5) {
          // 3 on top, 2 on bottom
          const ids = [
            generatePanelId(),
            generatePanelId(),
            generatePanelId(),
            generatePanelId(),
            generatePanelId(),
          ];
          panelIds.push(...ids);
          ids.forEach((id) => {
            state.panels[id] = { id, tabs: [], activeTabId: null };
          });
          state.root = {
            type: 'split',
            direction: 'vertical',
            children: [
              {
                type: 'split',
                direction: 'horizontal',
                children: [
                  { type: 'panel', panelId: ids[0] },
                  { type: 'panel', panelId: ids[1] },
                  { type: 'panel', panelId: ids[2] },
                ],
                sizes: [33.33, 33.34, 33.33],
              },
              {
                type: 'split',
                direction: 'horizontal',
                children: [
                  { type: 'panel', panelId: ids[3] },
                  { type: 'panel', panelId: ids[4] },
                ],
                sizes: [50, 50],
              },
            ],
            sizes: [50, 50],
          };
          state.focusedPanelId = ids[0];
        } else {
          // 6: 3x2 grid
          const ids = [
            generatePanelId(),
            generatePanelId(),
            generatePanelId(),
            generatePanelId(),
            generatePanelId(),
            generatePanelId(),
          ];
          panelIds.push(...ids);
          ids.forEach((id) => {
            state.panels[id] = { id, tabs: [], activeTabId: null };
          });
          state.root = {
            type: 'split',
            direction: 'vertical',
            children: [
              {
                type: 'split',
                direction: 'horizontal',
                children: [
                  { type: 'panel', panelId: ids[0] },
                  { type: 'panel', panelId: ids[1] },
                  { type: 'panel', panelId: ids[2] },
                ],
                sizes: [33.33, 33.34, 33.33],
              },
              {
                type: 'split',
                direction: 'horizontal',
                children: [
                  { type: 'panel', panelId: ids[3] },
                  { type: 'panel', panelId: ids[4] },
                  { type: 'panel', panelId: ids[5] },
                ],
                sizes: [33.33, 33.34, 33.33],
              },
            ],
            sizes: [50, 50],
          };
          state.focusedPanelId = ids[0];
        }

        logger.debug('Created grid layout', { panelCount: count, panelIds });
        return panelIds;
      });
    },

    /** Cycle through preset layouts */
    cyclePresets() {
      const presets: Array<'single' | 'split-horizontal' | 'split-vertical' | 'three-column'> = [
        'single',
        'split-horizontal',
        'split-vertical',
        'three-column',
      ];

      // Determine current layout type
      let currentPreset = 'single';
      if (state.root.type === 'split') {
        if (state.root.children.length === 3) {
          currentPreset = 'three-column';
        } else if (state.root.direction === 'horizontal') {
          currentPreset = 'split-horizontal';
        } else {
          currentPreset = 'split-vertical';
        }
      }

      const currentIndex = presets.indexOf(currentPreset as (typeof presets)[number]);
      const nextIndex = (currentIndex + 1) % presets.length;
      this.applyPreset(presets[nextIndex]);
    },

    /**
     * Execute multiple mutations as a single history entry.
     * All mutations within the batch will be grouped into one undo/redo step.
     *
     * @example
     * layoutManager.batchMutations(() => {
     *   layoutManager.applyPreset('three-column');
     *   layoutManager.openTab({ type: 'agent', ... }, panelId1);
     *   layoutManager.openTab({ type: 'agent', ... }, panelId2);
     * });
     * // User can undo all of the above with a single Cmd+Z
     */
    batchMutations<T>(fn: () => T): T {
      return batchMutations(fn);
    },
  };

  return manager;
}

/** Get or create a panel layout manager for a workspace (cached) */
export function getPanelLayoutManager(workspaceId: string): PanelLayoutManager {
  let manager = managerCache.get(workspaceId);
  if (!manager) {
    manager = createPanelLayoutManagerInternal(workspaceId);
    managerCache.set(workspaceId, manager);
  }
  return manager;
}

/**
 * Check if a panel layout manager exists in the cache for a workspace.
 * This does NOT create a new manager - use this to check before accessing.
 * Used to avoid prematurely initializing layout state when workspace page isn't loaded.
 */
export function hasPanelLayoutManager(workspaceId: string): boolean {
  return managerCache.has(workspaceId);
}

/**
 * Clear the panel layout for a workspace.
 * This removes both the cached manager and the localStorage data.
 * Call this when creating a new workspace to ensure no stale data is loaded.
 */
export function clearPanelLayout(workspaceId: string): void {
  // Remove from cache
  managerCache.delete(workspaceId);

  // Remove from localStorage
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(getStorageKey(workspaceId));
      logger.info('[PanelLayoutManager] Cleared panel layout', { workspaceId });
    } catch {
      // Ignore storage errors
    }
  }
}

/** Create a new panel layout manager (alias for getPanelLayoutManager) */
export function createPanelLayoutManager(workspaceId: string): PanelLayoutManager {
  return getPanelLayoutManager(workspaceId);
}
