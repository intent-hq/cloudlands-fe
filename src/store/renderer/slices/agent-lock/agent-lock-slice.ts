/**
 * Agent Lock Redux Slice — Actions & Reducer
 *
 * Tracks which agents and files are locked due to auto-commit being enabled
 * and agents actively working.
 */

import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
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

/** Set the daemon-computed lock state for a workspace (PROTOCOL §5.19 / §6.5) */
export const setAgentLockState = createAction(
  'agentLock/setAgentLockState',
  (
    workspaceId: string,
    lockedAgentIds: Record<string, true>,
    lockedFilePaths: Record<string, true>,
    authorityContext?: string,
    fromEvent?: boolean,
  ) => ({
    workspaceId,
    ...(fromEvent ? { fromEvent } : {}),
    lockedAgentIds,
    lockedFilePaths,
    ...(authorityContext ? { authorityContext } : {}),
  }),
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const agentLockReducer = createReducer<AgentLockState>(initialState);
agentLockReducer.with(setAgentLockState, (state, action) => {
  const { workspaceId, lockedAgentIds, lockedFilePaths, authorityContext, fromEvent } =
    action.payload;
  const ws = getWorkspaceState(state, workspaceId);
  // Return same reference if nothing changed
  if (
    !fromEvent &&
    ws.lockedAgentIds === lockedAgentIds &&
    ws.lockedFilePaths === lockedFilePaths &&
    ws.authorityContext === authorityContext
  ) {
    return state;
  }
  const eventRevision =
    (ws.authorityContext === authorityContext ? (ws.eventRevision ?? 0) : 0) + (fromEvent ? 1 : 0);
  return setWorkspaceState(state, workspaceId, {
    lockedAgentIds,
    lockedFilePaths,
    ...(authorityContext ? { authorityContext, eventRevision } : {}),
  });
});
agentLockReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
