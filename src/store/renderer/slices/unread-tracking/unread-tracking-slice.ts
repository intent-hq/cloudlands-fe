/**
 * Unread-tracking Redux slice.
 *
 * Tracks only which agent conversation is currently open (`currentlyViewedAgentId`),
 * which gates the chat stream lifecycle (chat-subscribe-service). Unread state
 * itself is backend-owned: `workspace.attention === 'unread'` on the workspace
 * entity, cleared via `workspace.markSeen` (PROTOCOL §5.1) — the FE-local
 * unread feed this slice used to keep has been retired.
 */

import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import type { UnreadTrackingState } from "./unread-tracking-types";

export const initialState: UnreadTrackingState = {
  currentlyViewedAgentId: null,
};

// ── Actions ──

/** Mark an agent as currently viewed. */
export const markAgentAsViewed = createAction<[agentId: string]>(
  "unreadTracking/markAgentAsViewed"
);

/**
 * Clear the currently viewed agent (drawer closed / tab switched).
 * Optionally scoped to an agent id: a scoped clear is a no-op unless that
 * agent is the one currently viewed, so a deactivating background panel's
 * trailing clear cannot clobber the newly viewed agent (monorepo#1215).
 */
export const clearCurrentlyViewedAgent = createAction<[agentId?: string]>(
  "unreadTracking/clearCurrentlyViewedAgent"
);

// ── Reducer ──

export const unreadTrackingReducer = createReducer<UnreadTrackingState>(initialState)
  .with(markAgentAsViewed, (state, { payload: [agentId] }) => {
    if (!agentId) return state;
    if (state.currentlyViewedAgentId === agentId) return state;
    return { ...state, currentlyViewedAgentId: agentId };
  })
  .with(clearCurrentlyViewedAgent, (state, { payload: [agentId] }) => {
    if (state.currentlyViewedAgentId === null) return state;
    if (agentId !== undefined && state.currentlyViewedAgentId !== agentId) return state;
    return { ...state, currentlyViewedAgentId: null };
  });

