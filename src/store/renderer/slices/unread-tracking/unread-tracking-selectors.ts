/**
 * Selectors for the unread-tracking slice.
 */

import { store } from "../../store";
import { selectAgentSessionWorkspaceId } from "../agent-session/agent-session-selectors";

/** All agent IDs with unread messages. */
export const selectUnreadAgentIds = store.createSelector(
  (state) => state.unreadTracking.unreadAgentIds
);

/** Unread agent IDs for a specific workspace. */
export const selectUnreadAgentIdsForWorkspace = store.createSelector(
  (state, workspaceId: string) => {
    return state.unreadTracking.unreadAgentIds.filter(
      (id) => selectAgentSessionWorkspaceId.select(state, id) === workspaceId
    );
  }
);

/** Unread agent IDs grouped by workspace. */
export const selectUnreadAgentIdsByWorkspace = store.createSelector(
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
export const selectCurrentlyViewedAgentId = store.createSelector(
  (state) => state.unreadTracking.currentlyViewedAgentId
);

