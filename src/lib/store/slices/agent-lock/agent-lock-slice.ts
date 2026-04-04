/**
 * Agent Lock Redux Slice — Actions & Reducer
 *
 * Tracks which agents and files are locked due to auto-commit being enabled
 * and agents actively working.
 */

import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type { AgentLockState, AgentLockWorkspaceState } from "./agent-lock-types";

// ---------------------------------------------------------------------------
// Empty / Initial State
// ---------------------------------------------------------------------------

export const emptyWorkspaceState: AgentLockWorkspaceState = {
  lockedAgentIds: {},
  lockedFilePaths: {},
};

export const initialState: AgentLockState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Trigger recomputation of agent locks for a workspace */
export const recomputeAgentLocks = createAction<[workspaceId: string]>(
  "agentLock/recomputeAgentLocks",
);

/** Set the computed lock state for a workspace */
export const setAgentLockState = createAction(
  "agentLock/setAgentLockState",
  (workspaceId: string, lockedAgentIds: Record<string, true>, lockedFilePaths: Record<string, true>) => ({
    workspaceId,
    lockedAgentIds,
    lockedFilePaths,
  }),
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const agentLockReducer = createReducer<AgentLockState>(initialState)
  .with(setAgentLockState, (state, action) => {
    const { workspaceId, lockedAgentIds, lockedFilePaths } = action.payload;
    const ws = getWorkspaceState(state, workspaceId);
    // Return same reference if nothing changed
    if (ws.lockedAgentIds === lockedAgentIds && ws.lockedFilePaths === lockedFilePaths) {
      return state;
    }
    return setWorkspaceState(state, workspaceId, {
      lockedAgentIds,
      lockedFilePaths,
    });
  })
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));

