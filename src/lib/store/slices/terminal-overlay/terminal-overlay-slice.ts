import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

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
}

export interface WorkspaceTerminalState {
  isOpen: boolean;
  activeTerminalId: string | null;
  terminals: TerminalTab[];
}

/** Persisted subset of workspace state (terminals are loaded from terminalManager) */
export interface PersistedWorkspaceState {
  isOpen: boolean;
  activeTerminalId: string | null;
}

export type TerminalOverlayState = {
  height: number;
  activeWorkspaceId: string | null;
  workspaces: Record<string, WorkspaceTerminalState>;
};

// ============================================================================
// Initial State
// ============================================================================

export const emptyWorkspaceState: WorkspaceTerminalState = {
  isOpen: false,
  activeTerminalId: null,
  terminals: [],
};

const initialState: TerminalOverlayState = {
  height: DEFAULT_HEIGHT,
  activeWorkspaceId: null,
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
  "terminalOverlay/open"
);

export const closeTerminalOverlay = createAction<[wsId: string]>("terminalOverlay/close");

export const toggleTerminalOverlay = createAction<[wsId: string, termId?: string]>(
  "terminalOverlay/toggle"
);

export const selectTerminal = createAction<[wsId: string, termId: string]>(
  "terminalOverlay/selectTerminal"
);

export const addTerminal = createAction<[wsId: string, termId: string, name?: string]>(
  "terminalOverlay/addTerminal"
);

export const removeTerminal = createAction<[wsId: string, termId: string]>(
  "terminalOverlay/removeTerminal"
);

export const setTerminalOverlayHeight = createAction<[height: number]>(
  "terminalOverlay/setHeight"
);

export const setTerminalOverlayWorkspace = createAction<[wsId: string]>(
  "terminalOverlay/setWorkspace"
);

export const renameTerminal = createAction<[wsId: string, termId: string, newName: string]>(
  "terminalOverlay/renameTerminal"
);

export const updateTerminalName = createAction<[wsId: string, termId: string, name: string]>(
  "terminalOverlay/updateTerminalName"
);

export const syncTerminals = createAction<[wsId: string, terminalList: Array<{ id: string; name?: string; title?: string }>]>(
  "terminalOverlay/syncTerminals"
);

/** Load workspace terminals data (dispatched by sagas after loading from storage) */
export const loadWorkspaceTerminals = createAction<[
  wsId: string,
  terminals: TerminalTab[],
  savedState?: PersistedWorkspaceState | null,
]>("terminalOverlay/loadWorkspaceTerminals");

/** Hydrate height from localStorage (dispatched by init saga) */
export const hydrateHeight = createAction<[height: number]>(
  "terminalOverlay/hydrateHeight"
);

/** Hydrate custom names from localStorage */
export const hydrateCustomNames = createAction<[wsId: string, names: Record<string, string>]>(
  "terminalOverlay/hydrateCustomNames"
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

function ensureDefaultTerminal(terminals: TerminalTab[], wsId: string, customNames?: Record<string, string>): { terminals: TerminalTab[]; defaultId: string } {
  const defaultId = `terminal-${wsId}-default`;
  if (terminals.some((t) => t.id === defaultId)) {
    return { terminals, defaultId };
  }
  const customName = customNames?.[defaultId];
  return {
    terminals: [...terminals, { id: defaultId, name: 'Terminal', customName }],
    defaultId,
  };
}

function addTerminalIfMissing(terminals: TerminalTab[], termId: string, name?: string, customName?: string): TerminalTab[] {
  if (terminals.some((t) => t.id === termId)) return terminals;
  return [...terminals, { id: termId, name: name || getTerminalName(termId), customName }];
}

// ============================================================================
// Reducer
// ============================================================================

export const terminalOverlayReducer = createReducer<TerminalOverlayState>(initialState)
  .with(openTerminalOverlay, (state, { payload: [wsId, termId] }) => {
    const ws = getWs(state, wsId);
    let newWs = { ...ws };

    if (termId) {
      newWs.terminals = addTerminalIfMissing(ws.terminals, termId);
      newWs.activeTerminalId = termId;
    } else if (!ws.activeTerminalId || !ws.terminals.some((t) => t.id === ws.activeTerminalId)) {
      const result = ensureDefaultTerminal(ws.terminals, wsId);
      newWs.terminals = result.terminals;
      newWs.activeTerminalId = result.defaultId;
    }

    newWs.isOpen = true;
    return setWs({ ...state, activeWorkspaceId: wsId }, wsId, newWs);
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
    let newWs = { ...ws };
    if (termId) {
      newWs.terminals = addTerminalIfMissing(ws.terminals, termId);
      newWs.activeTerminalId = termId;
    } else if (!ws.activeTerminalId || !ws.terminals.some((t) => t.id === ws.activeTerminalId)) {
      const result = ensureDefaultTerminal(ws.terminals, wsId);
      newWs.terminals = result.terminals;
      newWs.activeTerminalId = result.defaultId;
    }
    newWs.isOpen = true;
    return setWs({ ...state, activeWorkspaceId: wsId }, wsId, newWs);
  })
  .with(selectTerminal, (state, { payload: [wsId, termId] }) => {
    const ws = getWs(state, wsId);
    if (!ws.terminals.some((t) => t.id === termId)) return state;
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
    const index = ws.terminals.findIndex((t) => t.id === termId);
    if (index === -1) return state;

    const newTerminals = ws.terminals.filter((t) => t.id !== termId);
    let newActiveId = ws.activeTerminalId;

    if (ws.activeTerminalId === termId) {
      if (newTerminals.length > 0) {
        const newIndex = Math.min(index, newTerminals.length - 1);
        newActiveId = newTerminals[newIndex].id;
      } else {
        newActiveId = null;
      }
    }

    return setWs(state, wsId, { ...ws, terminals: newTerminals, activeTerminalId: newActiveId });
  })
  .with(setTerminalOverlayHeight, (state, { payload: [height] }) => {
    const clamped = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height));
    if (clamped === state.height) return state;
    return { ...state, height: clamped };
  })
  .with(setTerminalOverlayWorkspace, (state, { payload: [wsId] }) => {
    if (state.activeWorkspaceId === wsId) return state;
    return { ...state, activeWorkspaceId: wsId };
  })
  .with(renameTerminal, (state, { payload: [wsId, termId, newName] }) => {
    const ws = getWs(state, wsId);
    const trimmedName = newName.trim() || undefined;
    if (!ws.terminals.some((t) => t.id === termId)) return state;
    return setWs(state, wsId, {
      ...ws,
      terminals: ws.terminals.map((t) =>
        t.id === termId ? { ...t, customName: trimmedName } : t
      ),
    });
  })
  .with(updateTerminalName, (state, { payload: [wsId, termId, name] }) => {
    const ws = getWs(state, wsId);
    if (!ws.terminals.some((t) => t.id === termId)) return state;
    return setWs(state, wsId, {
      ...ws,
      terminals: ws.terminals.map((t) =>
        t.id === termId ? { ...t, name } : t
      ),
    });
  })
  .with(syncTerminals, (state, { payload: [wsId, terminalList] }) => {
    const ws = getWs(state, wsId);
    const newTerminals = terminalList.map((t) => ({
      id: t.id,
      name: t.name || t.title || getTerminalName(t.id),
      customName: ws.terminals.find((existing) => existing.id === t.id)?.customName,
    }));

    let newActiveId = ws.activeTerminalId;
    if (newActiveId && !newTerminals.some((t) => t.id === newActiveId)) {
      newActiveId = newTerminals.length > 0 ? newTerminals[0].id : null;
    }

    return setWs(state, wsId, { ...ws, terminals: newTerminals, activeTerminalId: newActiveId });
  })
  .with(loadWorkspaceTerminals, (state, { payload: [wsId, terminals, savedState] }) => {
    let wsState: WorkspaceTerminalState;

    if (terminals.length > 0) {
      let activeId: string | null;
      let isOpen: boolean;

      if (savedState) {
        isOpen = savedState.isOpen;
        activeId = (savedState.activeTerminalId && terminals.some((t) => t.id === savedState.activeTerminalId))
          ? savedState.activeTerminalId
          : terminals[0].id;
      } else {
        isOpen = false;
        activeId = terminals[0].id;
      }

      wsState = { terminals, isOpen, activeTerminalId: activeId };
    } else {
      wsState = {
        terminals: [],
        activeTerminalId: null,
        isOpen: savedState?.isOpen ?? false,
      };
    }

    return setWs({ ...state, activeWorkspaceId: wsId }, wsId, wsState);
  })
  .with(hydrateHeight, (state, { payload: [height] }) => {
    if (height < MIN_HEIGHT || height > MAX_HEIGHT) return state;
    return { ...state, height };
  })
  .with(hydrateCustomNames, (state, { payload: [wsId, names] }) => {
    const ws = getWs(state, wsId);
    if (ws.terminals.length === 0) return state;

    const updated = ws.terminals.map((t) => {
      const customName = names[t.id];
      if (customName && customName !== t.customName) {
        return { ...t, customName };
      }
      return t;
    });

    return setWs(state, wsId, { ...ws, terminals: updated });
  });

