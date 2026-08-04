import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import {
  createCollection,
  addItem,
  removeItem,
  updateItem,
  getItem,
  getItemIndex,
  type Collection,
} from "$lib/store-shim/utils/collections/collection-utils";
import { setScriptsData } from "../scripts/scripts-slice";

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
  /**
   * Daemon boot id from the last `terminal.list` snapshot (PROTOCOL §5.13
   * envelope). Lets the reducer tell a same-boot authoritative empty list
   * (converge to zero tabs) from a post-restart empty (preserve tabs — the
   * PTYs respawn via auto-reconnect). `null` until a boot id is seen.
   */
  daemonBootId: string | null;
  /**
   * Script whose output tab the overlay is showing, or null when a terminal
   * tab is showing. Lives here (not component $state) so the selected script
   * tab survives workspace switches/remounts. Hydration paths accept the id
   * unvalidated (scripts may not be loaded yet); once `setScriptsData` lands
   * the reducer clears a selection pointing at a missing script, and
   * `selectSelectedScriptId` additionally filters stale ids at read time.
   */
  selectedScriptId: string | null;
}

/** Persisted subset of workspace state (terminals are loaded from terminalManager) */
export interface PersistedWorkspaceState {
  isOpen: boolean;
  activeTerminalId: string | null;
  /** Optional for backward compat with entries persisted before it existed. */
  selectedScriptId?: string | null;
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
  daemonBootId: null,
  selectedScriptId: null,
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

/** Show a script's output tab in the overlay (clears on selectTerminal/addTerminal) */
export const selectScript = createAction<[wsId: string, scriptId: string]>(
  "terminals/selectScript"
);

/** Clear the selected script tab (back to the active terminal, if any) */
export const clearScriptSelection = createAction<[wsId: string]>(
  "terminals/clearScriptSelection"
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

/**
 * Load workspace terminals data (dispatched by the hydration paths after a
 * `terminal.list` fetch). `daemonBootId` is the envelope's boot id (PROTOCOL
 * §5.13); omitted for legacy bare-array responses, which the reducer treats
 * as carrying no boot metadata (empty lists then preserve existing tabs).
 */
export const loadWorkspaceTerminals = createAction<[
  wsId: string,
  terminals: TerminalTab[],
  savedState?: PersistedWorkspaceState | null,
  daemonBootId?: string,
]>("terminals/loadWorkspaceTerminals");

/** Hydrate height from localStorage (dispatched by init saga) */
export const hydrateHeight = createAction<[height: number]>(
  "terminals/hydrateHeight"
);

export const createTerminalRequested = createAction<[wsId: string]>(
  "terminals/createTerminalRequested"
);

/**
 * Fan-out trigger dispatched by the workspaceMounted fan-out
 * (`lifecycle-ipc-read-service`) so a workspace first-opened after boot
 * hydrates its terminal list via `appClient.terminals.list` — mirroring the
 * boot `terminals-scripts-seeder`. Saga-only trigger with no reducer entry
 * (see AGENTS.md §8); the handler lives in `lifecycle-read-service`.
 */
export const hydrateTerminalsRequested = createAction<[wsId: string]>(
  "terminals/hydrateTerminalsRequested"
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

/**
 * Signals a successful daemon `terminal.create` (PROTOCOL §5.13) from an
 * interactive create flow. Trigger-only action with no reducer entry (see
 * AGENTS.md §8); the handler in `lifecycle-read-service` invalidates any
 * in-flight `terminal.list` fetch (whose snapshot predates the create) and
 * starts a coalesced refetch so the store converges on the daemon list that
 * includes the new PTY.
 */
export const terminalCreated = createAction<[wsId: string]>(
  "terminals/terminalCreated"
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
      // Explicitly targeting a terminal means showing it, not a script tab.
      newWs.selectedScriptId = null;
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
      // Explicitly targeting a terminal means showing it, not a script tab.
      newWs.selectedScriptId = null;
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
    // Selecting a terminal tab always leaves the script tab (mirrors the
    // former component logic that reset selectedScriptId on every tab click).
    if (ws.activeTerminalId === termId && ws.selectedScriptId === null) return state;
    return setWs(state, wsId, { ...ws, activeTerminalId: termId, selectedScriptId: null });
  })
  .with(selectScript, (state, { payload: [wsId, scriptId] }) => {
    const ws = getWs(state, wsId);
    if (ws.selectedScriptId === scriptId) return state;
    // activeTerminalId is kept — the script tab overlays it; clearing the
    // script selection falls back to the still-active terminal.
    return setWs(state, wsId, { ...ws, selectedScriptId: scriptId });
  })
  .with(clearScriptSelection, (state, { payload: [wsId] }) => {
    const ws = getWs(state, wsId);
    if (ws.selectedScriptId === null) return state;
    return setWs(state, wsId, { ...ws, selectedScriptId: null });
  })
  .with(addTerminal, (state, { payload: [wsId, termId, name] }) => {
    const ws = getWs(state, wsId);
    const newTerminals = addTerminalIfMissing(ws.terminals, termId, name);
    return setWs(state, wsId, {
      ...ws,
      terminals: newTerminals,
      activeTerminalId: termId,
      // A newly created terminal takes over the panel (mirrors the former
      // component logic in createNewTerminal).
      selectedScriptId: null,
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
    // No explicit title must never clobber a daemon-provided name (e.g.
    // "Setup Script" from `terminal.list`) with the generic fallback.
    const name = title || existing?.name || getTerminalName(termId);
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
  .with(loadWorkspaceTerminals, (state, { payload: [wsId, terminals, savedState, daemonBootId] }) => {
    const prior = getWs(state, wsId);
    // Preserve renderer-only customName for daemon-listed tabs that survive
    // the merge — hydration replaces the collection wholesale otherwise.
    // Never across a KNOWN boot change though: a recycled PTY id on a new
    // daemon boot is a different terminal, so the old tab's custom name must
    // not resurrect onto it (mirrors the metadata-removal path). Unknown
    // boots (legacy bare-array responses) keep the preservation.
    const bootChanged =
      daemonBootId !== undefined &&
      prior.daemonBootId !== null &&
      daemonBootId !== prior.daemonBootId;
    const merged = terminals.map((t) => ({
      ...t,
      customName: bootChanged
        ? t.customName
        : getItem(prior.terminals, t.id)?.customName ?? t.customName,
    }));
    const collection = createCollection<TerminalTab, "id">("id", merged);
    // Adopt the incoming boot id when present; a legacy bare-array response
    // carries none, so the last-seen boot id is kept.
    const nextBootId = daemonBootId ?? prior.daemonBootId;
    let wsState: WorkspaceTerminalState;

    // Scripts are not part of `terminal.list`, so hydration must never drop a
    // script-tab selection: restore it from savedState when persisted there,
    // otherwise keep the in-memory one. Stale ids are filtered at read time
    // by `selectSelectedScriptId` (validated against loaded scripts).
    const selectedScriptId =
      savedState?.selectedScriptId !== undefined
        ? savedState.selectedScriptId
        : prior.selectedScriptId;

    if (terminals.length > 0) {
      let activeId: string | null;
      let isOpen: boolean;

      if (savedState) {
        isOpen = savedState.isOpen;
        activeId = (savedState.activeTerminalId && getItem(collection, savedState.activeTerminalId))
          ? savedState.activeTerminalId
          : collection.ids[0];
      } else {
        // Mid-session rehydration (workspace switch-back, post-create
        // refetch): keep the live panel open/active state — tabs are keyed
        // by daemon ids, so the prior active id stays valid when listed.
        isOpen = prior.isOpen;
        activeId = (prior.activeTerminalId && getItem(collection, prior.activeTerminalId))
          ? prior.activeTerminalId
          : collection.ids[0];
      }

      wsState = { terminals: collection, isOpen, activeTerminalId: activeId, terminalsLoaded: false, isLoadingTerminals: false, daemonBootId: nextBootId, selectedScriptId };
    } else if (prior.terminals.ids.length > 0) {
      // Empty list over existing live tabs. Converge to zero ONLY when the
      // snapshot is authoritative for the boot we already know: the daemon
      // that produced it is the same instance that owned the tabs, so every
      // PTY is genuinely gone (killed externally, e.g. via the sitter). A
      // different or unknown boot id means a daemon restart (PTYs respawn
      // via auto-reconnect) or a legacy/transient response (monorepo#1330)
      // — preserve the tabs and only adopt the new boot id. A snapshot that
      // races a `terminal.create` is handled upstream: the terminalCreated
      // trigger invalidates the in-flight fetch and refetches, so no
      // in-flight tab guard is needed here.
      const sameBootAuthoritativeEmpty =
        daemonBootId !== undefined &&
        prior.daemonBootId !== null &&
        daemonBootId === prior.daemonBootId;

      if (!sameBootAuthoritativeEmpty) {
        if (nextBootId === prior.daemonBootId) return state;
        return setWs(state, wsId, { ...prior, daemonBootId: nextBootId });
      }

      wsState = {
        ...prior,
        terminals: createCollection<TerminalTab, "id">("id"),
        activeTerminalId: null,
        // With zero terminal tabs the panel renders only when a script tab
        // holds it open (the overlay shows with isOpen && (activeTerminalId
        // || selectedScriptId)) — keep isOpen in that case; otherwise close,
        // since isOpen:true with nothing to render is a stuck state.
        isOpen:
          selectedScriptId !== null &&
          (savedState ? savedState.isOpen : prior.isOpen),
        daemonBootId: nextBootId,
        selectedScriptId,
      };
    } else {
      // Empty list over an empty workspace. Scripts are not in
      // `terminal.list`, so a script-only panel legitimately gets an empty
      // hydration here — preserve isOpen when a script tab holds the panel
      // open (monorepo#1411 flash-then-close on workspace switch-back).
      // With no script selected either, never leave isOpen:true: the panel
      // has nothing to render, creating a stuck state where the toggle
      // appears broken (first click closes an invisible panel, second click
      // finally creates a default terminal and opens it).
      wsState = {
        terminals: createCollection<TerminalTab, "id">("id"),
        activeTerminalId: null,
        isOpen:
          selectedScriptId !== null &&
          (savedState ? savedState.isOpen : prior.isOpen),
        terminalsLoaded: false,
        isLoadingTerminals: false,
        daemonBootId: nextBootId,
        selectedScriptId,
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
  // Cross-slice validation: when the scripts slice receives the workspace's
  // authoritative script list (`script.list`), a selectedScriptId pointing at
  // a script that no longer exists (deleted out-of-band, stale persisted id)
  // is cleared here — at write time — instead of relying solely on
  // `selectSelectedScriptId`'s read-time filtering. Without this, a stale id
  // keeps `isOpen:true` alive with nothing renderable (the stuck state this
  // slice otherwise guards against), because the raw id in Redux stays
  // non-null and every subsequent hydration preserves isOpen for it.
  .with(setScriptsData, (state, { payload: { wsId, scripts } }) => {
    const ws = state.workspaces[wsId];
    if (!ws?.selectedScriptId) return state;
    if (scripts.some((script) => script.id === ws.selectedScriptId)) return state;
    return setWs(state, wsId, {
      ...ws,
      selectedScriptId: null,
      // Without the script tab, the panel needs an active terminal to
      // render; close it when there is none (stuck-state guard).
      isOpen: ws.activeTerminalId !== null ? ws.isOpen : false,
    });
  });
