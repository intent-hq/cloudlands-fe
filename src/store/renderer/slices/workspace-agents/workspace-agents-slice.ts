import type {
  AgentSession,
  AgentMessage,
  ContentBlock,
  AgentId,
  AgentDelegatedCounts,
  AgentListBin,
  AgentScopeCounts,
} from '$shared/types';
import type { UnifiedAgentConfig } from '$shared/types/agent.types';
import { isBackgroundAgentSession } from '$shared/utils/agent-scope';
import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { omitKey } from '../../utils/utils';
import { restoreStoredSessions, upsertSession } from '../agent-session/agent-session-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
export {
  agentStreamUpdateReceived,
  type AgentStreamUpdatePayload,
} from './workspace-agents-stream-slice';

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
  /**
   * Daemon-served retired-row count (§5.5 soft retire). The default
   * hydration read excludes retired rows, so the sidebar's Retired bin renders
   * its collapsed toggle from this count and lazy-loads the rows on expand.
   */
  retiredCount: number;
  /** True once the retired-only read has hydrated the retired rows. */
  retiredAgentsLoaded: boolean;
  /** True while the on-demand retired-only read is in flight. */
  isLoadingRetiredAgents: boolean;
  /**
   * Daemon-served per-bin counts (`scopeCounts`, §5.5 row scope). The default
   * hydration read is `scope: "topLevel"`, so the sidebar's Delegated and
   * Background bins render their collapsed toggles from these counts and
   * lazy-load the rows on expand. `null` = the daemon served no counts
   * (predates `scope`, answered the all-rows read): no bins, every row is in
   * the list already.
   */
  scopeCounts: AgentScopeCounts | null;
  /**
   * Bumped each time `setScopeCounts` installs an authoritative baseline —
   * including one numerically equal to the held counts (a created row may
   * replace a retired one in the same bin, or the snapshot may correct an
   * already-stale local count). Deferred event nudges (`agent:created`
   * classifies the row only once its detail read lands) capture the generation
   * when the event arrives and skip the nudge if a newer baseline — which
   * already counts the row — was installed meanwhile. `adjustScopeCount`
   * never advances it.
   */
  scopeCountsGeneration: number;
  /**
   * Daemon-served per-parent delegated counts (`delegatedCounts`, §5.5),
   * installed by the same hydration read as `scopeCounts` and sharing its
   * baseline generation. Every top-level agent's collapsed delegated group
   * renders from `byParent[id]` until that parent's children are loaded.
   * `null` = the daemon served none (predates the field).
   */
  delegatedCounts: AgentDelegatedCounts | null;
  /** True once the whole-bin `scope: "delegated"` read has hydrated the delegated rows. */
  delegatedAgentsLoaded: boolean;
  /** True while the on-demand whole-bin delegated read is in flight. */
  isLoadingDelegatedAgents: boolean;
  /**
   * Parents whose direct children the per-parent delegated read
   * (`scope: "delegated"` + `parentAgentId`) has hydrated. A whole-bin load
   * covers every parent, so readers check `delegatedAgentsLoaded` first.
   */
  loadedDelegatedParentIds: Record<string, true>;
  /** Parents whose per-parent delegated read is in flight. */
  loadingDelegatedParentIds: Record<string, true>;
  /** True once the `scope: "background"` read has hydrated the background rows. */
  backgroundAgentsLoaded: boolean;
  /** True while the on-demand background read is in flight. */
  isLoadingBackgroundAgents: boolean;
}

/** Lazily loaded `agent.list` bins (retired rows have their own flags). */
export type LazyAgentListBin = Exclude<AgentListBin, 'topLevel'>;

export interface WorkspaceAgentsState {
  byWorkspaceId: Record<string, WorkspaceAgentState>;
}

export interface BackendActiveStreamPayload {
  agentId: string;
  workspaceId?: string;
  assistantAppMessageId?: string;
  accumulatedContent?: {
    content?: string;
    contentBlocks?: ContentBlock[];
  };
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
  specialistUpdate?: {
    specialist: string | null;
    model?: string | null;
    systemPrompt?: string | null;
  };
  specialistRollback?: Pick<AgentSession, 'metadata' | 'model'>;
}

function reconcileWorkspaceAgentSnapshot(
  workspaceState: WorkspaceAgentState,
  agents: AgentSession[],
): WorkspaceAgentState {
  const diskAgentIds = agents.map((agent) => String(agent.id));
  const diskIdSet = new Set(diskAgentIds);

  // Preserve only explicitly optimistic/pending local agents that are not in the daemon snapshot
  const optimisticIds = workspaceState.agentIds.filter((id) => {
    if (diskIdSet.has(id)) return false;
    // Keep IDs that are either recently created or waiting for first message
    return (
      workspaceState.recentlyCreatedAgents.includes(id) ||
      workspaceState.isWaitingForFirstMessage[id] === true
    );
  });

  // Daemon snapshot IDs are authoritative; append optimistic IDs
  const mergedIds = [...diskAgentIds, ...optimisticIds];
  const allIdSet = new Set(mergedIds);

  const diskForegroundAgentIds = agents
    .filter((agent) => !isBackgroundAgentSession(agent))
    .map((agent) => agent.id);
  const diskForegroundIdSet = new Set(diskForegroundAgentIds.map((id) => String(id)));
  const foregroundAgentIds = mergeUniqueAgentIds(
    workspaceState.foregroundAgentIds.filter((id) => {
      const agentId = String(id);
      return allIdSet.has(agentId) && (!diskIdSet.has(agentId) || diskForegroundIdSet.has(agentId));
    }),
    diskForegroundAgentIds,
  );
  const recentlyCreatedAgents = workspaceState.recentlyCreatedAgents.filter((id) =>
    allIdSet.has(id),
  );
  const isWaitingForFirstMessage = Object.fromEntries(
    Object.entries(workspaceState.isWaitingForFirstMessage).filter(([id]) => allIdSet.has(id)),
  );
  const diskMessageCounts = Object.fromEntries(
    Object.entries(workspaceState.diskMessageCounts).filter(([id]) => allIdSet.has(id)),
  );
  for (const agent of agents) {
    const agentId = String(agent.id);
    if (diskMessageCounts[agentId] === undefined) {
      diskMessageCounts[agentId] = agent.messages?.length ?? 0;
    }
  }

  return {
    ...workspaceState,
    agentIds: mergedIds,
    foregroundAgentIds,
    recentlyCreatedAgents,
    isWaitingForFirstMessage,
    diskMessageCounts,
  };
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
  return isBackgroundAgentSession(agent)
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
  retiredCount: 0,
  retiredAgentsLoaded: false,
  isLoadingRetiredAgents: false,
  scopeCounts: null,
  scopeCountsGeneration: 0,
  delegatedCounts: null,
  delegatedAgentsLoaded: false,
  isLoadingDelegatedAgents: false,
  loadedDelegatedParentIds: {},
  loadingDelegatedParentIds: {},
  backgroundAgentsLoaded: false,
  isLoadingBackgroundAgents: false,
};

export const initialState: WorkspaceAgentsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceAgentState);

export const setAgents = createAction<[wsId: string, agents: AgentSession[]]>(
  'workspaceAgents/setAgents',
);
export const addAgent = createAction<[wsId: string, agent: AgentSession]>(
  'workspaceAgents/addAgent',
);
export const removeAgent = createAction<[wsId: string, agentId: string]>(
  'workspaceAgents/removeAgent',
);
export const markAgentRecentlyCreated = createAction<[wsId: string, agentId: string]>(
  'workspaceAgents/markAgentRecentlyCreated',
);
export const setInitialAgentId = createAction<[wsId: string, agentId: string | null]>(
  'workspaceAgents/setInitialAgentId',
);
export const setAgentsLoaded = createAction<[wsId: string, loaded: boolean]>(
  'workspaceAgents/setAgentsLoaded',
);
export const setIsLoadingAgents = createAction<[wsId: string, loading: boolean]>(
  'workspaceAgents/setIsLoadingAgents',
);
/**
 * Fan-out trigger dispatched by the workspaceMounted fan-out
 * (`lifecycle-ipc-read-service`) — and by the daemon-events-bridge on a
 * recycled-ID `workspace:created` — so an opened workspace (re)hydrates its
 * agent list via `appClient.agents.list`, matching the agent read saga.
 * Saga-only trigger with no reducer entry (see AGENTS.md §8); the handler
 * lives in `lifecycle-read-service` and always refetches, converging the
 * store on the daemon's canonical list without clobbering a still-valid
 * active-agent selection.
 */
export const hydrateAgentsRequested = createAction<[wsId: string]>(
  'workspaceAgents/hydrateAgentsRequested',
);
/**
 * Saga-only trigger (no reducer entry): load the workspace's retired rows on
 * demand via the retired-only read (`retiredOnly: true`, §5.5) when the
 * sidebar's Retired bin is expanded or an active search needs them. The
 * handler lives in `lifecycle-read-saga` and no-ops once the rows are loaded.
 */
export const fetchRetiredAgentsRequested = createAction<[wsId: string]>(
  'workspaceAgents/fetchRetiredAgentsRequested',
);
/** Store the daemon-served retired-row count (`retiredCount`, §5.5 soft retire). */
export const setRetiredCount = createAction<[wsId: string, count: number]>(
  'workspaceAgents/setRetiredCount',
);
/**
 * Nudge the retired-row count on `agent:retired` (+1) / `agent:restored` (−1)
 * so the collapsed bin stays consistent without a full refetch; hydration
 * re-baselines from the daemon-served count.
 */
export const adjustRetiredCount = createAction<[wsId: string, delta: number]>(
  'workspaceAgents/adjustRetiredCount',
);
export const setRetiredAgentsLoaded = createAction<[wsId: string, loaded: boolean]>(
  'workspaceAgents/setRetiredAgentsLoaded',
);
export const setIsLoadingRetiredAgents = createAction<[wsId: string, loading: boolean]>(
  'workspaceAgents/setIsLoadingRetiredAgents',
);
/**
 * Saga-only triggers (no reducer entry): load one lazy bin's rows on demand
 * via the scoped read (`scope: "delegated"` / `scope: "background"`, §5.5 row
 * scope) when the sidebar's bin expands or an active search needs them. The
 * handlers live in `lifecycle-read-saga` and no-op once the rows are loaded.
 * The delegated trigger takes an optional `parentAgentId`: with it, only that
 * parent's direct children are read (`scope: "delegated"` + `parentAgentId`)
 * and only that parent is marked loaded; without it the whole bin is read.
 */
export const fetchDelegatedAgentsRequested = createAction<[wsId: string, parentAgentId?: string]>(
  'workspaceAgents/fetchDelegatedAgentsRequested',
);
export const fetchBackgroundAgentsRequested = createAction<[wsId: string]>(
  'workspaceAgents/fetchBackgroundAgentsRequested',
);
/**
 * Store the daemon-served per-bin counts (`scopeCounts`, §5.5 row scope);
 * `null` records that the daemon served none (old daemon, all-rows read).
 */
export const setScopeCounts = createAction<[wsId: string, counts: AgentScopeCounts | null]>(
  'workspaceAgents/setScopeCounts',
);
/**
 * Nudge one bin's count on agent lifecycle events (`agent:created` +1,
 * `agent:deleted` / `agent:retired` −1, `agent:restored` +1) so the collapsed
 * bins stay consistent without a full refetch; hydration re-baselines from the
 * daemon-served counts. A no-op while no counts are held (old daemon).
 */
export const adjustScopeCount = createAction<[wsId: string, bin: AgentListBin, delta: number]>(
  'workspaceAgents/adjustScopeCount',
);
export const setLazyBinLoaded = createAction<
  [wsId: string, bin: LazyAgentListBin, loaded: boolean]
>('workspaceAgents/setLazyBinLoaded');
export const setIsLoadingLazyBin = createAction<
  [wsId: string, bin: LazyAgentListBin, loading: boolean]
>('workspaceAgents/setIsLoadingLazyBin');
/**
 * Store the daemon-served per-parent delegated counts (`delegatedCounts`,
 * §5.5); `null` records that the daemon served none. Always put by the same
 * hydration read as `setScopeCounts`, whose generation bump covers both.
 */
export const setDelegatedCounts = createAction<[wsId: string, counts: AgentDelegatedCounts | null]>(
  'workspaceAgents/setDelegatedCounts',
);
/**
 * Nudge one parent's delegated `total` on agent lifecycle events, in lockstep
 * with the `adjustScopeCount(…, 'delegated', delta)` the same event dispatches
 * so `Σ byParent[*].total === scopeCounts.delegated` holds. An entry reaching
 * zero is dropped (the wire never serves an empty parent); `running` is never
 * nudged — it re-baselines on the next hydration read, and loaded rows are
 * authoritative once a parent's children are hydrated. A no-op while no
 * counts are held.
 */
export const adjustDelegatedParentCount = createAction<
  [wsId: string, parentAgentId: string, delta: number]
>('workspaceAgents/adjustDelegatedParentCount');
export const setDelegatedParentLoaded = createAction<
  [wsId: string, parentAgentId: string, loaded: boolean]
>('workspaceAgents/setDelegatedParentLoaded');
export const setIsLoadingDelegatedParent = createAction<
  [wsId: string, parentAgentId: string, loading: boolean]
>('workspaceAgents/setIsLoadingDelegatedParent');
export const createAgentRequested = createAction<
  [wsId: string, agentType?: string, options?: { panelLayoutId?: string; panelId?: string }]
>('workspaceAgents/createAgentRequested');
export const createAgentWithSpecialistRequested = createAction<
  [
    wsId: string,
    specialistId: string | null,
    options?: { panelLayoutId?: string; panelId?: string },
  ]
>('workspaceAgents/createAgentWithSpecialistRequested');
export const createAgentFromConfigRequested = createAsyncAction<
  [wsId: string, config: UnifiedAgentConfig, options?: AgentCreationRequestOptions],
  AgentSession
>('workspaceAgents/createAgentFromConfig', 'workspaceAgents/createAgentFromConfigRequested');
export const forkAgentRequested = createAction<[wsId: string, request: ForkAgentRequest]>(
  'workspaceAgents/forkAgentRequested',
);
export const delegateTaskRequested = createAction<
  [wsId: string, taskText: string, openAgent?: boolean]
>('workspaceAgents/delegateTaskRequested');
export const delegateExistingTaskRequested = createAction<
  [wsId: string, noteId: string, taskText: string, openAgent?: boolean]
>('workspaceAgents/delegateExistingTaskRequested');
export const runAgentForNoteRequested = createAction<
  [wsId: string, noteId: string, noteTitle?: string]
>('workspaceAgents/runAgentForNoteRequested');
export const agentsLoaded = createAction<[wsId: string]>('workspaceAgents/agentsLoaded');
export const setWaitingForFirstMessage = createAction<
  [wsId: string, agentId: string, waiting: boolean]
>('workspaceAgents/setWaitingForFirstMessage');

// --------------------------------------------------------------------------
// New actions for unified-state-store migration
// --------------------------------------------------------------------------

/** Set the active (focused) agent for a workspace */
export const setActiveAgentId = createAction<[wsId: string, agentId: string | null]>(
  'workspaceAgents/setActiveAgentId',
);

/** Set the initial spec write in-progress flag */
export const setInitialSpecWriteInProgress = createAction<[wsId: string, isWriting: boolean]>(
  'workspaceAgents/setInitialSpecWriteInProgress',
);

/** Remove the entire workspace state entry */
export const removeWorkspaceAgentState = createAction<[wsId: string]>(
  'workspaceAgents/removeWorkspaceAgentState',
);

// --------------------------------------------------------------------------
// Actions for AgentService serializable state (6a migration)
// --------------------------------------------------------------------------

/** Record a recent agent:created event timestamp for deduplication */
export const recordAgentCreatedEvent = createAction<
  [wsId: string, agentId: string, timestamp: number]
>('workspaceAgents/recordAgentCreatedEvent');

/** Clean up old agent:created dedup entries (older than the given cutoff timestamp) */
export const cleanupAgentCreatedEvents = createAction<[wsId: string, cutoffTimestamp: number]>(
  'workspaceAgents/cleanupAgentCreatedEvents',
);

/**
 * Saga-only trigger: schedule a debounced reconnection to backend streams.
 * Replaces the setTimeout-based scheduleBackendStreamReconnect() in AgentService.
 * Handled by takeLatest + delay(500) in agent-ipc-saga.ts.
 */
export const triggerBackendStreamReconnect = createAction(
  'workspaceAgents/triggerBackendStreamReconnect',
);

// Session lifecycle request actions (saga-owned side effects)
export const saveAgentSessionRequested = createAsyncAction<
  [wsId: string, agentId: string, immediate?: boolean, options?: SaveAgentSessionOptions],
  void
>('workspaceAgents/saveAgentSession', 'workspaceAgents/saveAgentSessionRequested');
export const renameAgentSessionRequested = createAsyncAction<
  [wsId: string, agentId: string, name: string],
  void
>('workspaceAgents/renameAgentSession', 'workspaceAgents/renameAgentSessionRequested');
export const stopAgentSessionRequested = createAsyncAction<[wsId: string, agentId: string], void>(
  'workspaceAgents/stopAgentSession',
  'workspaceAgents/stopAgentSessionRequested',
);
/**
 * Set or clear the daemon-owned per-agent notification mute
 * (`agent.update { changes: { notificationsMuted } }`, §5.5). The saga
 * applies the flag optimistically (re-deriving `hasUnread`), reverts on a
 * daemon failure, and lets the `agent:updated` push converge the session.
 */
export const setAgentNotificationsMutedRequested = createAsyncAction<
  [wsId: string, agentId: string, notificationsMuted: boolean],
  void
>(
  'workspaceAgents/setAgentNotificationsMuted',
  'workspaceAgents/setAgentNotificationsMutedRequested',
);
export const deleteAgentSessionRequested = createAsyncAction<[wsId: string, agentId: string], void>(
  'workspaceAgents/deleteAgentSession',
  'workspaceAgents/deleteAgentSessionRequested',
);
export const deleteAgentWithUndoRequested = createAsyncAction<
  [wsId: string, agentId: string, agentName?: string],
  AgentSession | null
>('workspaceAgents/deleteAgentWithUndo', 'workspaceAgents/deleteAgentWithUndoRequested');
export const undoAgentDeletionRequested = createAsyncAction<
  [wsId: string, agentId: string],
  boolean
>('workspaceAgents/undoAgentDeletion', 'workspaceAgents/undoAgentDeletionRequested');

// Stream lifecycle actions

/** Request the safety timeout check after reconnect (replaces startStreamingSafetyTimeout) */
export const triggerStreamingSafetyCheck = createAction<[confirmedActiveIds: string[]]>(
  'workspaceAgents/triggerStreamingSafetyCheck',
);

/** Request stream handler re-registration for streaming sessions in a workspace. */
export const reconnectStreamHandlersForWorkspaceRequested = createAction<[workspaceId: string]>(
  'workspaceAgents/reconnectStreamHandlersForWorkspaceRequested',
);

/** Backend active-stream snapshot from the thin lifecycle adapter. */
export const backendStreamsReconnectResultReceived = createAction<
  [streams: BackendActiveStreamPayload[]]
>('workspaceAgents/backendStreamsReconnectResultReceived');

/** Clear stale streaming assistant messages before a new stream mutates state. */
export const agentStreamResetStreamingMessagesRequested = createAction<
  [payload: { workspaceId?: string; agentId: string; reason: string }]
>('workspaceAgents/agentStreamResetStreamingMessagesRequested');

/**
 * Saga-only trigger: load a single agent session's latest metadata into Redux.
 * Every dispatch is processed independently so unrelated agent loads can run
 * concurrently. A later same-agent dispatch supersedes only its matching
 * in-flight read before it can upsert, independent of response timestamps.
 * Existing transcript messages are preserved, and workspace cleanup cancels
 * any matching in-flight load. Handled in sagas/agent-read-saga.ts.
 */
export const ensureAgentSessionLoaded = createAction<[wsId: string, agentId: string]>(
  'workspaceAgents/ensureAgentSessionLoaded',
  (...args) => {
    return args;
  },
);

export const activateAgentRequested = createAsyncAction<
  [wsId: string, agentId: string],
  AgentSession | null
>('workspaceAgents/activateAgent', 'workspaceAgents/activateAgentRequested');

export const restoreAgentSessionRequested = createAsyncAction<
  [wsId: string, agentId: string],
  AgentSession | null
>('workspaceAgents/restoreAgentSession', 'workspaceAgents/restoreAgentSessionRequested');

/**
 * Un-retire a soft-retired agent via `agent.restore` (§5.5). Distinct from
 * `restoreAgentSessionRequested`, which re-materializes a hidden session from
 * the daemon — this clears `retiredAt` daemon-side and the refreshed metadata
 * moves the agent out of the sidebar's Retired bin.
 */
export const restoreRetiredAgentRequested = createAsyncAction<
  [wsId: string, agentId: string],
  void
>('workspaceAgents/restoreRetiredAgent', 'workspaceAgents/restoreRetiredAgentRequested');

export const workspaceAgentsReducer = createReducer<WorkspaceAgentsState>(initialState);
workspaceAgentsReducer.with(setAgents, (state, { payload: [wsId, agents] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, reconcileWorkspaceAgentSnapshot(workspaceState, agents));
});
workspaceAgentsReducer.with(addAgent, (state, { payload: [wsId, agent] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  const agentId = String(agent.id);
  const foregroundAgentIds = syncForegroundAgentId(workspaceState.foregroundAgentIds, agent);
  const diskMessageCounts =
    workspaceState.diskMessageCounts[agentId] !== undefined
      ? workspaceState.diskMessageCounts
      : { ...workspaceState.diskMessageCounts, [agentId]: agent.messages?.length ?? 0 };
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
});
workspaceAgentsReducer.with(removeAgent, (state, { payload: [wsId, agentId] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  const foregroundAgentIds = removeAgentId(workspaceState.foregroundAgentIds, agentId);
  if (
    !workspaceState.agentIds.includes(agentId) &&
    foregroundAgentIds === workspaceState.foregroundAgentIds
  ) {
    return state;
  }

  return setWorkspaceState(state, wsId, {
    ...workspaceState,
    agentIds: workspaceState.agentIds.filter((id) => id !== agentId),
    foregroundAgentIds,
    initialAgentId:
      workspaceState.initialAgentId === agentId ? null : workspaceState.initialAgentId,
    recentlyCreatedAgents: workspaceState.recentlyCreatedAgents.filter(
      (recentAgentId) => recentAgentId !== agentId,
    ),
    isWaitingForFirstMessage: omitKey(workspaceState.isWaitingForFirstMessage, agentId),
    diskMessageCounts: omitKey(workspaceState.diskMessageCounts, agentId),
  });
});
workspaceAgentsReducer.with(markAgentRecentlyCreated, (state, { payload: [wsId, agentId] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  if (workspaceState.recentlyCreatedAgents.includes(agentId)) {
    return state;
  }
  return setWorkspaceState(state, wsId, {
    ...workspaceState,
    recentlyCreatedAgents: [...workspaceState.recentlyCreatedAgents, agentId],
  });
});
workspaceAgentsReducer.with(setInitialAgentId, (state, { payload: [wsId, initialAgentId] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  if (workspaceState.initialAgentId === initialAgentId) {
    return state;
  }
  return setWorkspaceState(state, wsId, { ...workspaceState, initialAgentId });
});
workspaceAgentsReducer.with(setAgentsLoaded, (state, { payload: [wsId, agentsLoaded] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  if (workspaceState.agentsLoaded === agentsLoaded) {
    return state;
  }
  return setWorkspaceState(state, wsId, { ...workspaceState, agentsLoaded });
});
workspaceAgentsReducer.with(setIsLoadingAgents, (state, { payload: [wsId, isLoadingAgents] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  if (workspaceState.isLoadingAgents === isLoadingAgents) {
    return state;
  }
  return setWorkspaceState(state, wsId, { ...workspaceState, isLoadingAgents });
});
workspaceAgentsReducer.with(setRetiredCount, (state, { payload: [wsId, count] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  const retiredCount = Math.max(0, count);
  if (workspaceState.retiredCount === retiredCount) {
    return state;
  }
  return setWorkspaceState(state, wsId, { ...workspaceState, retiredCount });
});
workspaceAgentsReducer.with(adjustRetiredCount, (state, { payload: [wsId, delta] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  const retiredCount = Math.max(0, workspaceState.retiredCount + delta);
  if (workspaceState.retiredCount === retiredCount) {
    return state;
  }
  return setWorkspaceState(state, wsId, { ...workspaceState, retiredCount });
});
workspaceAgentsReducer.with(setRetiredAgentsLoaded, (state, { payload: [wsId, loaded] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  if (workspaceState.retiredAgentsLoaded === loaded) {
    return state;
  }
  return setWorkspaceState(state, wsId, { ...workspaceState, retiredAgentsLoaded: loaded });
});
workspaceAgentsReducer.with(setIsLoadingRetiredAgents, (state, { payload: [wsId, loading] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  if (workspaceState.isLoadingRetiredAgents === loading) {
    return state;
  }
  return setWorkspaceState(state, wsId, { ...workspaceState, isLoadingRetiredAgents: loading });
});
workspaceAgentsReducer.with(setScopeCounts, (state, { payload: [wsId, counts] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  const scopeCounts = counts
    ? {
        topLevel: Math.max(0, counts.topLevel),
        delegated: Math.max(0, counts.delegated),
        background: Math.max(0, counts.background),
      }
    : null;
  const current = workspaceState.scopeCounts;
  const unchanged =
    current === scopeCounts ||
    (current !== null &&
      scopeCounts !== null &&
      current.topLevel === scopeCounts.topLevel &&
      current.delegated === scopeCounts.delegated &&
      current.background === scopeCounts.background);
  // An equal-valued snapshot is still a fresh baseline: the generation
  // advances so deferred nudges captured before it are dropped, while the
  // counts object keeps its reference.
  return setWorkspaceState(state, wsId, {
    ...workspaceState,
    scopeCounts: unchanged ? current : scopeCounts,
    scopeCountsGeneration: workspaceState.scopeCountsGeneration + 1,
  });
});
workspaceAgentsReducer.with(adjustScopeCount, (state, { payload: [wsId, bin, delta] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  const current = workspaceState.scopeCounts;
  if (!current) return state;
  const next = Math.max(0, current[bin] + delta);
  if (current[bin] === next) return state;
  return setWorkspaceState(state, wsId, {
    ...workspaceState,
    scopeCounts: { ...current, [bin]: next },
  });
});
const LAZY_BIN_LOADED_FIELD = {
  delegated: 'delegatedAgentsLoaded',
  background: 'backgroundAgentsLoaded',
} as const satisfies Record<LazyAgentListBin, keyof WorkspaceAgentState>;
const LAZY_BIN_LOADING_FIELD = {
  delegated: 'isLoadingDelegatedAgents',
  background: 'isLoadingBackgroundAgents',
} as const satisfies Record<LazyAgentListBin, keyof WorkspaceAgentState>;
workspaceAgentsReducer.with(setLazyBinLoaded, (state, { payload: [wsId, bin, loaded] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  const field = LAZY_BIN_LOADED_FIELD[bin];
  if (workspaceState[field] === loaded) return state;
  return setWorkspaceState(state, wsId, { ...workspaceState, [field]: loaded });
});
workspaceAgentsReducer.with(setIsLoadingLazyBin, (state, { payload: [wsId, bin, loading] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  const field = LAZY_BIN_LOADING_FIELD[bin];
  if (workspaceState[field] === loading) return state;
  return setWorkspaceState(state, wsId, { ...workspaceState, [field]: loading });
});
workspaceAgentsReducer.with(setDelegatedCounts, (state, { payload: [wsId, counts] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  if (!counts) {
    if (workspaceState.delegatedCounts === null) return state;
    return setWorkspaceState(state, wsId, { ...workspaceState, delegatedCounts: null });
  }
  const byParent: AgentDelegatedCounts['byParent'] = {};
  for (const [parentAgentId, entry] of Object.entries(counts.byParent)) {
    const total = Math.max(0, entry.total);
    if (total === 0) continue;
    byParent[parentAgentId] = { total, running: Math.min(total, Math.max(0, entry.running)) };
  }
  return setWorkspaceState(state, wsId, {
    ...workspaceState,
    delegatedCounts: { running: Math.max(0, counts.running), byParent },
  });
});
workspaceAgentsReducer.with(
  adjustDelegatedParentCount,
  (state, { payload: [wsId, parentAgentId, delta] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const current = workspaceState.delegatedCounts;
    if (!current || delta === 0) return state;
    const entry = current.byParent[parentAgentId];
    const total = Math.max(0, (entry?.total ?? 0) + delta);
    if ((entry?.total ?? 0) === total) return state;
    const byParent = { ...current.byParent };
    if (total === 0) {
      delete byParent[parentAgentId];
    } else {
      byParent[parentAgentId] = { total, running: Math.min(total, entry?.running ?? 0) };
    }
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      delegatedCounts: { ...current, byParent },
    });
  },
);
function setParentIdFlag(
  ids: Record<string, true>,
  parentAgentId: string,
  flagged: boolean,
): Record<string, true> {
  if (flagged) {
    return ids[parentAgentId] ? ids : { ...ids, [parentAgentId]: true };
  }
  return ids[parentAgentId] ? omitKey(ids, parentAgentId) : ids;
}
workspaceAgentsReducer.with(
  setDelegatedParentLoaded,
  (state, { payload: [wsId, parentAgentId, loaded] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const next = setParentIdFlag(workspaceState.loadedDelegatedParentIds, parentAgentId, loaded);
    if (next === workspaceState.loadedDelegatedParentIds) return state;
    return setWorkspaceState(state, wsId, { ...workspaceState, loadedDelegatedParentIds: next });
  },
);
workspaceAgentsReducer.with(
  setIsLoadingDelegatedParent,
  (state, { payload: [wsId, parentAgentId, loading] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const next = setParentIdFlag(workspaceState.loadingDelegatedParentIds, parentAgentId, loading);
    if (next === workspaceState.loadingDelegatedParentIds) return state;
    return setWorkspaceState(state, wsId, { ...workspaceState, loadingDelegatedParentIds: next });
  },
);

workspaceAgentsReducer.with(
  setWaitingForFirstMessage,
  (state, { payload: [wsId, agentId, waiting] }) => {
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
  },
);
// --------------------------------------------------------------------------
// Unified-state-store migration — session data delegated to agent-session slice
// --------------------------------------------------------------------------
workspaceAgentsReducer.with(setActiveAgentId, (state, { payload: [wsId, agentId] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  if (workspaceState.activeAgentId === agentId) return state;
  return setWorkspaceState(state, wsId, { ...workspaceState, activeAgentId: agentId });
});
// Only track the agent ID — session data lives in agent-session slice
function syncSessionMembership(state: WorkspaceAgentsState, session: AgentSession) {
  const wsId = String(session.workspaceId);
  const workspaceState = getWorkspaceState(state, wsId);
  const agentId = String(session.id);
  const foregroundAgentIds = syncForegroundAgentId(workspaceState.foregroundAgentIds, session);
  const diskMessageCounts =
    workspaceState.diskMessageCounts[agentId] !== undefined
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
}
workspaceAgentsReducer.with(upsertSession, (state, { payload: [session] }) =>
  syncSessionMembership(state, session),
);
// A stored-snapshot restore (soft-hide undo / failed delete / delete-cancelled)
// follows a `removeAgent`, so membership must be re-registered the same way.
workspaceAgentsReducer.with(restoreStoredSessions, (state, { payload: [sessions] }) => {
  let next = state;
  for (const session of sessions) {
    next = syncSessionMembership(next, session);
  }
  return next;
});
workspaceAgentsReducer.with(
  setInitialSpecWriteInProgress,
  (state, { payload: [wsId, isWriting] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.isInitialSpecWriteInProgress === isWriting) return state;
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      isInitialSpecWriteInProgress: isWriting,
    });
  },
);
workspaceAgentsReducer.with(removeWorkspaceAgentState, (state, { payload: [wsId] }) => {
  if (!state.byWorkspaceId[wsId]) return state;
  return { byWorkspaceId: omitKey(state.byWorkspaceId, wsId) };
});
workspaceAgentsReducer.with(workspaceDeleted, (state, { payload: [wsId] }) => {
  if (!state.byWorkspaceId[wsId]) return state;
  return { byWorkspaceId: omitKey(state.byWorkspaceId, wsId) };
});
// --------------------------------------------------------------------------
// AgentService serializable state (6a migration)
// --------------------------------------------------------------------------
workspaceAgentsReducer.with(
  recordAgentCreatedEvent,
  (state, { payload: [wsId, agentId, timestamp] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      recentAgentCreatedEvents: {
        ...workspaceState.recentAgentCreatedEvents,
        [agentId]: timestamp,
      },
    });
  },
);
workspaceAgentsReducer.with(
  cleanupAgentCreatedEvents,
  (state, { payload: [wsId, cutoffTimestamp] }) => {
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
  },
);
