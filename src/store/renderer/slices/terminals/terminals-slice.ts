import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  addItem,
  removeItem,
  updateItem,
  getItem,
  getItemIndex,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import {
  DEFAULT_TERMINAL_OVERLAY_HEIGHT,
  clampTerminalOverlayHeight,
  isValidTerminalOverlayHeight,
} from '$shared/utils/terminal-overlay-height';
import { setScriptsData } from '../scripts/scripts-slice';

// ============================================================================
// Constants
// ============================================================================

/** Legacy global height key; still read as the fallback for never-resized workspaces. */
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

/** Surface a terminal or script output was last shown on. */
export type TerminalPlacement = 'overlay' | 'panel';

export const DEFAULT_TERMINAL_PLACEMENT: TerminalPlacement = 'overlay';

export interface WorkspaceTerminalState {
  isOpen: boolean;
  activeTerminalId: string | null;
  terminals: Collection<TerminalTab, 'id'>;
  terminalsLoaded: boolean;
  isLoadingTerminals: boolean;
  recentlyCreatedTerminals: string[];
  /**
   * Script whose output tab the overlay is showing, or null when a terminal
   * tab is showing. Lives here so the selected script tab survives workspace
   * switches/remounts. Hydration accepts the id unvalidated until scripts load.
   */
  selectedScriptId: string | null;
  /**
   * Daemon boot id from the last `terminal.list` snapshot (PROTOCOL §5.13
   * envelope). Lets the reducer tell a same-boot authoritative empty list
   * (converge to zero tabs) from a post-restart empty (preserve tabs — the
   * PTYs respawn via auto-reconnect). `null` until a boot id is seen.
   */
  daemonBootId: string | null;
  /**
   * Last surface each terminal (keyed by terminal id) or script output (keyed
   * by script id) was shown on, so the Shell sidebar reopens it there. Missing
   * entries read as `'overlay'`.
   */
  placements: Record<string, TerminalPlacement>;
}

/** Persisted subset of workspace state (terminals are loaded from terminalManager) */
export interface PersistedWorkspaceState {
  isOpen: boolean;
  activeTerminalId: string | null;
  /** Optional for backward compat with entries persisted before it existed. */
  selectedScriptId?: string | null;
  /** Optional for backward compat with entries persisted before it existed. */
  height?: number;
  /** Optional for backward compat with entries persisted before it existed. */
  placements?: Record<string, TerminalPlacement>;
}

export type TerminalOverlayState = {
  /** Fallback height for workspaces without their own (legacy global value or default). */
  height: number;
  /**
   * Per-workspace overlay heights in vh. Kept outside `workspaces` so boot
   * hydration never materializes a workspace entry — persistence relies on the
   * `emptyWorkspaceState` identity to skip not-yet-loaded workspaces.
   */
  workspaceHeights: Record<string, number>;
  /**
   * Stored placements per workspace, hydrated at boot and consumed by the
   * workspace's first `loadWorkspaceTerminals`. Kept outside `workspaces` for
   * the same reason as `workspaceHeights`.
   */
  workspacePlacements: Record<string, Record<string, TerminalPlacement>>;
  workspaces: Record<string, WorkspaceTerminalState>;
};

// ============================================================================
// Initial State
// ============================================================================

export const emptyWorkspaceState: WorkspaceTerminalState = {
  isOpen: false,
  activeTerminalId: null,
  terminals: createCollection<TerminalTab, 'id'>('id'),
  terminalsLoaded: false,
  isLoadingTerminals: false,
  recentlyCreatedTerminals: [],
  selectedScriptId: null,
  daemonBootId: null,
  placements: {},
};

const initialState: TerminalOverlayState = {
  height: DEFAULT_TERMINAL_OVERLAY_HEIGHT,
  workspaceHeights: {},
  workspacePlacements: {},
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

export const openTerminalOverlay = createAction<[wsId: string, termId?: string]>('terminals/open');

export const closeTerminalOverlay = createAction<[wsId: string]>('terminals/close');

export const toggleTerminalOverlay =
  createAction<[wsId: string, termId?: string]>('terminals/toggle');

export const selectTerminal = createAction<[wsId: string, termId: string]>(
  'terminals/selectTerminal',
);

export const selectScript =
  createAction<[wsId: string, scriptId: string]>('terminals/selectScript');

export const clearScriptSelection = createAction<[wsId: string]>('terminals/clearScriptSelection');

/** Record the surface a terminal (`id` = terminal id) or script (`id` = script id) was shown on. */
export const setTerminalPlacement =
  createAction<[wsId: string, id: string, placement: TerminalPlacement]>('terminals/setPlacement');

export const addTerminal =
  createAction<[wsId: string, termId: string, name?: string]>('terminals/addTerminal');

export const removeTerminal = createAction<[wsId: string, termId: string]>(
  'terminals/removeTerminal',
);

export const setTerminalOverlayHeight =
  createAction<[wsId: string, height: number]>('terminals/setHeight');

export const renameTerminal = createAction<[wsId: string, termId: string, newName: string]>(
  'terminals/renameTerminal',
);

export const saveTerminalMetadata = createAction<
  [wsId: string, termId: string, title: string | undefined, createdAt: string]
>('terminals/saveTerminalMetadata');

/**
 * Load workspace terminals data (dispatched by the hydration paths after a
 * `terminal.list` fetch). `daemonBootId` is the envelope's boot id (PROTOCOL
 * §5.13); omitted for legacy bare-array responses, which the reducer treats
 * as carrying no boot metadata (empty lists then preserve existing tabs).
 */
export const loadWorkspaceTerminals = createAction<
  [
    wsId: string,
    terminals: TerminalTab[],
    savedState?: PersistedWorkspaceState | null,
    daemonBootId?: string,
  ]
>('terminals/loadWorkspaceTerminals');

/**
 * Hydrate heights from localStorage (dispatched by init saga): the legacy
 * global value becomes the fallback, `workspaceHeights` seeds per-workspace
 * heights. Out-of-range entries are ignored individually.
 */
export const hydrateHeight =
  createAction<[height: number, workspaceHeights?: Record<string, number>]>(
    'terminals/hydrateHeight',
  );

/**
 * Hydrate stored placements per workspace from localStorage (dispatched by
 * init saga). Each workspace consumes its entry on its first terminal load.
 */
export const hydratePlacements = createAction<
  [workspacePlacements: Record<string, Record<string, TerminalPlacement>>]
>('terminals/hydratePlacements');

export const createTerminalRequested = createAction<[wsId: string]>(
  'terminals/createTerminalRequested',
);

/**
 * Fan-out trigger dispatched by the workspaceMounted fan-out
 * (`lifecycle-ipc-read-service`) so a workspace first-opened after boot
 * hydrates its terminal list via `appClient.terminals.list` — mirroring the
 * boot `terminals-scripts-seeder`. Saga-only trigger with no reducer entry
 * (see AGENTS.md §8); the handler lives in `lifecycle-read-service`.
 */
export const hydrateTerminalsRequested = createAction<[wsId: string]>(
  'terminals/hydrateTerminalsRequested',
);

export const closeActiveTerminalRequested = createAction<[wsId: string]>(
  'terminals/closeActiveTerminalRequested',
);

// ============================================================================
// Reducer helpers
// ============================================================================

function getWs(state: TerminalOverlayState, wsId: string): WorkspaceTerminalState {
  return state.workspaces[wsId] || emptyWorkspaceState;
}

function setWs(
  state: TerminalOverlayState,
  wsId: string,
  ws: WorkspaceTerminalState,
): TerminalOverlayState {
  return { ...state, workspaces: { ...state.workspaces, [wsId]: ws } };
}

function setWsHeight(
  state: TerminalOverlayState,
  wsId: string,
  height: number,
): TerminalOverlayState {
  if (state.workspaceHeights[wsId] === height) return state;
  return { ...state, workspaceHeights: { ...state.workspaceHeights, [wsId]: height } };
}

function ensureDefaultTerminal(
  terminals: Collection<TerminalTab, 'id'>,
  wsId: string,
  customNames?: Record<string, string>,
): { terminals: Collection<TerminalTab, 'id'>; defaultId: string } {
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

function addTerminalIfMissing(
  terminals: Collection<TerminalTab, 'id'>,
  termId: string,
  name?: string,
  customName?: string,
  metadata?: Partial<TerminalTab>,
): Collection<TerminalTab, 'id'> {
  if (getItem(terminals, termId)) return terminals;
  return addItem(terminals, {
    id: termId,
    name: name || getTerminalName(termId),
    customName,
    ...metadata,
  });
}

function withPlacement(
  placements: Record<string, TerminalPlacement>,
  id: string | null,
  placement: TerminalPlacement,
): Record<string, TerminalPlacement> {
  if (!id || placements[id] === placement) return placements;
  return { ...placements, [id]: placement };
}

function withoutPlacement(
  placements: Record<string, TerminalPlacement>,
  id: string,
): Record<string, TerminalPlacement> {
  if (!(id in placements)) return placements;
  const { [id]: _removed, ...rest } = placements;
  return rest;
}

function consumeHydratedPlacements(
  state: TerminalOverlayState,
  wsId: string,
): TerminalOverlayState {
  const { [wsId]: _consumed, ...workspacePlacements } = state.workspacePlacements;
  return { ...state, workspacePlacements };
}

// ============================================================================
// Reducer
// ============================================================================

export const terminalsReducer = createReducer<TerminalOverlayState>(initialState);
terminalsReducer.with(openTerminalOverlay, (state, { payload: [wsId, termId] }) => {
  const ws = getWs(state, wsId);
  const newWs = { ...ws };

  if (termId) {
    newWs.terminals = addTerminalIfMissing(ws.terminals, termId);
    newWs.activeTerminalId = termId;
    newWs.selectedScriptId = null;
  } else if (!ws.activeTerminalId || !getItem(ws.terminals, ws.activeTerminalId)) {
    const result = ensureDefaultTerminal(ws.terminals, wsId);
    newWs.terminals = result.terminals;
    newWs.activeTerminalId = result.defaultId;
  }

  // The overlay shows the selected script when one is set, else the active terminal.
  newWs.placements = withPlacement(
    ws.placements,
    newWs.selectedScriptId ?? newWs.activeTerminalId,
    'overlay',
  );
  newWs.isOpen = true;
  return setWs(state, wsId, newWs);
});
terminalsReducer.with(setTerminalPlacement, (state, { payload: [wsId, id, placement] }) => {
  const ws = getWs(state, wsId);
  const placements = withPlacement(ws.placements, id, placement);
  if (placements === ws.placements) return state;
  return setWs(state, wsId, { ...ws, placements });
});
terminalsReducer.with(closeTerminalOverlay, (state, { payload: [wsId] }) => {
  const ws = getWs(state, wsId);
  if (!ws.isOpen) return state;
  return setWs(state, wsId, { ...ws, isOpen: false });
});
terminalsReducer.with(toggleTerminalOverlay, (state, { payload: [wsId, termId] }) => {
  const ws = getWs(state, wsId);
  if (ws.isOpen && !termId) {
    return setWs(state, wsId, { ...ws, isOpen: false });
  }
  // Delegate to open logic
  const newWs = { ...ws };
  if (termId) {
    newWs.terminals = addTerminalIfMissing(ws.terminals, termId);
    newWs.activeTerminalId = termId;
    newWs.selectedScriptId = null;
  } else if (!ws.activeTerminalId || !getItem(ws.terminals, ws.activeTerminalId)) {
    const result = ensureDefaultTerminal(ws.terminals, wsId);
    newWs.terminals = result.terminals;
    newWs.activeTerminalId = result.defaultId;
  }
  newWs.placements = withPlacement(
    ws.placements,
    newWs.selectedScriptId ?? newWs.activeTerminalId,
    'overlay',
  );
  newWs.isOpen = true;
  return setWs(state, wsId, newWs);
});
// Selecting inside an open overlay shows the target there, so it counts as an overlay placement.
terminalsReducer.with(selectTerminal, (state, { payload: [wsId, termId] }) => {
  const ws = getWs(state, wsId);
  if (!getItem(ws.terminals, termId)) return state;
  const placements = ws.isOpen ? withPlacement(ws.placements, termId, 'overlay') : ws.placements;
  if (
    ws.activeTerminalId === termId &&
    ws.selectedScriptId === null &&
    placements === ws.placements
  ) {
    return state;
  }
  return setWs(state, wsId, {
    ...ws,
    activeTerminalId: termId,
    selectedScriptId: null,
    placements,
  });
});
terminalsReducer.with(selectScript, (state, { payload: [wsId, scriptId] }) => {
  const ws = getWs(state, wsId);
  const placements = ws.isOpen ? withPlacement(ws.placements, scriptId, 'overlay') : ws.placements;
  if (ws.selectedScriptId === scriptId && placements === ws.placements) return state;
  return setWs(state, wsId, { ...ws, selectedScriptId: scriptId, placements });
});
terminalsReducer.with(clearScriptSelection, (state, { payload: [wsId] }) => {
  const ws = getWs(state, wsId);
  if (ws.selectedScriptId === null) return state;
  return setWs(state, wsId, { ...ws, selectedScriptId: null });
});
terminalsReducer.with(addTerminal, (state, { payload: [wsId, termId, name] }) => {
  const ws = getWs(state, wsId);
  const newTerminals = addTerminalIfMissing(ws.terminals, termId, name);
  return setWs(state, wsId, {
    ...ws,
    terminals: newTerminals,
    activeTerminalId: termId,
    selectedScriptId: null,
  });
});
terminalsReducer.with(removeTerminal, (state, { payload: [wsId, termId] }) => {
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

  return setWs(state, wsId, {
    ...ws,
    terminals: newTerminals,
    activeTerminalId: newActiveId,
    isOpen,
    placements: withoutPlacement(ws.placements, termId),
  });
});
terminalsReducer.with(setTerminalOverlayHeight, (state, { payload: [wsId, height] }) => {
  if (!Number.isFinite(height)) return state;
  return setWsHeight(state, wsId, clampTerminalOverlayHeight(height));
});
terminalsReducer.with(renameTerminal, (state, { payload: [wsId, termId, newName] }) => {
  const ws = getWs(state, wsId);
  const trimmedName = newName.trim() || undefined;
  if (!getItem(ws.terminals, termId)) return state;
  return setWs(state, wsId, {
    ...ws,
    terminals: updateItem(ws.terminals, { id: termId, customName: trimmedName }),
  });
});
terminalsReducer.with(
  saveTerminalMetadata,
  (state, { payload: [wsId, termId, title, createdAt] }) => {
    const ws = getWs(state, wsId);
    const existing = getItem(ws.terminals, termId);
    // No explicit title must never clobber a daemon-provided name (e.g.
    // "Setup Script" from `terminal.list`) with the generic fallback.
    const name = title || existing?.name || getTerminalName(termId);
    const terminal: TerminalTab = {
      ...(existing ?? { id: termId }),
      id: termId,
      name,
      type: existing?.type ?? 'terminal',
      workspaceId: wsId,
      createdAt: existing?.createdAt ?? createdAt,
    };

    const terminals = existing
      ? updateItem(ws.terminals, terminal)
      : addItem(ws.terminals, terminal);

    return setWs(state, wsId, { ...ws, terminals });
  },
);
terminalsReducer.with(
  loadWorkspaceTerminals,
  (rawState, { payload: [wsId, terminals, savedState, daemonBootId] }) => {
    const withHeight =
      savedState?.height !== undefined && isValidTerminalOverlayHeight(savedState.height)
        ? setWsHeight(rawState, wsId, savedState.height)
        : rawState;
    // The hydrated entry seeds the first load (in-memory changes win), then
    // the loaded workspace state is authoritative.
    const hydrated = withHeight.workspacePlacements[wsId];
    const state = hydrated ? consumeHydratedPlacements(withHeight, wsId) : withHeight;
    const collection = createCollection<TerminalTab, 'id'>('id', terminals);
    const prior = getWs(state, wsId);
    const nextBootId = daemonBootId ?? prior.daemonBootId;
    let wsState: WorkspaceTerminalState;
    const selectedScriptId =
      (savedState?.selectedScriptId !== undefined
        ? savedState.selectedScriptId
        : prior.selectedScriptId) ?? null;
    const placements =
      savedState?.placements ??
      (hydrated ? { ...hydrated, ...prior.placements } : prior.placements);

    if (terminals.length > 0) {
      let activeId: string | null;
      let isOpen: boolean;

      if (savedState) {
        isOpen = savedState.isOpen;
        activeId =
          savedState.activeTerminalId && getItem(collection, savedState.activeTerminalId)
            ? savedState.activeTerminalId
            : collection.ids[0];
      } else {
        isOpen = prior.isOpen;
        activeId =
          prior.activeTerminalId && getItem(collection, prior.activeTerminalId)
            ? prior.activeTerminalId
            : collection.ids[0];
      }

      wsState = {
        terminals: collection,
        isOpen,
        activeTerminalId: activeId,
        terminalsLoaded: false,
        isLoadingTerminals: false,
        recentlyCreatedTerminals: [],
        selectedScriptId,
        daemonBootId: nextBootId,
        placements,
      };
    } else if (prior.terminals.ids.length > 0) {
      const sameBootAuthoritativeEmpty =
        daemonBootId !== undefined &&
        prior.daemonBootId !== null &&
        daemonBootId === prior.daemonBootId;

      if (!sameBootAuthoritativeEmpty) {
        if (nextBootId === prior.daemonBootId && placements === prior.placements) return state;
        return setWs(state, wsId, { ...prior, daemonBootId: nextBootId, placements });
      }

      const kept = prior.terminals.ids
        .filter((id) => prior.recentlyCreatedTerminals.includes(id))
        .map((id) => getItem(prior.terminals, id))
        .filter((tab): tab is TerminalTab => tab !== undefined);
      const keptCollection = createCollection<TerminalTab, 'id'>('id', kept);
      const activeId =
        prior.activeTerminalId && getItem(keptCollection, prior.activeTerminalId)
          ? prior.activeTerminalId
          : (keptCollection.ids[0] ?? null);
      wsState = {
        ...prior,
        terminals: keptCollection,
        activeTerminalId: activeId,
        isOpen:
          keptCollection.ids.length > 0
            ? prior.isOpen
            : selectedScriptId !== null && (savedState ? savedState.isOpen : prior.isOpen),
        selectedScriptId,
        daemonBootId: nextBootId,
        placements,
      };
    } else {
      // Don't restore isOpen when there are no terminals — the panel
      // requires activeTerminalId to render, so isOpen:true with no
      // terminals creates a stuck state where the toggle appears broken
      // (first click closes an invisible panel, second click finally
      // creates a default terminal and opens it).
      wsState = {
        terminals: createCollection<TerminalTab, 'id'>('id'),
        activeTerminalId: null,
        isOpen: selectedScriptId !== null && (savedState ? savedState.isOpen : prior.isOpen),
        terminalsLoaded: false,
        isLoadingTerminals: false,
        recentlyCreatedTerminals: [],
        selectedScriptId,
        daemonBootId: nextBootId,
        placements,
      };
    }

    return setWs(state, wsId, wsState);
  },
);
terminalsReducer.with(hydrateHeight, (state, { payload: [height, workspaceHeights] }) => {
  let next = state;
  if (isValidTerminalOverlayHeight(height) && height !== state.height) {
    next = { ...next, height };
  }
  for (const [wsId, wsHeight] of Object.entries(workspaceHeights ?? {})) {
    if (!isValidTerminalOverlayHeight(wsHeight)) continue;
    next = setWsHeight(next, wsId, wsHeight);
  }
  return next;
});
terminalsReducer.with(hydratePlacements, (state, { payload: [workspacePlacements] }) => {
  if (Object.keys(workspacePlacements).length === 0) return state;
  return {
    ...state,
    workspacePlacements: { ...state.workspacePlacements, ...workspacePlacements },
  };
});

terminalsReducer.with(setScriptsData, (state, { payload: { wsId, scripts } }) => {
  const ws = state.workspaces[wsId];
  if (!ws?.selectedScriptId) return state;
  if (scripts.some((script) => script.id === ws.selectedScriptId)) return state;
  return setWs(state, wsId, {
    ...ws,
    selectedScriptId: null,
    isOpen: ws.activeTerminalId !== null ? ws.isOpen : false,
  });
});
