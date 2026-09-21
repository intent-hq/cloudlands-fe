/**
 * Panel Keyboard Shortcuts Manager
 *
 * Direct shortcuts (no leader key required):
 * - Mod+[/]: Select the previous/next pane in the active stack
 * - Mod+Shift+PageUp/PageDown: Focus the previous/next column
 * - Mod+Alt+PageUp/PageDown: Move the active pane to the previous/next column
 * - Mod+\: Create a column to the right
 *
 * Implements tmux/vim-style leader key system for panel navigation and management.
 * Leader key: Cmd+; (Mac) / Ctrl+; (Windows/Linux)
 *
 * After pressing the leader key, the next keypress triggers the action:
 * - h/j/k/l: Navigate panels (vim-style)
 * - H/J/K/L: Resize panels
 * - %: Split right (tmux)
 * - z: Toggle zoom/maximize
 * - x: Close panel
 * - o: Cycle to next panel
 * - p: Cycle to previous panel
 * - etc.
 */

import { createLogger } from '$lib/utils/client-logger';
import { isFocusInEditableElement, isFocusInTerminal } from '$lib/utils/keyboardShortcuts';

import {
  selectFocusedPanelId,
  selectFocusedPanel,
  selectPanelLayoutWorkspace,
  selectPanelIds,
} from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import type { PanelLayoutManager } from './panel-layout-adapter';
import type { PanelCycleDirection } from './panel-cycle-navigation';
import { store as appStore } from '$store/renderer/store';
import {
  matchesShortcut,
  matchesShortcutPattern,
  getShortcutSequenceTrigger,
  resolveShortcut,
  type ShortcutId,
} from '$lib/utils/shortcut-bindings';

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

interface PanelKeyboardShortcutOptions {
  isMac?: boolean;
  onFocusAdjacentColumn?: (direction: PanelCycleDirection) => boolean;
}

export function createPanelKeyboardShortcuts(
  getLayoutManager: () => PanelLayoutManager,
  onCyclePanel?: (direction: PanelCycleDirection) => void,
  getAvailableCanvasWidth: () => number | null = () => null,
  options: PanelKeyboardShortcutOptions = {},
) {
  const isMac =
    options.isMac ??
    (typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC'));
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
        if (onCyclePanel) onCyclePanel('next');
        else cyclePanel(layoutManager, 'next');
        break;

      case 'navigate-prev':
        if (onCyclePanel) onCyclePanel('prev');
        else cyclePanel(layoutManager, 'prev');
        break;

      case 'split-right': {
        const focusedId = selectFocusedPanelId.select(appStore.state, layoutManager.workspaceId);
        const panelIds = selectPanelIds.select(appStore.state, layoutManager.workspaceId);
        if (focusedId && panelIds.length < 4) {
          layoutManager.splitPanel(focusedId, 'horizontal');
        }
        break;
      }

      case 'zoom-toggle':
        toggleZoom(layoutManager);
        break;

      case 'zoom-reset':
        resetZoom();
        break;

      case 'close-panel': {
        const focusedId = selectFocusedPanelId.select(appStore.state, layoutManager.workspaceId);
        if (focusedId) {
          layoutManager.closePanel(focusedId);
        }
        break;
      }

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
        const panel = selectFocusedPanel.select(appStore.state, layoutManager.workspaceId);
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
    const wsId = layoutManager.workspaceId;
    const storeState = appStore.state;
    // Get all panel IDs and find adjacent panel based on direction
    const panelIds = selectPanelIds.select(storeState, wsId);
    if (panelIds.length <= 1) return;

    const currentId = selectFocusedPanelId.select(storeState, wsId);
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
    const wsId = layoutManager.workspaceId;
    const storeState = appStore.state;
    const panelIds = selectPanelIds.select(storeState, wsId);
    if (panelIds.length <= 1) return;

    const currentId = selectFocusedPanelId.select(storeState, wsId);
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
      state.zoomedPanelId = selectFocusedPanelId.select(appStore.state, layoutManager.workspaceId);
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
    const wsState = selectPanelLayoutWorkspace.select(appStore.state, layoutManager.workspaceId);
    if (!wsState) return;

    function equalizeSplitSizes(node: typeof wsState.root): void {
      if (node.type === 'split') {
        const equalSize = 100 / node.children.length;
        node.sizes = node.children.map(() => equalSize);
        node.children.forEach(equalizeSplitSizes);
      }
    }

    equalizeSplitSizes(wsState.root);
    logger.debug('Equalized all panel sizes');
  }

  function focusPanelByIndex(layoutManager: PanelLayoutManager, index: number) {
    const panelIds = selectPanelIds.select(appStore.state, layoutManager.workspaceId);
    if (index >= 0 && index < panelIds.length) {
      layoutManager.focusPanel(panelIds[index]);
    }
  }

  function selectAdjacentPane(
    layoutManager: PanelLayoutManager,
    direction: PanelCycleDirection,
  ): boolean {
    const panel = selectFocusedPanel.select(appStore.state, layoutManager.workspaceId);
    if (!panel || panel.tabs.length < 2) return false;
    if (direction === 'next') layoutManager.selectNextTab(panel.id);
    else layoutManager.selectPreviousTab(panel.id);
    return true;
  }

  function focusAdjacentColumn(
    layoutManager: PanelLayoutManager,
    direction: PanelCycleDirection,
  ): boolean {
    if (options.onFocusAdjacentColumn) return options.onFocusAdjacentColumn(direction);
    const panelIds = selectPanelIds.select(appStore.state, layoutManager.workspaceId);
    const focusedPanelId = selectFocusedPanelId.select(appStore.state, layoutManager.workspaceId);
    const currentIndex = focusedPanelId ? panelIds.indexOf(focusedPanelId) : -1;
    const targetIndex = currentIndex + (direction === 'next' ? 1 : -1);
    const targetPanelId = panelIds[targetIndex];
    if (!targetPanelId) return false;
    layoutManager.focusPanel(targetPanelId);
    return true;
  }

  function moveActivePane(
    layoutManager: PanelLayoutManager,
    direction: PanelCycleDirection,
  ): boolean {
    const panelIds = selectPanelIds.select(appStore.state, layoutManager.workspaceId);
    const panel = selectFocusedPanel.select(appStore.state, layoutManager.workspaceId);
    if (!panel?.activeTabId) return false;
    const currentIndex = panelIds.indexOf(panel.id);
    const targetIndex = currentIndex + (direction === 'next' ? 1 : -1);
    const targetPanelId = panelIds[targetIndex];
    if (!targetPanelId) return false;
    layoutManager.moveTabToPanel(panel.activeTabId, panel.id, targetPanelId);
    return true;
  }

  function createColumnToRight(layoutManager: PanelLayoutManager): boolean {
    const panelIds = selectPanelIds.select(appStore.state, layoutManager.workspaceId);
    const focusedPanelId = selectFocusedPanelId.select(appStore.state, layoutManager.workspaceId);
    if (!focusedPanelId || panelIds.length >= 4) return false;
    layoutManager.splitPanel(focusedPanelId, 'horizontal');
    return true;
  }

  /**
   * Handle a keydown event. Returns true if the event was handled.
   */
  function handleKeyDown(e: KeyboardEvent): boolean {
    // On Mac, "Mod" is Cmd (metaKey) only — Ctrl is reserved for Emacs bindings and other uses.
    // On Win/Linux, "Mod" is Ctrl.
    const isMod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    const matches = (id: ShortcutId) =>
      matchesShortcut(
        e,
        resolveShortcut(id, appStore.state.userPreferences?.shortcutOverrides ?? {}),
        isMac,
      );
    const focusColumnDirection = matches('panel.focus-previous-column')
      ? 'prev'
      : matches('panel.focus-next-column')
        ? 'next'
        : null;
    const paneDirection = matches('panel.previous-pane')
      ? 'prev'
      : matches('panel.next-pane')
        ? 'next'
        : null;

    // Column focus is global, including while panel content or a terminal owns focus.
    if (focusColumnDirection) {
      const handled = focusAdjacentColumn(getLayoutManager(), focusColumnDirection);
      if (handled) e.preventDefault();
      return handled;
    }

    // Pane selection is global when that direction is available, including from editable content.
    if (paneDirection) {
      const handled = selectAdjacentPane(getLayoutManager(), paneDirection);
      if (handled) e.preventDefault();
      return handled;
    }

    const target = e.target instanceof Element ? e.target : null;
    if (isFocusInTerminal(target as HTMLElement | null) || isFocusInEditableElement(target)) {
      return false;
    }

    const layoutManager = getLayoutManager();

    // PageUp/PageDown remain compatibility aliases for column focus and pane movement.
    const movePaneDirection = matches('panel.move-pane-previous-column')
      ? 'prev'
      : matches('panel.move-pane-next-column')
        ? 'next'
        : null;
    if (movePaneDirection) {
      const handled = moveActivePane(layoutManager, movePaneDirection);
      if (handled) e.preventDefault();
      return handled;
    }

    if (matches('panel.create-column-right')) {
      const handled = createColumnToRight(layoutManager);
      if (handled) e.preventDefault();
      return handled;
    }

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
    const binding = (id: ShortcutId) =>
      resolveShortcut(id, appStore.state.userPreferences?.shortcutOverrides ?? {});
    const match = (id: ShortcutId) => matchesShortcutPattern(e, binding(id), isMac);
    const navigation = match('leader.navigate-panels');
    if (navigation >= 0)
      return ['navigate-left', 'navigate-down', 'navigate-up', 'navigate-right'][
        navigation
      ] as LeaderAction;
    const resize = match('leader.resize-panels');
    if (resize >= 0)
      return ['resize-left', 'resize-down', 'resize-up', 'resize-right'][resize] as LeaderAction;
    const cycle = match('leader.next-previous-panel');
    if (cycle >= 0) return cycle === 0 ? 'navigate-next' : 'navigate-prev';
    if (match('leader.split-right') >= 0) return 'split-right';
    if (match('leader.toggle-zoom') >= 0) return 'zoom-toggle';
    if (match('leader.close-panel') >= 0) return 'close-panel';
    if (match('leader.equalize-sizes') >= 0) return 'resize-equal';
    const jumpBinding = getShortcutSequenceTrigger(binding('leader.jump-to-panel'));
    if (jumpBinding && matchesShortcut(e, jumpBinding, isMac)) return 'show-panel-numbers';
    if (match('leader.cycle-layout') >= 0) return 'cycle-layout-presets';

    return null;
  }

  return {
    get availableCanvasWidth() {
      return getAvailableCanvasWidth();
    },
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

export function getPanelKeyboardShortcuts(workspaceId: string): PanelKeyboardShortcuts | undefined {
  return keyboardShortcutsCache.get(workspaceId);
}
