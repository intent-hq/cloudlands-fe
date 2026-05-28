import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Types
// ============================================================================

/**
 * State of a single PiP window
 */
export interface PipWindowState {
  workspaceId: string;
  tabId: string;
  tabType: string;
  windowId: number;
  panelId: string;
}

export type PipState = {
  /** Open PiP windows keyed by "workspaceId:tabId" */
  openPipWindows: Record<string, PipWindowState>;
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: PipState = {
  openPipWindows: {},
};

// ============================================================================
// Helpers
// ============================================================================

export function getPipKey(workspaceId: string, tabId: string): string {
  return `${workspaceId}:${tabId}`;
}

// ============================================================================
// Actions
// ============================================================================

/** A PiP window was opened (from IPC event) */
export const pipWindowOpened = createAction<
  [data: { workspaceId: string; tabId: string; windowId: number }]
>("pip/pipWindowOpened");

/** A PiP window was closed (from IPC event) */
export const pipWindowClosed = createAction<
  [data: { workspaceId: string; tabId: string }]
>("pip/pipWindowClosed");

/** Request to open or focus a PiP window (triggers saga) */
export const openOrFocusPip = createAction<
  [workspaceId: string, tabId: string, tabType: string, panelId: string]
>("pip/openOrFocusPip");

/** Request to close a PiP window (triggers saga) */
export const closePip = createAction<[workspaceId: string, tabId: string]>(
  "pip/closePip"
);

/** Request to close all PiP windows for a workspace (triggers saga) */
export const closeAllPipForWorkspace = createAction<[workspaceId: string]>(
  "pip/closeAllPipForWorkspace"
);

/** Request to close all PiP windows (triggers saga) */
export const closeAllPip = createAction("pip/closeAllPip");

// ============================================================================
// Reducer
// ============================================================================

export const pipReducer = createReducer<PipState>(initialState)
  .with(pipWindowOpened, (state, { payload: [data] }) => {
    const key = getPipKey(data.workspaceId, data.tabId);
    const existing = state.openPipWindows[key];
    if (existing) {
      // Update windowId on existing entry
      return {
        ...state,
        openPipWindows: {
          ...state.openPipWindows,
          [key]: { ...existing, windowId: data.windowId },
        },
      };
    }
    // Create minimal state from event
    return {
      ...state,
      openPipWindows: {
        ...state.openPipWindows,
        [key]: {
          workspaceId: data.workspaceId,
          tabId: data.tabId,
          tabType: "",
          windowId: data.windowId,
          panelId: "",
        },
      },
    };
  })
  .with(pipWindowClosed, (state, { payload: [data] }) => {
    const key = getPipKey(data.workspaceId, data.tabId);
    if (!(key in state.openPipWindows)) return state;
     
    const { [key]: _, ...rest } = state.openPipWindows;
    return {
      ...state,
      openPipWindows: rest,
    };
  });

