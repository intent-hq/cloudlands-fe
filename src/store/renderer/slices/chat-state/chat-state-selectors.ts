import { store } from '../../store';
import type { StoreState } from '../../types';
import { emptyChatAgentState } from './chat-state-slice';
import type {
  ChatAgentState,
  HydratedBlockEntry,
  StatusEvent,
  LastAttemptedMessage,
  LiveStreamPhase,
  ModelUnavailableInfo,
  TranscriptHydrationStatus,
  TranscriptSnapshotMeta,
  StreamFailureCorrelation,
} from './chat-state-types';
import { hydratedBlockKey } from './chat-state-types';

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
export const selectChatAgentState = store.createSelector((state, agentId: string): ChatAgentState =>
  getAgentChatState(state, agentId),
);

/** All agent ids holding a chat-state entry (bulk hygiene sweeps in sagas). */
export const selectChatAgentIds = store.createSelector((state): string[] =>
  Object.keys(state.chatState?.byAgentId ?? {}),
);

/** Select error */
export const selectChatError = store.createSelector(
  (state, agentId: string): string | null => getAgentChatState(state, agentId).error,
);

export const selectChatFailureCorrelation = store.createSelector(
  (state, agentId: string): StreamFailureCorrelation | undefined =>
    getAgentChatState(state, agentId).failureCorrelation,
);

/** Select streaming start time */
export const selectChatStreamingStartTime = store.createSelector(
  (state, agentId: string): number | null => getAgentChatState(state, agentId).streamingStartTime,
);

/** Select last chunk time */
export const selectChatLastChunkTime = store.createSelector(
  (state, agentId: string): number | null => getAgentChatState(state, agentId).lastChunkTime,
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
  (state, agentId: string): StatusEvent[] => getAgentChatState(state, agentId).statusEvents,
);

/** Select received first chunk flag */
export const selectChatReceivedFirstChunk = store.createSelector(
  (state, agentId: string): boolean => getAgentChatState(state, agentId).receivedFirstChunk,
);

/** Select last message send time (for rate limiting) */
export const selectChatLastMessageTime = store.createSelector(
  (state, agentId: string): number => getAgentChatState(state, agentId).lastMessageTime,
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

// --- Scrollback paging (on-demand history segment fetches) ---

/** True while an on-demand older-history scrollback page fetch is in flight. */
export const selectFetchingOlderHistory = store.createSelector(
  (state, agentId: string): boolean => getAgentChatState(state, agentId).fetchingOlderHistory,
);

/** True while an on-demand gap-refill scrollback page fetch is in flight. */
export const selectFetchingGapFill = store.createSelector(
  (state, agentId: string): boolean => getAgentChatState(state, agentId).fetchingGapFill,
);

/** True while an `aroundIndex` far-flick seek fetch is in flight. */
export const selectFetchingHistorySeek = store.createSelector(
  (state, agentId: string): boolean => getAgentChatState(state, agentId).fetchingHistorySeek,
);

/**
 * True once the daemon rejected `aroundIndex` (INVALID_PARAMS) — a daemon
 * predating the param. Far-flick seeks fall back to the serial walk.
 */
export const selectHistorySeekUnsupported = store.createSelector(
  (state, agentId: string): boolean => getAgentChatState(state, agentId).historySeekUnsupported,
);

/**
 * True once the older scrollback walk hydrated the conversation's true first
 * message. Reads the history segment's `oldestReached` (agent-session slice)
 * so exhaustion lives and dies with the segment itself — a cleared segment
 * (chat reset, §7.1 `resumed: false` rehydration) is never falsely exhausted.
 */
export const selectHistoryExhausted = store.createSelector(
  (state, agentId: string): boolean =>
    state.agentSessions?.historySegmentsByAgentId?.[agentId]?.oldestReached === true,
);

/** Result of the bounded authoritative question-marker recovery, if attempted. */
export const selectPendingQuestionRecovery = store.createSelector(
  (state, agentId: string) => getAgentChatState(state, agentId).pendingQuestionRecovery,
);

/** Per-messageId results of the pending-proposal carrying-message recoveries. */
export const selectPendingProposalRecovery = store.createSelector(
  (state, agentId: string) => getAgentChatState(state, agentId).pendingProposalRecovery,
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
 * Select one lazily hydrated content block entry (§5.5 slim projection →
 * v7.2 `agent.getMessageBlock`), or undefined when never requested. Keyed by
 * `{messageId}|{blockId}` via `hydratedBlockKey`.
 */
export const selectHydratedBlock = store.createSelector(
  (state, agentId: string, messageId: string, blockId: string): HydratedBlockEntry | undefined =>
    getAgentChatState(state, agentId).hydratedBlocks?.[hydratedBlockKey(messageId, blockId)],
);

/**
 * Select the agent's whole hydrated-block cache (keys `{messageId}|{blockId}`
 * via `hydratedBlockKey`), or undefined when nothing was ever hydrated.
 * Components subscribe to this map at init (agentId is stable per instance)
 * and look blocks up reactively with `$derived` — block ids can appear after
 * init (streaming), which a per-block selector readable could not track.
 */
export const selectHydratedBlocks = store.createSelector(
  (state, agentId: string): Record<string, HydratedBlockEntry> | undefined =>
    getAgentChatState(state, agentId).hydratedBlocks,
);
