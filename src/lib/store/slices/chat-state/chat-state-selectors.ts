import type { StoreState } from '../../types';
import { createSelector } from '../../utils/create-selector';
import { emptyChatAgentState } from './chat-state-slice';
import type { ChatAgentState, StatusEvent, LastAttemptedMessage, ModelUnavailableInfo } from './chat-state-types';

// ============================================================================
// Helpers
// ============================================================================

function getAgentChatState(state: StoreState, agentId: string): ChatAgentState {
  return state.chatState?.byAgentId[agentId] ?? emptyChatAgentState;
}

// ============================================================================
// Selectors
// ============================================================================

/** Select the full agent chat state object */
export const selectChatAgentState = createSelector(
  (state, agentId: string): ChatAgentState =>
    getAgentChatState(state, agentId),
);

/** Select interrupting flag */
export const selectChatIsInterrupting = createSelector(
  (state, agentId: string): boolean =>
    getAgentChatState(state, agentId).isInterrupting,
);

/** Select streaming content */
export const selectChatStreamingContent = createSelector(
  (state, agentId: string): string =>
    getAgentChatState(state, agentId).streamingContent,
);

/** Select error */
export const selectChatError = createSelector(
  (state, agentId: string): string | null =>
    getAgentChatState(state, agentId).error,
);

/** Select stalled flag */
export const selectChatIsStalled = createSelector(
  (state, agentId: string): boolean =>
    getAgentChatState(state, agentId).isStalled,
);

/** Select streaming start time */
export const selectChatStreamingStartTime = createSelector(
  (state, agentId: string): number | null =>
    getAgentChatState(state, agentId).streamingStartTime,
);

/** Select last chunk time */
export const selectChatLastChunkTime = createSelector(
  (state, agentId: string): number | null =>
    getAgentChatState(state, agentId).lastChunkTime,
);

/** Select last attempted message (for retry) */
export const selectChatLastAttemptedMessage = createSelector(
  (state, agentId: string): LastAttemptedMessage | null =>
    getAgentChatState(state, agentId).lastAttemptedMessage,
);

/** Select model unavailable info */
export const selectChatModelUnavailable = createSelector(
  (state, agentId: string): ModelUnavailableInfo | null =>
    getAgentChatState(state, agentId).modelUnavailable,
);

/** Select status events */
export const selectChatStatusEvents = createSelector(
  (state, agentId: string): StatusEvent[] =>
    getAgentChatState(state, agentId).statusEvents,
);

/** Select received first chunk flag */
export const selectChatReceivedFirstChunk = createSelector(
  (state, agentId: string): boolean =>
    getAgentChatState(state, agentId).receivedFirstChunk,
);

/** Select rebinding flag */
export const selectChatIsRebinding = createSelector(
  (state, agentId: string): boolean =>
    getAgentChatState(state, agentId).isRebinding,
);

/** Select tracked workspace ID (for rebind detection) */
export const selectChatTrackedWorkspaceId = createSelector(
  (state, agentId: string): string | null =>
    getAgentChatState(state, agentId).trackedWorkspaceId,
);

/** Select last message send time (for rate limiting) */
export const selectChatLastMessageTime = createSelector(
  (state, agentId: string): number =>
    getAgentChatState(state, agentId).lastMessageTime,
);



/** Select last chunk received at timestamp (for reconciliation skip logic) */
export const selectChatLastChunkReceivedAt = createSelector(
  (state, agentId: string): number =>
    getAgentChatState(state, agentId).lastChunkReceivedAt,
);

/**
 * Select chat state for the given agent, falling back to an empty default state.
 * Equivalent to selectChatAgentState (which already defaults via emptyChatAgentState),
 * but explicitly named for use in ChatService and other consumers that need
 * a guaranteed non-null ChatAgentState without wrapper methods.
 */
export const selectChatStateOrDefault = createSelector(
  (state, agentId: string): ChatAgentState =>
    getAgentChatState(state, agentId),
);



