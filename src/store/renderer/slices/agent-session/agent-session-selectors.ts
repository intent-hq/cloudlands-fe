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
      ? getAgentProvider(stored, state.providerCatalog?.defaultProviderId ?? '')
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
