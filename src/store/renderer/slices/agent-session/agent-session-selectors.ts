import { store } from "../../store";
import {
  AgentStatus,
  type AgentSession,
  type AgentMessage,
  type QueuedMessage,
} from "$shared/types";
import { AgentActivationState, getAgentProvider } from "$shared/types/agent-session";
import { getContentBlockText } from "$shared/utils/content-block-helpers";
import type { StoredAgentSession } from "./agent-session-types";
import { selectAgentQueueMessages } from "../agent-queue/agent-queue-selectors";

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

function getLatestAssistantMessage(stored: StoredAgentSession): AgentMessage | undefined {
  const messages = stored.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i];
  }
  return undefined;
}

function hasTerminalMessageMetadata(message: AgentMessage | undefined): boolean {
  const metadata = message?.metadata;
  return metadata?.interrupted === true || typeof metadata?.stopReason === 'string';
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

function hasUnresolvedToolUse(message: AgentMessage | undefined): boolean {
  // Finalized messages cannot have "still running" tool calls. A persisted
  // message whose stream completed or terminated (interrupted, stop reason,
  // explicit streamingComplete) may still contain a trailing tool_use without
  // a matching tool_result — that's a leftover from a crashed/interrupted
  // stream, not an in-flight tool call. Treat it as resolved so the agent is
  // not stuck in the "Thinking" state after reload.
  if (hasTerminalMessageMetadata(message)) return false;
  if (message?.streamingComplete === true) return false;

  const contentBlocks = message?.contentBlocks ?? [];
  const hasUnresolvedContentBlock = contentBlocks.some((block) => {
    if (block.type !== 'tool_use' || !(block.name || block.toolName)) return false;
    // Per PROTOCOL.md §7, tool_use blocks carry both an addressable `id`
    // (messageId:blockIndex) and a provider `toolCallId`; tool_result blocks
    // reference the tool call via `tool_use_id` (canonically the toolCallId).
    // Pair against both so blocks pair regardless of which identifier shape the
    // backend emits.
    return !contentBlocks.some((candidate) => {
      if (candidate.type !== 'tool_result') return false;
      const candidateRefs = [candidate.tool_use_id, candidate.toolCallId];
      const blockRefs = [block.id, block.toolCallId];
      return candidateRefs.some(
        (ref) => ref !== undefined && blockRefs.some((target) => target !== undefined && ref === target),
      );
    });
  });
  if (hasUnresolvedContentBlock) return true;

  const toolCalls = message?.toolCalls ?? [];
  const toolResults = message?.toolResults ?? [];
  return toolCalls.some((toolCall) => {
    if (toolCall.status === 'pending' || toolCall.status === 'running') return true;
    if (toolCall.status === 'completed' || toolCall.status === 'failed') return false;
    if (toolCall.result !== undefined || toolCall.error !== undefined) return false;
    return !toolResults.some((result) => result.toolCallId === toolCall.id);
  });
}

function isTerminalAgentStatus(status: AgentStatus): boolean {
  return (
    status === AgentStatus.Completed ||
    status === AgentStatus.Error ||
    status === AgentStatus.Deleted
  );
}

function hasWaitingForAgentRelationships(stored: StoredAgentSession): boolean {
  const waitingForAgentIds = (stored.metadata as { waitingForAgentIds?: unknown } | undefined)
    ?.waitingForAgentIds;
  return Array.isArray(waitingForAgentIds) && waitingForAgentIds.length > 0;
}

function isAgentWaitingForOtherAgents(stored: StoredAgentSession): boolean {
  if (isTerminalAgentStatus(stored.status)) return false;
  return hasWaitingForAgentRelationships(stored);
}

function isAgentWaiting(stored: StoredAgentSession): boolean {
  if (isTerminalAgentStatus(stored.status)) return false;

  return (
    stored.status === AgentStatus.Waiting ||
    hasUnresolvedToolUse(getLatestAssistantMessage(stored))
  );
}

function isActiveAgentThread(stored: StoredAgentSession): boolean {
  if (isTerminalAgentStatus(stored.status)) {
    return false;
  }

  const latestAssistant = getLatestAssistantMessage(stored);

  return (
    stored.isProcessing === true ||
    stored.isStreaming === true ||
    stored.isResponding === true ||
    stored.activationState === AgentActivationState.ACTIVATING ||
    stored.status === AgentStatus.Active ||
    stored.status === AgentStatus.Processing ||
    stored.status === AgentStatus.Waiting ||
    hasUnresolvedToolUse(latestAssistant) ||
    isStreamingMessage(latestAssistant)
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
    return stored ? getAgentProvider(stored) : undefined;
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

/**
 * Select a single message by id within an agent session.
 * Returns the live message reference from Redux state, so components that
 * subscribe via this selector stay in sync during streaming updates instead
 * of depending on a possibly-stale prop.
 *
 * Bounded lookup over the stored ordered message list.
 */
export const selectAgentMessageById = store.createSelector(
  (state, agentId: string, messageId: string): AgentMessage | undefined => {
    if (!agentId || !messageId) return undefined;
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return undefined;
    return stored.messages.find((message) => message.id === messageId);
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

/** Select the workspace ID for a given agent session. */
export const selectAgentSessionWorkspaceId = store.createSelector(
  (state, agentId: string): AgentSession['workspaceId'] | undefined =>
    state.agentSessions?.byAgentId[agentId]?.workspaceId,
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
 */
export const selectAgentActivationWaitComplete = store.createSelector(
  (state, agentId: string): boolean => {
    const session = state.agentSessions?.byAgentId[agentId];
    if (!session) return false;
    if (session.activationState === AgentActivationState.ERROR) return true;
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
 * Canonical boolean selector for agents paused on child/peer agents. It is
 * derived only from existing waiting-for-agent relationship metadata and never
 * exposes an object model or graph transport field.
 */
export const selectAgentIsWaitingForOtherAgents = store.createSelector(
  (state, agentId: string): boolean => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return false;
    return isAgentWaitingForOtherAgents(stored);
  },
);

/**
 * Canonical selector for agent waiting state. Includes explicit Waiting status,
 * waiting-for-other-agents relationships, and unresolved tool/MCP calls represented
 * by either tool_use blocks without matching tool_result blocks or pending/running
 * message toolCalls without a result.
 */
export const selectAgentIsWaiting = store.createSelector(
  (state, agentId: string): boolean => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return false;
    return isAgentWaiting(stored) || selectAgentIsWaitingForOtherAgents.select(state, agentId);
  },
);

/**
 * THE canonical "is the agent currently running" selector.
 *
 * Returns true whenever the agent is actively doing work and is NOT in a
 * terminal state (Completed/Error/Deleted). It is true for any of: `isStreaming`,
 * `isProcessing`, `isResponding`, activation `ACTIVATING`, status
 * `Active`/`Processing`/`Waiting`, unresolved/in-flight tool calls, an in-flight
 * streaming assistant message, and waiting-for-other-agents relationships. It is
 * false for terminal statuses and for genuinely idle/cleanly-ended turns.
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
