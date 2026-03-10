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
}

export type TerminalOverlayState = {
  isOpen: boolean;
  height: number;
  workspaceId: string | null;
  activeTerminalId: string | null;
  terminals: TerminalTab[];
};

// ============================================================================
// Initial State
// ============================================================================

const initialState: TerminalOverlayState = {
  isOpen: false,
  height: DEFAULT_HEIGHT,
  workspaceId: null,
  activeTerminalId: null,
  terminals: [],
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

export const openTerminalOverlay = createAction<[wsId?: string, termId?: string]>(
  "terminalOverlay/open"
);

export const closeTerminalOverlay = createAction("terminalOverlay/close");

export const toggleTerminalOverlay = createAction<[wsId?: string, termId?: string]>(
  "terminalOverlay/toggle"
);

export const selectTerminal = createAction<[termId: string]>(
  "terminalOverlay/selectTerminal"
);

export const addTerminal = createAction<[termId: string, name?: string]>(
  "terminalOverlay/addTerminal"
);

export const removeTerminal = createAction<[termId: string]>(
  "terminalOverlay/removeTerminal"
);

export const setTerminalOverlayHeight = createAction<[height: number]>(
  "terminalOverlay/setHeight"
);

export const setTerminalOverlayWorkspace = createAction<[wsId: string]>(
  "terminalOverlay/setWorkspace"
);

export const renameTerminal = createAction<[termId: string, newName: string]>(
  "terminalOverlay/renameTerminal"
);

export const updateTerminalName = createAction<[termId: string, name: string]>(
  "terminalOverlay/updateTerminalName"
);

export const syncTerminals = createAction<[terminalList: Array<{ id: string; name?: string; title?: string }>]>(
  "terminalOverlay/syncTerminals"
);

/** Load workspace terminals data (dispatched by sagas after loading from storage) */
export const loadWorkspaceTerminals = createAction<[
  wsId: string,
  terminals: TerminalTab[],
  savedState?: WorkspaceTerminalState | null,
]>("terminalOverlay/loadWorkspaceTerminals");

/** Hydrate height from localStorage (dispatched by init saga) */
export const hydrateHeight = createAction<[height: number]>(
  "terminalOverlay/hydrateHeight"
);

/** Hydrate custom names from localStorage */
export const hydrateCustomNames = createAction<[names: Record<string, string>]>(
  "terminalOverlay/hydrateCustomNames"
);

// ============================================================================
// Reducer helpers
// ============================================================================

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
    let newState = { ...state };

    if (wsId) {
      newState.workspaceId = wsId;
      if (termId) {
        newState.terminals = addTerminalIfMissing(state.terminals, termId);
        newState.activeTerminalId = termId;
      } else if (!state.activeTerminalId || !state.terminals.some((t) => t.id === state.activeTerminalId)) {
        const result = ensureDefaultTerminal(state.terminals, wsId);
        newState.terminals = result.terminals;
        newState.activeTerminalId = result.defaultId;
      }
    }

    newState.isOpen = true;
    return newState;
  })
  .with(closeTerminalOverlay, (state) => {
    if (!state.isOpen) return state;
    return { ...state, isOpen: false };
  })
  .with(toggleTerminalOverlay, (state, { payload: [wsId, termId] }) => {
    if (state.isOpen && !termId) {
      return { ...state, isOpen: false };
    }
    // Delegate to open logic
    let newState = { ...state };
    if (wsId) {
      newState.workspaceId = wsId;
      if (termId) {
        newState.terminals = addTerminalIfMissing(state.terminals, termId);
        newState.activeTerminalId = termId;
      } else if (!state.activeTerminalId || !state.terminals.some((t) => t.id === state.activeTerminalId)) {
        const result = ensureDefaultTerminal(state.terminals, wsId);
        newState.terminals = result.terminals;
        newState.activeTerminalId = result.defaultId;
      }
    }
    newState.isOpen = true;
    return newState;
  })
  .with(selectTerminal, (state, { payload: [termId] }) => {
    if (!state.terminals.some((t) => t.id === termId)) return state;
    if (state.activeTerminalId === termId) return state;
    return { ...state, activeTerminalId: termId };
  })
  .with(addTerminal, (state, { payload: [termId, name] }) => {
    const newTerminals = addTerminalIfMissing(state.terminals, termId, name);
    return {
      ...state,
      terminals: newTerminals,
      activeTerminalId: termId,
    };
  })
  .with(removeTerminal, (state, { payload: [termId] }) => {
    const index = state.terminals.findIndex((t) => t.id === termId);
    if (index === -1) return state;

    const newTerminals = state.terminals.filter((t) => t.id !== termId);
    let newActiveId = state.activeTerminalId;

    if (state.activeTerminalId === termId) {
      if (newTerminals.length > 0) {
        const newIndex = Math.min(index, newTerminals.length - 1);
        newActiveId = newTerminals[newIndex].id;
      } else {
        newActiveId = null;
      }
    }

    return { ...state, terminals: newTerminals, activeTerminalId: newActiveId };
  })
  .with(setTerminalOverlayHeight, (state, { payload: [height] }) => {
    const clamped = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height));
    if (clamped === state.height) return state;
    return { ...state, height: clamped };
  })
  .with(setTerminalOverlayWorkspace, (state, { payload: [wsId] }) => {
    if (state.workspaceId === wsId) return state;
    // Just update workspaceId. Saga will dispatch loadWorkspaceTerminals with loaded data.
    return { ...state, workspaceId: wsId };
  })
  .with(renameTerminal, (state, { payload: [termId, newName] }) => {
    const trimmedName = newName.trim() || undefined;
    if (!state.terminals.some((t) => t.id === termId)) return state;
    return {
      ...state,
      terminals: state.terminals.map((t) =>
        t.id === termId ? { ...t, customName: trimmedName } : t
      ),
    };
  })
  .with(updateTerminalName, (state, { payload: [termId, name] }) => {
    if (!state.terminals.some((t) => t.id === termId)) return state;
    return {
      ...state,
      terminals: state.terminals.map((t) =>
        t.id === termId ? { ...t, name } : t
      ),
    };
  })
  .with(syncTerminals, (state, { payload: [terminalList] }) => {
    const newTerminals = terminalList.map((t) => ({
      id: t.id,
      name: t.name || t.title || getTerminalName(t.id),
      customName: state.terminals.find((existing) => existing.id === t.id)?.customName,
    }));

    let newActiveId = state.activeTerminalId;
    if (newActiveId && !newTerminals.some((t) => t.id === newActiveId)) {
      newActiveId = newTerminals.length > 0 ? newTerminals[0].id : null;
    }

    return { ...state, terminals: newTerminals, activeTerminalId: newActiveId };
  })
  .with(loadWorkspaceTerminals, (state, { payload: [wsId, terminals, savedState] }) => {
    let newState: TerminalOverlayState;

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

      newState = {
        ...state,
        workspaceId: wsId,
        terminals,
        isOpen,
        activeTerminalId: activeId,
      };
    } else {
      newState = {
        ...state,
        workspaceId: wsId,
        terminals: [],
        activeTerminalId: null,
        isOpen: savedState?.isOpen ?? false,
      };
    }

    return newState;
  })
  .with(hydrateHeight, (state, { payload: [height] }) => {
    if (height < MIN_HEIGHT || height > MAX_HEIGHT) return state;
    return { ...state, height };
  })
  .with(hydrateCustomNames, (state, { payload: [names] }) => {
    // Apply custom names to existing terminals
    const hasTerminals = state.terminals.length > 0;
    if (!hasTerminals) return state;

    const updated = state.terminals.map((t) => {
      const customName = names[t.id];
      if (customName && customName !== t.customName) {
        return { ...t, customName };
      }
      return t;
    });

    return { ...state, terminals: updated };
  });

