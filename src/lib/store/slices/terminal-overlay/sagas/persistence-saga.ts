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
  STORAGE_KEY,
  CUSTOM_NAMES_STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY,
  type PersistedWorkspaceState,
} from "../terminal-overlay-slice";
import {
  selectTerminalOverlayHeight,
  selectWorkspaceTerminalState,
} from "../terminal-overlay-selectors";

const LEGACY_CUSTOM_NAMES_BUCKET = "__legacy__";

type WorkspaceCustomNames = Record<string, string>;
type StoredCustomNames = Record<string, WorkspaceCustomNames>;

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

function isStoredCustomNames(value: unknown): value is StoredCustomNames {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((entry) => isStringRecord(entry));
}

function pruneEmptyCustomNameBuckets(all: StoredCustomNames): StoredCustomNames {
  return Object.fromEntries(
    Object.entries(all).filter(([, names]) => Object.keys(names).length > 0)
  );
}

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

function loadAllCustomNames(): StoredCustomNames {
  try {
    const stored = localStorage.getItem(CUSTOM_NAMES_STORAGE_KEY);
    if (!stored) return {};

    const parsed: unknown = JSON.parse(stored);
    if (isStoredCustomNames(parsed)) return parsed;

    if (isStringRecord(parsed)) {
      const migrated = { [LEGACY_CUSTOM_NAMES_BUCKET]: parsed };
      localStorage.setItem(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch { /* ignore */ }
  return {};
}

function loadCustomNamesForWorkspace(wsId: string): Record<string, string> {
  const all = loadAllCustomNames();
  return {
    ...(all[LEGACY_CUSTOM_NAMES_BUCKET] || {}),
    ...(all[wsId] || {}),
  };
}

function saveCustomName(wsId: string, termId: string, customName: string | undefined): void {
  try {
    const all = loadAllCustomNames();
    if (all[LEGACY_CUSTOM_NAMES_BUCKET]) {
      delete all[LEGACY_CUSTOM_NAMES_BUCKET][termId];
    }
    if (!all[wsId]) all[wsId] = {};
    if (customName) {
      all[wsId][termId] = customName;
    } else {
      delete all[wsId][termId];
    }
    localStorage.setItem(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify(pruneEmptyCustomNameBuckets(all)));
  } catch { /* ignore */ }
}

function removeCustomName(wsId: string, termId: string): void {
  try {
    const all = loadAllCustomNames();
    if (all[LEGACY_CUSTOM_NAMES_BUCKET]) {
      delete all[LEGACY_CUSTOM_NAMES_BUCKET][termId];
    }
    if (all[wsId]) {
      delete all[wsId][termId];
    }
    localStorage.setItem(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify(pruneEmptyCustomNameBuckets(all)));
  } catch { /* ignore */ }
}

export function getStoredCustomName(wsId: string, termId: string): string | undefined {
  return loadCustomNamesForWorkspace(wsId)[termId];
}

function saveWorkspaceState(wsId: string, state: PersistedWorkspaceState): void {
  try {
    const stored = localStorage.getItem(WORKSPACE_STATE_STORAGE_KEY);
    const states = stored ? (JSON.parse(stored) as Record<string, PersistedWorkspaceState>) : {};
    states[wsId] = { isOpen: state.isOpen, activeTerminalId: state.activeTerminalId };
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
    const [wsId, termId, newName] = action.payload;
    const trimmedName = newName.trim() || undefined;
    yield* call(saveCustomName, wsId, termId, trimmedName);
  });
}

/** Remove custom name on terminal removal */
export function* watchRemoveTerminalCustomName() {
  yield* takeEvery(removeTerminal.type, function* (action: ReturnType<typeof removeTerminal>) {
    const [wsId, termId] = action.payload;
    yield* call(removeCustomName, wsId, termId);
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
  yield* takeEvery(WORKSPACE_STATE_ACTIONS, function* (action: { type: string; payload: [string, ...unknown[]] }) {
    const wsId = action.payload[0];
    if (!wsId) return;
    const ws = yield* selectWorkspaceTerminalState.effect(wsId);
    yield* call(saveWorkspaceState, wsId, { isOpen: ws.isOpen, activeTerminalId: ws.activeTerminalId });
  });
}

