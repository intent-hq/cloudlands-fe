/**
 * Session Stats Selectors
 */

import { createSelector } from "../../utils/create-selector";
import type {
  AgentSessionStats,
  WorkspaceAggregateStats,
} from "./session-stats-types";

/** Select workspace aggregate stats by workspace ID */
export const selectWorkspaceStats = createSelector(
  (state, wsId: string): WorkspaceAggregateStats | undefined =>
    state.sessionStats?.workspaceStats[wsId],
);

/** Select whether workspace stats are loading for a specific workspace */
export const selectIsLoadingWorkspaceStats = createSelector(
  (state, wsId: string): boolean =>
    state.sessionStats?.loadingWorkspaceStats[wsId] ?? false,
);

/** Select workspace stats error for a specific workspace */
export const selectWorkspaceStatsError = createSelector(
  (state, wsId: string): string | null =>
    state.sessionStats?.workspaceStatsErrors[wsId] ?? null,
);

/** Select stats for a specific agent by agentId */
export const selectAgentStats = createSelector(
  (state, agentId: string): AgentSessionStats | undefined =>
    state.sessionStats?.agentStats[agentId],
);

/** Select whether agent stats are loading for a specific agent */
export const selectIsLoadingAgentStats = createSelector(
  (state, agentId: string): boolean =>
    state.sessionStats?.loadingAgentStats[agentId] ?? false,
);

/** Select agent stats error for a specific agent */
export const selectAgentStatsError = createSelector(
  (state, agentId: string): string | undefined =>
    state.sessionStats?.agentStatsErrors[agentId],
);
