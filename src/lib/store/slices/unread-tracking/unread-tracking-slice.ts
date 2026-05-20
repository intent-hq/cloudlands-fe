/**
 * Unread-tracking Redux slice.
 *
 * Manages unread state for agent messages. Replaces the old
 * UnreadTrackingService singleton with serializable Redux state.
 */

import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";
import type { UnreadTrackingState } from "./unread-tracking-types";

// Maximum number of unread agent IDs to store (prevents unbounded growth)
const MAX_UNREAD_AGENTS = 100;

export const initialState: UnreadTrackingState = {
  unreadAgentIds: [],
  currentlyViewedAgentId: null,
};

// ── Actions ──

/** Load persisted state from localStorage on startup. */
export const hydrateUnreadTracking = createAction<
  [data: { unreadAgentIds: string[] }]
>("unreadTracking/hydrate");

/** Mark an agent as currently viewed — clears its unread status. */
export const markAgentAsViewed = createAction<[agentId: string]>(
  "unreadTracking/markAgentAsViewed"
);

/** Clear the currently viewed agent (drawer closed / tab switched). */
export const clearCurrentlyViewedAgent = createAction(
  "unreadTracking/clearCurrentlyViewedAgent"
);

/** Record a new assistant message — marks agent as unread if not currently viewed. */
export const newAssistantMessage = createAction(
  "unreadTracking/newAssistantMessage",
  (agentId: string, workspaceId: string, isBackground?: boolean) => ({
    agentId,
    workspaceId,
    isBackground,
  })
);

/** Clear unread status for a single agent (e.g. when agent is deleted). */
export const clearAgentUnread = createAction<[agentId: string]>(
  "unreadTracking/clearAgentUnread"
);

/** Clear unread status for all agents in a workspace. */
export const clearWorkspaceUnread = createAction<[workspaceId: string]>(
  "unreadTracking/clearWorkspaceUnread"
);

/** Clear unread status for a derived set of agent IDs. */
export const clearAgentsUnread = createAction<[agentIds: string[]]>(
  "unreadTracking/clearAgentsUnread"
);

/** Clear all unread status. */
export const clearAllUnread = createAction("unreadTracking/clearAllUnread");

// ── Helpers ──

function removeAgentFromUnread(
  state: UnreadTrackingState,
  agentId: string
): UnreadTrackingState {
  const idx = state.unreadAgentIds.indexOf(agentId);
  if (idx === -1) return state;
  const unreadAgentIds = state.unreadAgentIds.filter((id) => id !== agentId);
  return { ...state, unreadAgentIds };
}

// ── Reducer ──

export const unreadTrackingReducer = createReducer<UnreadTrackingState>(initialState)
  .with(hydrateUnreadTracking, (state, { payload: [data] }) => ({
    ...state,
    unreadAgentIds: data.unreadAgentIds,
  }))
  .with(markAgentAsViewed, (state, { payload: [agentId] }) => {
    if (!agentId) return state;
    const next = removeAgentFromUnread(state, agentId);
    return next === state && state.currentlyViewedAgentId === agentId
      ? state
      : { ...next, currentlyViewedAgentId: agentId };
  })
  .with(clearCurrentlyViewedAgent, (state) => {
    if (state.currentlyViewedAgentId === null) return state;
    return { ...state, currentlyViewedAgentId: null };
  })
  .with(newAssistantMessage, (state, action) => {
    const { agentId, isBackground } = action.payload;
    if (!agentId || isBackground) return state;

    // Don't mark as unread if user is currently viewing this agent
    if (state.currentlyViewedAgentId === agentId) {
      return state;
    }

    // Already unread
    if (state.unreadAgentIds.includes(agentId)) {
      return state;
    }

    // Add to unread list with size limit (FIFO eviction)
    let unreadAgentIds = state.unreadAgentIds;
    if (unreadAgentIds.length >= MAX_UNREAD_AGENTS) {
      unreadAgentIds = unreadAgentIds.slice(1);
    }

    return {
      ...state,
      unreadAgentIds: [...unreadAgentIds, agentId],
    };
  })
  .with(clearAgentUnread, (state, { payload: [agentId] }) => {
    const next = removeAgentFromUnread(state, agentId);
    if (state.currentlyViewedAgentId === agentId) {
      return { ...next, currentlyViewedAgentId: null };
    }
    return next;
  })
  .with(clearAgentsUnread, (state, { payload: [agentIds] }) => {
    if (agentIds.length === 0) return state;
    const clearSet = new Set(agentIds);
    const unreadAgentIds = state.unreadAgentIds.filter((id) => !clearSet.has(id));
    if (unreadAgentIds.length === state.unreadAgentIds.length) return state;
    return { ...state, unreadAgentIds };
  })
  .with(clearAllUnread, () => initialState);

