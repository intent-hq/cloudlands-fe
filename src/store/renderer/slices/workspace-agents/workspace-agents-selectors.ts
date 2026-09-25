import { store } from '../../store';
import type { AgentId, AgentSession } from '$shared/types';
import { classifyAgentScope } from '$shared/utils/agent-scope';
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

/** True when any non-retired foreground (top-level) agent session has unread messages. */
export const selectWorkspaceHasUnreadForegroundAgents = store.createSelector(
  (state, wsId: string): boolean => {
    return selectForegroundWorkspaceAgents
      .select(state, wsId)
      .some((agent) => !agent.retiredAt && agent.hasUnread === true);
  },
);

export const selectAgentsLoaded = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).agentsLoaded;
});

export const selectIsLoadingAgents = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).isLoadingAgents;
});

/** Daemon-served retired-row count (§5.5 soft retire) for the Retired bin toggle. */
export const selectRetiredCount = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).retiredCount;
});

/** True once the on-demand retired-only read has hydrated the retired rows. */
export const selectRetiredAgentsLoaded = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).retiredAgentsLoaded;
});

/** True while the on-demand retired-only read is in flight. */
export const selectIsLoadingRetiredAgents = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).isLoadingRetiredAgents;
});

/**
 * Daemon-served per-bin counts (`scopeCounts`, §5.5 row scope) for the
 * Delegated / Background bin toggles; `null` when the daemon served none
 * (old daemon — the all-rows read, no lazy bins).
 */
export const selectScopeCounts = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).scopeCounts;
});

/**
 * Bumped each time a hydration read installs an authoritative count baseline
 * (`setScopeCounts`); a deferred count adjustment captured under an older
 * generation is stale and must be dropped.
 */
export const selectScopeCountsGeneration = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).scopeCountsGeneration;
});

/** True once the on-demand `scope: "delegated"` read has hydrated the delegated rows. */
export const selectDelegatedAgentsLoaded = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).delegatedAgentsLoaded;
});

/** True while the on-demand delegated read is in flight. */
export const selectIsLoadingDelegatedAgents = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).isLoadingDelegatedAgents;
});

/**
 * Daemon-served per-parent delegated counts (`delegatedCounts`, §5.5) for the
 * collapsed per-parent delegated groups; `null` when the daemon served none.
 */
export const selectDelegatedCounts = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).delegatedCounts;
});

/**
 * True once one parent's direct children are hydrated — by the per-parent
 * read (`scope: "delegated"` + `parentAgentId`) or by the whole-bin read,
 * which covers every parent.
 */
export const selectDelegatedParentLoaded = store.createSelector(
  (state, wsId: string, parentAgentId: string) => {
    const workspaceState = getWorkspaceAgentState(state, wsId);
    return (
      workspaceState.delegatedAgentsLoaded ||
      workspaceState.loadedDelegatedParentIds[parentAgentId] === true
    );
  },
);

/** True while that parent's per-parent delegated read is in flight. */
export const selectIsLoadingDelegatedParent = store.createSelector(
  (state, wsId: string, parentAgentId: string) => {
    return getWorkspaceAgentState(state, wsId).loadingDelegatedParentIds[parentAgentId] === true;
  },
);

/** The parents whose per-parent delegated read has landed (not the whole-bin flag). */
export const selectLoadedDelegatedParentIds = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).loadedDelegatedParentIds;
});

/** The parents whose per-parent delegated read is in flight. */
export const selectLoadingDelegatedParentIds = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).loadingDelegatedParentIds;
});

/**
 * True once the orphan-only delegated read (`scope: "delegated"` +
 * `orphanedOnly: true`) has landed — the raw flag, not the whole-bin one;
 * readers that only need "are the orphans hydrated" check
 * `selectDelegatedAgentsLoaded` first.
 */
export const selectOrphanedDelegatedAgentsLoaded = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).orphanedDelegatedAgentsLoaded;
});

/** The rows the latest orphan-only read served (the Delegated bin's membership). */
export const selectOrphanedDelegatedAgentIds = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).orphanedDelegatedAgentIds;
});

/** True while the on-demand orphan-only delegated read is in flight. */
export const selectIsLoadingOrphanedDelegatedAgents = store.createSelector(
  (state, wsId: string) => {
    return getWorkspaceAgentState(state, wsId).isLoadingOrphanedDelegatedAgents;
  },
);

/** True once the on-demand `scope: "background"` read has hydrated the background rows. */
export const selectBackgroundAgentsLoaded = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).backgroundAgentsLoaded;
});

/** True while the on-demand background read is in flight. */
export const selectIsLoadingBackgroundAgents = store.createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).isLoadingBackgroundAgents;
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
  // The primary candidate must be a top-level row (shared `agent-scope` bin —
  // neither delegated nor background). Forked sessions (`parentSessionId`) are
  // excluded as a separate rule: a fork is not delegated, but it is a
  // continuation of another session rather than the workspace's own primary.
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
        classifyAgentScope(agent) === 'topLevel' &&
        !agent.parentSessionId,
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
