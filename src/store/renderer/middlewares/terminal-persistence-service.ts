/**
 * Terminal persistence service — restores the terminals/sagas/persistence-saga.ts
 * localStorage read/write behaviors (GAPs 2-5 from the saga removal audit).
 *
 * With no saga listening after the redux-saga removal (95d908a2, c81d7d25):
 *   - Terminal overlay height never persisted across relaunches (GAP 2)
 *   - Custom terminal names never saved (GAP 3)
 *   - Terminal metadata never persisted (GAP 4)
 *   - Per-workspace overlay state (isOpen, activeTerminalId) never saved (GAP 5)
 *
 * This middleware reconnects those persistence paths WITHOUT re-adding a saga:
 *   - On creation: hydrates height + loads workspace terminal metadata from localStorage
 *   - After height-changing actions: writes height to localStorage
 *   - After rename actions: writes custom names to localStorage (with legacy migration)
 *   - After metadata actions: writes terminal metadata to localStorage
 *   - After workspace state actions: writes per-workspace overlay state
 *   - On removeTerminal: cleans up custom names and metadata
 *
 * Storage keys and formats match the reference saga (terminals/sagas/persistence-saga.ts
 * at 95d908a2~1) for cross-compatibility with pre-port persisted state.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only safe-storage,
 * slice actions/types/constants — no selectors and no store module.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import type { StoreState } from "../types";
import {
  setTerminalOverlayHeight,
  renameTerminal,
  saveTerminalMetadata,
  removeTerminal,
  openTerminalOverlay,
  closeTerminalOverlay,
  toggleTerminalOverlay,
  selectTerminal,
  addTerminal,
  loadWorkspaceTerminals,
  hydrateHeight,
  STORAGE_KEY,
  CUSTOM_NAMES_STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY,
  getTerminalName,
  type TerminalMetadata,
  type PersistedWorkspaceState,
} from "../slices/terminals/terminals-slice";

// ============================================================================
// Constants
// ============================================================================

const LEGACY_CUSTOM_NAMES_BUCKET = "__legacy__";
const TERMINAL_METADATA_STORAGE_PREFIX = "terminal-metadata-";
const MAX_TERMINAL_METADATA_ENTRIES = 10;

// ============================================================================
// Type Guards
// ============================================================================

type WorkspaceCustomNames = Record<string, string>;
type StoredCustomNames = Record<string, WorkspaceCustomNames>;

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isStoredCustomNames(value: unknown): value is StoredCustomNames {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => isStringRecord(entry))
  );
}

function isTerminalMetadata(
  value: unknown,
  wsId: string
): value is TerminalMetadata {
  const metadata = value as TerminalMetadata;
  return (
    !!metadata &&
    typeof metadata === "object" &&
    typeof metadata.terminalId === "string" &&
    typeof metadata.workspaceId === "string" &&
    metadata.workspaceId === wsId &&
    typeof metadata.createdAt === "string" &&
    (metadata.title === undefined || typeof metadata.title === "string")
  );
}

// ============================================================================
// Storage Helpers
// ============================================================================

function loadHeight(): number {
  const stored = safeLocalStorage.getItem(STORAGE_KEY);
  if (stored) {
    const height = parseInt(stored, 10);
    if (!isNaN(height)) return height;
  }
  return 50;
}

function saveHeight(height: number): void {
  safeLocalStorage.setItem(STORAGE_KEY, String(height));
}

function pruneEmptyCustomNameBuckets(
  all: StoredCustomNames
): StoredCustomNames {
  return Object.fromEntries(
    Object.entries(all).filter(([, names]) => Object.keys(names).length > 0)
  );
}

function loadAllCustomNames(): StoredCustomNames {
  const parsed: unknown = safeLocalStorage.getJSON<unknown>(
    CUSTOM_NAMES_STORAGE_KEY
  );
  if (parsed === undefined) return {};

  if (isStoredCustomNames(parsed)) return parsed;

  // Legacy migration: old format was flat Record<string, string>
  if (isStringRecord(parsed)) {
    const migrated = { [LEGACY_CUSTOM_NAMES_BUCKET]: parsed };
    safeLocalStorage.setJSON(CUSTOM_NAMES_STORAGE_KEY, migrated);
    return migrated;
  }

  return {};
}

function saveCustomName(
  wsId: string,
  termId: string,
  customName: string | undefined
): void {
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
  safeLocalStorage.setJSON(
    CUSTOM_NAMES_STORAGE_KEY,
    pruneEmptyCustomNameBuckets(all)
  );
}

function removeCustomName(wsId: string, termId: string): void {
  const all = loadAllCustomNames();
  if (all[LEGACY_CUSTOM_NAMES_BUCKET]) {
    delete all[LEGACY_CUSTOM_NAMES_BUCKET][termId];
  }
  if (all[wsId]) {
    delete all[wsId][termId];
  }
  safeLocalStorage.setJSON(
    CUSTOM_NAMES_STORAGE_KEY,
    pruneEmptyCustomNameBuckets(all)
  );
}

function getTerminalMetadataStorageKey(wsId: string): string {
  return `${TERMINAL_METADATA_STORAGE_PREFIX}${wsId}`;
}

function loadTerminalMetadataFromStorage(
  wsId: string
): TerminalMetadata[] {
  const key = getTerminalMetadataStorageKey(wsId);
  const stored = safeLocalStorage.getJSON<unknown>(key);
  if (!Array.isArray(stored)) return [];

  const metadata = stored.filter((entry) => isTerminalMetadata(entry, wsId));
  if (metadata.length !== stored.length) {
    safeLocalStorage.setJSON(key, metadata);
  }
  return metadata;
}

function saveTerminalMetadataToStorage(
  terminalId: string,
  workspaceId: string,
  title?: string,
  createdAt?: string
): void {
  const existing = loadTerminalMetadataFromStorage(workspaceId);
  const index = existing.findIndex(
    (metadata) => metadata.terminalId === terminalId
  );
  const current = index >= 0 ? existing[index] : undefined;
  const next: TerminalMetadata = {
    terminalId,
    workspaceId,
    createdAt: current?.createdAt ?? createdAt ?? "",
    title: title || getTerminalName(terminalId),
  };
  const metadata =
    index >= 0
      ? existing.map((entry, entryIndex) =>
          entryIndex === index ? next : entry
        )
      : [...existing, next];

  safeLocalStorage.setJSON(
    getTerminalMetadataStorageKey(workspaceId),
    metadata.slice(-MAX_TERMINAL_METADATA_ENTRIES)
  );
}

function removeTerminalMetadataFromStorage(
  terminalId: string,
  workspaceId: string
): void {
  const existing = loadTerminalMetadataFromStorage(workspaceId);
  safeLocalStorage.setJSON(
    getTerminalMetadataStorageKey(workspaceId),
    existing.filter((metadata) => metadata.terminalId !== terminalId)
  );
}

function loadWorkspaceState(wsId: string): PersistedWorkspaceState | null {
  const states = safeLocalStorage.getJSON<
    Record<string, PersistedWorkspaceState>
  >(WORKSPACE_STATE_STORAGE_KEY);
  return states?.[wsId] || null;
}

function saveWorkspaceState(
  wsId: string,
  state: PersistedWorkspaceState
): void {
  const states =
    safeLocalStorage.getJSON<Record<string, PersistedWorkspaceState>>(
      WORKSPACE_STATE_STORAGE_KEY
    ) ?? {};
  states[wsId] = {
    isOpen: state.isOpen,
    activeTerminalId: state.activeTerminalId,
  };
  safeLocalStorage.setJSON(WORKSPACE_STATE_STORAGE_KEY, states);
}

// ============================================================================
// Middleware
// ============================================================================

/** Actions that mutate workspace terminal state and need persistence */
const WORKSPACE_STATE_PERSIST_ACTIONS = new Set<string>([
  openTerminalOverlay.type,
  closeTerminalOverlay.type,
  toggleTerminalOverlay.type,
  selectTerminal.type,
  addTerminal.type,
  removeTerminal.type,
  loadWorkspaceTerminals.type,
]);

/**
 * Middleware restoring terminal persistence behaviors from the deleted
 * terminals/sagas/persistence-saga.ts and workspace-init-saga.ts.
 * Hydration runs once at factory time; persistence runs after each mutating
 * action passes the reducer.
 */
export function createTerminalPersistenceMiddleware(): StoreMiddleware {
  return (api) => {
    // Hydrate height from localStorage once
    const height = loadHeight();
    api.dispatch(hydrateHeight(height));

    return (next) => (action) => {
      // Intercept loadWorkspaceTerminals to restore saved state from localStorage
      // (lifecycle-read-service dispatches it without savedState)
      if (action?.type === loadWorkspaceTerminals.type) {
        const [wsId, terminals, savedState] = action.payload as [
          string,
          unknown[],
          PersistedWorkspaceState | null | undefined
        ];
        // If savedState is not already provided, load it from localStorage
        if (savedState === undefined) {
          const loadedState = loadWorkspaceState(wsId);
          // Re-dispatch with the loaded state
          return next({
            ...action,
            payload: [wsId, terminals, loadedState],
          });
        }
      }

      const result = next(action);

      if (!action) return result;

      // GAP 2: Persist height changes
      if (action.type === setTerminalOverlayHeight.type) {
        const state = api.getState() as StoreState;
        saveHeight(state.terminals.height);
      }

      // GAP 3: Persist custom terminal names
      if (action.type === renameTerminal.type) {
        const [wsId, termId, newName] = action.payload as [
          string,
          string,
          string
        ];
        const trimmedName = newName.trim() || undefined;
        saveCustomName(wsId, termId, trimmedName);
      }

      // GAP 4: Persist terminal metadata
      if (action.type === saveTerminalMetadata.type) {
        const [wsId, termId, title, createdAt] = action.payload as [
          string,
          string,
          string | undefined,
          string
        ];
        saveTerminalMetadataToStorage(termId, wsId, title, createdAt);
      }

      // GAP 3 & 4: Remove custom name and metadata on terminal removal
      if (action.type === removeTerminal.type) {
        const [wsId, termId] = action.payload as [string, string];
        removeCustomName(wsId, termId);
        removeTerminalMetadataFromStorage(termId, wsId);
      }

      // GAP 5: Persist per-workspace overlay state
      if (WORKSPACE_STATE_PERSIST_ACTIONS.has(action.type)) {
        const wsId = (action.payload as [string, ...unknown[]])[0];
        if (!wsId) return result;
        const state = api.getState() as StoreState;
        const ws = state.terminals.workspaces[wsId];
        if (ws) {
          saveWorkspaceState(wsId, {
            isOpen: ws.isOpen,
            activeTerminalId: ws.activeTerminalId,
          });
        }
      }

      return result;
    };
  };
}
