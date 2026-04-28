import type { AgentSession, QueuedMessage } from "$shared/types";
import type { StoreState } from "../../types";
import { createSelector } from "../../utils/create-selector";
import { selectAgentSession, selectAllStreamingAgents as selectAllStreamingFromAgentSession } from "../agent-session/agent-session-selectors";
import { emptyWorkspaceAgentState, type InitialAgentConfig } from "./workspace-agents-slice";

function isBackgroundAgent(agent: AgentSession): boolean {
  return !!(agent.isBackground || agent.metadata?.isBackground);
}

function getWorkspaceAgentState(state: StoreState, wsId: string) {
  return state.workspaceAgents.byWorkspaceId[wsId] ?? emptyWorkspaceAgentState;
}

/** Derives agent sessions from workspace agentIds + agent-session slice */
export const selectAllWorkspaceAgents = createSelector((state, wsId?: string): AgentSession[] => {
  if (!wsId) return [];
  
  const agentIds = getWorkspaceAgentState(state, wsId).agentIds;
  const result: AgentSession[] = [];
  for (const id of agentIds) {
    const session = selectAgentSession.select(state, id);
    if (session) result.push(session);
  }
  return result;
});

export const selectForegroundWorkspaceAgents = createSelector((state, wsId: string) => {
  return selectAllWorkspaceAgents.select(state, wsId).filter((agent) => !isBackgroundAgent(agent));
});

export const selectAgentsLoaded = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).agentsLoaded;
});

export const selectIsLoadingAgents = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).isLoadingAgents;
});

export const selectInitialAgentId = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).initialAgentId;
});

export const selectInitialAgentConfigProcessed = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).initialAgentConfigProcessed;
});

export const selectRecentlyCreatedAgents = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).recentlyCreatedAgents;
});

export const selectInitialAgentConfig = createSelector(
  (state, wsId: string): InitialAgentConfig | null => {
    return getWorkspaceAgentState(state, wsId).initialAgentConfig ?? null;
  }
);

/**
 * Returns true when a workspace has a pending initial agent config,
 * meaning it was just created and hasn't sent its first message yet.
 * Replaces the old `isNewlyCreatedWorkspace` Svelte state flag.
 */
export const selectIsNewlyCreatedWorkspace = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).initialAgentConfig !== null;
});

// --------------------------------------------------------------------------
// Selectors delegating to agent-session slice
// --------------------------------------------------------------------------

/** Get the active agent ID for a workspace */
export const selectActiveAgentId = createSelector((state, wsId: string): string | null => {
  return getWorkspaceAgentState(state, wsId).activeAgentId;
});

/** Get a specific agent session by ID — reads from agent-session slice */
export const selectAgentById = createSelector(
  (state, agentId: string): AgentSession | undefined => {
    return selectAgentSession.select(state, agentId);
  }
);

/**
 * Returns the ready session for an agent within a workspace, or null until the
 * agent-session slice has hydrated the session for that workspace.
 */
export const selectWorkspaceAgentReadySession = createSelector(
  (state, wsId: string, agentId: string): AgentSession | null => {
    const session = selectAgentSession.select(state, agentId);
    if (!session) return null;
    if (String(session.workspaceId) === String(wsId)) return session;

    return null;
  }
);

/** Get the active agent session for a workspace — reads from agent-session slice */
export const selectActiveAgent = createSelector(
  (state, wsId: string): AgentSession | undefined => {
    const wsState = getWorkspaceAgentState(state, wsId);
    if (!wsState.activeAgentId) return undefined;
    return selectAgentSession.select(state, wsState.activeAgentId);
  }
);

/** Whether the initial spec write is in progress for a workspace */
export const selectIsInitialSpecWriteInProgress = createSelector((state, wsId: string): boolean => {
  return getWorkspaceAgentState(state, wsId).isInitialSpecWriteInProgress;
});

/** Get queued messages for a specific agent — reads from agent-session slice */
export const selectAgentQueuedMessages = createSelector(
  (state, _wsId: string, agentId: string): QueuedMessage[] => {
    const session = selectAgentSession.select(state, agentId);
    return session?.queuedMessages ?? [];
  }
);

// --------------------------------------------------------------------------
// AgentService serializable state selectors (6a migration)
// --------------------------------------------------------------------------

/** Get the disk message count for a specific agent */
export const selectDiskMessageCount = createSelector(
  (state, wsId: string, agentId: string): number => {
    return getWorkspaceAgentState(state, wsId).diskMessageCounts[agentId] ?? 0;
  }
);

/** Get the last-seen timestamp for an agent:created event (for dedup) */
export const selectRecentAgentCreatedEvent = createSelector(
  (state, wsId: string, agentId: string): number | undefined => {
    return getWorkspaceAgentState(state, wsId).recentAgentCreatedEvents[agentId];
  }
);

/** Get the count of recent agent created events (for cleanup threshold) */
export const selectRecentAgentCreatedEventsCount = createSelector(
  (state, wsId: string): number => {
    return Object.keys(getWorkspaceAgentState(state, wsId).recentAgentCreatedEvents).length;
  }
);

/** Get all streaming agents across all workspaces — delegates to agent-session slice */
export const selectAllStreamingAgents = createSelector((state): AgentSession[] => {
  return selectAllStreamingFromAgentSession.select(state);
});