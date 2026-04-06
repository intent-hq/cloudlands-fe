import type { AgentSession, AgentMessage } from "$shared/types";
import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { omitKey } from "../../utils/utils";

export interface InitialAgentConfig {
  agentId: string;
  config: {
    prompt?: string;
    model?: string;
    specialist?: string | null;
    behaviorPrompt?: string;
    isInitialAgent?: boolean;
    isFirstWorkspaceAgent?: boolean;
    metadata?: Record<string, unknown>;
  };
  timestamp: number;
}

export interface WorkspaceAgentState {
  /** Ordered list of agent IDs belonging to this workspace. Session data lives in agent-session slice. */
  agentIds: string[];
  agentsLoaded: boolean;
  isLoadingAgents: boolean;
  initialAgentId: string | null;
  initialAgentConfigProcessed: boolean;
  recentlyCreatedAgents: string[];
  isWaitingForFirstMessage: Record<string, boolean>;
  initialAgentConfig: InitialAgentConfig | null;
  /** Currently active/focused agent in the workspace */
  activeAgentId: string | null;
  /** Whether the initial spec-writer agent is actively writing the spec */
  isInitialSpecWriteInProgress: boolean;
  /**
   * Track the message count from disk for each agent session.
   * Prevents beforeunload from overwriting a complete session on disk
   * with a stale in-memory session that has fewer messages.
   * Key: agentId, Value: message count from last disk load.
   */
  diskMessageCounts: Record<string, number>;
  /**
   * Deduplication for agent:created events — same agentId can arrive multiple
   * times from different IPC channels within milliseconds.
   * Key: agentId, Value: timestamp (ms) of last seen event.
   */
  recentAgentCreatedEvents: Record<string, number>;
}

export interface WorkspaceAgentsState {
  byWorkspaceId: Record<string, WorkspaceAgentState>;
}

function reconcileWorkspaceAgentSnapshot(
  workspaceState: WorkspaceAgentState,
  agents: AgentSession[]
): WorkspaceAgentState {
  const diskAgentIds = agents.map((agent) => String(agent.id));
  const existingIdSet = new Set(workspaceState.agentIds);

  // Merge: keep existing IPC-added agents + add any new disk-loaded agents
  const mergedIds = [...workspaceState.agentIds];
  for (const id of diskAgentIds) {
    if (!existingIdSet.has(id)) {
      mergedIds.push(id);
    }
  }

  const allIdSet = new Set(mergedIds);
  const recentlyCreatedAgents = workspaceState.recentlyCreatedAgents.filter((id) =>
    allIdSet.has(id)
  );
  const isWaitingForFirstMessage = Object.fromEntries(
    Object.entries(workspaceState.isWaitingForFirstMessage).filter(([id]) =>
      allIdSet.has(id)
    )
  );

  return {
    ...workspaceState,
    agentIds: mergedIds,
    recentlyCreatedAgents,
    isWaitingForFirstMessage,
  };
}


export const emptyWorkspaceAgentState: WorkspaceAgentState = {
  agentIds: [],
  agentsLoaded: false,
  isLoadingAgents: false,
  initialAgentId: null,
  initialAgentConfigProcessed: false,
  recentlyCreatedAgents: [],
  isWaitingForFirstMessage: {},
  initialAgentConfig: null,
  activeAgentId: null,
  isInitialSpecWriteInProgress: false,
  diskMessageCounts: {},
  recentAgentCreatedEvents: {},
};

export const initialState: WorkspaceAgentsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState } = createWorkspaceScopedHelpers(
  emptyWorkspaceAgentState
);

export const setAgents = createAction<[wsId: string, agents: AgentSession[]]>(
  "workspaceAgents/setAgents"
);
export const addAgent = createAction<[wsId: string, agent: AgentSession]>(
  "workspaceAgents/addAgent"
);
export const removeAgent = createAction<[wsId: string, agentId: string]>(
  "workspaceAgents/removeAgent"
);
export const renameAgent = createAction<[wsId: string, agentId: string, name: string]>(
  "workspaceAgents/renameAgent"
);
export const markAgentRecentlyCreated = createAction<[wsId: string, agentId: string]>(
  "workspaceAgents/markAgentRecentlyCreated"
);
export const setInitialAgentId = createAction<[wsId: string, agentId: string | null]>(
  "workspaceAgents/setInitialAgentId"
);
export const setInitialAgentConfigProcessed = createAction<[wsId: string, processed: boolean]>(
  "workspaceAgents/setInitialAgentConfigProcessed"
);
export const setAgentsLoaded = createAction<[wsId: string, loaded: boolean]>(
  "workspaceAgents/setAgentsLoaded"
);
export const setIsLoadingAgents = createAction<[wsId: string, loading: boolean]>(
  "workspaceAgents/setIsLoadingAgents"
);
export const createAgentRequested = createAction<[wsId: string, agentType?: string]>(
  "workspaceAgents/createAgentRequested"
);
export const createAgentWithSpecialistRequested = createAction<
  [wsId: string, specialistId: string | null]
>("workspaceAgents/createAgentWithSpecialistRequested");
export const delegateTaskRequested = createAction<[wsId: string, taskText: string, openAgent?: boolean]>(
  "workspaceAgents/delegateTaskRequested"
);
export const agentsLoaded = createAction<[wsId: string]>("workspaceAgents/agentsLoaded");
export const setWaitingForFirstMessage = createAction<
  [wsId: string, agentId: string, waiting: boolean]
>("workspaceAgents/setWaitingForFirstMessage");
export const setInitialAgentConfig = createAction<[wsId: string, config: InitialAgentConfig]>(
  "workspaceAgents/setInitialAgentConfig"
);
export const clearInitialAgentConfig = createAction<[wsId: string]>(
  "workspaceAgents/clearInitialAgentConfig"
);

// --------------------------------------------------------------------------
// New actions for unified-state-store migration
// --------------------------------------------------------------------------

/** Set the active (focused) agent for a workspace */
export const setActiveAgentId = createAction<[wsId: string, agentId: string | null]>(
  "workspaceAgents/setActiveAgentId"
);

/** Upsert an agent session with message-preservation logic */
export const upsertAgentSession = createAction<[wsId: string, session: AgentSession]>(
  "workspaceAgents/upsertAgentSession"
);

/** Set streaming state for an agent */
export const setAgentStreaming = createAction<[wsId: string, agentId: string, isStreaming: boolean]>(
  "workspaceAgents/setAgentStreaming"
);

/** Add a message to an agent's conversation */
export const addAgentMessage = createAction<[wsId: string, agentId: string, message: AgentMessage]>(
  "workspaceAgents/addAgentMessage"
);

/** Update a specific message in an agent's conversation */
export const updateAgentMessage = createAction<[wsId: string, agentId: string, messageId: string, updates: Partial<AgentMessage>]>(
  "workspaceAgents/updateAgentMessage"
);

/** Replace all messages for an agent */
export const replaceAgentMessages = createAction<[wsId: string, agentId: string, messages: AgentMessage[]]>(
  "workspaceAgents/replaceAgentMessages"
);

/** Atomically remove a single message by ID (avoids TOCTOU with read→filter→replace) */
export const removeAgentMessage = createAction<[wsId: string, agentId: string, messageId: string]>(
  "workspaceAgents/removeAgentMessage"
);

/** Update an agent's digest field */
export const updateAgentDigest = createAction<[wsId: string, agentId: string, digest: string | null]>(
  "workspaceAgents/updateAgentDigest"
);

/** Set the initial spec write in-progress flag */
export const setInitialSpecWriteInProgress = createAction<[wsId: string, isWriting: boolean]>(
  "workspaceAgents/setInitialSpecWriteInProgress"
);

/** Remove the entire workspace state entry */
export const removeWorkspaceAgentState = createAction<[wsId: string]>(
  "workspaceAgents/removeWorkspaceAgentState"
);

// Heartbeat actions (saga-only — no reducer state needed; timers live in the saga)
export const startHeartbeat = createAction<[sessionId: string, intervalMs?: number]>(
  "workspaceAgents/startHeartbeat"
);
export const heartbeatReceived = createAction<[sessionId: string]>(
  "workspaceAgents/heartbeatReceived"
);
export const stopHeartbeat = createAction<[sessionId: string]>(
  "workspaceAgents/stopHeartbeat"
);
export const stopAllHeartbeats = createAction("workspaceAgents/stopAllHeartbeats");
export const heartbeatTimedOut = createAction<[sessionId: string]>(
  "workspaceAgents/heartbeatTimedOut"
);

// --------------------------------------------------------------------------
// Actions for AgentService serializable state (6a migration)
// --------------------------------------------------------------------------

/** Set the disk message count for an agent (used to prevent stale overwrites) */
export const setDiskMessageCount = createAction<[wsId: string, agentId: string, count: number]>(
  "workspaceAgents/setDiskMessageCount"
);

/** Record a recent agent:created event timestamp for deduplication */
export const recordAgentCreatedEvent = createAction<[wsId: string, agentId: string, timestamp: number]>(
  "workspaceAgents/recordAgentCreatedEvent"
);

/** Clean up old agent:created dedup entries (older than the given cutoff timestamp) */
export const cleanupAgentCreatedEvents = createAction<[wsId: string, cutoffTimestamp: number]>(
  "workspaceAgents/cleanupAgentCreatedEvents"
);

/**
 * Saga-only trigger: schedule a debounced reconnection to backend streams.
 * Replaces the setTimeout-based scheduleBackendStreamReconnect() in AgentService.
 * Handled by takeLatest + delay(500) in agent-ipc-saga.ts.
 */
export const triggerBackendStreamReconnect = createAction(
  "workspaceAgents/triggerBackendStreamReconnect"
);

// Stream lifecycle actions (saga-only — stream state lives in stream-handler-registry.ts)

/** Request the safety timeout check after reconnect (replaces startStreamingSafetyTimeout) */
export const triggerStreamingSafetyCheck = createAction<[confirmedActiveIds: string[]]>(
  "workspaceAgents/triggerStreamingSafetyCheck"
);

/** Request cleanup of orphaned stream handlers */
export const cleanupOrphanedStreamHandlersRequested = createAction(
  "workspaceAgents/cleanupOrphanedStreamHandlersRequested"
);



export const workspaceAgentsReducer = createReducer<WorkspaceAgentsState>(initialState)
  .with(setAgents, (state, { payload: [wsId, agents] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, reconcileWorkspaceAgentSnapshot(workspaceState, agents));
  })
  .with(addAgent, (state, { payload: [wsId, agent] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const agentId = String(agent.id);
    if (workspaceState.agentIds.includes(agentId)) {
      return state;
    }
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      agentIds: [...workspaceState.agentIds, agentId],
    });
  })
  .with(removeAgent, (state, { payload: [wsId, agentId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (!workspaceState.agentIds.includes(agentId)) {
      return state;
    }

    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      agentIds: workspaceState.agentIds.filter((id) => id !== agentId),
      initialAgentId:
        workspaceState.initialAgentId === agentId ? null : workspaceState.initialAgentId,
      recentlyCreatedAgents: workspaceState.recentlyCreatedAgents.filter(
        (recentAgentId) => recentAgentId !== agentId
      ),
      isWaitingForFirstMessage: omitKey(workspaceState.isWaitingForFirstMessage, agentId),
    });
  })
  .with(markAgentRecentlyCreated, (state, { payload: [wsId, agentId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.recentlyCreatedAgents.includes(agentId)) {
      return state;
    }
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      recentlyCreatedAgents: [...workspaceState.recentlyCreatedAgents, agentId],
    });
  })
  .with(setInitialAgentId, (state, { payload: [wsId, initialAgentId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.initialAgentId === initialAgentId) {
      return state;
    }
    return setWorkspaceState(state, wsId, { ...workspaceState, initialAgentId });
  })
  .with(setInitialAgentConfigProcessed, (state, { payload: [wsId, initialAgentConfigProcessed] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.initialAgentConfigProcessed === initialAgentConfigProcessed) {
      return state;
    }
    return setWorkspaceState(state, wsId, { ...workspaceState, initialAgentConfigProcessed });
  })
  .with(setAgentsLoaded, (state, { payload: [wsId, agentsLoaded] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.agentsLoaded === agentsLoaded) {
      return state;
    }
    return setWorkspaceState(state, wsId, { ...workspaceState, agentsLoaded });
  })
  .with(setIsLoadingAgents, (state, { payload: [wsId, isLoadingAgents] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.isLoadingAgents === isLoadingAgents) {
      return state;
    }
    return setWorkspaceState(state, wsId, { ...workspaceState, isLoadingAgents });
  })
  .with(setWaitingForFirstMessage, (state, { payload: [wsId, agentId, waiting] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const currentWaiting = workspaceState.isWaitingForFirstMessage[agentId] ?? false;
    if (currentWaiting === waiting) {
      return state;
    }

    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      isWaitingForFirstMessage: waiting
        ? {
          ...workspaceState.isWaitingForFirstMessage,
          [agentId]: true,
        }
        : omitKey(workspaceState.isWaitingForFirstMessage, agentId),
    });
  })
  .with(setInitialAgentConfig, (state, { payload: [wsId, config] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      initialAgentConfig: config,
    });
  })
  .with(clearInitialAgentConfig, (state, { payload: [wsId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (!workspaceState.initialAgentConfig) return state;
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      initialAgentConfig: null,
    });
  })
  // --------------------------------------------------------------------------
  // Unified-state-store migration — session data delegated to agent-session slice
  // --------------------------------------------------------------------------
  .with(setActiveAgentId, (state, { payload: [wsId, agentId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.activeAgentId === agentId) return state;
    return setWorkspaceState(state, wsId, { ...workspaceState, activeAgentId: agentId });
  })
  .with(upsertAgentSession, (state, { payload: [wsId, session] }) => {
    // Only track the agent ID — session data lives in agent-session slice
    const workspaceState = getWorkspaceState(state, wsId);
    const agentId = String(session.id);
    if (workspaceState.agentIds.includes(agentId)) {
      return state;
    }
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      agentIds: [...workspaceState.agentIds, agentId],
    });
  })
  .with(setInitialSpecWriteInProgress, (state, { payload: [wsId, isWriting] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.isInitialSpecWriteInProgress === isWriting) return state;
    return setWorkspaceState(state, wsId, { ...workspaceState, isInitialSpecWriteInProgress: isWriting });
  })
  .with(removeWorkspaceAgentState, (state, { payload: [wsId] }) => {
    if (!state.byWorkspaceId[wsId]) return state;
    return { byWorkspaceId: omitKey(state.byWorkspaceId, wsId) };
  })
  // --------------------------------------------------------------------------
  // AgentService serializable state (6a migration)
  // --------------------------------------------------------------------------
  .with(setDiskMessageCount, (state, { payload: [wsId, agentId, count] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.diskMessageCounts[agentId] === count) return state;
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      diskMessageCounts: { ...workspaceState.diskMessageCounts, [agentId]: count },
    });
  })
  .with(recordAgentCreatedEvent, (state, { payload: [wsId, agentId, timestamp] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      recentAgentCreatedEvents: { ...workspaceState.recentAgentCreatedEvents, [agentId]: timestamp },
    });
  })
  .with(cleanupAgentCreatedEvents, (state, { payload: [wsId, cutoffTimestamp] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const filtered: Record<string, number> = {};
    let changed = false;
    for (const [id, ts] of Object.entries(workspaceState.recentAgentCreatedEvents)) {
      if (ts >= cutoffTimestamp) {
        filtered[id] = ts;
      } else {
        changed = true;
      }
    }
    if (!changed) return state;
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      recentAgentCreatedEvents: filtered,
    });
  });
