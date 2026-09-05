import { call, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  DEFAULT_TERMINAL_OVERLAY_HEIGHT,
  isValidTerminalOverlayHeight,
} from '$shared/utils/terminal-overlay-height';
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageJSON,
} from '../../../utils/safe-local-storage-saga';
import { selectWorkspaceTerminalState } from '../terminals-selectors';
import {
  CUSTOM_NAMES_STORAGE_KEY,
  STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY,
  addTerminal,
  closeTerminalOverlay,
  emptyWorkspaceState,
  getTerminalName,
  hydrateHeight,
  loadWorkspaceTerminals,
  openTerminalOverlay,
  removeTerminal,
  renameTerminal,
  saveTerminalMetadata,
  selectTerminal,
  setTerminalOverlayHeight,
  toggleTerminalOverlay,
  type PersistedWorkspaceState,
  type TerminalMetadata,
} from '../terminals-slice';

const LEGACY_CUSTOM_NAMES_BUCKET = '__legacy__';
const TERMINAL_METADATA_STORAGE_PREFIX = 'terminal-metadata-';
const MAX_TERMINAL_METADATA_ENTRIES = 10;

type StoredCustomNames = Record<string, Record<string, string>>;
type WorkspaceStateAction =
  | ReturnType<typeof openTerminalOverlay>
  | ReturnType<typeof closeTerminalOverlay>
  | ReturnType<typeof toggleTerminalOverlay>
  | ReturnType<typeof selectTerminal>
  | ReturnType<typeof addTerminal>;

const internallyHydratedLoads = new WeakSet<object>();

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function isStoredCustomNames(value: unknown): value is StoredCustomNames {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(isStringRecord)
  );
}

function isTerminalMetadata(value: unknown, workspaceId: string): value is TerminalMetadata {
  const metadata = value as TerminalMetadata;
  return (
    !!metadata &&
    typeof metadata === 'object' &&
    typeof metadata.terminalId === 'string' &&
    metadata.workspaceId === workspaceId &&
    typeof metadata.createdAt === 'string' &&
    (metadata.title === undefined || typeof metadata.title === 'string')
  );
}

function pruneEmptyCustomNameBuckets(all: StoredCustomNames): StoredCustomNames {
  return Object.fromEntries(
    Object.entries(all).filter(([, names]) => Object.keys(names).length > 0),
  );
}

function metadataStorageKey(workspaceId: string): string {
  return `${TERMINAL_METADATA_STORAGE_PREFIX}${workspaceId}`;
}

function* loadAllCustomNames(): SagaGenerator<StoredCustomNames> {
  const parsed = yield* call(getLocalStorageJSON<unknown>, CUSTOM_NAMES_STORAGE_KEY);
  if (parsed === undefined) return {};
  if (isStoredCustomNames(parsed)) return parsed;
  if (!isStringRecord(parsed)) return {};

  const migrated = { [LEGACY_CUSTOM_NAMES_BUCKET]: parsed };
  yield* call(setLocalStorageJSON, CUSTOM_NAMES_STORAGE_KEY, {
    [LEGACY_CUSTOM_NAMES_BUCKET]: { ...parsed },
  });
  return migrated;
}

function* persistCustomName(
  workspaceId: string,
  terminalId: string,
  customName: string | undefined,
): SagaGenerator<void> {
  const all = yield* call(loadAllCustomNames);
  delete all[LEGACY_CUSTOM_NAMES_BUCKET]?.[terminalId];
  all[workspaceId] ??= {};
  if (customName) all[workspaceId][terminalId] = customName;
  else delete all[workspaceId][terminalId];
  yield* call(setLocalStorageJSON, CUSTOM_NAMES_STORAGE_KEY, pruneEmptyCustomNameBuckets(all));
}

function* loadTerminalMetadata(workspaceId: string): SagaGenerator<TerminalMetadata[]> {
  const key = metadataStorageKey(workspaceId);
  const stored = yield* call(getLocalStorageJSON<unknown>, key);
  if (!Array.isArray(stored)) return [];

  const metadata = stored.filter((entry) => isTerminalMetadata(entry, workspaceId));
  if (metadata.length !== stored.length) yield* call(setLocalStorageJSON, key, metadata);
  return metadata;
}

function* persistWorkspaceState(workspaceId: string): SagaGenerator<void> {
  const workspaceState = yield* selectWorkspaceTerminalState.effect(workspaceId);
  if (workspaceState === emptyWorkspaceState) return;

  const states =
    (yield* call(
      getLocalStorageJSON<Record<string, PersistedWorkspaceState>>,
      WORKSPACE_STATE_STORAGE_KEY,
    )) ?? {};
  states[workspaceId] = {
    isOpen: workspaceState.isOpen,
    activeTerminalId: workspaceState.activeTerminalId,
    ...(workspaceState.height !== null ? { height: workspaceState.height } : {}),
  };
  yield* call(setLocalStorageJSON, WORKSPACE_STATE_STORAGE_KEY, states);
}

function* hydrateTerminalHeightWorker(): SagaGenerator<void> {
  const stored = yield* call(getLocalStorageItem, STORAGE_KEY);
  const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
  const fallback = Number.isNaN(parsed) ? DEFAULT_TERMINAL_OVERLAY_HEIGHT : parsed;

  const states = yield* call(
    getLocalStorageJSON<Record<string, PersistedWorkspaceState>>,
    WORKSPACE_STATE_STORAGE_KEY,
  );
  const workspaceHeights: Record<string, number> = {};
  for (const [workspaceId, state] of Object.entries(states ?? {})) {
    const height = state?.height;
    if (typeof height === 'number' && isValidTerminalOverlayHeight(height)) {
      workspaceHeights[workspaceId] = height;
    }
  }
  yield* put(hydrateHeight(fallback, workspaceHeights));
}

function* persistTerminalHeightWorker(
  action: ReturnType<typeof setTerminalOverlayHeight>,
): SagaGenerator<void> {
  yield* call(persistWorkspaceState, action.payload[0]);
}

function* persistTerminalNameWorker(
  action: ReturnType<typeof renameTerminal>,
): SagaGenerator<void> {
  const [workspaceId, terminalId, name] = action.payload;
  yield* call(persistCustomName, workspaceId, terminalId, name.trim() || undefined);
}

function* persistTerminalMetadataWorker(
  action: ReturnType<typeof saveTerminalMetadata>,
): SagaGenerator<void> {
  const [workspaceId, terminalId, title, createdAt] = action.payload;
  const existing = yield* call(loadTerminalMetadata, workspaceId);
  const index = existing.findIndex((metadata) => metadata.terminalId === terminalId);
  const current = index >= 0 ? existing[index] : undefined;
  const next: TerminalMetadata = {
    terminalId,
    workspaceId,
    createdAt: current?.createdAt ?? createdAt ?? '',
    title: title || current?.title || getTerminalName(terminalId),
  };
  const metadata =
    index >= 0
      ? existing.map((entry, entryIndex) => (entryIndex === index ? next : entry))
      : [...existing, next];
  yield* call(
    setLocalStorageJSON,
    metadataStorageKey(workspaceId),
    metadata.slice(-MAX_TERMINAL_METADATA_ENTRIES),
  );
}

function* removeTerminalPersistenceWorker(
  action: ReturnType<typeof removeTerminal>,
): SagaGenerator<void> {
  const [workspaceId, terminalId] = action.payload;
  const all = yield* call(loadAllCustomNames);
  delete all[LEGACY_CUSTOM_NAMES_BUCKET]?.[terminalId];
  delete all[workspaceId]?.[terminalId];
  yield* call(setLocalStorageJSON, CUSTOM_NAMES_STORAGE_KEY, pruneEmptyCustomNameBuckets(all));

  const metadata = yield* call(loadTerminalMetadata, workspaceId);
  yield* call(
    setLocalStorageJSON,
    metadataStorageKey(workspaceId),
    metadata.filter((entry) => entry.terminalId !== terminalId),
  );
  yield* call(persistWorkspaceState, workspaceId);
}

function* persistTerminalWorkspaceStateWorker(action: WorkspaceStateAction): SagaGenerator<void> {
  yield* call(persistWorkspaceState, action.payload[0]);
}

function* hydrateAndPersistLoadedTerminalsWorker(
  action: ReturnType<typeof loadWorkspaceTerminals>,
): SagaGenerator<void> {
  if (internallyHydratedLoads.has(action)) {
    internallyHydratedLoads.delete(action);
    return;
  }

  const [workspaceId, terminals, savedState] = action.payload;
  if (savedState !== undefined) {
    yield* call(persistWorkspaceState, workspaceId);
    return;
  }

  const states = yield* call(
    getLocalStorageJSON<Record<string, PersistedWorkspaceState>>,
    WORKSPACE_STATE_STORAGE_KEY,
  );
  const hydratedAction = loadWorkspaceTerminals(
    workspaceId,
    terminals,
    states?.[workspaceId] || null,
  );
  internallyHydratedLoads.add(hydratedAction);
  yield* put(hydratedAction);
}

function* watchTerminalPersistence(): SagaGenerator<void> {
  yield* takeEvery(setTerminalOverlayHeight, persistTerminalHeightWorker);
  yield* takeEvery(renameTerminal, persistTerminalNameWorker);
  yield* takeEvery(saveTerminalMetadata, persistTerminalMetadataWorker);
  yield* takeEvery(removeTerminal, removeTerminalPersistenceWorker);
  yield* takeEvery(
    [openTerminalOverlay, closeTerminalOverlay, toggleTerminalOverlay, selectTerminal, addTerminal],
    persistTerminalWorkspaceStateWorker,
  );
  yield* takeEvery(loadWorkspaceTerminals, hydrateAndPersistLoadedTerminalsWorker);
}

/** Unregistered until the S20 middleware cutover. */
export function* terminalPersistenceSaga(): SagaGenerator<void> {
  yield* call(hydrateTerminalHeightWorker);
  yield* fork(watchTerminalPersistence);
}
