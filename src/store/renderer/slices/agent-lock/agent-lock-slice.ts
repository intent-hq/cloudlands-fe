/**
 * Agent Lock Redux Slice — Actions & Reducer
 *
 * Tracks which agents and files are locked due to auto-commit being enabled
 * and agents actively working.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type { AgentLockState, AgentLockWorkspaceState } from './agent-lock-types';

// ---------------------------------------------------------------------------
// Empty / Initial State
// ---------------------------------------------------------------------------

const emptyWorkspaceState: AgentLockWorkspaceState = {
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
  'agentLock/recomputeAgentLocks',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const agentLockReducer = createReducer<AgentLockState>(initialState);
agentLockReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
