import type { StoreState } from "../../types";
import { createSelector } from "../../utils/create-selector";
import { AgentStatus, type AgentSession, type AgentMessage, type QueuedMessage } from "$shared/types";
import { AgentActivationState } from "$shared/types/agent-session";
import { getItem, getItems } from "../../utils/collection-utils";
import type { StoredAgentSession } from "./agent-session-types";
import { selectAgentQueueMessages } from "../agent-queue/agent-queue-selectors";

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Memoize materialized sessions keyed on their stored (Collection-backed)
 * reference. As long as the reducer does not replace the stored entry, callers
 * that go through `materializeSession` (e.g. `selectAgentSession.select`)
 * receive the same object reference — preserving reference-equality guarantees
 * that subscription layers rely on for dedup.
 */
const materializedCache = new WeakMap<StoredAgentSession, AgentSession>();

/**
 * Materialize the stored (Collection-backed) session shape back to the
 * public `AgentSession` shape expected by callers — specifically, `messages`
 * as an ordered array.
 */
function materializeSession(stored: StoredAgentSession | undefined): AgentSession | null {
  if (!stored) return null;
  const cached = materializedCache.get(stored);
  if (cached) return cached;
  const materialized: AgentSession = { ...stored, messages: getItems(stored.messages) };
  materializedCache.set(stored, materialized);
  return materialized;
}

function getLatestAssistantMessage(stored: StoredAgentSession): AgentMessage | undefined {
  const messages = getItems(stored.messages);
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

function hasUnresolvedToolUse(message: AgentMessage | undefined): boolean {
  const contentBlocks = message?.contentBlocks ?? [];
  const hasUnresolvedContentBlock = contentBlocks.some((block) => {
    if (block.type !== 'tool_use' || !(block.name || block.toolName)) return false;
    return !contentBlocks.some((candidate) => {
      if (candidate.type !== 'tool_result') return false;
      return candidate.tool_use_id === block.id || candidate.toolCallId === block.id;
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
export const selectAgentSession = createSelector(
  (state: StoreState, agentId?: string): AgentSession | null => {
    if (!agentId) return null;
    return materializeSession(state.agentSessions?.byAgentId[agentId]);
  },
);

/** Select specific agent sessions by agent IDs. */
export const selectAgentSessionsByIds = createSelector(
  (state: StoreState, agentIds: string[]): AgentSession[] => {
    const result: AgentSession[] = [];
    for (const id of agentIds) {
      const materialized = materializeSession(state.agentSessions?.byAgentId[id]);
      if (materialized) result.push(materialized);
    }
    return result;
  },
);

/** Select messages for a given agent (ordered array) */
export const selectAgentMessages = createSelector(
  (state: StoreState, agentId: string): AgentMessage[] => {
    const stored = state.agentSessions?.byAgentId[agentId];
    return stored ? getItems(stored.messages) : [];
  },
);

/**
 * Select a single message by id within an agent session.
 * Returns the live message reference from Redux state, so components that
 * subscribe via this selector stay in sync during streaming updates instead
 * of depending on a possibly-stale prop.
 *
 * O(1) Collection lookup via `getItem`.
 */
export const selectAgentMessageById = createSelector(
  (state: StoreState, agentId: string, messageId: string): AgentMessage | undefined => {
    if (!agentId || !messageId) return undefined;
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return undefined;
    return getItem(stored.messages, messageId);
  },
);

/** Select all agent sessions across all workspaces */
export const selectAllAgentSessions = createSelector(
  (state: StoreState): AgentSession[] => {
    const byAgentId = state.agentSessions?.byAgentId ?? {};
    const result: AgentSession[] = [];
    for (const id of Object.keys(byAgentId)) {
      const materialized = materializeSession(byAgentId[id]);
      if (materialized) result.push(materialized);
    }
    return result;
  },
);

/**
 * Canonical selector for the raw session processing flag. This intentionally
 * preserves processing semantics separately from responding/waiting state.
 */
export const selectAgentSessionIsProcessing = createSelector(
  (state: StoreState, agentId: string): boolean =>
    state.agentSessions?.byAgentId[agentId]?.isProcessing === true,
);

/**
 * Canonical selector for agent responding state. Preserves the established active
 * thread semantics from session flags/statuses and streaming assistant messages.
 */
export const selectAgentIsResponding = createSelector(
  (state: StoreState, agentId: string): boolean => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return false;
    return isActiveAgentThread(stored);
  },
);

/** @deprecated Renderer-visible queues live in agentQueue. Use selectAgentQueueMessages directly. */
export const selectAgentQueuedMessages = createSelector(
  (state: StoreState, agentId: string): QueuedMessage[] =>
    selectAgentQueueMessages.select(state, agentId),
);

/** Select all agents that are currently streaming */
export const selectAllStreamingAgents = createSelector(
  (state: StoreState): AgentSession[] => {
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

/**
 * Canonical selector for active agent thread state that drives the Agent Overview
 * `Thinking...` label and specialist avatar animation.
 */
export const selectAgentIsThinking = createSelector(
  (state: StoreState, agentId: string): boolean =>
    selectAgentIsResponding.select(state, agentId),
);

/**
 * Canonical boolean selector for agents paused on child/peer agents. It is
 * derived only from existing waiting-for-agent relationship metadata and never
 * exposes an object model or graph transport field.
 */
export const selectAgentIsWaitingForOtherAgents = createSelector(
  (state: StoreState, agentId: string): boolean => {
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
export const selectAgentIsWaiting = createSelector(
  (state: StoreState, agentId: string): boolean => {
    const stored = state.agentSessions?.byAgentId[agentId];
    if (!stored) return false;
    return isAgentWaiting(stored) || selectAgentIsWaitingForOtherAgents.select(state, agentId);
  },
);
