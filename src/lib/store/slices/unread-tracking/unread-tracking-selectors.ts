/**
 * Selectors for the unread-tracking slice.
 */

import { createSelector } from "../../utils/create-selector";

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
    const { unreadAgentIds, agentWorkspaceMap } = state.unreadTracking;
    return unreadAgentIds.filter((id) => agentWorkspaceMap[id] === workspaceId);
  }
);

/** Unread agent IDs grouped by workspace. */
export const selectUnreadAgentIdsByWorkspace = createSelector(
  (state): Record<string, string[]> => {
    const { unreadAgentIds, agentWorkspaceMap } = state.unreadTracking;
    const result: Record<string, string[]> = {};

    for (const id of unreadAgentIds) {
      const workspaceId = agentWorkspaceMap[id];
      if (!workspaceId) continue;
      result[workspaceId] ??= [];
      result[workspaceId].push(id);
    }

    return result;
  }
);

/** Get the workspace ID for a specific agent (if known). */
export const selectWorkspaceForAgent = createSelector(
  (state, agentId: string) => state.unreadTracking.agentWorkspaceMap[agentId] as string | undefined
);

/** The currently viewed agent ID. */
export const selectCurrentlyViewedAgentId = createSelector(
  (state) => state.unreadTracking.currentlyViewedAgentId
);

