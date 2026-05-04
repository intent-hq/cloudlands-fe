import {
  getLocalStorageJSON,
  getLocalStorageItem,
  setLocalStorageJSON,
  setLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
import { call, put, takeEvery, type SagaGenerator } from "typed-redux-saga";
import {
  openTerminalOverlay,
  closeTerminalOverlay,
  toggleTerminalOverlay,
  selectTerminal,
  addTerminal,
  removeTerminal,
  setTerminalOverlayHeight,
  renameTerminal,
  saveTerminalMetadata,
  loadWorkspaceTerminals,
  hydrateHeight,
  STORAGE_KEY,
  CUSTOM_NAMES_STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY,
  getTerminalName,
  type TerminalMetadata,
  type PersistedWorkspaceState,
} from "../terminals-slice";
import {
  selectTerminalOverlayHeight,
  selectWorkspaceTerminalState,
} from "../terminals-selectors";

const LEGACY_CUSTOM_NAMES_BUCKET = "__legacy__";
export const TERMINAL_METADATA_STORAGE_PREFIX = "terminal-metadata-";
const MAX_TERMINAL_METADATA_ENTRIES = 10;

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

function isTerminalMetadata(value: unknown, wsId: string): value is TerminalMetadata {
  const metadata = value as TerminalMetadata;
  return !!metadata
    && typeof metadata === "object"
    && typeof metadata.terminalId === "string"
    && typeof metadata.workspaceId === "string"
    && metadata.workspaceId === wsId
    && typeof metadata.createdAt === "string"
    && (metadata.title === undefined || typeof metadata.title === "string");
}

function getTerminalMetadataStorageKey(wsId: string): string {
  return `${TERMINAL_METADATA_STORAGE_PREFIX}${wsId}`;
}

// ============================================================================
// localStorage helpers
// ============================================================================

function* loadHeight(): SagaGenerator<number> {
  const stored = yield* call(getLocalStorageItem, STORAGE_KEY);
  if (stored) {
    const height = parseInt(stored, 10);
    if (!isNaN(height)) return height;
  }
  return 50;
}

function* saveHeight(height: number): SagaGenerator<void> {
  yield* call(setLocalStorageItem, STORAGE_KEY, String(height));
}

function* loadAllCustomNames(): SagaGenerator<StoredCustomNames> {
  const parsed: unknown = yield* call(getLocalStorageJSON<unknown>, CUSTOM_NAMES_STORAGE_KEY);
  if (parsed === undefined) return {};

  if (isStoredCustomNames(parsed)) return parsed;

  if (isStringRecord(parsed)) {
    const migrated = { [LEGACY_CUSTOM_NAMES_BUCKET]: parsed };
    yield* call(setLocalStorageJSON, CUSTOM_NAMES_STORAGE_KEY, migrated);
    return migrated;
  }

  return {};
}

function* loadCustomNamesForWorkspace(wsId: string): SagaGenerator<Record<string, string>> {
  const all = yield* call(loadAllCustomNames);
  return {
    ...(all[LEGACY_CUSTOM_NAMES_BUCKET] || {}),
    ...(all[wsId] || {}),
  };
}

function* saveCustomName(
  wsId: string,
  termId: string,
  customName: string | undefined
): SagaGenerator<void> {
  const all = yield* call(loadAllCustomNames);
  if (all[LEGACY_CUSTOM_NAMES_BUCKET]) {
    delete all[LEGACY_CUSTOM_NAMES_BUCKET][termId];
  }
  if (!all[wsId]) all[wsId] = {};
  if (customName) {
    all[wsId][termId] = customName;
  } else {
    delete all[wsId][termId];
  }
  yield* call(setLocalStorageJSON, CUSTOM_NAMES_STORAGE_KEY, pruneEmptyCustomNameBuckets(all));
}

function* removeCustomName(wsId: string, termId: string): SagaGenerator<void> {
  const all = yield* call(loadAllCustomNames);
  if (all[LEGACY_CUSTOM_NAMES_BUCKET]) {
    delete all[LEGACY_CUSTOM_NAMES_BUCKET][termId];
  }
  if (all[wsId]) {
    delete all[wsId][termId];
  }
  yield* call(setLocalStorageJSON, CUSTOM_NAMES_STORAGE_KEY, pruneEmptyCustomNameBuckets(all));
}

export function* getStoredCustomName(
  wsId: string,
  termId: string
): SagaGenerator<string | undefined> {
  const customNames = yield* call(loadCustomNamesForWorkspace, wsId);
  return customNames[termId];
}

export function* loadTerminalMetadataFromStorage(wsId: string): SagaGenerator<TerminalMetadata[]> {
  const key = getTerminalMetadataStorageKey(wsId);
  const stored = yield* call(getLocalStorageJSON<unknown>, key);
  if (!Array.isArray(stored)) return [];

  const metadata = stored.filter((entry) => isTerminalMetadata(entry, wsId));
  if (metadata.length !== stored.length) {
    yield* call(setLocalStorageJSON, key, metadata);
  }
  return metadata;
}

export function* saveTerminalMetadataToStorage(
  terminalId: string,
  workspaceId: string,
  title?: string,
  createdAt?: string
): SagaGenerator<void> {
  const existing = yield* call(loadTerminalMetadataFromStorage, workspaceId);
  const index = existing.findIndex((metadata) => metadata.terminalId === terminalId);
  const current = index >= 0 ? existing[index] : undefined;
  const next: TerminalMetadata = {
    terminalId,
    workspaceId,
    createdAt: current?.createdAt ?? createdAt ?? "",
    title: title || getTerminalName(terminalId),
  };
  const metadata = index >= 0
    ? existing.map((entry, entryIndex) => (entryIndex === index ? next : entry))
    : [...existing, next];

  yield* call(
    setLocalStorageJSON,
    getTerminalMetadataStorageKey(workspaceId),
    metadata.slice(-MAX_TERMINAL_METADATA_ENTRIES)
  );
}

export function* removeTerminalMetadataFromStorage(
  terminalId: string,
  workspaceId: string
): SagaGenerator<void> {
  const existing = yield* call(loadTerminalMetadataFromStorage, workspaceId);
  yield* call(
    setLocalStorageJSON,
    getTerminalMetadataStorageKey(workspaceId),
    existing.filter((metadata) => metadata.terminalId !== terminalId)
  );
}

function* saveWorkspaceState(
  wsId: string,
  state: PersistedWorkspaceState
): SagaGenerator<void> {
  const states = (yield* call(
    getLocalStorageJSON<Record<string, PersistedWorkspaceState>>,
    WORKSPACE_STATE_STORAGE_KEY
  )) ?? {};
  states[wsId] = { isOpen: state.isOpen, activeTerminalId: state.activeTerminalId };
  yield* call(setLocalStorageJSON, WORKSPACE_STATE_STORAGE_KEY, states);
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
  yield* takeEvery(setTerminalOverlayHeight, function* () {
    const height = yield* selectTerminalOverlayHeight.effect();
    yield* call(saveHeight, height);
  });
}

/** Persist custom names on rename */
export function* watchRenameTerminal() {
  yield* takeEvery(renameTerminal, function* (action: ReturnType<typeof renameTerminal>) {
    const [wsId, termId, newName] = action.payload;
    const trimmedName = newName.trim() || undefined;
    yield* call(saveCustomName, wsId, termId, trimmedName);
  });
}

/** Remove custom name on terminal removal */
export function* watchRemoveTerminalCustomName() {
  yield* takeEvery(removeTerminal, function* (action: ReturnType<typeof removeTerminal>) {
    const [wsId, termId] = action.payload;
    yield* call(removeCustomName, wsId, termId);
  });
}

export function* watchTerminalMetadataPersistence() {
  yield* takeEvery(saveTerminalMetadata, function* (action: ReturnType<typeof saveTerminalMetadata>) {
    const [wsId, termId, title, createdAt] = action.payload;
    yield* call(saveTerminalMetadataToStorage, termId, wsId, title, createdAt);
  });

  yield* takeEvery(removeTerminal, function* (action: ReturnType<typeof removeTerminal>) {
    const [wsId, termId] = action.payload;
    yield* call(removeTerminalMetadataFromStorage, termId, wsId);
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

