import { store } from '../../store';
import {
  AgentStatus,
  type AgentSession,
  type AgentMessage,
  type QueuedMessage,
  type ToolUseBlock,
} from '$shared/types';
import { AgentActivationState, getAgentProvider } from '$shared/types/agent-session';
import { getContentBlockText } from '$shared/utils/content-block-helpers';
import {
  getAgentAttentionRequest,
  type AgentAttentionRequest,
} from '$shared/utils/agent-attention';
import { isAgentBlockedWaitingState, isAgentRunningState } from '$shared/utils/agent-runtime-state';
import { getAgentPeekData } from '$lib/utils/agent-peek-utils';
import { classifyTool } from '$lib/utils/tool-classifier';
import { deriveAgentCardPreview, type AgentCardPreview } from '$lib/utils/agent-preview';
import { getLastMeaningfulLine, stripUserMessagePrefixes } from '$lib/utils/text-utils';
import type { StoredAgentSession } from './agent-session-types';
import { selectAgentQueueMessages } from '../agent-queue/agent-queue-selectors';
import { selectChatReceivedFirstChunk } from '../chat-state/chat-state-selectors';
import { selectEffectiveDefaultProviderId } from '../provider-catalog/provider-catalog-selectors';

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
 * Purple waiting is an explicit Waiting status or peer/child pause with no
 * active turn. `turnInFlight`, the sticky `liveTurnOpen`, runtime flags, and
 * `isWaitingOnTool` all win because they describe work that is still running.
 */
function isAgentBlockedWaiting(stored: StoredAgentSession): boolean {
  return isAgentBlockedWaitingState(stored);
}

/**
 * Active-thread state driven by BE-owned activity flags and turn-liveness,
 * plus transient FE-owned send signals and the running lifecycle statuses.
 */
function isActiveAgentThread(stored: StoredAgentSession): boolean {
  return isAgentRunningState(stored);
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

/** Select the canonical session map for dynamic component-owned ID sets. */
export const selectAgentSessionsById = store.createSelector(
  (state): Readonly<Record<string, AgentSession>> => state.agentSessions?.byAgentId ?? {},
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
const LEGACY_CODEX_EFFORT_MODELS = new Set(['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max']);

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
  (state, agentId: string): boolean => state.agentSessions?.byAgentId[agentId] !== undefined,
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
export const selectAgentIsResponding = store.createSelector((state, agentId: string): boolean => {
  const stored = state.agentSessions?.byAgentId[agentId];
  if (!stored) return false;
  return isActiveAgentThread(stored);
});

/** @deprecated Renderer-visible queues live in agentQueue. Use selectAgentQueueMessages directly. */
export const selectAgentQueuedMessages = store.createSelector(
  (state, agentId: string): QueuedMessage[] => selectAgentQueueMessages.select(state, agentId),
);

/** Select all agents that are currently streaming */
export const selectAllStreamingAgents = store.createSelector((state): AgentSession[] => {
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
});

/** Select all agents with live work that should retain workspace interest. */
export const selectAllRetainedAgentSessions = store.createSelector((state): AgentSession[] => {
  const byAgentId = state.agentSessions?.byAgentId ?? {};
  const result: AgentSession[] = [];
  for (const id of Object.keys(byAgentId)) {
    const stored = byAgentId[id];
    if (stored && (isActiveAgentThread(stored) || isAgentBlockedWaiting(stored))) {
      const materialized = materializeSession(stored);
      if (materialized) result.push(materialized);
    }
  }
  return result;
});

/**
 * Canonical selector for active agent thread state that drives the Agent Overview
 * `Thinking...` label and specialist avatar animation.
 */
export const selectAgentIsThinking = store.createSelector((state, agentId: string): boolean =>
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
 * explicit Waiting status, the daemon's `isWaitingOnTool` activity flag, and
 * the `isWaitingForOtherAgents` flag. This raw reason selector is not the
 * avatar color; `selectAgentIsBlockedWaiting` applies active-turn precedence.
 */
export const selectAgentIsWaiting = store.createSelector((state, agentId: string): boolean => {
  const stored = state.agentSessions?.byAgentId[agentId];
  if (!stored) return false;
  return isAgentWaiting(stored) || selectAgentIsWaitingForOtherAgents.select(state, agentId);
});

/**
 * Status-indicator variant of `selectAgentIsWaiting`: true only for waits that
 * genuinely block on something outside the agent. Tool execution is always
 * active evidence, and a live orchestration turn wins over a concurrent
 * peer-wait flag. Purple appears only after the turn ends.
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
 * activity flags (`isResponding`, `isWaitingOnTool`, `turnInFlight`),
 * the transient FE-owned `isStreaming`/`isProcessing`/`ACTIVATING` send signals,
 * the sticky `liveTurnOpen`, a `lastToolUse.status === "running"`, and status
 * `Active`/`Processing`. It is false for blocked waits, terminal statuses, and
 * genuinely idle/cleanly-ended turns.
 *
 * This is the single source of truth UI surfaces should consult when gating
 * idle-only affordances (such as next-steps links). It composes the existing
 * active-thread and waiting-for-other-agents semantics so it stays consistent
 * with `selectAgentIsResponding` and `selectAgentIsWaiting`.
 */
export const selectAgentIsRunning = store.createSelector((state, agentId: string): boolean => {
  const stored = state.agentSessions?.byAgentId[agentId];
  if (!stored) return false;
  return isActiveAgentThread(stored);
});

/**
 * The selected canonical preview: the AgentCardPreview union plus the
 * canonical responding flag. `isLive` is `selectAgentIsResponding` at
 * derivation time — `live-text`/`live-tool` kinds always coincide with
 * `isLive === true`, and consumers that need streaming affordances for
 * persisted kinds (e.g. TaskAgentStatus's `last-tool` arm during a tool-only
 * live stretch) read it directly instead of re-deriving responding state.
 */
export type AgentPreview = AgentCardPreview & { isLive: boolean };

/**
 * Select the canonical structured single-line preview for an agent, or null
 * when the agent has no preview line. Collapses AgentCard's component-level
 * `$derived` chain so every preview surface (AgentCard, TaskAgentStatus)
 * consumes the same precedence chain: attention request → live streamed text
 * → renderable in-flight tool → newest user line → digest/report → persisted
 * transcript fallbacks. The derivation is byte-identical to AgentCard's,
 * including the `classifyTool` hidden-tool gate and the per-turn
 * `receivedFirstChunk` live-text gate (a leftover previous-turn
 * `lastAgentResponse` must not masquerade as this turn's text in the
 * pre-first-token window).
 *
 * All inputs are Redux state (AgentLite session fields, chat-state
 * `receivedFirstChunk`, the canonical responding state). The two optional
 * trailing args carry AgentCard's event-data props (`completionReport`,
 * `lastResponseSummary`), which are component-side fallback inputs rather
 * than store state — they slot into the idle report arm at exactly the
 * positions AgentCard gives them. Missing sessions still derive (yielding
 * the report arm when fallback args are provided, else null), mirroring
 * AgentCard's behavior before the session lands in state.
 */
export const selectAgentPreview = store.createSelector(
  (
    state,
    agentId: string,
    completionReportFallback?: string,
    lastResponseSummaryFallback?: string,
  ): AgentPreview | null => {
    const session = state.agentSessions?.byAgentId[agentId];
    const agentData = getAgentPeekData(session);
    const isLive = selectAgentIsResponding.select(state, agentId);
    const receivedFirstChunk = selectChatReceivedFirstChunk.select(state, agentId);

    // Pending attention request (discussion/blocker) from the daemon session
    // fields; null when none is pending.
    const attentionRequest = getAgentAttentionRequest(session);

    // While a turn is live, the session's push-applied `lastAgentResponse` —
    // gated on the per-turn `receivedFirstChunk` flag (reset by
    // `agent:stream:end`, flipped by a text-bearing `agent:stream:activity`).
    let liveResponseLine = '';
    if (isLive && receivedFirstChunk && session?.lastAgentResponse) {
      liveResponseLine = getLastMeaningfulLine(session.lastAgentResponse);
    }
    const lastResponse =
      liveResponseLine ||
      (agentData?.lastResponse ? getLastMeaningfulLine(agentData.lastResponse) : '');

    // Freshness-wins source text: transcript-derived first (agent-peek-utils
    // applies the wire fallback itself), then the direct session read as a
    // belt-and-braces fallback.
    const userFirstLine =
      stripUserMessagePrefixes(agentData?.lastUserMessage || session?.lastUserMessage || '')
        .split('\n')[0]
        ?.trim() ?? '';

    // Tool-use block to preview when the latest thing the agent did was a
    // tool call (see agent-peek-utils). Hidden tool labels fall through.
    const lastToolUse = agentData?.lastToolUse;
    const liveToolUse: ToolUseBlock | undefined =
      session?.isStreaming && session?.lastToolUse ? lastToolUse : undefined;
    const liveToolDisplay = liveToolUse
      ? classifyTool(liveToolUse.name, (liveToolUse.input as Record<string, unknown>) || {})
      : null;
    const hasRenderableLiveTool = !!liveToolUse && !liveToolDisplay?.hidden;

    const showUserMessagePreview =
      agentData?.lastMessageRole === 'user' &&
      !!userFirstLine &&
      !liveResponseLine &&
      !hasRenderableLiveTool;

    // While responding, only the live digest may serve as the report arm
    // (previous-turn summaries must never be the preview mid-turn,
    // monorepo#1327); idle agents fall back through digest → completion
    // report (prop, then metadata) → lastResponseSummary.
    const effectiveCompletionReport = isLive
      ? session?.digest || undefined
      : agentData?.digest ||
        completionReportFallback ||
        agentData?.completionReport ||
        lastResponseSummaryFallback;

    const lastUserMsg = stripUserMessagePrefixes(agentData?.lastUserMessage ?? '');

    const preview = deriveAgentCardPreview({
      attentionRequest,
      liveResponseLine,
      liveToolUse,
      hasRenderableLiveTool,
      showUserMessagePreview,
      userFirstLine,
      effectiveCompletionReport,
      lastResponse,
      lastToolUse,
      lastUserMsg,
    });

    return preview ? { ...preview, isLive } : null;
  },
);
