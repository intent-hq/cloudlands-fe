/**
 * Unread-tracking Redux slice.
 *
 * Tracks which agent conversation is currently open (`currentlyViewedAgentId`),
 * which gates the chat stream lifecycle (chat-subscribe-service), and the
 * latched "New messages" divider viewing sessions
 * (`dividerSessionByAgentId`, see divider-session-boundary-service.ts). Unread
 * state itself is backend-owned: `workspace.attention === 'unread'` on the
 * workspace entity, cleared via `workspace.markSeen` (PROTOCOL §5.1) — the
 * FE-local unread feed this slice used to keep has been retired.
 */

import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import type { UnreadTrackingState } from "./unread-tracking-types";

export const initialState: UnreadTrackingState = {
  currentlyViewedAgentId: null,
  dividerSessionByAgentId: {},
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

/**
 * Latch the "New messages" divider anchor for an agent's viewing session,
 * derived once at conversation entry (first transcript hydration).
 * First-write-wins: a second start for the same agent is a no-op, so cached
 * panel remounts cannot recompute the anchor. `anchorId: null` latches
 * "session started, no divider".
 */
export const startDividerSession = createAction<[agentId: string, anchorId: string | null]>(
  "unreadTracking/startDividerSession"
);

/** End one agent's divider viewing session (its chat tab was closed). */
export const endDividerSession = createAction<[agentId: string]>(
  "unreadTracking/endDividerSession"
);

/** End every divider viewing session (the active workspace switched). */
export const endAllDividerSessions = createAction(
  "unreadTracking/endAllDividerSessions"
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
  })
  .with(startDividerSession, (state, { payload: [agentId, anchorId] }) => {
    if (!agentId) return state;
    if (state.dividerSessionByAgentId[agentId] !== undefined) return state;
    return {
      ...state,
      dividerSessionByAgentId: {
        ...state.dividerSessionByAgentId,
        [agentId]: { anchorId: anchorId ?? null },
      },
    };
  })
  .with(endDividerSession, (state, { payload: [agentId] }) => {
    if (state.dividerSessionByAgentId[agentId] === undefined) return state;
    const dividerSessionByAgentId = { ...state.dividerSessionByAgentId };
    delete dividerSessionByAgentId[agentId];
    return { ...state, dividerSessionByAgentId };
  })
  .with(endAllDividerSessions, (state) => {
    if (Object.keys(state.dividerSessionByAgentId).length === 0) return state;
    return { ...state, dividerSessionByAgentId: {} };
  });

