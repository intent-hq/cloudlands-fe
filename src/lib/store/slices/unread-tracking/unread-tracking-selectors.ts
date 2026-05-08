/**
 * Selectors for the unread-tracking slice.
 */

import { createSelector } from "../../utils/create-selector";
import type { StoreState } from "../../types";

function getWorkspaceAgentIds(state: StoreState, workspaceId: string): string[] {
  return state.workspaceAgents.byWorkspaceId[workspaceId]?.agentIds ?? [];
}

function getWorkspaceIdByAgentId(state: StoreState): Record<string, string> {
  const workspaceIdByAgentId: Record<string, string> = {};
  for (const [workspaceId, workspaceAgents] of Object.entries(state.workspaceAgents.byWorkspaceId)) {
    for (const agentId of workspaceAgents.agentIds) {
      workspaceIdByAgentId[agentId] ??= workspaceId;
    }
  }
  return workspaceIdByAgentId;
}

/** Whether a specific agent has unread messages. */
export const selectAgentHasUnread = createSelector(
  (state, agentId: string) => state.unreadTracking.unreadAgentIds.includes(agentId)
);

/** Total count of agents with unread messages. */
export const selectUnreadCount = createSelector(
  (state) => state.unreadTracking.unreadAgentIds.length
);

/** All agent IDs with unread messages. */
export const selectUnreadAgentIds = createSelector(
  (state) => state.unreadTracking.unreadAgentIds
);

/** Unread agent IDs for a specific workspace. */
export const selectUnreadAgentIdsForWorkspace = createSelector(
  (state, workspaceId: string) => {
    const workspaceAgentIds = new Set(getWorkspaceAgentIds(state, workspaceId));
    return state.unreadTracking.unreadAgentIds.filter((id) => workspaceAgentIds.has(id));
  }
);

/** Unread agent IDs grouped by workspace. */
export const selectUnreadAgentIdsByWorkspace = createSelector(
  (state): Record<string, string[]> => {
    const { unreadAgentIds } = state.unreadTracking;
    const workspaceIdByAgentId = getWorkspaceIdByAgentId(state);
    const result: Record<string, string[]> = {};

    for (const id of unreadAgentIds) {
      const workspaceId = workspaceIdByAgentId[id];
      if (!workspaceId) continue;
      result[workspaceId] ??= [];
      result[workspaceId].push(id);
    }

    return result;
  }
);

/** Get the workspace ID for a specific agent (if known). */
export const selectWorkspaceForAgent = createSelector(
  (state, agentId: string) => getWorkspaceIdByAgentId(state)[agentId]
);

/** The currently viewed agent ID. */
export const selectCurrentlyViewedAgentId = createSelector(
  (state) => state.unreadTracking.currentlyViewedAgentId
);

