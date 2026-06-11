/**
 * Session Stats Saga
 *
 * Handles fetching session credit stats via IPC.
 * - Workspace stats: fetched on workspace mount + polled every 60s
 * - Agent stats: fetched on demand
 */

import {
  call,
  cancel,
  delay,
  fork,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import type { Task } from "redux-saga";
import {
  invoke,
  isElectron,
} from "$lib/electron-bridge";
import { SESSION_STATS_CHANNELS } from "$shared/ipc/channels";
import {
  clearActiveWorkspace,
  setActiveWorkspaceId,
} from "../../workspace/workspace-slice";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import {
  selectAgentsLoaded,
  selectAllWorkspaceAgents,
} from "../../workspace-agents/workspace-agents-selectors";

import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { removeAgent } from "../../workspace-agents/workspace-agents-slice";
import { eventReceived } from "../../workspace-events/workspace-events-slice";
import {
  fetchWorkspaceStats,
  workspaceStatsReceived,
  workspaceStatsFailed,
  fetchAgentStats,
  agentStatsReceived,
  agentStatsFailed,
  clearSessionStats,
  clearAgentStatsLoading,
} from "../session-stats-slice";
import type {
  AgentSessionStats,
  WorkspaceAggregateStats,
  WorkspaceStatsSessionRequest,
} from "../session-stats-types";
import { selectAllAgentStats } from "../session-stats-selectors";
import { getWorkspaceStatsSessionRequests } from "../utils/workspace-session-selection";

/** Polling interval for workspace stats (60 seconds) */
const POLL_INTERVAL_MS = 60_000;

/** Debounce window for agent-activity-driven refetches. Coalesces bursts of
 *  agent:idle events (e.g. parent + sub-agents finishing back-to-back) into
 *  a single stats fetch so the UI updates promptly without thrashing IPC. */
const AGENT_ACTIVITY_DEBOUNCE_MS = 1500;

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

/**
 * Fetch stats via IPC. The handler always takes `{ sessionIds: string[] }` and
 * returns `{ success, data: AggregatedSessionStats }`. For a single agent we
 * still send a one-element array and extract the first session entry.
 */
async function fetchStatsFromIpc(sessionIds: string[]): Promise<{
  sessions: Array<{
    sessionId: string;
    messageCount: number;
    toolCount: number;
    creditsUsed: number | null;
    parentCreditsUsed: number | null;
    subAgentCreditsUsed: number | null;
  }>;
  totalCreditsUsed: number;
  totalMessageCount: number;
  totalToolCount: number;
  hasPendingCredits: boolean;
  isPartial: boolean;
  failedCount: number;
}> {
  if (!isElectron()) {
    throw new Error("IPC not available");
  }
  const result = await invoke<{ success: boolean; data?: any; error?: unknown }>(
    SESSION_STATS_CHANNELS.GET,
    { sessionIds },
  );
  if (!result || !result.success || !result.data) {
    // Zod validation failures from the IPC middleware surface `error` as an
    // object ({ code, message, details }); stringify so the thrown message is
    // actionable instead of "[object Object]".
    const rawErr = result?.error;
    const errMsg =
      typeof rawErr === "string"
        ? rawErr
        : rawErr != null
          ? JSON.stringify(rawErr)
          : "Failed to fetch session stats";
    throw new Error(errMsg);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Saga handlers
// ---------------------------------------------------------------------------

function isWorkspaceStatsSessionRequest(
  value: string | WorkspaceStatsSessionRequest,
): value is WorkspaceStatsSessionRequest {
  return typeof value !== "string";
}

function normalizeWorkspaceStatsRequests(
  values: WorkspaceStatsSessionRequest[] | string[],
): WorkspaceStatsSessionRequest[] {
  return values.map((value) =>
    isWorkspaceStatsSessionRequest(value)
      ? value
      : { agentId: value, sessionId: value, messageCount: 0, isActive: true },
  );
}

function makeAgentStatsFromSession(
  session: {
    sessionId: string;
    messageCount: number;
    toolCount: number;
    creditsUsed: number | null;
    parentCreditsUsed: number | null;
    subAgentCreditsUsed: number | null;
  },
  lastFetchedAt: string,
): AgentSessionStats {
  return {
    sessionId: session.sessionId,
    messageCount: session.messageCount,
    toolCount: session.toolCount,
    creditsUsed: session.creditsUsed,
    parentCreditsUsed: session.parentCreditsUsed,
    subAgentCreditsUsed: session.subAgentCreditsUsed,
    lastFetchedAt,
  };
}

function aggregateAgentStats(
  stats: AgentSessionStats[],
  requestedCount: number,
  failedCount: number,
  lastFetchedAt: string,
): WorkspaceAggregateStats {
  return {
    totalCreditsUsed:
      Math.round(stats.reduce((sum, s) => sum + (s.creditsUsed ?? 0), 0) * 100) / 100,
    totalMessageCount: stats.reduce((sum, s) => sum + s.messageCount, 0),
    totalToolCount: stats.reduce((sum, s) => sum + s.toolCount, 0),
    agentCount: requestedCount,
    hasPendingCredits: stats.some((s) => s.creditsUsed === null),
    isPartial: failedCount > 0 || stats.length < requestedCount,
    failedCount,
    lastFetchedAt,
  };
}

function shouldRefreshStats(
  request: WorkspaceStatsSessionRequest,
  cached: AgentSessionStats | undefined,
): boolean {
  return (
    request.isActive ||
    !cached ||
    cached.sessionId !== request.sessionId ||
    cached.creditsUsed === null ||
    request.messageCount > cached.messageCount
  );
}

function* handleFetchWorkspaceStats(
  action: ReturnType<typeof fetchWorkspaceStats>,
): SagaGenerator<void> {
  const [wsId, sessionRequestValues, explicitRefreshSessionIds] = action.payload;
  const sessionRequests = normalizeWorkspaceStatsRequests(sessionRequestValues);
  const sessionIds = sessionRequests.map((request) => request.sessionId);
  try {
    const cachedAgentStats: Record<string, AgentSessionStats> = yield* selectAllAgentStats.effect();
    const refreshSessionIds = explicitRefreshSessionIds ?? sessionIds;
    const raw = refreshSessionIds.length > 0
      ? yield* call(fetchStatsFromIpc, refreshSessionIds)
      : { sessions: [], failedCount: 0 };
    const lastFetchedAt = new Date().toISOString();
    const fetchedBySessionId = new Map(
      raw.sessions.map((session) => [session.sessionId, makeAgentStatsFromSession(session, lastFetchedAt)]),
    );
    const aggregateStats: AgentSessionStats[] = [];

    for (const request of sessionRequests) {
      const fetched = fetchedBySessionId.get(request.sessionId);
      if (fetched) {
        aggregateStats.push(fetched);
        yield* put(agentStatsReceived(request.agentId, fetched));
        continue;
      }
      const cached = cachedAgentStats[request.agentId];
      if (cached?.sessionId === request.sessionId) {
        aggregateStats.push(cached);
      }
    }

    yield* put(
      workspaceStatsReceived(
        wsId,
        aggregateAgentStats(
          aggregateStats,
          sessionRequests.length,
          raw.failedCount,
          lastFetchedAt,
        ),
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    yield* put(workspaceStatsFailed(wsId, message));
  }
}

function* handleFetchAgentStats(
  action: ReturnType<typeof fetchAgentStats>,
): SagaGenerator<void> {
  const [agentId, sessionId] = action.payload;
  try {
    const raw = yield* call(fetchStatsFromIpc, [sessionId]);
    const session = raw.sessions[0];
    if (!session) {
      throw new Error("No stats returned for session");
    }
    const stats: AgentSessionStats = {
      sessionId: session.sessionId,
      messageCount: session.messageCount,
      toolCount: session.toolCount,
      creditsUsed: session.creditsUsed,
      parentCreditsUsed: session.parentCreditsUsed,
      subAgentCreditsUsed: session.subAgentCreditsUsed,
      lastFetchedAt: new Date().toISOString(),
    };
    yield* put(agentStatsReceived(agentId, stats));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    yield* put(agentStatsFailed(agentId, message));
  }
}

// ---------------------------------------------------------------------------
// Workspace polling
// ---------------------------------------------------------------------------

function* getSessionRequestsForWorkspace(
  wsId: string,
): SagaGenerator<WorkspaceStatsSessionRequest[]> {
  const agents = yield* selectAllWorkspaceAgents.effect(wsId);
  // Keep workspace-level polling bounded for large historical workspaces. Per-agent
  // hover stats still fetch a single session on demand; the aggregate prioritizes
  // active, foreground, and recent Auggie sessions instead of every persisted agent.
  return getWorkspaceStatsSessionRequests(agents);
}

function* getRefreshSessionIds(
  sessionRequests: WorkspaceStatsSessionRequest[],
): SagaGenerator<string[]> {
  const cachedAgentStats: Record<string, AgentSessionStats> = yield* selectAllAgentStats.effect();
  return sessionRequests
    .filter((request) => shouldRefreshStats(request, cachedAgentStats[request.agentId]))
    .map((request) => request.sessionId);
}

/** Wait for agents to finish loading from disk before collecting session IDs.
 *  Without this, the retroactive mount check fires before loadAgentsFromDiskSaga
 *  has populated the agent list, resulting in an empty sessionIds array. */
function* waitForAgentsLoaded(wsId: string): SagaGenerator<void> {
  const MAX_WAIT_MS = 15_000;
  const POLL_MS = 250;
  let elapsed = 0;

  while (elapsed < MAX_WAIT_MS) {
    const loaded: boolean = yield* selectAgentsLoaded.effect(wsId);
    if (loaded) return;

    // Also listen for the action in case it fires between polls
    yield* delay(POLL_MS);
    elapsed += POLL_MS;
  }
  // Timed out — proceed anyway (agents may genuinely be empty)
}

function* refreshCurrentActiveWorkspaceStats(
  unmountedWorkspaceIds: Set<string>,
): SagaGenerator<void> {
  const wsId: string | null = yield* selectActiveWorkspaceId.effect();
  if (!wsId || unmountedWorkspaceIds.has(wsId)) {
    return;
  }

  // Wait for agents to finish loading from disk before each refresh attempt.
  yield* call(waitForAgentsLoaded, wsId);

  // Re-read active workspace after waiting so delayed disk loads cannot refresh
  // a workspace that stopped being active while this loop stayed alive.
  const currentWsId: string | null = yield* selectActiveWorkspaceId.effect();
  if (currentWsId !== wsId || unmountedWorkspaceIds.has(wsId)) {
    return;
  }

  const sessionRequests: WorkspaceStatsSessionRequest[] = yield* call(
    getSessionRequestsForWorkspace,
    wsId,
  );
  yield* call(dispatchWorkspaceStatsOrClear, wsId, sessionRequests);
}

type PollingWakeAction =
  | ReturnType<typeof setActiveWorkspaceId>
  | ReturnType<typeof clearActiveWorkspace>
  | ReturnType<typeof workspaceMounted>
  | ReturnType<typeof workspaceUnmounted>;

function updateUnmountedPollingWorkspaces(
  action: PollingWakeAction,
  unmountedWorkspaceIds: Set<string>,
): boolean {
  const wsId = action.payload?.[0];

  if (action.type === workspaceUnmounted.type) {
    if (wsId) {
      unmountedWorkspaceIds.add(wsId);
    }
    return false;
  }

  if (action.type === workspaceMounted.type) {
    return wsId ? unmountedWorkspaceIds.delete(wsId) : false;
  }

  if (action.type === setActiveWorkspaceId.type && wsId) {
    unmountedWorkspaceIds.delete(wsId);
  }

  return true;
}

function* waitForNextPollingRefresh(
  unmountedWorkspaceIds: Set<string>,
): SagaGenerator<boolean> {
  const result: { wakeAction?: PollingWakeAction } = yield* race({
    interval: delay(POLL_INTERVAL_MS),
    wakeAction: take([
      setActiveWorkspaceId,
      clearActiveWorkspace,
      workspaceMounted,
      workspaceUnmounted,
    ]),
  });

  return result.wakeAction
    ? updateUnmountedPollingWorkspaces(result.wakeAction, unmountedWorkspaceIds)
    : true;
}

/** One long-lived polling owner. It selects the active workspace internally. */
function* sessionStatsPollingLoop(): SagaGenerator<void> {
  const unmountedWorkspaceIds = new Set<string>();
  let shouldRefresh = true;

  while (true) {
    if (shouldRefresh) {
      yield* call(refreshCurrentActiveWorkspaceStats, unmountedWorkspaceIds);
    }

    shouldRefresh = yield* call(waitForNextPollingRefresh, unmountedWorkspaceIds);
  }
}

/** If sessionIds is empty, clear stats for the workspace so the UI reflects
 *  "no agents, no stats" instead of showing stale totals. Otherwise dispatch
 *  a fetch. Sending an empty array to the IPC layer is avoided (unclear
 *  semantics and may not be tolerated downstream). */
function* dispatchWorkspaceStatsOrClear(
  wsId: string,
  sessionRequests: WorkspaceStatsSessionRequest[],
): SagaGenerator<void> {
  if (sessionRequests.length === 0) {
    yield* put(clearSessionStats(wsId));
  } else {
    const refreshSessionIds: string[] = yield* call(getRefreshSessionIds, sessionRequests);
    yield* put(fetchWorkspaceStats(wsId, sessionRequests, refreshSessionIds));
  }
}

type AgentIdleEventReceivedAction = ReturnType<typeof eventReceived>;

function isAgentIdleEventReceived(action: unknown): action is AgentIdleEventReceivedAction {
  if (typeof action !== "object" || action === null) {
    return false;
  }

  const candidate = action as Partial<AgentIdleEventReceivedAction>;
  if (candidate.type !== eventReceived.type || !Array.isArray(candidate.payload)) {
    return false;
  }

  const [, event] = candidate.payload;
  return event?.type === "agent:idle";
}

function* waitForWorkspaceUnmount(wsId: string): SagaGenerator<void> {
  while (true) {
    const action: ReturnType<typeof workspaceUnmounted> = yield* take(workspaceUnmounted);
    const [unmountedWsId] = action.payload;
    if (unmountedWsId === wsId) return;
  }
}

function* delayedAgentIdleRefetch(wsId: string): SagaGenerator<void> {
  yield* delay(AGENT_ACTIVITY_DEBOUNCE_MS);
  const sessionRequests: WorkspaceStatsSessionRequest[] = yield* call(
    getSessionRequestsForWorkspace,
    wsId,
  );
  yield* call(dispatchWorkspaceStatsOrClear, wsId, sessionRequests);
}

function* handleAgentIdleRefetch(action: AgentIdleEventReceivedAction): SagaGenerator<void> {
  const [wsId] = action.payload;
  yield* race({
    refetched: call(delayedAgentIdleRefetch, wsId),
    unmounted: call(waitForWorkspaceUnmount, wsId),
  });
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* sessionStatsSaga(): SagaGenerator<void> {
  const wsFetchTasks: Record<string, Task> = {};
  const agentFetchTasks: Record<string, Task> = {};
  const agentActivityRefetchTasks: Record<string, Task> = {};

  // Workspace stats: cancel/coalesce only the previous fetch for the same wsId.
  yield* takeEvery(fetchWorkspaceStats, function* (action: ReturnType<typeof fetchWorkspaceStats>) {
    const [wsId] = action.payload;
    const prev = wsFetchTasks[wsId];
    if (prev) {
      yield* cancel(prev);
    }

    const task: Task = yield* fork(function* () {
      try {
        yield* call(handleFetchWorkspaceStats, action);
      } finally {
        if (wsFetchTasks[wsId] === task) {
          delete wsFetchTasks[wsId];
        }
      }
    });
    wsFetchTasks[wsId] = task;
  });

  // Agent stats: cancel/coalesce only the previous fetch for the same agentId.
  yield* takeEvery(fetchAgentStats, function* (action: ReturnType<typeof fetchAgentStats>) {
    const [agentId] = action.payload;
    const prev = agentFetchTasks[agentId];
    if (prev) {
      yield* cancel(prev);
    }

    const task: Task = yield* fork(function* () {
      try {
        yield* call(handleFetchAgentStats, action);
      } finally {
        if (agentFetchTasks[agentId] === task) {
          delete agentFetchTasks[agentId];
        }
      }
    });
    agentFetchTasks[agentId] = task;
  });

  yield* takeEvery(clearSessionStats, function* (action: ReturnType<typeof clearSessionStats>) {
    const [wsId] = action.payload;
    const wsTask = wsFetchTasks[wsId];
    if (wsTask) {
      delete wsFetchTasks[wsId];
      yield* cancel(wsTask);
    }

    const agents: Array<{ id: string }> = yield* selectAllWorkspaceAgents.effect(wsId);
    for (const agent of agents) {
      const agentTask = agentFetchTasks[agent.id];
      if (agentTask) {
        delete agentFetchTasks[agent.id];
        yield* cancel(agentTask);
        yield* put(clearAgentStatsLoading(agent.id));
      }
    }
  });

  yield* takeEvery(removeAgent, function* (action: ReturnType<typeof removeAgent>) {
    const [, agentId] = action.payload;
    const agentTask = agentFetchTasks[agentId];
    if (agentTask) {
      delete agentFetchTasks[agentId];
      yield* cancel(agentTask);
    }
  });

  // Agent activity refetch: when an agent finishes a turn (`agent:idle`),
  // proactively refetch the workspace stats so the credit display reflects
  // newly-spent credits without waiting for the next 60s poll tick. Bursts of
  // idle events (parent + sub-agents finishing back-to-back) are coalesced
  // into a single fetch per workspace via keyed cancellation.
  yield* takeEvery(isAgentIdleEventReceived, function* (action: AgentIdleEventReceivedAction) {
    const [wsId] = action.payload;
    const prev = agentActivityRefetchTasks[wsId];
    if (prev) {
      yield* cancel(prev);
    }

    const task: Task = yield* fork(function* () {
      try {
        yield* call(handleAgentIdleRefetch, action);
      } finally {
        if (agentActivityRefetchTasks[wsId] === task) {
          delete agentActivityRefetchTasks[wsId];
        }
      }
    });
    agentActivityRefetchTasks[wsId] = task;
  });

  // Unmount: clear stats for this workspace.
  yield* fork(function* () {
    while (true) {
      const action: ReturnType<typeof workspaceUnmounted> = yield* take(
        workspaceUnmounted,
      );
      const [wsId] = action.payload;
      const refetchTask = agentActivityRefetchTasks[wsId];
      if (refetchTask) {
        delete agentActivityRefetchTasks[wsId];
        yield* cancel(refetchTask);
      }
      yield* put(clearSessionStats(wsId));
    }
  });

  yield* fork(sessionStatsPollingLoop);
}
