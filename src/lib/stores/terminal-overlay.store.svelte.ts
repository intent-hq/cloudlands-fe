/**
 * Terminal Overlay Store
 *
 * Manages the state of the Quake-style terminal overlay that slides up from the bottom.
 * Supports multiple terminals with tabs.
 */
import { terminalManager } from '$features/terminal/terminal-manager.svelte';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('TerminalOverlayStore');

const STORAGE_KEY = 'terminal-overlay-height';
const CUSTOM_NAMES_STORAGE_KEY = 'terminal-custom-names';
const WORKSPACE_STATE_STORAGE_KEY = 'terminal-overlay-workspace-state';
const DEFAULT_HEIGHT = 50; // percentage of viewport height
const MIN_HEIGHT = 20;
const MAX_HEIGHT = 90;

// Per-workspace state (isOpen, activeTerminalId)
interface WorkspaceTerminalState {
  isOpen: boolean;
  activeTerminalId: string | null;
}

function loadWorkspaceState(wsId: string): WorkspaceTerminalState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(WORKSPACE_STATE_STORAGE_KEY);
    if (stored) {
      const states = JSON.parse(stored) as Record<string, WorkspaceTerminalState>;
      return states[wsId] || null;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function saveWorkspaceState(wsId: string, state: WorkspaceTerminalState) {
  if (typeof window === 'undefined') return;
  try {
    const stored = localStorage.getItem(WORKSPACE_STATE_STORAGE_KEY);
    const states = stored ? (JSON.parse(stored) as Record<string, WorkspaceTerminalState>) : {};
    states[wsId] = state;
    localStorage.setItem(WORKSPACE_STATE_STORAGE_KEY, JSON.stringify(states));
  } catch {
    // Ignore storage errors
  }
}

export interface TerminalTab {
  id: string;
  name: string;
  customName?: string; // User-defined name, takes priority over auto-generated name
}

function loadHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_HEIGHT;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const height = parseInt(stored, 10);
      if (height >= MIN_HEIGHT && height <= MAX_HEIGHT) {
        return height;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_HEIGHT;
}

function saveHeight(height: number) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, String(height));
  } catch {
    // Ignore storage errors
  }
}

// Custom name persistence
function loadCustomNames(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(CUSTOM_NAMES_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function saveCustomName(termId: string, customName: string | undefined) {
  if (typeof window === 'undefined') return;
  try {
    const names = loadCustomNames();
    if (customName) {
      names[termId] = customName;
    } else {
      delete names[termId];
    }
    localStorage.setItem(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify(names));
  } catch {
    // Ignore storage errors
  }
}

function removeCustomName(termId: string) {
  if (typeof window === 'undefined') return;
  try {
    const names = loadCustomNames();
    delete names[termId];
    localStorage.setItem(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify(names));
  } catch {
    // Ignore storage errors
  }
}

function getStoredCustomName(termId: string): string | undefined {
  const names = loadCustomNames();
  return names[termId];
}

function createTerminalOverlayStore() {
  let isOpen = $state(false);
  let height = $state(loadHeight());
  let workspaceId = $state<string | null>(null);
  let activeTerminalId = $state<string | null>(null);
  let terminals = $state<TerminalTab[]>([]);

  function ensureDefaultTerminal(wsId: string): string {
    const defaultId = `terminal-${wsId}-default`;
    if (!terminals.some((t) => t.id === defaultId)) {
      // Load any persisted custom name for this terminal
      const customName = getStoredCustomName(defaultId);
      terminals = [...terminals, { id: defaultId, name: 'Terminal', customName }];
    }
    return defaultId;
  }

  const store = {
    get isOpen() {
      return isOpen;
    },
    get height() {
      return height;
    },
    get workspaceId() {
      return workspaceId;
    },
    get activeTerminalId() {
      return activeTerminalId;
    },
    get terminals() {
      return terminals;
    },

    open(wsId?: string, termId?: string) {
      logger.info('[open] called', {
        wsId,
        termId,
        currentIsOpen: isOpen,
        currentActiveTerminalId: activeTerminalId,
        currentTerminals: terminals.map((t) => t.id),
      });
      if (wsId) {
        // If workspace changed or terminals are empty, sync from storage
        if (workspaceId !== wsId || terminals.length === 0) {
          const storedTerminals = terminalManager.loadTerminalMetadata(wsId);
          logger.info('[open] loaded stored terminals', {
            count: storedTerminals.length,
            ids: storedTerminals.map((t) => t.terminalId),
          });
          if (storedTerminals.length > 0) {
            terminals = storedTerminals.map((t) => ({
              id: t.terminalId,
              name: t.title || getTerminalName(t.terminalId),
              customName: getStoredCustomName(t.terminalId),
            }));
          }
        }

        workspaceId = wsId;
        if (termId) {
          // Open specific terminal
          if (!terminals.some((t) => t.id === termId)) {
            const customName = getStoredCustomName(termId);
            terminals = [...terminals, { id: termId, name: getTerminalName(termId), customName }];
          }
          activeTerminalId = termId;
        } else if (!activeTerminalId || !terminals.some((t) => t.id === activeTerminalId)) {
          // No active terminal, create/use default
          activeTerminalId = ensureDefaultTerminal(wsId);
        }
      }
      logger.info('[open] result', {
        isOpen: true,
        activeTerminalId,
        terminals: terminals.map((t) => t.id),
      });
      isOpen = true;

      // Persist the open state for this workspace
      if (workspaceId) {
        saveWorkspaceState(workspaceId, { isOpen: true, activeTerminalId });
      }
    },

    close() {
      isOpen = false;

      // Persist the closed state for this workspace
      if (workspaceId) {
        saveWorkspaceState(workspaceId, { isOpen: false, activeTerminalId });
      }
    },

    toggle(wsId?: string, termId?: string) {
      if (isOpen && !termId) {
        this.close();
      } else {
        this.open(wsId, termId);
      }
    },

    selectTerminal(termId: string) {
      if (terminals.some((t) => t.id === termId)) {
        activeTerminalId = termId;
        // Persist the active terminal change
        if (workspaceId) {
          saveWorkspaceState(workspaceId, { isOpen, activeTerminalId });
        }
      }
    },

    addTerminal(termId: string, name?: string) {
      if (!terminals.some((t) => t.id === termId)) {
        // Load any persisted custom name for this terminal
        const customName = getStoredCustomName(termId);
        terminals = [
          ...terminals,
          { id: termId, name: name || getTerminalName(termId), customName },
        ];
      }
      activeTerminalId = termId;
      // Persist the active terminal change
      if (workspaceId) {
        saveWorkspaceState(workspaceId, { isOpen, activeTerminalId });
      }
    },

    removeTerminal(termId: string) {
      const index = terminals.findIndex((t) => t.id === termId);
      if (index === -1) return;

      terminals = terminals.filter((t) => t.id !== termId);
      // Remove persisted custom name
      removeCustomName(termId);

      // Select adjacent terminal if we removed the active one
      if (activeTerminalId === termId) {
        if (terminals.length > 0) {
          const newIndex = Math.min(index, terminals.length - 1);
          activeTerminalId = terminals[newIndex].id;
        } else {
          activeTerminalId = null;
        }
      }

      // Persist the state change
      if (workspaceId) {
        saveWorkspaceState(workspaceId, { isOpen, activeTerminalId });
      }
    },

    setHeight(newHeight: number) {
      const clampedHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));
      height = clampedHeight;
      saveHeight(clampedHeight);
    },

    setWorkspace(wsId: string) {
      if (workspaceId === wsId) return;

      logger.info('[setWorkspace] switching workspace', {
        from: workspaceId,
        to: wsId,
        currentTerminals: terminals.map((t) => t.id),
        currentIsOpen: isOpen,
      });

      // Save current workspace state before switching
      if (workspaceId) {
        saveWorkspaceState(workspaceId, {
          isOpen,
          activeTerminalId,
        });
      }

      // Load terminals for the new workspace
      const storedTerminals = terminalManager.loadTerminalMetadata(wsId);
      // Load persisted state for the new workspace
      const savedState = loadWorkspaceState(wsId);

      logger.info('[setWorkspace] loaded stored terminals for new workspace', {
        count: storedTerminals.length,
        ids: storedTerminals.map((t) => t.terminalId),
        savedState,
      });

      if (storedTerminals.length > 0) {
        terminals = storedTerminals.map((t) => ({
          id: t.terminalId,
          name: t.title || getTerminalName(t.terminalId),
          customName: getStoredCustomName(t.terminalId),
        }));

        // Restore the persisted state for this workspace
        if (savedState) {
          isOpen = savedState.isOpen;
          // Restore active terminal if it still exists, otherwise use first
          if (savedState.activeTerminalId && terminals.some((t) => t.id === savedState.activeTerminalId)) {
            activeTerminalId = savedState.activeTerminalId;
          } else {
            activeTerminalId = storedTerminals[0].terminalId;
          }
        } else {
          // No saved state - keep terminal closed, but set active terminal for when user opens it
          isOpen = false;
          activeTerminalId = storedTerminals[0].terminalId;
        }
      } else {
        // Clear terminals for new workspace with no stored terminals
        terminals = [];
        activeTerminalId = null;
        // Restore isOpen state from saved state if available, otherwise close
        isOpen = savedState?.isOpen ?? false;
      }

      workspaceId = wsId;
    },

    /** Rename a terminal tab */
    renameTerminal(termId: string, newName: string) {
      const trimmedName = newName.trim() || undefined;
      const index = terminals.findIndex((t) => t.id === termId);
      if (index !== -1) {
        terminals = terminals.map((t) => (t.id === termId ? { ...t, customName: trimmedName } : t));
        // Persist the custom name
        saveCustomName(termId, trimmedName);
      }
    },

    /** Update the display name for a terminal (e.g., from last command) */
    updateTerminalName(termId: string, name: string) {
      const index = terminals.findIndex((t) => t.id === termId);
      if (index !== -1) {
        terminals = terminals.map((t) => (t.id === termId ? { ...t, name } : t));
      }
    },

    /** Get display name for a terminal (customName takes priority) */
    getDisplayName(termId: string): string {
      const term = terminals.find((t) => t.id === termId);
      if (!term) return 'Terminal';
      return term.customName || term.name || 'Terminal';
    },

    /** Sync terminals from workspace terminal list */
    syncTerminals(terminalList: Array<{ id: string; name?: string; title?: string }>) {
      terminals = terminalList.map((t) => ({
        id: t.id,
        name: t.name || t.title || getTerminalName(t.id),
        customName: getStoredCustomName(t.id), // Load persisted custom name
      }));
      // Ensure active terminal is still valid
      if (activeTerminalId && !terminals.some((t) => t.id === activeTerminalId)) {
        activeTerminalId = terminals.length > 0 ? terminals[0].id : null;
      }
    },
  };

  // Listen for terminal disposal events from main process (workspace delete/archive)
  if (typeof window !== 'undefined' && window.electronAPI) {
    window.electronAPI.on(
      'terminal:disposed',
      (data: { terminalId: string; workspaceId: string }) => {
        if (data && data.terminalId) {
          // Only process events for the current workspace to prevent removing wrong terminals
          if (data.workspaceId !== workspaceId) {
            logger.debug('[TerminalOverlayStore] Ignoring terminal:disposed for different workspace', {
              eventWorkspaceId: data.workspaceId,
              currentWorkspaceId: workspaceId,
            });
            return;
          }
          logger.info('[TerminalOverlayStore] Received terminal:disposed event', {
            terminalId: data.terminalId,
            workspaceId: data.workspaceId,
          });
          store.removeTerminal(data.terminalId);
        }
      },
    );
  }

  return store;
}

function getTerminalName(termId: string): string {
  if (termId.includes('-default')) return 'Terminal';
  // Extract a reasonable name from the ID
  const match = termId.match(/terminal-(\d+)/);
  if (match) return `Terminal ${match[1]}`;
  return 'Terminal';
}

export const terminalOverlayStore = createTerminalOverlayStore();
