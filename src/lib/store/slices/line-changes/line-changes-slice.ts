/**
 * Line Changes Slice
 *
 * Redux slice for tracking line change statistics across workspaces and agents.
 */

import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import type {
  LineChangesState,
  LineChangeStats,
  FileLineChange,
} from "./line-changes-types";

// ============================================================================
// Initial State
// ============================================================================

export const initialState: LineChangesState = {
  workspaceStats: {},
  agentStats: {},
  fileChanges: {},
};

// ============================================================================
// Actions
// ============================================================================

/** Update workspace stats (merge with existing) */
export const updateWorkspaceStats = createAction(
  "lineChanges/updateWorkspaceStats",
  (workspaceId: string, stats: LineChangeStats) => ({ workspaceId, stats }),
);

/** Update agent stats (merge with existing) */
export const updateAgentStats = createAction(
  "lineChanges/updateAgentStats",
  (agentId: string, stats: LineChangeStats) => ({ agentId, stats }),
);

/** Track file changes for a workspace or agent, and compute aggregate stats */
export const trackFileChanges = createAction(
  "lineChanges/trackFileChanges",
  (id: string, changes: FileLineChange[]) => ({ id, changes, timestamp: new Date().toISOString() }),
);

/** Clear workspace stats and file changes */
export const clearWorkspaceStats = createAction<[workspaceId: string]>(
  "lineChanges/clearWorkspaceStats",
);

/** Clear agent stats and file changes */
export const clearAgentStats = createAction<[agentId: string]>(
  "lineChanges/clearAgentStats",
);

/** Hydrate workspace stats from main process (bulk) */
export const hydrateAllWorkspaceStats = createAction<
  [stats: Record<string, LineChangeStats>]
>("lineChanges/hydrateAllWorkspaceStats");

// ============================================================================
// Reducer
// ============================================================================

export const lineChangesReducer = createReducer<LineChangesState>(initialState)
  .with(updateWorkspaceStats, (state, { payload }) => ({
    ...state,
    workspaceStats: {
      ...state.workspaceStats,
      [payload.workspaceId]: payload.stats,
    },
  }))
  .with(updateAgentStats, (state, { payload }) => ({
    ...state,
    agentStats: {
      ...state.agentStats,
      [payload.agentId]: payload.stats,
    },
  }))
  .with(trackFileChanges, (state, { payload }) => {
    const { id, changes, timestamp } = payload;
    const isAgentId = id.startsWith("agent-");

    // Calculate aggregate stats
    const stats = changes.reduce(
      (acc, change) => ({
        additions: acc.additions + change.additions,
        deletions: acc.deletions + change.deletions,
      }),
      { additions: 0, deletions: 0 },
    );

    const lineStats: LineChangeStats = { ...stats, timestamp };

    return {
      ...state,
      fileChanges: { ...state.fileChanges, [id]: changes },
      ...(isAgentId
        ? { agentStats: { ...state.agentStats, [id]: lineStats } }
        : { workspaceStats: { ...state.workspaceStats, [id]: lineStats } }),
    };
  })
  .with(clearWorkspaceStats, (state, { payload: [workspaceId] }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [workspaceId]: _ws, ...remainingWorkspaceStats } =
      state.workspaceStats;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [workspaceId]: _fc, ...remainingFileChanges } = state.fileChanges;
    return {
      ...state,
      workspaceStats: remainingWorkspaceStats,
      fileChanges: remainingFileChanges,
    };
  })
  .with(clearAgentStats, (state, { payload: [agentId] }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [agentId]: _as, ...remainingAgentStats } = state.agentStats;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [agentId]: _fc, ...remainingFileChanges } = state.fileChanges;
    return {
      ...state,
      agentStats: remainingAgentStats,
      fileChanges: remainingFileChanges,
    };
  })
  .with(hydrateAllWorkspaceStats, (state, { payload: [stats] }) => ({
    ...state,
    workspaceStats: { ...state.workspaceStats, ...stats },
  }));
