import { call, put, takeEvery } from "typed-redux-saga";
import {
  openTerminalOverlay,
  closeTerminalOverlay,
  toggleTerminalOverlay,
  selectTerminal,
  addTerminal,
  removeTerminal,
  setTerminalOverlayHeight,
  renameTerminal,
  loadWorkspaceTerminals,
  hydrateHeight,
  type WorkspaceTerminalState,
  STORAGE_KEY,
  CUSTOM_NAMES_STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY,
} from "../terminal-overlay-slice";
import {
  selectIsTerminalOverlayOpen,
  selectActiveTerminalId,
  selectTerminalOverlayWorkspaceId,
  selectTerminalOverlayHeight,
} from "../terminal-overlay-selectors";

// ============================================================================
// localStorage helpers
// ============================================================================

function loadHeight(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const height = parseInt(stored, 10);
      if (!isNaN(height)) return height;
    }
  } catch { /* ignore */ }
  return 50;
}

function saveHeight(height: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(height));
  } catch { /* ignore */ }
}

function loadCustomNames(): Record<string, string> {
  try {
    const stored = localStorage.getItem(CUSTOM_NAMES_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

function saveCustomName(termId: string, customName: string | undefined): void {
  try {
    const names = loadCustomNames();
    if (customName) {
      names[termId] = customName;
    } else {
      delete names[termId];
    }
    localStorage.setItem(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify(names));
  } catch { /* ignore */ }
}

function removeCustomName(termId: string): void {
  try {
    const names = loadCustomNames();
    delete names[termId];
    localStorage.setItem(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify(names));
  } catch { /* ignore */ }
}

export function getStoredCustomName(termId: string): string | undefined {
  const names = loadCustomNames();
  return names[termId];
}

function saveWorkspaceState(wsId: string, state: WorkspaceTerminalState): void {
  try {
    const stored = localStorage.getItem(WORKSPACE_STATE_STORAGE_KEY);
    const states = stored ? (JSON.parse(stored) as Record<string, WorkspaceTerminalState>) : {};
    states[wsId] = state;
    localStorage.setItem(WORKSPACE_STATE_STORAGE_KEY, JSON.stringify(states));
  } catch { /* ignore */ }
}

// ============================================================================
// Init saga — hydrate height from localStorage
// ============================================================================

export function* initPersistenceSaga() {
  if (typeof window === 'undefined') return;
  const height = yield* call(loadHeight);
  yield* put(hydrateHeight(height));
}

// ============================================================================
// Persistence sagas
// ============================================================================

/** Persist height on change */
export function* watchHeightChanges() {
  yield* takeEvery(setTerminalOverlayHeight.type, function* () {
    const height = yield* selectTerminalOverlayHeight.effect();
    yield* call(saveHeight, height);
  });
}

/** Persist custom names on rename */
export function* watchRenameTerminal() {
  yield* takeEvery(renameTerminal.type, function* (action: ReturnType<typeof renameTerminal>) {
    const [termId, newName] = action.payload;
    const trimmedName = newName.trim() || undefined;
    yield* call(saveCustomName, termId, trimmedName);
  });
}

/** Remove custom name on terminal removal */
export function* watchRemoveTerminalCustomName() {
  yield* takeEvery(removeTerminal.type, function* (action: ReturnType<typeof removeTerminal>) {
    const [termId] = action.payload;
    yield* call(removeCustomName, termId);
  });
}

/** Persist workspace state (isOpen, activeTerminalId) */
const WORKSPACE_STATE_ACTIONS = [
  openTerminalOverlay.type,
  closeTerminalOverlay.type,
  toggleTerminalOverlay.type,
  selectTerminal.type,
  addTerminal.type,
  removeTerminal.type,
  loadWorkspaceTerminals.type,
];

export function* watchWorkspaceState() {
  yield* takeEvery(WORKSPACE_STATE_ACTIONS, function* () {
    const wsId = yield* selectTerminalOverlayWorkspaceId.effect();
    if (!wsId) return;
    const isOpen = yield* selectIsTerminalOverlayOpen.effect();
    const activeTerminalId = yield* selectActiveTerminalId.effect();
    yield* call(saveWorkspaceState, wsId, { isOpen, activeTerminalId });
  });
}

