import { call, put, takeEvery, select } from "typed-redux-saga";
import { terminalManager } from "$features/terminal/terminal-manager.svelte";
import {
  openTerminalOverlay,
  setTerminalOverlayWorkspace,
  loadWorkspaceTerminals,
  getTerminalName,
  type TerminalTab,
  type WorkspaceTerminalState,
  WORKSPACE_STATE_STORAGE_KEY,
} from "../terminal-overlay-slice";
import { getStoredCustomName } from "./persistence-saga";

// ============================================================================
// Helpers
// ============================================================================

function loadWorkspaceState(wsId: string): WorkspaceTerminalState | null {
  try {
    const stored = localStorage.getItem(WORKSPACE_STATE_STORAGE_KEY);
    if (stored) {
      const states = JSON.parse(stored) as Record<string, WorkspaceTerminalState>;
      return states[wsId] || null;
    }
  } catch { /* ignore */ }
  return null;
}

function loadTerminalMetadataForWorkspace(wsId: string): TerminalTab[] {
  const storedTerminals = terminalManager.loadTerminalMetadata(wsId);
  if (storedTerminals.length === 0) return [];
  return storedTerminals.map((t) => ({
    id: t.terminalId,
    name: t.title || getTerminalName(t.terminalId),
    customName: getStoredCustomName(t.terminalId),
  }));
}

// ============================================================================
// Sagas
// ============================================================================

/**
 * When setWorkspace is dispatched, save current workspace state and load
 * terminals + state for the new workspace.
 */
export function* watchSetWorkspace() {
  yield* takeEvery(setTerminalOverlayWorkspace.type, function* (action: ReturnType<typeof setTerminalOverlayWorkspace>) {
    const [wsId] = action.payload;
    if (typeof window === 'undefined') return;

    // Save current workspace state before switching
    const prevState = yield* select((state) => ({
      workspaceId: state.terminalOverlay.workspaceId,
      isOpen: state.terminalOverlay.isOpen,
      activeTerminalId: state.terminalOverlay.activeTerminalId,
    }));

    if (prevState.workspaceId && prevState.workspaceId !== wsId) {
      // Save previous workspace state
      try {
        const stored = localStorage.getItem(WORKSPACE_STATE_STORAGE_KEY);
        const states = stored ? JSON.parse(stored) as Record<string, WorkspaceTerminalState> : {};
        states[prevState.workspaceId] = {
          isOpen: prevState.isOpen,
          activeTerminalId: prevState.activeTerminalId,
        };
        localStorage.setItem(WORKSPACE_STATE_STORAGE_KEY, JSON.stringify(states));
      } catch { /* ignore */ }
    }

    // Load terminals for new workspace
    const terminals: TerminalTab[] = yield* call(loadTerminalMetadataForWorkspace, wsId);
    const savedState: WorkspaceTerminalState | null = yield* call(loadWorkspaceState, wsId);

    yield* put(loadWorkspaceTerminals(wsId, terminals, savedState));
  });
}

/**
 * When open is dispatched with a workspace ID, load terminals if needed.
 * The reducer handles the pure state part; this saga loads from storage.
 */
export function* watchOpenWithWorkspace() {
  yield* takeEvery(openTerminalOverlay.type, function* (action: ReturnType<typeof openTerminalOverlay>) {
    const [wsId] = action.payload;
    if (!wsId || typeof window === 'undefined') return;

    // Check if we need to load terminals (workspace changed or empty)
    const currentState = yield* select((state) => ({
      workspaceId: state.terminalOverlay.workspaceId,
      terminals: state.terminalOverlay.terminals,
    }));

    // Only load if workspace just changed or terminals are empty
    if (currentState.workspaceId === wsId && currentState.terminals.length > 0) return;

    const terminals: TerminalTab[] = yield* call(loadTerminalMetadataForWorkspace, wsId);
    if (terminals.length > 0) {
      const savedState: WorkspaceTerminalState | null = yield* call(loadWorkspaceState, wsId);
      yield* put(loadWorkspaceTerminals(wsId, terminals, savedState));
    }
  });
}

