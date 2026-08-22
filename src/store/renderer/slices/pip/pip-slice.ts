import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';

// ============================================================================
// Types
// ============================================================================

/**
 * State of a single PiP window
 */
interface PipWindowState {
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
// Reducer
// ============================================================================

export const pipReducer = createReducer<PipState>(initialState);
