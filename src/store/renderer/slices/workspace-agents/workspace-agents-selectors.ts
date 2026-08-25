import { store } from '../../store';
import type { AgentId, AgentSession } from '$shared/types';
import type { StoreState } from '../../types';
import { selectAgentSession } from '../agent-session/agent-session-selectors';
import { emptyWorkspaceAgentState } from './workspace-agents-slice';

function getWorkspaceAgentState(state: StoreState, wsId: string) {
  return state.workspaceAgents.byWorkspaceId[wsId] ?? emptyWorkspaceAgentState;
}

/** Derives agent sessions from workspace agentIds + agent-session slice */
export const selectAllWorkspaceAgents = store.createSelector(
  (state, wsId?: string): AgentSession[] => {
    if (!wsId) return [];

    const agentIds = getWorkspaceAgentState(state, wsId).agentIds;
    const result: AgentSession[] = [];
    for (const id of agentIds) {
      const session = selectAgentSession.select(state, id);
      if (session) result.push(session);
    }
    return result;
  },
);

/** Get reducer-maintained foreground agent IDs for a workspace. */
export const selectWorkspaceForegroundAgentIds = store.createSelector(
  (state, wsId?: string): AgentId[] => {
    if (!wsId) return [];
    return getWorkspaceAgentState(state, wsId).foregroundAgentIds;
  },
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
  },
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

function byCreatedOrder(left: AgentSession, right: AgentSession): number {
  const leftTime = new Date(left.createdAt).getTime();
  const rightTime = new Date(right.createdAt).getTime();
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
  return normalizedLeft - normalizedRight || String(left.id).localeCompare(String(right.id));
}

function newestUserMessageTimestamp(agent: AgentSession): number | null {
  let newest: number | null = null;
  for (const message of agent.messages) {
    if (message.role !== 'user') continue;
    const timestamp = new Date(message.timestamp).getTime();
    if (Number.isFinite(timestamp) && (newest === null || timestamp > newest)) newest = timestamp;
  }
  if (newest !== null || !agent.lastUserMessage) return newest;
  // AgentLite restores omit transcripts. Its persisted preview proves a user
  // message exists, and lastActivity is the available durable ordering stamp.
  const restoredTimestamp = new Date(agent.lastActivity ?? agent.updatedAt).getTime();
  return Number.isFinite(restoredTimestamp) ? restoredTimestamp : null;
}

/** Resolve the daemon-owned initial agent without inventing a replacement. */
export function resolveCanonicalInitialAgent(agents: AgentSession[]): AgentSession | null {
  // Retired sessions (§5.5 soft retire) are read-only archive rows — never
  // resolve one as the workspace's initial agent (mirrors resolveEmptyLayoutAgent).
  const ordered = agents.filter((agent) => !agent.retiredAt).sort(byCreatedOrder);
  return (
    ordered.find((agent) => agent.isInitialAgent === true) ??
    ordered.find((agent) => agent.metadata?.isInitialAgent === true) ??
    ordered.find((agent) => !agent.isBackground && !agent.parentSessionId) ??
    ordered.find((agent) => !agent.isBackground) ??
    ordered[0] ??
    null
  );
}

/** Resolve the primary agent that should fill an otherwise empty restored layout. */
export function resolveEmptyLayoutAgent(
  agents: AgentSession[],
  workspaceId: string,
  allowInitialAgent = false,
): AgentSession | null {
  const eligibleAgents = agents.filter(
    (agent) =>
      String(agent.workspaceId) === workspaceId &&
      agent.status !== 'deleted' &&
      !agent.pendingDeleteAt &&
      !agent.retiredAt,
  );
  if (allowInitialAgent) {
    const initialAgent = [...eligibleAgents]
      .sort(byCreatedOrder)
      .find(
        (agent) =>
          agent.isInitialAgent === true ||
          agent.metadata?.isInitialAgent === true ||
          agent.agentMetadata?.isInitialAgent === true,
      );
    if (initialAgent) return initialAgent;
  }
  const orderedPrimaryAgents = agents
    .filter(
      (agent) =>
        String(agent.workspaceId) === workspaceId &&
        agent.status !== 'deleted' &&
        !agent.pendingDeleteAt &&
        !agent.retiredAt &&
        agent.isInitialAgent !== true &&
        agent.metadata?.isInitialAgent !== true &&
        agent.agentMetadata?.isInitialAgent !== true &&
        agent.isBackground !== true &&
        agent.metadata?.isBackground !== true &&
        !agent.parentSessionId &&
        typeof agent.metadata?.createdByAgentId !== 'string',
    )
    .sort(byCreatedOrder);
  let newestAgent: AgentSession | null = null;
  let newestTimestamp = Number.NEGATIVE_INFINITY;
  for (const agent of orderedPrimaryAgents) {
    const timestamp = newestUserMessageTimestamp(agent);
    if (timestamp !== null && timestamp > newestTimestamp) {
      newestAgent = agent;
      newestTimestamp = timestamp;
    }
  }
  return newestAgent;
}

export const selectEmptyLayoutAgent = store.createSelector((state, wsId: string) =>
  resolveEmptyLayoutAgent(selectAllWorkspaceAgents.select(state, wsId), wsId),
);

export const selectInitialAgentId = store.createSelector((state, wsId: string) => {
  const workspaceState = getWorkspaceAgentState(state, wsId);
  if (workspaceState.initialAgentId) return workspaceState.initialAgentId;
  // The in-memory flag is only dispatched by the creating session. After a
  // reload (or in another window) fall back to the daemon-persisted
  // `metadata.isInitialAgent` flag on the hydrated agent sessions; older
  // daemons that don't surface the field simply never match.
  for (const id of workspaceState.agentIds) {
    const session = selectAgentSession.select(state, id);
    if (session?.isInitialAgent === true || session?.metadata?.isInitialAgent === true) return id;
  }
  return null;
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
  },
);

/** Check whether a workspace owns an agent session. */
export const selectWorkspaceHasAgent = store.createSelector(
  (state, wsId: string, agentId: string): boolean => {
    return !!selectWorkspaceAgentSession.select(state, wsId, agentId);
  },
);

/** Check whether a workspace-scoped agent is currently streaming. */
export const selectWorkspaceAgentIsStreaming = store.createSelector(
  (state, wsId: string, agentId: string): boolean => {
    return selectWorkspaceAgentSession.select(state, wsId, agentId)?.isStreaming === true;
  },
);

/** Check whether a workspace-scoped agent is soft-deleted. */
export const selectWorkspaceAgentIsSoftDeleted = store.createSelector(
  (state, wsId: string, agentId: string): boolean => {
    return selectWorkspaceAgentSession.select(state, wsId, agentId)?.metadata?.softDeleted === true;
  },
);

/** Get the active agent session for a workspace — reads from agent-session slice */
export const selectActiveAgent = store.createSelector(
  (state, wsId: string): AgentSession | undefined => {
    const wsState = getWorkspaceAgentState(state, wsId);
    if (!wsState.activeAgentId) return undefined;
    return selectAgentSession.select(state, wsState.activeAgentId) ?? undefined;
  },
);

/** Whether the initial spec write is in progress for a workspace */
export const selectIsInitialSpecWriteInProgress = store.createSelector(
  (state, wsId: string): boolean => {
    return getWorkspaceAgentState(state, wsId).isInitialSpecWriteInProgress;
  },
);

// --------------------------------------------------------------------------
// AgentService serializable state selectors (6a migration)
// --------------------------------------------------------------------------

/** Get the disk/restored message count for a specific agent */
export const selectDiskMessageCount = store.createSelector(
  (state, wsId: string, agentId: string): number => {
    return getWorkspaceAgentState(state, wsId).diskMessageCounts[agentId] ?? 0;
  },
);
