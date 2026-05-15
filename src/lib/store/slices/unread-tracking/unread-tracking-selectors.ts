/**
 * Selectors for the unread-tracking slice.
 */

import { createSelector } from "../../utils/create-selector";
import { selectAgentSessionWorkspaceId } from "../agent-session/agent-session-selectors";

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
    return state.unreadTracking.unreadAgentIds.filter(
      (id) => selectAgentSessionWorkspaceId.select(state, id) === workspaceId
    );
  }
);

/** Unread agent IDs grouped by workspace. */
export const selectUnreadAgentIdsByWorkspace = createSelector(
  (state): Record<string, string[]> => {
    const { unreadAgentIds } = state.unreadTracking;
    const result: Record<string, string[]> = {};

    for (const id of unreadAgentIds) {
      const workspaceId = selectAgentSessionWorkspaceId.select(state, id);
      if (!workspaceId) continue;
      result[workspaceId] ??= [];
      result[workspaceId].push(id);
    }

    return result;
  }
);

/** The currently viewed agent ID. */
export const selectCurrentlyViewedAgentId = createSelector(
  (state) => state.unreadTracking.currentlyViewedAgentId
);

