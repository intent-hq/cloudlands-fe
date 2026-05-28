import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import {
  createCollection,
  addItem,
  removeItem,
  updateItem,
  getItem,
  getItemIndex,
  type Collection,
} from "../../utils/collection-utils";

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_HEIGHT = 50;
export const MIN_HEIGHT = 20;
export const MAX_HEIGHT = 90;

export const STORAGE_KEY = 'terminal-overlay-height';
export const CUSTOM_NAMES_STORAGE_KEY = 'terminal-custom-names';
export const WORKSPACE_STATE_STORAGE_KEY = 'terminal-overlay-workspace-state';

// ============================================================================
// Types
// ============================================================================

export interface TerminalTab {
  id: string;
  name: string;
  customName?: string;
  type?: string;
  workspaceId?: string;
  createdAt?: string;
  isConnected?: boolean;
  isExecuting?: boolean;
}

export interface TerminalMetadata {
  terminalId: string;
  workspaceId: string;
  createdAt: string;
  title?: string;
}

/** @deprecated Use TerminalTab instead — kept for backward compatibility during migration. */
export type WorkspaceTerminal = TerminalTab;

export interface WorkspaceTerminalState {
  isOpen: boolean;
  activeTerminalId: string | null;
  terminals: Collection<TerminalTab, "id">;
  terminalsLoaded: boolean;
  isLoadingTerminals: boolean;
  recentlyCreatedTerminals: string[];
}

/** Persisted subset of workspace state (terminals are loaded from terminalManager) */
export interface PersistedWorkspaceState {
  isOpen: boolean;
  activeTerminalId: string | null;
}

export type TerminalOverlayState = {
  height: number;
  workspaces: Record<string, WorkspaceTerminalState>;
};

// ============================================================================
// Initial State
// ============================================================================

export const emptyWorkspaceState: WorkspaceTerminalState = {
  isOpen: false,
  activeTerminalId: null,
  terminals: createCollection<TerminalTab, "id">("id"),
  terminalsLoaded: false,
  isLoadingTerminals: false,
  recentlyCreatedTerminals: [],
};

const initialState: TerminalOverlayState = {
  height: DEFAULT_HEIGHT,
  workspaces: {},
};

// ============================================================================
// Helpers
// ============================================================================

export function getTerminalName(termId: string): string {
  if (termId.includes('-default')) return 'Terminal';
  const match = termId.match(/terminal-(\d+)/);
  if (match) return `Terminal ${match[1]}`;
  return 'Terminal';
}

// ============================================================================
// Actions
// ============================================================================

export const openTerminalOverlay = createAction<[wsId: string, termId?: string]>(
  "terminals/open"
);

export const closeTerminalOverlay = createAction<[wsId: string]>("terminals/close");

export const toggleTerminalOverlay = createAction<[wsId: string, termId?: string]>(
  "terminals/toggle"
);

export const selectTerminal = createAction<[wsId: string, termId: string]>(
  "terminals/selectTerminal"
);

export const addTerminal = createAction<[wsId: string, termId: string, name?: string]>(
  "terminals/addTerminal"
);

export const removeTerminal = createAction<[wsId: string, termId: string]>(
  "terminals/removeTerminal"
);

export const setTerminalOverlayHeight = createAction<[height: number]>(
  "terminals/setHeight"
);

export const renameTerminal = createAction<[wsId: string, termId: string, newName: string]>(
  "terminals/renameTerminal"
);

export const saveTerminalMetadata = createAction<[
  wsId: string,
  termId: string,
  title: string | undefined,
  createdAt: string,
]>("terminals/saveTerminalMetadata");

/** Load workspace terminals data (dispatched by sagas after loading from storage) */
export const loadWorkspaceTerminals = createAction<[
  wsId: string,
  terminals: TerminalTab[],
  savedState?: PersistedWorkspaceState | null,
]>("terminals/loadWorkspaceTerminals");

/** Hydrate height from localStorage (dispatched by init saga) */
export const hydrateHeight = createAction<[height: number]>(
  "terminals/hydrateHeight"
);

export const createTerminalRequested = createAction<[wsId: string]>(
  "terminals/createTerminalRequested"
);

export const closeActiveTerminalRequested = createAction<[wsId: string]>(
  "terminals/closeActiveTerminalRequested"
);

export const setTerminalsList = createAction<[wsId: string, terminals: TerminalTab[]]>(
  "terminals/setTerminalsList"
);

export const setTerminalsLoaded = createAction<[wsId: string, terminalsLoaded: boolean]>(
  "terminals/setTerminalsLoaded"
);

export const setIsLoadingTerminals = createAction<[wsId: string, isLoadingTerminals: boolean]>(
  "terminals/setIsLoadingTerminals"
);

export const markTerminalRecentlyCreated = createAction<[wsId: string, terminalId: string]>(
  "terminals/markTerminalRecentlyCreated"
);



// ============================================================================
// Reducer helpers
// ============================================================================

function getWs(state: TerminalOverlayState, wsId: string): WorkspaceTerminalState {
  return state.workspaces[wsId] || emptyWorkspaceState;
}

function setWs(state: TerminalOverlayState, wsId: string, ws: WorkspaceTerminalState): TerminalOverlayState {
  return { ...state, workspaces: { ...state.workspaces, [wsId]: ws } };
}

function ensureDefaultTerminal(terminals: Collection<TerminalTab, "id">, wsId: string, customNames?: Record<string, string>): { terminals: Collection<TerminalTab, "id">; defaultId: string } {
  const defaultId = `terminal-${wsId}-default`;
  if (getItem(terminals, defaultId)) {
    return { terminals, defaultId };
  }
  const customName = customNames?.[defaultId];
  return {
    terminals: addItem(terminals, { id: defaultId, name: 'Terminal', customName }),
    defaultId,
  };
}

function addTerminalIfMissing(terminals: Collection<TerminalTab, "id">, termId: string, name?: string, customName?: string, metadata?: Partial<TerminalTab>): Collection<TerminalTab, "id"> {
  if (getItem(terminals, termId)) return terminals;
  return addItem(terminals, { id: termId, name: name || getTerminalName(termId), customName, ...metadata });
}

// ============================================================================
// Reducer
// ============================================================================

export const terminalsReducer = createReducer<TerminalOverlayState>(initialState)
  .with(openTerminalOverlay, (state, { payload: [wsId, termId] }) => {
    const ws = getWs(state, wsId);
    const newWs = { ...ws };

    if (termId) {
      newWs.terminals = addTerminalIfMissing(ws.terminals, termId);
      newWs.activeTerminalId = termId;
    } else if (!ws.activeTerminalId || !getItem(ws.terminals, ws.activeTerminalId)) {
      const result = ensureDefaultTerminal(ws.terminals, wsId);
      newWs.terminals = result.terminals;
      newWs.activeTerminalId = result.defaultId;
    }

    newWs.isOpen = true;
    return setWs(state, wsId, newWs);
  })
  .with(closeTerminalOverlay, (state, { payload: [wsId] }) => {
    const ws = getWs(state, wsId);
    if (!ws.isOpen) return state;
    return setWs(state, wsId, { ...ws, isOpen: false });
  })
  .with(toggleTerminalOverlay, (state, { payload: [wsId, termId] }) => {
    const ws = getWs(state, wsId);
    if (ws.isOpen && !termId) {
      return setWs(state, wsId, { ...ws, isOpen: false });
    }
    // Delegate to open logic
    const newWs = { ...ws };
    if (termId) {
      newWs.terminals = addTerminalIfMissing(ws.terminals, termId);
      newWs.activeTerminalId = termId;
    } else if (!ws.activeTerminalId || !getItem(ws.terminals, ws.activeTerminalId)) {
      const result = ensureDefaultTerminal(ws.terminals, wsId);
      newWs.terminals = result.terminals;
      newWs.activeTerminalId = result.defaultId;
    }
    newWs.isOpen = true;
    return setWs(state, wsId, newWs);
  })
  .with(selectTerminal, (state, { payload: [wsId, termId] }) => {
    const ws = getWs(state, wsId);
    if (!getItem(ws.terminals, termId)) return state;
    if (ws.activeTerminalId === termId) return state;
    return setWs(state, wsId, { ...ws, activeTerminalId: termId });
  })
  .with(addTerminal, (state, { payload: [wsId, termId, name] }) => {
    const ws = getWs(state, wsId);
    const newTerminals = addTerminalIfMissing(ws.terminals, termId, name);
    return setWs(state, wsId, {
      ...ws,
      terminals: newTerminals,
      activeTerminalId: termId,
    });
  })
  .with(removeTerminal, (state, { payload: [wsId, termId] }) => {
    const ws = getWs(state, wsId);
    const index = getItemIndex(ws.terminals, termId);
    if (index === -1) return state;

    const newTerminals = removeItem(ws.terminals, termId);
    let newActiveId = ws.activeTerminalId;

    if (ws.activeTerminalId === termId) {
      if (newTerminals.ids.length > 0) {
        const newIndex = Math.min(index, newTerminals.ids.length - 1);
        newActiveId = newTerminals.ids[newIndex];
      } else {
        newActiveId = null;
      }
    }

    // Close the panel when the last terminal is removed — the panel
    // requires activeTerminalId to render, so isOpen:true with no
    // terminals creates a stuck state.
    const isOpen = newTerminals.ids.length > 0 ? ws.isOpen : false;

    return setWs(state, wsId, { ...ws, terminals: newTerminals, activeTerminalId: newActiveId, isOpen });
  })
  .with(setTerminalOverlayHeight, (state, { payload: [height] }) => {
    const clamped = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height));
    if (clamped === state.height) return state;
    return { ...state, height: clamped };
  })
  .with(renameTerminal, (state, { payload: [wsId, termId, newName] }) => {
    const ws = getWs(state, wsId);
    const trimmedName = newName.trim() || undefined;
    if (!getItem(ws.terminals, termId)) return state;
    return setWs(state, wsId, {
      ...ws,
      terminals: updateItem(ws.terminals, { id: termId, customName: trimmedName }),
    });
  })
  .with(saveTerminalMetadata, (state, { payload: [wsId, termId, title, createdAt] }) => {
    const ws = getWs(state, wsId);
    const existing = getItem(ws.terminals, termId);
    const name = title || getTerminalName(termId);
    const terminal: TerminalTab = {
      ...(existing ?? { id: termId }),
      id: termId,
      name,
      type: existing?.type ?? "terminal",
      workspaceId: wsId,
      createdAt: existing?.createdAt ?? createdAt,
    };

    const terminals = existing
      ? updateItem(ws.terminals, terminal)
      : addItem(ws.terminals, terminal);

    return setWs(state, wsId, { ...ws, terminals });
  })
  .with(loadWorkspaceTerminals, (state, { payload: [wsId, terminals, savedState] }) => {
    const collection = createCollection<TerminalTab, "id">("id", terminals);
    let wsState: WorkspaceTerminalState;

    if (terminals.length > 0) {
      let activeId: string | null;
      let isOpen: boolean;

      if (savedState) {
        isOpen = savedState.isOpen;
        activeId = (savedState.activeTerminalId && getItem(collection, savedState.activeTerminalId))
          ? savedState.activeTerminalId
          : collection.ids[0];
      } else {
        isOpen = false;
        activeId = collection.ids[0];
      }

      wsState = { terminals: collection, isOpen, activeTerminalId: activeId, terminalsLoaded: false, isLoadingTerminals: false, recentlyCreatedTerminals: [] };
    } else {
      // Don't restore isOpen when there are no terminals — the panel
      // requires activeTerminalId to render, so isOpen:true with no
      // terminals creates a stuck state where the toggle appears broken
      // (first click closes an invisible panel, second click finally
      // creates a default terminal and opens it).
      wsState = {
        terminals: createCollection<TerminalTab, "id">("id"),
        activeTerminalId: null,
        isOpen: false,
        terminalsLoaded: false,
        isLoadingTerminals: false,
        recentlyCreatedTerminals: [],
      };
    }

    return setWs(state, wsId, wsState);
  })
  .with(hydrateHeight, (state, { payload: [height] }) => {
    if (height < MIN_HEIGHT || height > MAX_HEIGHT) return state;
    return { ...state, height };
  })
  .with(setTerminalsList, (state, { payload: [wsId, terminals] }) => {
    const ws = getWs(state, wsId);
    // Preserve custom names from existing terminals
    const merged = terminals.map((t) => ({
      ...t,
      customName: getItem(ws.terminals, t.id)?.customName || t.customName,
    }));
    return setWs(state, wsId, { ...ws, terminals: createCollection<TerminalTab, "id">("id", merged) });
  })
  .with(setTerminalsLoaded, (state, { payload: [wsId, terminalsLoaded] }) => {
    const ws = getWs(state, wsId);
    if (ws.terminalsLoaded === terminalsLoaded) return state;
    return setWs(state, wsId, { ...ws, terminalsLoaded });
  })
  .with(setIsLoadingTerminals, (state, { payload: [wsId, isLoadingTerminals] }) => {
    const ws = getWs(state, wsId);
    if (ws.isLoadingTerminals === isLoadingTerminals) return state;
    return setWs(state, wsId, { ...ws, isLoadingTerminals });
  })
  .with(markTerminalRecentlyCreated, (state, { payload: [wsId, terminalId] }) => {
    const ws = getWs(state, wsId);
    if (ws.recentlyCreatedTerminals.includes(terminalId)) return state;
    return setWs(state, wsId, {
      ...ws,
      recentlyCreatedTerminals: [...ws.recentlyCreatedTerminals, terminalId],
    });
  });
