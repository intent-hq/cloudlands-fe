import type { AgentSession, AgentMessage, AgentId } from "$shared/types";
import type { UnifiedAgentConfig } from "$shared/types/agent.types";
import {
  createAction,
  createAsyncAction,
} from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { omitKey } from "../../utils/utils";
import { upsertSession } from "../agent-session/agent-session-slice";
import { workspaceDeleted } from "../workspace-lifecycle/workspace-lifecycle-slice";

export interface WorkspaceAgentState {
  /** Ordered list of agent IDs belonging to this workspace. Session data lives in agent-session slice. */
  agentIds: string[];
  /** Ordered list of foreground agent IDs belonging to this workspace. */
  foregroundAgentIds: AgentId[];
  agentsLoaded: boolean;
  isLoadingAgents: boolean;
  initialAgentId: string | null;
  recentlyCreatedAgents: string[];
  isWaitingForFirstMessage: Record<string, boolean>;
  /** Currently active/focused agent in the workspace */
  activeAgentId: string | null;
  /** Whether the initial spec-writer agent is actively writing the spec */
  isInitialSpecWriteInProgress: boolean;
  /**
   * Track the message count from disk/restored upserts for each agent session.
   * Prevents beforeunload from overwriting a complete session on disk
   * with a stale in-memory session that has fewer messages.
   * Key: agentId, Value: message count from last upserted session payload.
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

export interface AgentCreationRequestOptions {
  openAgent?: boolean;
  openInAdjacentPanel?: boolean;
  panelId?: string;
  sourcePanelId?: string;
  assignTaskNoteId?: string;
  reloadNotes?: boolean;
  markInitialMessageSent?: boolean;
}

export interface ForkAgentRequest {
  forkedAgentId: string;
  sourceAgentId: string;
  name: string;
  model?: string;
  messages: AgentMessage[];
  forkPoint: number;
  selectedText?: string;
  switchToForked?: boolean;
}

export interface SaveAgentSessionOptions {
  allowTruncation?: boolean;
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
  const diskIdSet = new Set(diskAgentIds);
  const diskForegroundAgentIds = agents.filter((agent) => !isBackgroundAgent(agent)).map((agent) => agent.id);
  const diskForegroundIdSet = new Set(diskForegroundAgentIds.map((id) => String(id)));
  const foregroundAgentIds = mergeUniqueAgentIds(
    workspaceState.foregroundAgentIds.filter((id) => {
      const agentId = String(id);
      return allIdSet.has(agentId) && (!diskIdSet.has(agentId) || diskForegroundIdSet.has(agentId));
    }),
    diskForegroundAgentIds
  );
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
    foregroundAgentIds,
    recentlyCreatedAgents,
    isWaitingForFirstMessage,
  };
}

function isBackgroundAgent(agent: AgentSession): boolean {
  return agent.isBackground === true || agent.metadata?.isBackground === true;
}

function mergeUniqueAgentIds(existing: AgentId[], additions: AgentId[]): AgentId[] {
  const existingIds = new Set(existing.map((id) => String(id)));
  const merged = [...existing];
  let changed = false;
  for (const id of additions) {
    if (!existingIds.has(String(id))) {
      merged.push(id);
      existingIds.add(String(id));
      changed = true;
    }
  }
  return changed ? merged : existing;
}

function removeAgentId(existing: AgentId[], agentId: string): AgentId[] {
  if (!existing.some((id) => String(id) === agentId)) {
    return existing;
  }
  return existing.filter((id) => String(id) !== agentId);
}

function syncForegroundAgentId(existing: AgentId[], agent: AgentSession): AgentId[] {
  return isBackgroundAgent(agent)
    ? removeAgentId(existing, String(agent.id))
    : mergeUniqueAgentIds(existing, [agent.id]);
}


export const emptyWorkspaceAgentState: WorkspaceAgentState = {
  agentIds: [],
  foregroundAgentIds: [],
  agentsLoaded: false,
  isLoadingAgents: false,
  initialAgentId: null,
  recentlyCreatedAgents: [],
  isWaitingForFirstMessage: {},
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
export const markAgentRecentlyCreated = createAction<[wsId: string, agentId: string]>(
  "workspaceAgents/markAgentRecentlyCreated"
);
export const setInitialAgentId = createAction<[wsId: string, agentId: string | null]>(
  "workspaceAgents/setInitialAgentId"
);
export const setAgentsLoaded = createAction<[wsId: string, loaded: boolean]>(
  "workspaceAgents/setAgentsLoaded"
);
export const setIsLoadingAgents = createAction<[wsId: string, loading: boolean]>(
  "workspaceAgents/setIsLoadingAgents"
);
/**
 * Fan-out trigger dispatched by the workspaceMounted fan-out
 * (`lifecycle-ipc-read-service`) — and by the daemon-events-bridge on a
 * recycled-ID `workspace:created` — so an opened workspace (re)hydrates its
 * agent list via `appClient.agents.list`, mirroring the boot `agents-seeder`.
 * Saga-only trigger with no reducer entry (see AGENTS.md §8); the handler
 * lives in `lifecycle-read-service` and always refetches, converging the
 * store on the daemon's canonical list without clobbering a still-valid
 * active-agent selection.
 */
export const hydrateAgentsRequested = createAction<[wsId: string]>(
  "workspaceAgents/hydrateAgentsRequested"
);
export const createAgentRequested = createAction<[wsId: string, agentType?: string]>(
  "workspaceAgents/createAgentRequested"
);
export const createAgentWithSpecialistRequested = createAction<
  [wsId: string, specialistId: string | null]
>("workspaceAgents/createAgentWithSpecialistRequested");
export const createAgentFromConfigRequested = createAsyncAction<[
  wsId: string,
  config: UnifiedAgentConfig,
  options?: AgentCreationRequestOptions,
], AgentSession>("workspaceAgents/createAgentFromConfig", "workspaceAgents/createAgentFromConfigRequested");
export const forkAgentRequested = createAction<[wsId: string, request: ForkAgentRequest]>(
  "workspaceAgents/forkAgentRequested"
);
export const delegateTaskRequested = createAction<[wsId: string, taskText: string, openAgent?: boolean]>(
  "workspaceAgents/delegateTaskRequested"
);
export const delegateExistingTaskRequested = createAction<
  [wsId: string, noteId: string, taskText: string, openAgent?: boolean]
>("workspaceAgents/delegateExistingTaskRequested");
export const runAgentForNoteRequested = createAction<
  [wsId: string, noteId: string, noteTitle?: string]
>("workspaceAgents/runAgentForNoteRequested");
export const agentsLoaded = createAction<[wsId: string]>("workspaceAgents/agentsLoaded");
export const setWaitingForFirstMessage = createAction<
  [wsId: string, agentId: string, waiting: boolean]
>("workspaceAgents/setWaitingForFirstMessage");

// --------------------------------------------------------------------------
// New actions for unified-state-store migration
// --------------------------------------------------------------------------

/** Set the active (focused) agent for a workspace */
export const setActiveAgentId = createAction<[wsId: string, agentId: string | null]>(
  "workspaceAgents/setActiveAgentId"
);

/** Set the initial spec write in-progress flag */
export const setInitialSpecWriteInProgress = createAction<[wsId: string, isWriting: boolean]>(
  "workspaceAgents/setInitialSpecWriteInProgress"
);

/** Remove the entire workspace state entry */
export const removeWorkspaceAgentState = createAction<[wsId: string]>(
  "workspaceAgents/removeWorkspaceAgentState"
);

// --------------------------------------------------------------------------
// Actions for AgentService serializable state (6a migration)
// --------------------------------------------------------------------------

/** Record a recent agent:created event timestamp for deduplication */
export const recordAgentCreatedEvent = createAction<[wsId: string, agentId: string, timestamp: number]>(
  "workspaceAgents/recordAgentCreatedEvent"
);

/** Clean up old agent:created dedup entries (older than the given cutoff timestamp) */
export const cleanupAgentCreatedEvents = createAction<[wsId: string, cutoffTimestamp: number]>(
  "workspaceAgents/cleanupAgentCreatedEvents"
);

// Session lifecycle request actions (saga-owned side effects)
export const saveAgentSessionRequested = createAsyncAction<[
  wsId: string,
  agentId: string,
  immediate?: boolean,
  options?: SaveAgentSessionOptions,
], void>("workspaceAgents/saveAgentSession", "workspaceAgents/saveAgentSessionRequested");
export const renameAgentSessionRequested = createAsyncAction<[
  wsId: string,
  agentId: string,
  name: string,
], void>("workspaceAgents/renameAgentSession", "workspaceAgents/renameAgentSessionRequested");
export const stopAgentSessionRequested = createAsyncAction<[
  wsId: string,
  agentId: string,
], void>("workspaceAgents/stopAgentSession", "workspaceAgents/stopAgentSessionRequested");
export const deleteAgentSessionRequested = createAsyncAction<[
  wsId: string,
  agentId: string,
], void>("workspaceAgents/deleteAgentSession", "workspaceAgents/deleteAgentSessionRequested");
export const deleteAgentWithUndoRequested = createAsyncAction<[
  wsId: string,
  agentId: string,
  agentName?: string,
], AgentSession | null>("workspaceAgents/deleteAgentWithUndo", "workspaceAgents/deleteAgentWithUndoRequested");
export const undoAgentDeletionRequested = createAsyncAction<[
  wsId: string,
  agentId: string,
], boolean>("workspaceAgents/undoAgentDeletion", "workspaceAgents/undoAgentDeletionRequested");
export const commitPendingAgentDeletionRequested = createAction<[wsId: string, agentId: string]>(
  "workspaceAgents/commitPendingAgentDeletionRequested"
);
export const flushPendingAgentDeletionsRequested = createAsyncAction<[
  wsId: string,
], void>("workspaceAgents/flushPendingAgentDeletions", "workspaceAgents/flushPendingAgentDeletionsRequested");

/**
 * Saga-only trigger: ensure a single agent session is loaded into Redux.
 * If the session already exists with a usable backend identity it is a no-op;
 * otherwise the saga resolves the workspace and loads persisted session/config
 * through the saga-owned persistence utility, replacing stale same-ID shells.
 * Idempotent and debounced
 * per `(wsId, agentId)` — rapid re-dispatches while a load is in flight
 * are ignored. Handled in sagas/ensure-agent-session-saga.ts.
 */
export const ensureAgentSessionLoaded = createAction<[wsId: string, agentId: string]>(
  "workspaceAgents/ensureAgentSessionLoaded"
);

export const activateAgentRequested = createAsyncAction<[
  wsId: string,
  agentId: string,
], AgentSession | null>(
  "workspaceAgents/activateAgent",
  "workspaceAgents/activateAgentRequested",
);

export const restoreAgentSessionRequested = createAsyncAction<[
  wsId: string,
  agentId: string,
], AgentSession | null>(
  "workspaceAgents/restoreAgentSession",
  "workspaceAgents/restoreAgentSessionRequested",
);

export const workspaceAgentsReducer = createReducer<WorkspaceAgentsState>(initialState)
  .with(setAgents, (state, { payload: [wsId, agents] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, reconcileWorkspaceAgentSnapshot(workspaceState, agents));
  })
  .with(addAgent, (state, { payload: [wsId, agent] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const agentId = String(agent.id);
    const foregroundAgentIds = syncForegroundAgentId(workspaceState.foregroundAgentIds, agent);
    if (workspaceState.agentIds.includes(agentId)) {
      if (foregroundAgentIds !== workspaceState.foregroundAgentIds) {
        return setWorkspaceState(state, wsId, {
          ...workspaceState,
          foregroundAgentIds,
        });
      }
      return state;
    }
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      agentIds: [...workspaceState.agentIds, agentId],
      foregroundAgentIds,
    });
  })
  .with(removeAgent, (state, { payload: [wsId, agentId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const foregroundAgentIds = removeAgentId(workspaceState.foregroundAgentIds, agentId);
    if (!workspaceState.agentIds.includes(agentId) && foregroundAgentIds === workspaceState.foregroundAgentIds) {
      return state;
    }

    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      agentIds: workspaceState.agentIds.filter((id) => id !== agentId),
      foregroundAgentIds,
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
  // --------------------------------------------------------------------------
  // Unified-state-store migration — session data delegated to agent-session slice
  // --------------------------------------------------------------------------
  .with(setActiveAgentId, (state, { payload: [wsId, agentId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.activeAgentId === agentId) return state;
    return setWorkspaceState(state, wsId, { ...workspaceState, activeAgentId: agentId });
  })
  .with(upsertSession, (state, { payload: [session] }) => {
    // Only track the agent ID — session data lives in agent-session slice
    const wsId = String(session.workspaceId);
    const workspaceState = getWorkspaceState(state, wsId);
    const agentId = String(session.id);
    const foregroundAgentIds = syncForegroundAgentId(workspaceState.foregroundAgentIds, session);
    const diskMessageCounts = workspaceState.diskMessageCounts[agentId] !== undefined
      ? workspaceState.diskMessageCounts
      : { ...workspaceState.diskMessageCounts, [agentId]: session.messages?.length ?? 0 };
    if (workspaceState.agentIds.includes(agentId)) {
      if (
        foregroundAgentIds !== workspaceState.foregroundAgentIds ||
        diskMessageCounts !== workspaceState.diskMessageCounts
      ) {
        return setWorkspaceState(state, wsId, {
          ...workspaceState,
          foregroundAgentIds,
          diskMessageCounts,
        });
      }
      return state;
    }
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      agentIds: [...workspaceState.agentIds, agentId],
      foregroundAgentIds,
      diskMessageCounts,
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
  .with(workspaceDeleted, (state, { payload: [wsId] }) => {
    if (!state.byWorkspaceId[wsId]) return state;
    return { byWorkspaceId: omitKey(state.byWorkspaceId, wsId) };
  })
  // --------------------------------------------------------------------------
  // AgentService serializable state (6a migration)
  // --------------------------------------------------------------------------
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
