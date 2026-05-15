import { getLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import {
  call,
  put,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import {
  openTerminalOverlay,
  loadWorkspaceTerminals,
  getTerminalName,
  setTerminalsLoaded,
  setIsLoadingTerminals,
  type TerminalTab,
  type PersistedWorkspaceState,
  WORKSPACE_STATE_STORAGE_KEY,
} from "../terminals-slice";
import { setActiveWorkspaceId } from "../../workspace/workspace-slice";
import { selectWorkspaceTerminalState } from "../terminals-selectors";
import {
  getStoredCustomName,
  loadTerminalMetadataFromStorage,
  removeTerminalMetadataFromStorage,
  saveTerminalMetadataToStorage,
} from "./persistence-saga";
// ============================================================================
// Helpers
// ============================================================================
function* loadWorkspaceState(wsId: string): SagaGenerator<PersistedWorkspaceState | null> {
    const states = yield* call(getLocalStorageJSON<Record<string, PersistedWorkspaceState>>, WORKSPACE_STATE_STORAGE_KEY);
    return states?.[wsId] || null;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function* loadTerminalMetadataForWorkspace(wsId: string): SagaGenerator<TerminalTab[]> {
    const storedTerminals = yield* call(loadTerminalMetadataFromStorage, wsId);
    if (storedTerminals.length === 0)
        return [];
    const terminals: TerminalTab[] = [];
    for (const terminal of storedTerminals) {
        terminals.push({
            id: terminal.terminalId,
            name: terminal.title || getTerminalName(terminal.terminalId),
            customName: yield* call(getStoredCustomName, wsId, terminal.terminalId),
        });
    }
    return terminals;
}
interface BackendTerminal {
    id: string;
    workspaceId: string;
    cwd: string;
}
interface TerminalListResult {
    success?: boolean;
    terminals?: BackendTerminal[];
}
/**
 * Loads terminals from both localStorage and the backend, merging them.
 * Previously lived in workspace-terminals-saga as loadTerminalsSaga.
 */
export function* loadTerminalsSaga(wsId: string) {
    if (typeof window === "undefined")
        return;
    yield* put(setIsLoadingTerminals(wsId, true));
    try {
        // Load terminal metadata from localStorage
        const storedTerminals = yield* call(loadTerminalMetadataFromStorage, wsId);
        // Query backend for active terminals
        let backendTerminals: BackendTerminal[] = [];
        let backendCallSucceeded = false;
        try {
            const result: TerminalListResult = yield* call(invoke<TerminalListResult>, "terminal:professional:list", { workspaceId: wsId });
            if (result?.success && result.terminals) {
                backendTerminals = result.terminals;
                backendCallSucceeded = true;
            }
        }
        catch {
        }
        // Merge localStorage terminals with backend terminals
        const terminalMap = new Map<string, TerminalTab>();
        // Add localStorage terminals first
        for (const meta of storedTerminals) {
            const customName: string | undefined = yield* call(getStoredCustomName, wsId, meta.terminalId);
            terminalMap.set(meta.terminalId, {
                id: meta.terminalId,
                name: meta.title || getTerminalName(meta.terminalId),
                customName,
                type: "terminal",
                workspaceId: meta.workspaceId,
                createdAt: meta.createdAt,
                isConnected: false,
                isExecuting: false,
            });
        }
        // Add backend terminals not yet in localStorage
        for (const backendTerminal of backendTerminals) {
            if (!terminalMap.has(backendTerminal.id)) {
                terminalMap.set(backendTerminal.id, {
                    id: backendTerminal.id,
                    name: "Setup",
                    type: "terminal",
                    workspaceId: backendTerminal.workspaceId,
                    createdAt: new Date().toISOString(),
                    isConnected: false,
                    isExecuting: false,
                });
                // Save to localStorage for future loads
                yield* call(saveTerminalMetadataToStorage, backendTerminal.id, backendTerminal.workspaceId, "Setup", new Date().toISOString());
            }
        }
        // Prune stale localStorage entries not present in the backend.
        // Only prune if the backend call actually succeeded — otherwise an IPC
        // failure would wipe all local terminal metadata.
        if (backendCallSucceeded) {
            const backendIds = new Set(backendTerminals.map((t) => t.id));
            for (const meta of storedTerminals) {
                if (!backendIds.has(meta.terminalId)) {
                    terminalMap.delete(meta.terminalId);
                    yield* call(removeTerminalMetadataFromStorage, meta.terminalId, wsId);
                }
            }
        }
        const terminals = Array.from(terminalMap.values());
        // Load persisted UI state (isOpen, activeTerminalId)
        const savedState: PersistedWorkspaceState | null = yield* call(loadWorkspaceState, wsId);
        yield* put(loadWorkspaceTerminals(wsId, terminals, savedState));
    }
    catch {
        yield* put(loadWorkspaceTerminals(wsId, [], null));
    }
    finally {
        yield* put(setTerminalsLoaded(wsId, true));
        yield* put(setIsLoadingTerminals(wsId, false));
    }
}
// ============================================================================
// Sagas
// ============================================================================
/**
 * When the active workspace changes, load terminals for the new workspace
 * if they haven't been loaded yet.
 *
 * No need to "save previous workspace state" anymore — all workspaces
 * are in the Record and persist independently. setActiveWorkspaceId
 * just changes activeWorkspaceId.
 */
export function* watchSetWorkspace() {
    yield* takeEvery(setActiveWorkspaceId, function* (action: ReturnType<typeof setActiveWorkspaceId>) {
        const [wsId] = action.payload;
        if (typeof window === 'undefined')
            return;
        // Check if this workspace already has terminals loaded in the Record
        const wsState = yield* selectWorkspaceTerminalState.effect(wsId);
        if (wsState.terminalsLoaded)
            return;
        yield* call(loadTerminalsSaga, wsId);
    });
}
/**
 * When open is dispatched with a workspace ID, load terminals if needed.
 * The reducer handles the pure state part; this saga loads from storage.
 */
export function* watchOpenWithWorkspace() {
    yield* takeEvery(openTerminalOverlay, function* (action: ReturnType<typeof openTerminalOverlay>) {
        const [wsId] = action.payload;
        if (!wsId || typeof window === 'undefined')
            return;
        // Check if this workspace already has terminals loaded
        const wsState = yield* selectWorkspaceTerminalState.effect(wsId);
        if (wsState.terminalsLoaded)
            return;
        yield* call(loadTerminalsSaga, wsId);
    });
}
