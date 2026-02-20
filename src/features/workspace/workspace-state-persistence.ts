/**
 * Workspace State Persistence Manager
 * Handles saving and loading workspace UI state to/from localStorage
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('workspace-state-persistence');

export interface MainPanelState {
  selectedNoteId: string | null;
  selectedFile: string;
  selectedChangeId: string | null;
  mainContentType: string;
  selectedTrackedChange?: any;
}

export interface DrawerState {
  isOpen: boolean;
  activeItemId: string | null;
  drawerType: 'agent' | 'terminal' | null;
}

export class WorkspaceStatePersistence {
  private workspaceId: string;
  private mainPanelSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  private drawerSaveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  // Main panel state management
  saveMainPanelState(state: MainPanelState, immediate = false) {
    if (!this.workspaceId) return;

    const doSave = () => {
      try {
        const key = `workspace-${this.workspaceId}-main-panel`;
        const stateToSave = {
          ...state,
          timestamp: Date.now(),
        };

        // Don't save tracked change details, just the ID
        if (state.selectedTrackedChange) {
          stateToSave.selectedTrackedChange = {
            id: state.selectedTrackedChange.id,
          };
        }

        localStorage.setItem(key, JSON.stringify(stateToSave));
        logger.debug('[saveMainPanelState] Saved main panel state', stateToSave);
      } catch (error) {
        logger.error('[saveMainPanelState] Failed to save main panel state:', error);
      }
    };

    if (immediate) {
      if (this.mainPanelSaveTimeout) {
        clearTimeout(this.mainPanelSaveTimeout);
        this.mainPanelSaveTimeout = null;
      }
      doSave();
    } else {
      if (this.mainPanelSaveTimeout) {
        clearTimeout(this.mainPanelSaveTimeout);
      }
      // Debounce the save by 500ms to avoid saving during rapid state changes
      this.mainPanelSaveTimeout = setTimeout(doSave, 500);
    }
  }

  loadMainPanelState(): MainPanelState | null {
    if (!this.workspaceId) return null;

    try {
      const key = `workspace-${this.workspaceId}-main-panel`;
      const stored = localStorage.getItem(key);

      if (stored) {
        const state = JSON.parse(stored);
        logger.debug('[loadMainPanelState] Loaded main panel state', state);
        return state;
      }
    } catch (error) {
      logger.error('[loadMainPanelState] Failed to load main panel state:', error);
    }

    return null;
  }

  // Drawer state management
  saveDrawerState(state: DrawerState) {
    if (!this.workspaceId) {
      logger.warn('[saveDrawerState] No workspace ID available');
      return;
    }

    if (this.drawerSaveTimeout) {
      clearTimeout(this.drawerSaveTimeout);
    }

    // Debounce the save by 300ms (shorter than main panel since drawer changes are less frequent)
    this.drawerSaveTimeout = setTimeout(() => {
      try {
        const key = `workspace-${this.workspaceId}-drawer`;
        const dataToSave = {
          ...state,
          timestamp: Date.now(),
        };
        localStorage.setItem(key, JSON.stringify(dataToSave));
        logger.info('[saveDrawerState] Saved drawer state', {
          workspaceId: this.workspaceId,
          state: dataToSave,
          key,
        });
      } catch (error) {
        logger.error('[saveDrawerState] Failed to save drawer state:', error);
      }
    }, 300);
  }

  loadDrawerState(): DrawerState | null {
    if (!this.workspaceId) {
      logger.warn('[loadDrawerState] No workspace ID available');
      return null;
    }

    try {
      const key = `workspace-${this.workspaceId}-drawer`;
      const stored = localStorage.getItem(key);

      if (stored) {
        const state = JSON.parse(stored);
        logger.info('[loadDrawerState] Loaded drawer state', {
          workspaceId: this.workspaceId,
          state,
        });
        return state;
      } else {
        logger.info('[loadDrawerState] No saved drawer state found', {
          workspaceId: this.workspaceId,
          key,
        });
      }
    } catch (error) {
      logger.error('[loadDrawerState] Failed to load drawer state:', error);
    }

    return null;
  }

  // Force immediate save of drawer state
  saveDrawerStateImmediate(state: DrawerState) {
    if (!this.workspaceId) return;

    // Clear any pending timeout
    if (this.drawerSaveTimeout) {
      clearTimeout(this.drawerSaveTimeout);
      this.drawerSaveTimeout = null;
    }

    try {
      const key = `workspace-${this.workspaceId}-drawer`;
      localStorage.setItem(
        key,
        JSON.stringify({
          ...state,
          timestamp: Date.now(),
        }),
      );
      logger.debug('[saveDrawerStateImmediate] Saved drawer state immediately', state);
    } catch (error) {
      logger.error('[saveDrawerStateImmediate] Failed to save drawer state:', error);
    }
  }

  // Cleanup
  cleanup() {
    if (this.mainPanelSaveTimeout) {
      clearTimeout(this.mainPanelSaveTimeout);
      this.mainPanelSaveTimeout = null;
    }
    if (this.drawerSaveTimeout) {
      clearTimeout(this.drawerSaveTimeout);
      this.drawerSaveTimeout = null;
    }
  }
}
