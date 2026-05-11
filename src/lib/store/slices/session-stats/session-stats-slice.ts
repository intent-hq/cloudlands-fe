/**
 * Session Stats Slice
 *
 * Actions and reducer for session credit usage statistics.
 */

import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { omitKey } from "../../utils/utils";
import { removeAgent } from "../workspace-agents/workspace-agents-slice";
import type {
  SessionStatsState,
  AgentSessionStats,
  WorkspaceAggregateStats,
  WorkspaceStatsSessionRequest,
} from "./session-stats-types";

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------

export const initialState: SessionStatsState = {
  agentStats: {},
  workspaceStats: {},
  loadingWorkspaceStats: {},
  loadingAgentStats: {},
  workspaceStatsErrors: {},
  agentStatsErrors: {},
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Request workspace-level aggregate stats */
export const fetchWorkspaceStats = createAction<[
  wsId: string,
  sessionRequests: WorkspaceStatsSessionRequest[] | string[],
  refreshSessionIds?: string[],
]>(
  "sessionStats/fetchWorkspaceStats",
);

/** Workspace stats received successfully */
export const workspaceStatsReceived = createAction<[wsId: string, stats: WorkspaceAggregateStats]>(
  "sessionStats/workspaceStatsReceived",
);

/** Workspace stats fetch failed */
export const workspaceStatsFailed = createAction<[wsId: string, error: string]>(
  "sessionStats/workspaceStatsFailed",
);

/** Request stats for a specific agent */
export const fetchAgentStats = createAction<[agentId: string, sessionId: string]>(
  "sessionStats/fetchAgentStats",
);

/** Agent stats received successfully */
export const agentStatsReceived = createAction<[agentId: string, stats: AgentSessionStats]>(
  "sessionStats/agentStatsReceived",
);

/** Agent stats fetch failed */
export const agentStatsFailed = createAction<[agentId: string, error: string]>(
  "sessionStats/agentStatsFailed",
);

/** Clear all stats for a workspace (on workspace unmount) */
export const clearSessionStats = createAction<[wsId: string]>(
  "sessionStats/clearSessionStats",
);

/** Clear loading/error state for a specific agent (used when cancelling in-flight fetches) */
export const clearAgentStatsLoading = createAction<[agentId: string]>(
  "sessionStats/clearAgentStatsLoading",
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const sessionStatsReducer = createReducer<SessionStatsState>(initialState)
  .with(fetchWorkspaceStats, (state, { payload: [wsId] }) => ({
    ...state,
    loadingWorkspaceStats: { ...state.loadingWorkspaceStats, [wsId]: true },
    workspaceStatsErrors: omitKey(state.workspaceStatsErrors, wsId),
  }))
  .with(workspaceStatsReceived, (state, { payload: [wsId, stats] }) => ({
    ...state,
    workspaceStats: { ...state.workspaceStats, [wsId]: stats },
    loadingWorkspaceStats: omitKey(state.loadingWorkspaceStats, wsId),
    workspaceStatsErrors: omitKey(state.workspaceStatsErrors, wsId),
  }))
  .with(workspaceStatsFailed, (state, { payload: [wsId, error] }) => ({
    ...state,
    loadingWorkspaceStats: omitKey(state.loadingWorkspaceStats, wsId),
    workspaceStatsErrors: { ...state.workspaceStatsErrors, [wsId]: error },
  }))
  .with(fetchAgentStats, (state, { payload: [agentId] }) => ({
    ...state,
    loadingAgentStats: { ...state.loadingAgentStats, [agentId]: true },
    agentStatsErrors: omitKey(state.agentStatsErrors, agentId),
  }))
  .with(agentStatsReceived, (state, { payload: [agentId, stats] }) => ({
    ...state,
    agentStats: { ...state.agentStats, [agentId]: stats },
    loadingAgentStats: omitKey(state.loadingAgentStats, agentId),
  }))
  .with(agentStatsFailed, (state, { payload: [agentId, error] }) => ({
    ...state,
    loadingAgentStats: omitKey(state.loadingAgentStats, agentId),
    agentStatsErrors: { ...state.agentStatsErrors, [agentId]: error },
  }))
  .with(clearSessionStats, (state, { payload: [wsId] }) => ({
    ...state,
    workspaceStats: omitKey(state.workspaceStats, wsId),
    loadingWorkspaceStats: omitKey(state.loadingWorkspaceStats, wsId),
    workspaceStatsErrors: omitKey(state.workspaceStatsErrors, wsId),
    // Agent stats are not workspace-keyed, so keep them; they are pruned on removeAgent
  }))
  .with(clearAgentStatsLoading, (state, { payload: [agentId] }) => ({
    ...state,
    loadingAgentStats: omitKey(state.loadingAgentStats, agentId),
    agentStatsErrors: omitKey(state.agentStatsErrors, agentId),
  }))
  .with(removeAgent, (state, { payload: [, agentId] }) => ({
    ...state,
    agentStats: omitKey(state.agentStats, agentId),
    loadingAgentStats: omitKey(state.loadingAgentStats, agentId),
    agentStatsErrors: omitKey(state.agentStatsErrors, agentId),
  }));
