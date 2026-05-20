/**
 * Session Stats Selectors
 */

import { store } from "../../store";
import type {
  AgentSessionStats,
  WorkspaceAggregateStats,
} from "./session-stats-types";

/** Select workspace aggregate stats by workspace ID */
export const selectWorkspaceStats = store.createSelector(
  (state, wsId: string): WorkspaceAggregateStats | undefined =>
    state?.sessionStats?.workspaceStats[wsId],
);

/** Select whether workspace stats are loading for a specific workspace */
export const selectIsLoadingWorkspaceStats = store.createSelector(
  (state, wsId: string): boolean =>
    state?.sessionStats?.loadingWorkspaceStats[wsId] ?? false,
);

/** Select workspace stats error for a specific workspace */
export const selectWorkspaceStatsError = store.createSelector(
  (state, wsId: string): string | null =>
    state?.sessionStats?.workspaceStatsErrors[wsId] ?? null,
);

/** Select stats for a specific agent by agentId */
export const selectAgentStats = store.createSelector(
  (state, agentId: string): AgentSessionStats | undefined =>
    state?.sessionStats?.agentStats[agentId],
);

/** Select all cached per-agent session stats */
export const selectAllAgentStats = store.createSelector(
  (state): Record<string, AgentSessionStats> =>
    state?.sessionStats?.agentStats ?? {},
);

/** Select whether agent stats are loading for a specific agent */
export const selectIsLoadingAgentStats = store.createSelector(
  (state, agentId: string): boolean =>
    state?.sessionStats?.loadingAgentStats[agentId] ?? false,
);

/** Select agent stats error for a specific agent */
export const selectAgentStatsError = store.createSelector(
  (state, agentId: string): string | undefined =>
    state?.sessionStats?.agentStatsErrors[agentId],
);
