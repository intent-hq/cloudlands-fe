/**
 * Panel Keyboard Shortcuts Manager
 *
 * Direct shortcuts (no leader key required):
 * - Cmd+[ / Ctrl+[: Go back in panel history (undo layout change)
 * - Cmd+] / Ctrl+]: Go forward in panel history (redo layout change)
 * - Cmd+0 / Ctrl+0: Reset zoom (unzoom panel)
 *
 * Implements tmux/vim-style leader key system for panel navigation and management.
 * Leader key: Cmd+; (Mac) / Ctrl+; (Windows/Linux)
 *
 * After pressing the leader key, the next keypress triggers the action:
 * - h/j/k/l: Navigate panels (vim-style)
 * - H/J/K/L: Resize panels
 * - %: Split right (tmux)
 * - ": Split down (tmux)
 * - z: Toggle zoom/maximize
 * - x: Close panel
 * - o: Cycle to next panel
 * - p: Cycle to previous panel
 * - etc.
 */

import { createLogger } from '$lib/utils/client-logger';
import type { PanelLayoutManager } from './panel-layout-manager.svelte';

const logger = createLogger('PanelKeyboardShortcuts');

// How long the leader key stays active (ms)
const LEADER_TIMEOUT = 2000;

export type LeaderAction =
  | 'navigate-left'
  | 'navigate-right'
  | 'navigate-up'
  | 'navigate-down'
  | 'navigate-next'
  | 'navigate-prev'
  | 'split-right'
  | 'split-down'
  | 'resize-left'
  | 'resize-right'
  | 'resize-up'
  | 'resize-down'
  | 'resize-equal'
  | 'zoom-toggle'
  | 'zoom-reset'
  | 'close-panel'
  | 'swap-prev'
  | 'swap-next'
  | 'show-panel-numbers'
  | 'move-tab-to-next-panel'
  | 'cycle-layout-presets';

interface KeyboardShortcutsState {
  leaderActive: boolean;
  leaderTimeout: ReturnType<typeof setTimeout> | null;
  isZoomed: boolean;
  zoomedPanelId: string | null;
  showPanelNumbers: boolean;
}

export function createPanelKeyboardShortcuts(getLayoutManager: () => PanelLayoutManager) {
  const state = $state<KeyboardShortcutsState>({
    leaderActive: false,
    leaderTimeout: null,
    isZoomed: false,
    zoomedPanelId: null,
    showPanelNumbers: false,
  });

  function activateLeader() {
    if (state.leaderTimeout) {
      clearTimeout(state.leaderTimeout);
    }
    state.leaderActive = true;
    state.leaderTimeout = setTimeout(() => {
      state.leaderActive = false;
      state.showPanelNumbers = false;
      logger.debug('Leader key timed out');
    }, LEADER_TIMEOUT);
    logger.debug('Leader key activated');
  }

  function deactivateLeader() {
    if (state.leaderTimeout) {
      clearTimeout(state.leaderTimeout);
      state.leaderTimeout = null;
    }
    state.leaderActive = false;
    state.showPanelNumbers = false;
  }

  /** Cleanup function - call on unmount to clear timeouts */
  function cleanup() {
    if (state.leaderTimeout) {
      clearTimeout(state.leaderTimeout);
      state.leaderTimeout = null;
    }
    state.leaderActive = false;
    state.isZoomed = false;
    state.zoomedPanelId = null;
    state.showPanelNumbers = false;
  }

  function executeAction(action: LeaderAction) {
    const layoutManager = getLayoutManager();
    logger.debug('Executing leader action', { action });

    switch (action) {
      case 'navigate-left':
      case 'navigate-right':
      case 'navigate-up':
      case 'navigate-down':
        navigatePanel(
          layoutManager,
          action.replace('navigate-', '') as 'left' | 'right' | 'up' | 'down',
        );
        break;

      case 'navigate-next':
        cyclePanel(layoutManager, 'next');
        break;

      case 'navigate-prev':
        cyclePanel(layoutManager, 'prev');
        break;

      case 'split-right':
        if (layoutManager.focusedPanelId) {
          layoutManager.splitPanel(layoutManager.focusedPanelId, 'horizontal');
        }
        break;

      case 'split-down':
        if (layoutManager.focusedPanelId) {
          layoutManager.splitPanel(layoutManager.focusedPanelId, 'vertical');
        }
        break;

      case 'zoom-toggle':
        toggleZoom(layoutManager);
        break;

      case 'zoom-reset':
        resetZoom();
        break;

      case 'close-panel':
        if (layoutManager.focusedPanelId) {
          layoutManager.closePanel(layoutManager.focusedPanelId);
        }
        break;

      case 'resize-left':
      case 'resize-right':
      case 'resize-up':
      case 'resize-down':
        // TODO: Implement panel resizing via keyboard
        // For now, use = to equalize sizes
        logger.debug('Resize action not yet implemented', { action });
        break;

      case 'resize-equal':
        equalizeAllSizes(layoutManager);
        break;

      case 'swap-prev':
      case 'swap-next':
        // TODO: Implement panel swap positions
        logger.debug('Swap action not yet implemented', { action });
        break;

      case 'show-panel-numbers':
        state.showPanelNumbers = true;
        // Keep leader active for number selection
        return; // Don't deactivate leader

      case 'move-tab-to-next-panel': {
        const panel = layoutManager.focusedPanel;
        if (panel?.activeTabId) {
          const otherPanelId = layoutManager.getOtherPanelId();
          if (otherPanelId) {
            layoutManager.moveTabToPanel(panel.activeTabId, panel.id, otherPanelId);
          }
        }
        break;
      }

      case 'cycle-layout-presets':
        layoutManager.cyclePresets();
        break;
    }

    deactivateLeader();
  }

  function navigatePanel(
    layoutManager: PanelLayoutManager,
    direction: 'left' | 'right' | 'up' | 'down',
  ) {
    // Get all panel IDs and find adjacent panel based on direction
    const panelIds = layoutManager.getPanelIds();
    if (panelIds.length <= 1) return;

    const currentId = layoutManager.focusedPanelId;
    if (!currentId) {
      layoutManager.focusPanel(panelIds[0]);
      return;
    }

    // For now, simple cycling - TODO: implement spatial navigation
    const currentIndex = panelIds.indexOf(currentId);
    let nextIndex: number;

    if (direction === 'left' || direction === 'up') {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : panelIds.length - 1;
    } else {
      nextIndex = currentIndex < panelIds.length - 1 ? currentIndex + 1 : 0;
    }

    layoutManager.focusPanel(panelIds[nextIndex]);
  }

  function cyclePanel(layoutManager: PanelLayoutManager, direction: 'next' | 'prev') {
    const panelIds = layoutManager.getPanelIds();
    if (panelIds.length <= 1) return;

    const currentId = layoutManager.focusedPanelId;
    const currentIndex = currentId ? panelIds.indexOf(currentId) : -1;

    let nextIndex: number;
    if (direction === 'next') {
      nextIndex = currentIndex < panelIds.length - 1 ? currentIndex + 1 : 0;
    } else {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : panelIds.length - 1;
    }

    layoutManager.focusPanel(panelIds[nextIndex]);
  }

  function toggleZoom(layoutManager: PanelLayoutManager) {
    // TODO: Implement proper zoom by hiding other panels
    // For now, this is a placeholder
    state.isZoomed = !state.isZoomed;
    if (state.isZoomed) {
      state.zoomedPanelId = layoutManager.focusedPanelId;
    } else {
      state.zoomedPanelId = null;
    }
    logger.debug('Zoom toggled', { isZoomed: state.isZoomed });
  }

  function resetZoom() {
    state.isZoomed = false;
    state.zoomedPanelId = null;
    logger.debug('Zoom reset');
  }

  function equalizeAllSizes(layoutManager: PanelLayoutManager) {
    // Reset all split sizes to equal
    const layout = layoutManager.layout;
    if (!layout) return;

    function equalizeSplitSizes(node: typeof layout.root): void {
      if (node.type === 'split') {
        const equalSize = 100 / node.children.length;
        node.sizes = node.children.map(() => equalSize);
        node.children.forEach(equalizeSplitSizes);
      }
    }

    equalizeSplitSizes(layout.root);
    logger.debug('Equalized all panel sizes');
  }

  function focusPanelByIndex(layoutManager: PanelLayoutManager, index: number) {
    const panelIds = layoutManager.getPanelIds();
    if (index >= 0 && index < panelIds.length) {
      layoutManager.focusPanel(panelIds[index]);
    }
  }

  /**
   * Handle a keydown event. Returns true if the event was handled.
   */
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

  function handleKeyDown(e: KeyboardEvent): boolean {
    // On Mac, "Mod" is Cmd (metaKey) only — Ctrl is reserved for Emacs bindings and other uses.
    // On Win/Linux, "Mod" is Ctrl.
    const isMod = isMac ? e.metaKey : e.ctrlKey;
    const layoutManager = getLayoutManager();

    // Back navigation: Cmd+[ / Ctrl+[
    if (isMod && e.key === '[' && !e.shiftKey && !e.altKey) {
      if (layoutManager.canGoBack) {
        e.preventDefault();
        layoutManager.goBack();
        return true;
      }
    }

    // Forward navigation: Cmd+] / Ctrl+]
    if (isMod && e.key === ']' && !e.shiftKey && !e.altKey) {
      if (layoutManager.canGoForward) {
        e.preventDefault();
        layoutManager.goForward();
        return true;
      }
    }

    // Cmd+0: Let browser handle native zoom reset (don't intercept)

    // Leader key activation: Cmd+; / Ctrl+; (tmux-style, avoids conflict with Cmd+K command palette)
    if (isMod && e.key === ';' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      activateLeader();
      return true;
    }

    // Handle input while leader is active
    if (state.leaderActive) {
      e.preventDefault();

      // Panel number selection (when showing numbers)
      if (state.showPanelNumbers && e.key >= '1' && e.key <= '9') {
        focusPanelByIndex(layoutManager, parseInt(e.key) - 1);
        deactivateLeader();
        return true;
      }

      // Leader key actions
      const action = getLeaderAction(e);
      if (action) {
        executeAction(action);
        return true;
      }

      // Unknown key - cancel leader mode
      deactivateLeader();
      return true;
    }

    return false;
  }

  function getLeaderAction(e: KeyboardEvent): LeaderAction | null {
    const isShift = e.shiftKey;

    switch (e.key.toLowerCase()) {
      // Navigation (vim-style)
      case 'h':
        return isShift ? 'resize-left' : 'navigate-left';
      case 'j':
        return isShift ? 'resize-down' : 'navigate-down';
      case 'k':
        return isShift ? 'resize-up' : 'navigate-up';
      case 'l':
        return isShift ? 'resize-right' : 'navigate-right';

      // Navigation (tmux-style)
      case 'o':
        return 'navigate-next';
      case 'p':
        return 'navigate-prev';

      // Splitting (tmux-style)
      case '%':
      case '5': // Shift+5 = % on US keyboard
        if (isShift) return 'split-right';
        break;
      case '"':
      case "'":
        if (isShift) return 'split-down';
        break;

      // Zoom
      case 'z':
        return 'zoom-toggle';

      // Close
      case 'x':
        return 'close-panel';

      // Resize equal
      case '=':
        return 'resize-equal';

      // Show panel numbers for quick jump
      case 'q':
        return 'show-panel-numbers';

      // Move tab
      case 'm':
        return 'move-tab-to-next-panel';

      // Cycle layout presets (tmux-style Space)
      case ' ':
        return 'cycle-layout-presets';
    }

    return null;
  }

  return {
    get leaderActive() {
      return state.leaderActive;
    },
    get isZoomed() {
      return state.isZoomed;
    },
    get zoomedPanelId() {
      return state.zoomedPanelId;
    },
    get showPanelNumbers() {
      return state.showPanelNumbers;
    },
    handleKeyDown,
    activateLeader,
    deactivateLeader,
    executeAction,
    focusPanelByIndex,
    cleanup,
  };
}

export type PanelKeyboardShortcuts = ReturnType<typeof createPanelKeyboardShortcuts>;

// Cache for keyboard shortcuts managers per workspace
const keyboardShortcutsCache = new Map<string, PanelKeyboardShortcuts>();

/**
 * Get the keyboard shortcuts manager for a workspace.
 * Returns undefined if the manager hasn't been created yet (PanelLayout not mounted).
 */
export function getPanelKeyboardShortcuts(workspaceId: string): PanelKeyboardShortcuts | undefined {
  return keyboardShortcutsCache.get(workspaceId);
}

/**
 * Register a keyboard shortcuts manager for a workspace.
 * Called by PanelLayout when it creates the manager.
 */
export function registerPanelKeyboardShortcuts(
  workspaceId: string,
  shortcuts: PanelKeyboardShortcuts,
): void {
  keyboardShortcutsCache.set(workspaceId, shortcuts);
}

/**
 * Unregister a keyboard shortcuts manager for a workspace.
 * Called by PanelLayout when it unmounts.
 */
export function unregisterPanelKeyboardShortcuts(workspaceId: string): void {
  keyboardShortcutsCache.delete(workspaceId);
}
