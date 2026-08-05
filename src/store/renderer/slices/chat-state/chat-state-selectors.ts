import { store } from "../../store";
import type { StoreState } from '../../types';
import { emptyChatAgentState } from './chat-state-slice';
import type {
  ChatAgentState,
  StatusEvent,
  LastAttemptedMessage,
  LiveStreamPhase,
  ModelUnavailableInfo,
  TranscriptHydrationStatus,
} from './chat-state-types';

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
export const selectChatAgentState = store.createSelector(
  (state, agentId: string): ChatAgentState =>
    getAgentChatState(state, agentId),
);

/** Select interrupting flag */
export const selectChatIsInterrupting = store.createSelector(
  (state, agentId: string): boolean =>
    getAgentChatState(state, agentId).isInterrupting,
);

/** Select error */
export const selectChatError = store.createSelector(
  (state, agentId: string): string | null =>
    getAgentChatState(state, agentId).error,
);

/** Select streaming start time */
export const selectChatStreamingStartTime = store.createSelector(
  (state, agentId: string): number | null =>
    getAgentChatState(state, agentId).streamingStartTime,
);

/** Select last chunk time */
export const selectChatLastChunkTime = store.createSelector(
  (state, agentId: string): number | null =>
    getAgentChatState(state, agentId).lastChunkTime,
);

/** Select last attempted message (for retry) */
export const selectChatLastAttemptedMessage = store.createSelector(
  (state, agentId: string): LastAttemptedMessage | null =>
    getAgentChatState(state, agentId).lastAttemptedMessage,
);

/** Select model unavailable info */
export const selectChatModelUnavailable = store.createSelector(
  (state, agentId: string): ModelUnavailableInfo | null =>
    getAgentChatState(state, agentId).modelUnavailable,
);

/** Select status events */
export const selectChatStatusEvents = store.createSelector(
  (state, agentId: string): StatusEvent[] =>
    getAgentChatState(state, agentId).statusEvents,
);

/** Select received first chunk flag */
export const selectChatReceivedFirstChunk = store.createSelector(
  (state, agentId: string): boolean =>
    getAgentChatState(state, agentId).receivedFirstChunk,
);

/** Select rebinding flag */
export const selectChatIsRebinding = store.createSelector(
  (state, agentId: string): boolean =>
    getAgentChatState(state, agentId).isRebinding,
);

/** Select tracked workspace ID (for rebind detection) */
export const selectChatTrackedWorkspaceId = store.createSelector(
  (state, agentId: string): string | null =>
    getAgentChatState(state, agentId).trackedWorkspaceId,
);

/** Select last message send time (for rate limiting) */
export const selectChatLastMessageTime = store.createSelector(
  (state, agentId: string): number =>
    getAgentChatState(state, agentId).lastMessageTime,
);

/** Select last chunk received at timestamp (for reconciliation skip logic) */
export const selectChatLastChunkReceivedAt = store.createSelector(
  (state, agentId: string): number =>
    getAgentChatState(state, agentId).lastChunkReceivedAt,
);

/**
 * Select chat state for the given agent, falling back to an empty default state.
 * Equivalent to selectChatAgentState (which already defaults via emptyChatAgentState),
 * but explicitly named for consumers that need
 * a guaranteed non-null ChatAgentState without wrapper methods.
 */
export const selectChatStateOrDefault = store.createSelector(
  (state, agentId: string): ChatAgentState =>
    getAgentChatState(state, agentId),
);

/**
 * Select transcript hydration status for the given agent.
 * Returns undefined if hydration has not started, 'loading' if in flight,
 * 'settled' if completed (success or error).
 */
export const selectTranscriptHydration = store.createSelector(
  (state, agentId: string): TranscriptHydrationStatus | undefined =>
    getAgentChatState(state, agentId).transcriptHydration,
);

/**
 * Select the standing `chat.subscribe` lifecycle phase for the agent, or
 * null when no subscription is open. Drives the pre-live hydration indicator.
 */
export const selectChatLiveStreamPhase = store.createSelector(
  (state, agentId: string): LiveStreamPhase | null =>
    getAgentChatState(state, agentId).liveStreamPhase ?? null,
);



