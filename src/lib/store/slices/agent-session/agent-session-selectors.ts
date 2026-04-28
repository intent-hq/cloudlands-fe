import type { StoreState } from "../../types";
import { createSelector } from "../../utils/create-selector";
import type { AgentSession, AgentMessage, QueuedMessage } from "$shared/types";
import { getItem, getItems } from "../../utils/collection-utils";
import type { StoredAgentSession } from "./agent-session-types";

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
function materializeSession(stored: StoredAgentSession | undefined): AgentSession | undefined {
  if (!stored) return undefined;
  const cached = materializedCache.get(stored);
  if (cached) return cached;
  const materialized: AgentSession = { ...stored, messages: getItems(stored.messages) };
  materializedCache.set(stored, materialized);
  return materialized;
}

// ============================================================================
// Selectors
// ============================================================================

/** Select a single agent session by agentId */
export const selectAgentSession = createSelector(
  (state: StoreState, agentId: string): AgentSession | undefined =>
    materializeSession(state.agentSessions?.byAgentId[agentId]),
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

/** Select all sessions for a workspace using the index */
export const selectAgentSessionsByWorkspace = createSelector(
  (state: StoreState, wsId: string): AgentSession[] => {
    const agentIds = state.agentSessions?.agentIdsByWorkspace[wsId] ?? [];
    const result: AgentSession[] = [];
    for (const id of agentIds) {
      const stored = state.agentSessions?.byAgentId[id];
      if (stored) {
        const materialized = materializeSession(stored);
        if (materialized) result.push(materialized);
      }
    }
    return result;
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

/** Select whether an agent is streaming */
export const selectAgentIsStreaming = createSelector(
  (state: StoreState, agentId: string): boolean =>
    state.agentSessions?.byAgentId[agentId]?.isStreaming === true,
);

/** Select whether an agent is processing */
export const selectAgentIsProcessing = createSelector(
  (state: StoreState, agentId: string): boolean =>
    state.agentSessions?.byAgentId[agentId]?.isProcessing === true,
);

/** Select queued messages for an agent */
export const selectAgentQueuedMessages = createSelector(
  (state: StoreState, agentId: string): QueuedMessage[] =>
    state.agentSessions?.byAgentId[agentId]?.queuedMessages ?? [],
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

