import type { StoreState } from "../../types";
import { createSelector } from "../../utils/create-selector";
import type { AgentSession, AgentMessage, QueuedMessage } from "$shared/types";

// ============================================================================
// Selectors
// ============================================================================

/** Select a single agent session by agentId */
export const selectAgentSession = createSelector(
  (state: StoreState, agentId: string): AgentSession | undefined =>
    state.agentSessions?.byAgentId[agentId],
);

/** Select messages for a given agent */
export const selectAgentMessages = createSelector(
  (state: StoreState, agentId: string): AgentMessage[] =>
    state.agentSessions?.byAgentId[agentId]?.messages ?? [],
);

/** Select all sessions for a workspace using the index */
export const selectAgentSessionsByWorkspace = createSelector(
  (state: StoreState, wsId: string): AgentSession[] => {
    const agentIds = state.agentSessions?.agentIdsByWorkspace[wsId] ?? [];
    const result: AgentSession[] = [];
    for (const id of agentIds) {
      const session = state.agentSessions?.byAgentId[id];
      if (session) result.push(session);
    }
    return result;
  },
);

/** Select all agent sessions across all workspaces */
export const selectAllAgentSessions = createSelector(
  (state: StoreState): AgentSession[] =>
    Object.values(state.agentSessions?.byAgentId ?? {}),
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
  (state: StoreState): AgentSession[] =>
    Object.values(state.agentSessions?.byAgentId ?? {}).filter(
      (s) => s.isStreaming === true,
    ),
);

