import { store } from "../../store";
import {
  AgentStatus,
  type AgentSession,
  type AgentMessage,
  type QueuedMessage,
} from "$shared/types";
import { AgentActivationState, getAgentProvider } from "$shared/types/agent-session";
import { getContentBlockText } from "$shared/utils/content-block-helpers";
import {
  getAgentAttentionRequest,
  type AgentAttentionRequest,
} from "$shared/utils/agent-attention";
import type { StoredAgentSession } from "./agent-session-types";
import { selectAgentQueueMessages } from "../agent-queue/agent-queue-selectors";
import { selectEffectiveDefaultProviderId } from "../provider-catalog/provider-catalog-selectors";

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Stored sessions already mirror the public `AgentSession` message-array shape.
 * Returning the stored reference preserves selector reference-equality when the
 * reducer keeps the session object unchanged.
 */
function materializeSession(stored: StoredAgentSession | undefined): AgentSession | undefined {
  if (!stored) return undefined;
  return stored;
}

function hasTerminalMessageMetadata(message: AgentMessage | undefined): boolean {
  const metadata = message?.metadata;
  return (
    metadata?.interrupted === true ||
    typeof metadata?.stopReason === 'string' ||
    // Abnormal-finish rows (PROTOCOL §7.3) are finalized by definition — the
    // daemon only stamps `finishReason` on persisted terminal rows, so never
    // pick one as the "current streaming message" even if the session-level
    // isStreaming flag is momentarily stale between stream:end and agent:idle.
    typeof metadata?.finishReason === 'string'
  );
}

function isStreamingMessage(message: AgentMessage | undefined): boolean {
  if (hasTerminalMessageMetadata(message)) return false;
  return message?.isStreaming === true || message?.streamingComplete === false;
}

function getCurrentStreamingAssistantMessage(stored: StoredAgentSession): AgentMessage | undefined {
  const messages = stored.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'assistant' && isStreamingMessage(message)) return message;
  }

  const latestMessage = messages[messages.length - 1];
  if (
    stored.isStreaming === true &&
    latestMessage?.role === 'assistant' &&
    !hasTerminalMessageMetadata(latestMessage)
  ) {
    return latestMessage;
  }

  return undefined;
}

function getCurrentStreamingText(message: AgentMessage | undefined): string {
  const contentBlocks = message?.contentBlocks ?? [];
  let lastToolUseIndex = -1;
  for (let i = contentBlocks.length - 1; i >= 0; i--) {
    if (contentBlocks[i].type === 'tool_use') {
      lastToolUseIndex = i;
      break;
    }
  }

  let streamingText = '';
  for (let i = lastToolUseIndex + 1; i < contentBlocks.length; i++) {
    const block = contentBlocks[i];
    if (block.type === 'text') streamingText += getContentBlockText(block);
  }
  return streamingText;
}

function isTerminalAgentStatus(status: AgentStatus): boolean {
  return (
    status === AgentStatus.Completed ||
    status === AgentStatus.Error ||
    status === AgentStatus.Deleted
  );
}

/**
 * Daemon-owned "paused on child/peer agents" flag (PROTOCOL.md §5.5), rendered
 * verbatim. The FE no longer infers this from `metadata.waitingForAgentIds`.
 */
function isAgentWaitingForOtherAgents(stored: StoredAgentSession): boolean {
  if (isTerminalAgentStatus(stored.status)) return false;
  return stored.isWaitingForOtherAgents === true;
}

/**
 * Waiting state driven by BE-owned signals: explicit `Waiting` status or the
 * daemon's `isWaitingOnTool` flag (unresolved tool_use on the in-flight turn).
 * The FE no longer re-derives tool/MCP resolution from message internals.
 */
function isAgentWaiting(stored: StoredAgentSession): boolean {
  if (isTerminalAgentStatus(stored.status)) return false;
  return stored.status === AgentStatus.Waiting || stored.isWaitingOnTool === true;
}

/**
 * Whether the turn is live in the daemon's sense — `isResponding` or the
 * transient FE-owned send signals. `isWaitingOnTool` is deliberately excluded:
 * it is the discriminator the blocked-waiting predicate below tests against.
 */
function isTurnInFlight(stored: StoredAgentSession): boolean {
  return (
    stored.isResponding === true ||
    stored.isStreaming === true ||
    stored.isProcessing === true
  );
}

/**
 * Waiting state that genuinely blocks on someone else — the hourglass
 * indicator. It is the BE-owned waiting signals MINUS the ones a live turn
 * contradicts:
 *
 * - `isWaitingForOtherAgents` is the daemon's explicit peer/child pause and
 *   can legitimately hold mid-turn, so it counts unconditionally. A wake
 *   clears the parked flag in the reducer (`chatQueueProcessingReceived`,
 *   and the running-transition clear in `updateSessionFields`).
 * - `isWaitingOnTool` on an in-flight turn is the agent executing a tool —
 *   work, not a block.
 * - A `Waiting` STATUS is a coarse between-turns marker with no dedicated
 *   clear path of its own: the daemon revises it on the next
 *   `agent:status-changed`, which is exactly the signal that can lag a
 *   turn start (a queue drain opens the busy flags before it lands). So it
 *   only counts when no turn is in flight; the dedicated flags above still
 *   raise the hourglass for a genuine mid-turn block.
 */
function isAgentBlockedWaiting(stored: StoredAgentSession): boolean {
  if (isTerminalAgentStatus(stored.status)) return false;
  if (isAgentWaitingForOtherAgents(stored)) return true;
  if (isTurnInFlight(stored)) return false;
  return stored.status === AgentStatus.Waiting || stored.isWaitingOnTool === true;
}

/**
 * Active-thread state driven by BE-owned activity flags (PROTOCOL.md §5.5:
 * `isResponding`, `isWaitingOnTool`) plus transient FE-owned signals
 * (optimistic `isStreaming`/`isProcessing` set on send, `ACTIVATING`) and the
 * agent status. The FE no longer infers "working" from raw message internals.
 */
function isActiveAgentThread(stored: StoredAgentSession): boolean {
  if (isTerminalAgentStatus(stored.status)) {
    return false;
  }

  return (
    stored.isProcessing === true ||
    stored.isStreaming === true ||
    stored.isResponding === true ||
    stored.isWaitingOnTool === true ||
    stored.activationState === AgentActivationState.ACTIVATING ||
    stored.status === AgentStatus.Active ||
    stored.status === AgentStatus.Processing ||
    stored.status === AgentStatus.Waiting
  );
}

// ============================================================================
// Selectors
// ============================================================================

/** Select a single agent session by agentId */
export const selectAgentSession = store.createSelector(
  (state, agentId?: string): AgentSession | undefined => {
    if (!agentId) return undefined;
    return materializeSession(state.agentSessions?.byAgentId[agentId]);
  },
);

/** Select the resolved provider for a given agent without materializing messages. */
export const selectAgentProvider = store.createSelector(
  (state, agentId?: string): string | undefined => {
    if (!agentId) return undefined;
    const stored = state.agentSessions?.byAgentId[agentId];
    return stored
      ? getAgentProvider(stored, selectEffectiveDefaultProviderId.select(state))
      : undefined;
  },
);

/** Select specific agent sessions by agent IDs. */
export const selectAgentSessionsByIds = store.createSelector(
  (state, agentIds: string[]): AgentSession[] => {
    const result: AgentSession[] = [];
    for (const id of agentIds) {
      const materialized = materializeSession(state.agentSessions?.byAgentId[id]);
      if (materialized) result.push(materialized);
    }
    return result;
  },
);

/** Select messages for a given agent (ordered array) */
export const selectAgentMessages = store.createSelector(
  (state, agentId: string): AgentMessage[] => {
    const stored = state.agentSessions?.byAgentId[agentId];
    return stored ? stored.messages : [];
  },
);

const EMPTY_HISTORY_MESSAGES: AgentMessage[] = [];

/** Select the hydrated scrollback history segment rows for a given agent (ordered array). */
export const selectAgentHistoryMessages = store.createSelector(
  (state, agentId: string): AgentMessage[] => {
    const segment = state.agentSessions?.historySegmentsByAgentId?.[agentId];
    return segment ? segment.messages : EMPTY_HISTORY_MESSAGES;
  },
);

export interface HistorySegmentMeta {
  /** true when a hole is open between history and the tail. */
  gapToTail: boolean;
  /** true once the conversation's true first message has been hydrated. */
  oldestReached: boolean;
  /** Number of hydrated history rows. */
  historyCount: number;
  /** Number of resident tail rows. */
  tailCount: number;
  /**
   * Estimated conversation ordinal of the segment's first row (seek-seeded
   * segments only); null for serial-walk segments (split by
   * `holeRowsEstimate` instead).
   */
  startOrdinalEstimate: number | null;
  /**
   * Estimated rows inside the open history→tail hole (serial-walk segments:
   * newest-side cap prunes minus gap refills); null when untracked.
   */
  holeRowsEstimate: number | null;
}

/** Select scrollback history segment metadata (gap flag, oldestReached, counts). */
export const selectHistorySegmentMeta = store.createSelector(
  (state, agentId: string): HistorySegmentMeta => {
    const segment = state.agentSessions?.historySegmentsByAgentId?.[agentId];
    const tailCount = state.agentSessions?.byAgentId[agentId]?.messages.length ?? 0;
    return {
      gapToTail: segment?.gapToTail === true,
      oldestReached: segment?.oldestReached === true,
      historyCount: segment?.messages.length ?? 0,
      tailCount,
      startOrdinalEstimate: segment?.startOrdinalEstimate ?? null,
      holeRowsEstimate: segment?.holeRowsEstimate ?? null,
    };
  },
);

/**
 * Select a single message by id within an agent session.
 * Returns the live message reference from Redux state, so components that
 * subscribe via this selector stay in sync during streaming updates instead
 * of depending on a possibly-stale prop.
 *
 * Bounded lookup over the stored ordered message list; falls back to the
 * scrollback history segment so paged-in history rows resolve too (they
 * live in `historySegmentsByAgentId`, not the tail — without the fallback
 * every history row renders as the "Loading..." placeholder).
 */
export const selectAgentMessageById = store.createSelector(
  (state, agentId: string, messageId: string): AgentMessage | undefined => {
    if (!agentId || !messageId) return undefined;
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return undefined;
    const tailMatch = stored.messages.find((message) => message.id === messageId);
    if (tailMatch) return tailMatch;
    const segment = state.agentSessions?.historySegmentsByAgentId?.[agentId];
    return segment?.messages.find((message) => message.id === messageId);
  },
);

/**
 * Canonical selector for the raw session processing flag. This intentionally
 * preserves processing semantics separately from responding/waiting state.
 */
export const selectAgentSessionIsProcessing = store.createSelector(
  (state, agentId: string): boolean =>
    state.agentSessions?.byAgentId[agentId]?.isProcessing === true,
);

/** Select the raw session streaming flag. */
export const selectAgentSessionIsStreaming = store.createSelector(
  (state, agentId: string): boolean =>
    state.agentSessions?.byAgentId[agentId]?.isStreaming === true,
);

/**
 * Select the currently visible streaming assistant text from canonical
 * agent-session messages. Text before the latest tool_use belongs to a previous
 * segment, so tool-use boundaries clear the transient visible streaming text
 * without removing persisted content blocks from the assistant message.
 */
export const selectAgentSessionStreamingContent = store.createSelector(
  (state, agentId: string): string => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return '';
    return getCurrentStreamingText(getCurrentStreamingAssistantMessage(stored));
  },
);

/**
 * Select whether the session holds a stream-owned assistant message — one the
 * standing `chat.subscribe` delta stream is actively growing (viewed agents
 * only). Distinguishes character-level live content from
 * `selectAgentSessionStreamingContent`'s session-flag fallback, which can
 * surface the last PERSISTED assistant message's text while a non-viewed
 * agent streams a new turn (its transcript never grows mid-turn). The
 * message-level flag stays accurate across navigate-away because
 * The chat-subscribe saga normalizes stale `isStreaming` /
 * `streamingComplete` flags when it tears down a mid-turn subscription.
 */
export const selectAgentSessionHasStreamOwnedMessage = store.createSelector(
  (state, agentId: string): boolean => {
    const messages = state.agentSessions?.byAgentId[agentId]?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === 'assistant' && isStreamingMessage(message)) return true;
    }
    return false;
  },
);

/**
 * Select whether the transcript's actual TAIL entry is a stream-owned
 * assistant message — stricter than `selectAgentSessionHasStreamOwnedMessage`,
 * which reports true for a streaming assistant row ANYWHERE in the array. An
 * interrupt-priority send can persist a new user message immediately after a
 * still-streaming assistant row, so "some streaming assistant message
 * exists" is too broad a signal for latching a watched-streaming-tail
 * suppression marker: it would suppress the divider for a newer reply the
 * user never actually saw. This selector only answers true when the
 * streaming assistant message is genuinely the last thing in the transcript.
 */
export const selectAgentSessionHasStreamingTailMessage = store.createSelector(
  (state, agentId: string): boolean => {
    const messages = state.agentSessions?.byAgentId[agentId]?.messages ?? [];
    const lastMessage = messages[messages.length - 1];
    return lastMessage?.role === 'assistant' && isStreamingMessage(lastMessage);
  },
);

/** Select the workspace ID for a given agent session. */
export const selectAgentSessionWorkspaceId = store.createSelector(
  (state, agentId: string): AgentSession['workspaceId'] | undefined =>
    state.agentSessions?.byAgentId[agentId]?.workspaceId,
);

/**
 * Current reasoning effort for an agent session (Option B first-class session
 * field, PROTOCOL §5.5). Rendered verbatim from the stored session:
 * `undefined` when unset (provider default) or when the session is unknown.
 *
 * Compatibility: sessions whose stored model is still the legacy codex
 * compound form (`{model}/{effort}`) surface the suffix as the effective
 * effort when no first-class field is set, so pre-migration sessions render
 * sensibly (the daemon splits the compound id at the session-read seam).
 * Guarded the same way as the daemon's migration `0080`: the suffix must be a
 * known codex effort level AND the session must show codex evidence, so
 * slash-bearing non-codex ids (HuggingFace-style `org/model`) are never split.
 */
const LEGACY_CODEX_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const LEGACY_CODEX_EFFORT_MODELS = new Set([
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.1-codex-max',
]);

export const selectAgentReasoningEffort = store.createSelector(
  (state, agentId: string): string | undefined => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return undefined;
    if (typeof stored.reasoningEffort === 'string' && stored.reasoningEffort.length > 0) {
      return stored.reasoningEffort;
    }
    if (stored.reasoningEffort === null) return undefined;
    const model = stored.model;
    if (typeof model !== 'string') return undefined;
    const slashIndex = model.indexOf('/');
    if (slashIndex <= 0 || slashIndex >= model.length - 1) return undefined;
    const suffix = model.slice(slashIndex + 1);
    if (!LEGACY_CODEX_EFFORTS.has(suffix)) return undefined;
    const base = model.slice(0, slashIndex);
    const isCodex =
      getAgentProvider(stored, selectEffectiveDefaultProviderId.select(state)) === 'codex' ||
      base.startsWith('codex:') ||
      LEGACY_CODEX_EFFORT_MODELS.has(base);
    return isCodex ? suffix : undefined;
  },
);

/** Select whether a session exists for a given agent. */
export const selectAgentSessionExists = store.createSelector(
  (state, agentId: string): boolean =>
    state.agentSessions?.byAgentId[agentId] !== undefined,
);

/**
 * Select whether first-send activation has reached a terminal store state.
 * Active/backed sessions are ready to send; activation errors are terminal so
 * callers can surface the stored activation error instead of waiting forever.
 *
 * Note: no production call site consumes this today — the live send path
 * guards activation inline in `agent-send.ts` (`needsActivation`).
 * The selector is kept correct for future first-send waiters.
 */
export const selectAgentActivationWaitComplete = store.createSelector(
  (state, agentId: string): boolean => {
    const session = state.agentSessions?.byAgentId[agentId];
    if (!session) return false;
    if (session.activationState === AgentActivationState.ERROR) return true;
    // ACTIVE is terminal even when backendSessionId hasn't landed yet —
    // re-waiting here would strand the first send (upstream #709 guard).
    if (session.activationState === AgentActivationState.ACTIVE) return true;
    return session.status !== AgentStatus.Pending && !!session.backendSessionId;
  },
);

/**
 * Canonical selector for agent responding state. Preserves the established active
 * thread semantics from session flags/statuses and streaming assistant messages.
 */
export const selectAgentIsResponding = store.createSelector(
  (state, agentId: string): boolean => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return false;
    return isActiveAgentThread(stored);
  },
);

/** @deprecated Renderer-visible queues live in agentQueue. Use selectAgentQueueMessages directly. */
export const selectAgentQueuedMessages = store.createSelector(
  (state, agentId: string): QueuedMessage[] =>
    selectAgentQueueMessages.select(state, agentId),
);

/** Select all agents that are currently streaming */
export const selectAllStreamingAgents = store.createSelector(
  (state): AgentSession[] => {
    const byAgentId = state.agentSessions?.byAgentId ?? {};
    const result: AgentSession[] = [];
    for (const id of Object.keys(byAgentId)) {
      const stored = byAgentId[id];
      if (stored?.isStreaming === true) {
        const materialized = materializeSession(stored);
        if (materialized) result.push(materialized);
      }
    }
    return result;
  },
);

/** Select all agents with live work that should retain workspace interest. */
export const selectAllRetainedAgentSessions = store.createSelector(
  (state): AgentSession[] => {
    const byAgentId = state.agentSessions?.byAgentId ?? {};
    const result: AgentSession[] = [];
    for (const id of Object.keys(byAgentId)) {
      const stored = byAgentId[id];
      if (stored && (isActiveAgentThread(stored) || isAgentWaitingForOtherAgents(stored))) {
        const materialized = materializeSession(stored);
        if (materialized) result.push(materialized);
      }
    }
    return result;
  },
);

/**
 * Canonical selector for active agent thread state that drives the Agent Overview
 * `Thinking...` label and specialist avatar animation.
 */
export const selectAgentIsThinking = store.createSelector(
  (state, agentId: string): boolean =>
    selectAgentIsResponding.select(state, agentId),
);

/**
 * Canonical boolean selector for agents paused on child/peer agents. It renders
 * the daemon's `isWaitingForOtherAgents` flag verbatim (PROTOCOL.md §5.5) and
 * never re-derives it from relationship metadata.
 */
export const selectAgentIsWaitingForOtherAgents = store.createSelector(
  (state, agentId: string): boolean => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return false;
    return isAgentWaitingForOtherAgents(stored);
  },
);

/**
 * Canonical selector for agent waiting state. Driven by BE-owned signals:
 * explicit Waiting status, the daemon's `isWaitingOnTool` flag (unresolved
 * tool_use on the in-flight turn), and the `isWaitingForOtherAgents` flag.
 */
export const selectAgentIsWaiting = store.createSelector(
  (state, agentId: string): boolean => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return false;
    return isAgentWaiting(stored) || selectAgentIsWaitingForOtherAgents.select(state, agentId);
  },
);

/**
 * Status-indicator variant of `selectAgentIsWaiting`: true only for waits that
 * genuinely block on something outside the agent (explicit `Waiting` status,
 * paused on peer/child agents, or a tool wait with no live turn behind it).
 * A tool executing inside an in-flight responding turn is active work, so this
 * returns false there and the surface renders "running" rather than the
 * hourglass.
 */
export const selectAgentIsBlockedWaiting = store.createSelector(
  (state, agentId: string): boolean => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return false;
    return isAgentBlockedWaiting(stored);
  },
);

/**
 * Pending attention request (discussion/blocker) for an agent, rendered
 * verbatim from the daemon session fields (PROTOCOL §5.5) — top-level on the
 * full projection, under `metadata` on `AgentLite`. Returns null when no
 * request is pending (the daemon clears the fields only on a user-origin
 * delivery — sendMessage, sendQueuedMessageNow, editAndRegenerate, or a
 * drained user-origin queue entry — emitting `agent:updated` with
 * `attentionRequestCleared: true`; automatic deliveries leave it pending).
 */
export const selectAgentAttentionRequest = store.createSelector(
  (state, agentId: string): AgentAttentionRequest | null => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return null;
    return getAgentAttentionRequest(stored);
  },
);

/**
 * THE canonical "is the agent currently running" selector.
 *
 * Returns true whenever the agent is actively doing work and is NOT in a
 * terminal state (Completed/Error/Deleted). It is true for any of the BE-owned
 * activity flags (`isResponding`, `isWaitingOnTool`, `isWaitingForOtherAgents`),
 * the transient FE-owned `isStreaming`/`isProcessing`/`ACTIVATING` send signals,
 * and status `Active`/`Processing`/`Waiting`. It is false for terminal statuses
 * and for genuinely idle/cleanly-ended turns.
 *
 * This is the single source of truth UI surfaces should consult when gating
 * idle-only affordances (such as next-steps links). It composes the existing
 * active-thread and waiting-for-other-agents semantics so it stays consistent
 * with `selectAgentIsResponding` and `selectAgentIsWaiting`.
 */
export const selectAgentIsRunning = store.createSelector(
  (state, agentId: string): boolean => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return false;
    return isActiveAgentThread(stored) || isAgentWaitingForOtherAgents(stored);
  },
);
