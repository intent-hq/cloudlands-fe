import { store } from "../../store";
import type { AgentId, AgentSession, QueuedMessage } from "$shared/types";
import type { StoreState } from "../../types";
import { selectAgentSession } from "../agent-session/agent-session-selectors";
import { selectAgentQueueMessages } from "../agent-queue/agent-queue-selectors";
import { emptyWorkspaceAgentState } from "./workspace-agents-slice";

function getWorkspaceAgentState(state: StoreState, wsId: string) {
  return state.workspaceAgents.byWorkspaceId[wsId] ?? emptyWorkspaceAgentState;
}

/** Derives agent sessions from workspace agentIds + agent-session slice */
export const selectAllWorkspaceAgents = store.createSelector((state, wsId?: string): AgentSession[] => {
  if (!wsId) return [];

  const agentIds = getWorkspaceAgentState(state, wsId).agentIds;
  const result: AgentSession[] = [];
  for (const id of agentIds) {
    const session = selectAgentSession.select(state, id);
    if (session) result.push(session);
  }
  return result;
});

/** Get reducer-maintained foreground agent IDs for a workspace. */
export const selectWorkspaceForegroundAgentIds = store.createSelector(
  (state, wsId?: string): AgentId[] => {
    if (!wsId) return [];
    return getWorkspaceAgentState(state, wsId).foregroundAgentIds;
  }
);

/** Get background agent sessions for a workspace. */
export const selectBackgroundWorkspaceAgents = store.createSelector(
  (state, wsId?: string): AgentSession[] => {
    if (!wsId) return [];

    const workspaceState = getWorkspaceAgentState(state, wsId);
    const foregroundAgentIds = new Set(workspaceState.foregroundAgentIds.map((id) => String(id)));
    const result: AgentSession[] = [];
    for (const id of workspaceState.agentIds) {
      if (foregroundAgentIds.has(String(id))) continue;
      const session = selectAgentSession.select(state, id);
      if (session) result.push(session);
    }
    return result;
  }
);

export const selectForegroundWorkspaceAgents = store.createSelector((state, wsId: string) => {
  const foregroundAgentIds = selectWorkspaceForegroundAgentIds.select(state, wsId);
  const result: AgentSession[] = [];
  for (const id of foregroundAgentIds) {
    const session = selectAgentSession.select(state, String(id));
    if (session) result.push(session);
  }
  return result;
});

export const selectAgentsLoaded = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).agentsLoaded;
});

export const selectIsLoadingAgents = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).isLoadingAgents;
});

export const selectInitialAgentId = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).initialAgentId;
});

/**
 * True while the initial agent of a workspace is still flagged as
 * recently-created (i.e. the workspace was just spun up). Replaces the
 * previous initialAgentConfig-based signal now that the daemon owns the
 * initial-agent + initial-message lifecycle.
 */
export const selectIsNewlyCreatedWorkspace = store.createSelector((state, wsId: string) => {
  const ws = getWorkspaceAgentState(state, wsId);
  return !!ws.initialAgentId && ws.recentlyCreatedAgents.includes(ws.initialAgentId);
});

export const selectRecentlyCreatedAgents = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).recentlyCreatedAgents;
});

/** Get agent IDs tracked for a workspace. */
export const selectWorkspaceAgentIds = store.createSelector((state, wsId: string): string[] => {
  return getWorkspaceAgentState(state, wsId).agentIds;
});

// --------------------------------------------------------------------------
// Selectors delegating to agent-session slice
// --------------------------------------------------------------------------

/** Get the active agent ID for a workspace */
export const selectActiveAgentId = store.createSelector((state, wsId: string): string | null => {
  return getWorkspaceAgentState(state, wsId).activeAgentId;
});

/**
 * Returns the ready session for an agent within a workspace, or null until the
 * agent-session slice has hydrated the session for that workspace.
 */
export const selectWorkspaceAgentReadySession = store.createSelector(
  (state, wsId: string, agentId: string): AgentSession | null => {
    const session = selectAgentSession.select(state, agentId);
    if (!session) return null;
    if (String(session.workspaceId) === String(wsId)) return session;

    return null;
  }
);

/**
 * Get a workspace-scoped agent session. Use this instead of bridge read helpers
 * when a caller knows the workspace that owns the agent.
 */
export const selectWorkspaceAgentSession = store.createSelector(
  (state, wsId: string, agentId: string): AgentSession | undefined => {
    if (!wsId || !agentId) return undefined;

    const plainAgentId = String(agentId);
    const session = selectAgentSession.select(state, plainAgentId);
    if (!session) return undefined;
    if (session.workspaceId === wsId) return session;

    const workspaceState = getWorkspaceAgentState(state, wsId);
    const trackedInWorkspace = workspaceState.agentIds.some((id) => String(id) === plainAgentId);
    return trackedInWorkspace ? session : undefined;
  }
);

/** Check whether a workspace owns an agent session. */
export const selectWorkspaceHasAgent = store.createSelector(
  (state, wsId: string, agentId: string): boolean => {
    return !!selectWorkspaceAgentSession.select(state, wsId, agentId);
  }
);

/** Check whether a workspace-scoped agent is currently streaming. */
export const selectWorkspaceAgentIsStreaming = store.createSelector(
  (state, wsId: string, agentId: string): boolean => {
    return selectWorkspaceAgentSession.select(state, wsId, agentId)?.isStreaming === true;
  }
);

/** Check whether a workspace-scoped agent is soft-deleted. */
export const selectWorkspaceAgentIsSoftDeleted = store.createSelector(
  (state, wsId: string, agentId: string): boolean => {
    return selectWorkspaceAgentSession.select(state, wsId, agentId)?.metadata?.softDeleted === true;
  }
);

/** Get the active agent session for a workspace — reads from agent-session slice */
export const selectActiveAgent = store.createSelector(
  (state, wsId: string): AgentSession | undefined => {
    const wsState = getWorkspaceAgentState(state, wsId);
    if (!wsState.activeAgentId) return undefined;
    return selectAgentSession.select(state, wsState.activeAgentId) ?? undefined;
  }
);

/** Whether the initial spec write is in progress for a workspace */
export const selectIsInitialSpecWriteInProgress = store.createSelector((state, wsId: string): boolean => {
  return getWorkspaceAgentState(state, wsId).isInitialSpecWriteInProgress;
});

/** @deprecated Renderer-visible queues live in agentQueue. Use selectAgentQueueMessages directly. */
export const selectAgentQueuedMessages = store.createSelector(
  (state, _wsId: string, agentId: string): QueuedMessage[] => {
    return selectAgentQueueMessages.select(state, agentId);
  }
);

// --------------------------------------------------------------------------
// AgentService serializable state selectors (6a migration)
// --------------------------------------------------------------------------

/** Get the disk/restored message count for a specific agent */
export const selectDiskMessageCount = store.createSelector(
  (state, wsId: string, agentId: string): number => {
    return getWorkspaceAgentState(state, wsId).diskMessageCounts[agentId] ?? 0;
  }
);

/** Get the last-seen timestamp for an agent:created event (for dedup) */
export const selectRecentAgentCreatedEvent = store.createSelector(
  (state, wsId: string, agentId: string): number | undefined => {
    return getWorkspaceAgentState(state, wsId).recentAgentCreatedEvents[agentId];
  }
);

/** Get the count of recent agent created events (for cleanup threshold) */
export const selectRecentAgentCreatedEventsCount = store.createSelector(
  (state, wsId: string): number => {
    return Object.keys(getWorkspaceAgentState(state, wsId).recentAgentCreatedEvents).length;
  }
);


