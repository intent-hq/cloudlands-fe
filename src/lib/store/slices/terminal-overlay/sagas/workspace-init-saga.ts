import { call, put, takeEvery } from "typed-redux-saga";
import { terminalManager } from "$features/terminal/terminal-manager.svelte";
import {
  openTerminalOverlay,
  setTerminalOverlayWorkspace,
  loadWorkspaceTerminals,
  getTerminalName,
  type TerminalTab,
  type PersistedWorkspaceState,
  WORKSPACE_STATE_STORAGE_KEY,
} from "../terminal-overlay-slice";
import { selectWorkspaceTerminalState } from "../terminal-overlay-selectors";
import { getStoredCustomName } from "./persistence-saga";

// ============================================================================
// Helpers
// ============================================================================

function loadWorkspaceState(wsId: string): PersistedWorkspaceState | null {
  try {
    const stored = localStorage.getItem(WORKSPACE_STATE_STORAGE_KEY);
    if (stored) {
      const states = JSON.parse(stored) as Record<string, PersistedWorkspaceState>;
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
    customName: getStoredCustomName(wsId, t.terminalId),
  }));
}

// ============================================================================
// Sagas
// ============================================================================

/**
 * When setWorkspace is dispatched, load terminals for the new workspace
 * if they haven't been loaded yet.
 *
 * No need to "save previous workspace state" anymore — all workspaces
 * are in the Record and persist independently. setTerminalOverlayWorkspace
 * just changes activeWorkspaceId.
 */
export function* watchSetWorkspace() {
  yield* takeEvery(setTerminalOverlayWorkspace.type, function* (action: ReturnType<typeof setTerminalOverlayWorkspace>) {
    const [wsId] = action.payload;
    if (typeof window === 'undefined') return;

    // Check if this workspace already has terminals loaded in the Record
    const wsState = yield* selectWorkspaceTerminalState.effect(wsId);
    if (wsState && wsState.terminals.length > 0) return;

    // Load terminals for new workspace
    const terminals: TerminalTab[] = yield* call(loadTerminalMetadataForWorkspace, wsId);
    const savedState: PersistedWorkspaceState | null = yield* call(loadWorkspaceState, wsId);

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

    // Check if this workspace already has terminals in the Record
    const wsState = yield* selectWorkspaceTerminalState.effect(wsId);
    if (wsState.terminals.length > 0) return;

    const terminals: TerminalTab[] = yield* call(loadTerminalMetadataForWorkspace, wsId);
    if (terminals.length > 0) {
      const savedState: PersistedWorkspaceState | null = yield* call(loadWorkspaceState, wsId);
      yield* put(loadWorkspaceTerminals(wsId, terminals, savedState));
    }
  });
}

