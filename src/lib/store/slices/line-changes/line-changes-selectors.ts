/**
 * Line Changes Selectors
 */

import { createSelector } from "../../utils/create-selector";
import type { LineChangeStats, FileLineChange } from "./line-changes-types";

/** Select workspace stats by workspace ID */
export const selectWorkspaceLineStats = createSelector(
  (state, workspaceId: string): LineChangeStats | undefined =>
    state.lineChanges.workspaceStats[workspaceId],
);

/** Select agent stats by agent ID */
export const selectAgentLineStats = createSelector(
  (state, agentId: string): LineChangeStats | undefined =>
    state.lineChanges.agentStats[agentId],
);

/** Select file changes by workspace or agent ID */
export const selectFileChanges = createSelector(
  (state, id: string): FileLineChange[] =>
    state.lineChanges.fileChanges[id] || [],
);

/** Select the full file changes record (for the overview store) */
export const selectAllFileChanges = createSelector(
  (state): Record<string, FileLineChange[]> => state.lineChanges.fileChanges,
);

/** Select the full workspace stats record */
export const selectAllWorkspaceStats = createSelector(
  (state): Record<string, LineChangeStats> => state.lineChanges.workspaceStats,
);

/** Select the full agent stats record */
export const selectAllAgentStats = createSelector(
  (state): Record<string, LineChangeStats> => state.lineChanges.agentStats,
);

