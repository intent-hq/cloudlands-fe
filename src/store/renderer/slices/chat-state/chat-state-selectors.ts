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
  TranscriptSnapshotMeta,
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
 * True once transcript hydration has settled at least once for the agent.
 * Gates ChatPanel's indeterminate first-hydration skeleton: until the first
 * hydration settles, partial messages must not render as a complete
 * transcript; after that, refresh re-hydrations keep the messages visible.
 */
export const selectTranscriptHydratedOnce = store.createSelector(
  (state, agentId: string): boolean =>
    getAgentChatState(state, agentId).transcriptHydratedOnce === true,
);

/**
 * Select the standing `chat.subscribe` lifecycle phase for the agent, or
 * null when no subscription is open. Drives the pre-live hydration indicator.
 */
export const selectChatLiveStreamPhase = store.createSelector(
  (state, agentId: string): LiveStreamPhase | null =>
    getAgentChatState(state, agentId).liveStreamPhase ?? null,
);

/**
 * Select the metadata of the last applied seq-0 snapshot from the standing
 * subscription, or undefined when none has arrived yet (single-transfer
 * hydration; consumed by the chat-read saga).
 */
export const selectTranscriptSnapshotMeta = store.createSelector(
  (state, agentId: string): TranscriptSnapshotMeta | undefined =>
    getAgentChatState(state, agentId).transcriptSnapshot,
);

/**
 * Switch-back transcript reveal gate: true while the viewed conversation is
 * awaiting a fresh seq-0 snapshot from its (re)opening standing subscription.
 * ChatPanel defers the transcript reveal while set (see
 * `shouldDeferTranscriptReveal` in chat-panel-visibility.ts).
 */
export const selectAwaitingSwitchBackSnapshot = store.createSelector(
  (state, agentId: string): boolean =>
    getAgentChatState(state, agentId).awaitingSwitchBackSnapshot === true,
);

/**
 * Utility-footer reveal gate: true while the transcript reveal is holding for
 * the footer data sources (agent subscriptions, background hooks, monitored
 * PRs) to settle, so transcript and footer flip in the same paint. Cleared by
 * the subscribe saga when `isUtilityFooterReady` composes true, by its
 * bounded fallback, or on subscription teardown (see
 * `shouldDeferTranscriptReveal` in chat-panel-visibility.ts).
 */
export const selectAwaitingUtilityFooter = store.createSelector(
  (state, agentId: string): boolean =>
    getAgentChatState(state, agentId).awaitingUtilityFooter === true,
);



