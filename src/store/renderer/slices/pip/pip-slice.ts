import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

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
// Reducer
// ============================================================================

export const pipReducer = createReducer<PipState>(initialState);

