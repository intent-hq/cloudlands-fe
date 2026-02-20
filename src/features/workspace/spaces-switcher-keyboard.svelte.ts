/**
 * Spaces Switcher Keyboard Manager
 *
 * Implements macOS Command-Tab style workspace switching:
 * - Ctrl+Tab opens the workspaces overlay
 * - The overlay shows current workspace first, then others by recency
 * - Selection starts on the second item (most recent other workspace)
 * - Additional Tab presses while Ctrl is held cycle forward
 * - Shift+Tab while Ctrl is held cycles backward
 * - On Ctrl keyup, we select the highlighted workspace and close the overlay
 * - If current workspace is selected, just dismiss without navigating
 */

import { createLogger } from '$lib/utils/client-logger';
import type { Workspace, WorkspaceId } from '$shared/types';

const logger = createLogger('SpacesSwitcherKeyboard');

export interface SpacesSwitcherState {
  /** Whether the switcher overlay is currently visible */
  isOpen: boolean;
  /** Index of the currently selected workspace in the full sorted list */
  selectedIndex: number;
  /** Sorted list of ALL workspaces (by lastViewedAt, excluding current) */
  workspaces: Workspace[];
  /** The currently active workspace ID (to exclude from selection) */
  currentWorkspaceId: WorkspaceId | null;
  /** Whether selection was already handled (via click, Escape, etc.) - ignore Ctrl release */
  selectionHandled: boolean;
}

export interface SpacesSwitcherCallbacks {
  /** Get the current workspace ID */
  getCurrentWorkspaceId: () => WorkspaceId | null;
  /** Get all workspaces sorted by most recently viewed */
  getWorkspacesSortedByLastViewed: () => Workspace[];
  /** Called when a workspace is selected (on Meta keyup) */
  onSelectWorkspace: (workspace: Workspace) => void;
  /** Called when the overlay opens */
  onOpen?: () => void;
  /** Called when the overlay closes (without selection, e.g., Escape) */
  onClose?: () => void;
}

export function createSpacesSwitcherKeyboard(callbacks: SpacesSwitcherCallbacks) {
  let state = $state<SpacesSwitcherState>({
    isOpen: false,
    selectedIndex: 0,
    workspaces: [],
    currentWorkspaceId: null,
    selectionHandled: false,
  });

  /** Whether the Meta/Command key is currently held down */
  let metaKeyDown = false;

  /**
   * Open the switcher overlay
   */
  function open() {
    const currentId = callbacks.getCurrentWorkspaceId();
    const allWorkspaces = callbacks.getWorkspacesSortedByLastViewed();

    // Find current workspace and other workspaces
    const currentWorkspace = allWorkspaces.find((w) => w.id === currentId);
    const otherWorkspaces = allWorkspaces.filter((w) => w.id !== currentId);

    if (otherWorkspaces.length === 0) {
      logger.debug('No other workspaces to switch to');
      return;
    }

    // Put current workspace first, then others sorted by recency
    const workspaces = currentWorkspace
      ? [currentWorkspace, ...otherWorkspaces]
      : otherWorkspaces;

    state.isOpen = true;
    state.selectedIndex = 1; // Start with the second item (first non-current workspace)
    state.workspaces = workspaces;
    state.currentWorkspaceId = currentId;
    state.selectionHandled = false;

    logger.debug('Spaces switcher opened', {
      workspaceCount: workspaces.length,
      selectedIndex: 1,
    });

    callbacks.onOpen?.();
  }

  /**
   * Reset state to closed
   */
  function resetState() {
    state.isOpen = false;
    state.selectedIndex = 0;
    state.workspaces = [];
  }

  /**
   * Close the switcher without making a selection (e.g., Escape)
   */
  function close() {
    resetState();
    state.selectionHandled = true; // Prevent selection on Ctrl release
    metaKeyDown = false;

    logger.debug('Spaces switcher closed');
    callbacks.onClose?.();
  }

  /**
   * Select a specific workspace (e.g., via click) and close
   */
  function selectWorkspace(workspace: Workspace) {
    if (!state.isOpen) return;

    if (workspace.id !== state.currentWorkspaceId) {
      logger.debug('Selecting workspace via click', {
        workspaceId: workspace.id,
        workspaceTitle: workspace.title,
      });
      callbacks.onSelectWorkspace(workspace);
    } else {
      logger.debug('Clicked current workspace, dismissing overlay');
    }

    resetState();
    state.selectionHandled = true; // Prevent selection on Ctrl release
  }

  /**
   * Cycle to the next workspace in the list
   */
  function cycleNext() {
    if (!state.isOpen || state.workspaces.length === 0) return;

    state.selectedIndex = (state.selectedIndex + 1) % state.workspaces.length;
    logger.debug('Cycled to next workspace', {
      selectedIndex: state.selectedIndex,
    });
  }

  /**
   * Cycle to the previous workspace in the list (Shift+L)
   */
  function cyclePrevious() {
    if (!state.isOpen || state.workspaces.length === 0) return;

    state.selectedIndex =
      (state.selectedIndex - 1 + state.workspaces.length) % state.workspaces.length;
    logger.debug('Cycled to previous workspace', {
      selectedIndex: state.selectedIndex,
    });
  }

  /**
   * Confirm the current selection (via Ctrl release) and close
   */
  function confirmSelection() {
    if (!state.isOpen || state.workspaces.length === 0) return;

    const selectedWorkspace = state.workspaces[state.selectedIndex];
    if (selectedWorkspace) {
      selectWorkspace(selectedWorkspace);
    } else {
      resetState();
    }
  }

  /**
   * Handle keydown events. Returns true if the event was handled.
   */
  function handleKeyDown(e: KeyboardEvent): boolean {
    // Track Meta key state
    if (e.key === 'Meta' || e.key === 'Control') {
      metaKeyDown = true;
      return false; // Don't prevent default for just meta key
    }

    const isMod = e.metaKey || e.ctrlKey;

    // Ctrl+Tab - Open switcher or cycle forward
    // Ctrl+Shift+Tab - Cycle backward
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();

      if (!state.isOpen) {
        open();
      } else {
        // Shift+Tab goes backward
        if (e.shiftKey) {
          logger.debug('Ctrl+Shift+Tab detected, cycling previous');
          cyclePrevious();
        } else {
          cycleNext();
        }
      }
      return true;
    }

    // Escape - Close without selection
    if (state.isOpen && e.key === 'Escape') {
      e.preventDefault();
      close();
      return true;
    }

    return false;
  }

  /**
   * Handle keyup events. Returns true if the event was handled.
   */
  function handleKeyUp(e: KeyboardEvent): boolean {
    // Track Meta key release
    if (e.key === 'Meta' || e.key === 'Control') {
      metaKeyDown = false;

      // If selection was already handled (click, Escape, etc.), just reset the flag
      if (state.selectionHandled) {
        state.selectionHandled = false;
        return false;
      }

      // If switcher is open and Meta is released, confirm selection
      if (state.isOpen) {
        e.preventDefault();
        confirmSelection();
        return true;
      }
    }

    return false;
  }

  /**
   * Handle workspace selection from overlay click (via custom event)
   */
  function handleSelectEvent(e: CustomEvent<{ workspace: Workspace }>) {
    selectWorkspace(e.detail.workspace);
  }

  /**
   * Cleanup - reset state
   */
  function cleanup() {
    resetState();
    state.selectionHandled = false;
    metaKeyDown = false;
  }

  return {
    // State getters
    get isOpen() {
      return state.isOpen;
    },
    get selectedIndex() {
      return state.selectedIndex;
    },
    get workspaces() {
      return state.workspaces;
    },
    get selectedWorkspace() {
      return state.workspaces[state.selectedIndex] ?? null;
    },
    /** Total number of workspaces */
    get totalCount() {
      return state.workspaces.length;
    },

    // Actions
    open,
    close,
    selectWorkspace,
    cycleNext,
    cyclePrevious,
    confirmSelection,
    handleKeyDown,
    handleKeyUp,
    handleSelectEvent,
    cleanup,
  };
}

export type SpacesSwitcherKeyboard = ReturnType<typeof createSpacesSwitcherKeyboard>;
