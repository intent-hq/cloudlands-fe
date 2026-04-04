/**
 * Unread-tracking Redux slice.
 *
 * Manages unread state for agent messages. Replaces the old
 * UnreadTrackingService singleton with serializable Redux state.
 */

import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import type { UnreadTrackingState } from "./unread-tracking-types";

// Maximum number of unread agent IDs to store (prevents unbounded growth)
const MAX_UNREAD_AGENTS = 100;

export const initialState: UnreadTrackingState = {
  unreadAgentIds: [],
  agentWorkspaceMap: {},
  currentlyViewedAgentId: null,
};

// ── Actions ──

/** Load persisted state from localStorage on startup. */
export const hydrateUnreadTracking = createAction<
  [data: { unreadAgentIds: string[]; agentWorkspaceMap: Record<string, string> }]
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
  (agentId: string, workspaceId?: string, isBackground?: boolean) => ({
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [agentId]: _, ...agentWorkspaceMap } = state.agentWorkspaceMap;
  return { ...state, unreadAgentIds, agentWorkspaceMap };
}

// ── Reducer ──

export const unreadTrackingReducer = createReducer<UnreadTrackingState>(initialState)
  .with(hydrateUnreadTracking, (state, { payload: [data] }) => ({
    ...state,
    unreadAgentIds: data.unreadAgentIds,
    agentWorkspaceMap: data.agentWorkspaceMap,
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
    const { agentId, workspaceId, isBackground } = action.payload;
    if (!agentId || isBackground) return state;

    // Always store workspace mapping even if agent is currently viewed
    let nextMap = state.agentWorkspaceMap;
    if (workspaceId && state.agentWorkspaceMap[agentId] !== workspaceId) {
      nextMap = { ...state.agentWorkspaceMap, [agentId]: workspaceId };
    }

    // Don't mark as unread if user is currently viewing this agent
    if (state.currentlyViewedAgentId === agentId) {
      return nextMap === state.agentWorkspaceMap
        ? state
        : { ...state, agentWorkspaceMap: nextMap };
    }

    // Already unread — just update workspace map if needed
    if (state.unreadAgentIds.includes(agentId)) {
      return nextMap === state.agentWorkspaceMap
        ? state
        : { ...state, agentWorkspaceMap: nextMap };
    }

    // Add to unread list with size limit (FIFO eviction)
    let unreadAgentIds = state.unreadAgentIds;
    if (unreadAgentIds.length >= MAX_UNREAD_AGENTS) {
      const oldest = unreadAgentIds[0];
      unreadAgentIds = unreadAgentIds.slice(1);
      if (oldest && nextMap[oldest]) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [oldest]: _, ...rest } = nextMap;
        nextMap = rest;
      }
    }

    return {
      ...state,
      unreadAgentIds: [...unreadAgentIds, agentId],
      agentWorkspaceMap: nextMap,
    };
  })
  .with(clearAgentUnread, (state, { payload: [agentId] }) => {
    const next = removeAgentFromUnread(state, agentId);
    if (state.currentlyViewedAgentId === agentId) {
      return { ...next, currentlyViewedAgentId: null };
    }
    return next;
  })
  .with(clearWorkspaceUnread, (state, { payload: [workspaceId] }) => {
    const agentsToClear = state.unreadAgentIds.filter(
      (id) => state.agentWorkspaceMap[id] === workspaceId
    );
    if (agentsToClear.length === 0) return state;
    const clearSet = new Set(agentsToClear);
    const unreadAgentIds = state.unreadAgentIds.filter((id) => !clearSet.has(id));
    const agentWorkspaceMap = { ...state.agentWorkspaceMap };
    for (const id of agentsToClear) {
      delete agentWorkspaceMap[id];
    }
    return { ...state, unreadAgentIds, agentWorkspaceMap };
  })
  .with(clearAllUnread, () => initialState);

