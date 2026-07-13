/**
 * PR Status Slice
 *
 * Actions and reducer for PR status refresh tracking.
 * The actual PR data lives on workspace entities; this slice
 * tracks refresh metadata (loading, rate-limiting, errors).
 */

import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import type { PRStatusWorkspaceState, PRStatusState } from "./pr-status-types";

const emptyWorkspaceState: PRStatusWorkspaceState = {
  lastRefreshTime: null,
  isRefreshing: false,
  lastError: null,
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);

export { getWorkspaceState as getPRStatusWorkspaceState };

export const initialState: PRStatusState = {
  byWorkspaceId: {},
};

// ── Actions ──

/** Request a PR status refresh for a workspace */
export const refreshPRStatusRequested = createAction<
  [wsId: string, force: boolean, isManual: boolean]
>("prStatus/refreshRequested");

/** PR status refresh started (sets loading state) */
export const prStatusRefreshStarted = createAction<[wsId: string]>(
  "prStatus/refreshStarted"
);

/** PR status refresh completed */
export const prStatusRefreshCompleted = createAction(
  "prStatus/refreshCompleted",
  (wsId: string, success: boolean, error?: string) => ({ wsId, success, error, timestamp: Date.now() })
);

/** Clean up all PR status tracking for a workspace */
export const cleanupPRStatusWorkspace = createAction<[wsId: string]>(
  "prStatus/cleanupWorkspace"
);

/** Start PR polling for a workspace (saga-only trigger) */
export const startPRPolling = createAction<[wsId: string]>(
  "prStatus/startPolling"
);

/** Stop PR polling for a workspace (saga-only trigger) */
export const stopPRPolling = createAction<[wsId: string]>(
  "prStatus/stopPolling"
);

// ── Reducer ──

export const prStatusReducer = createReducer<PRStatusState>(initialState)
  .with(prStatusRefreshStarted, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      isRefreshing: true,
      lastError: null,
    });
  })
  .with(prStatusRefreshCompleted, (state, action) => {
    const { wsId, success, error } = action.payload;
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      isRefreshing: false,
      lastRefreshTime: success ? action.payload.timestamp : ws.lastRefreshTime,
      lastError: error ?? null,
    });
  })
  .with(cleanupPRStatusWorkspace, (state, { payload: [wsId] }) =>
    clearWorkspaceState(state, wsId)
  );

