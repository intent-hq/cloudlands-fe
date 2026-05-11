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
  takeEvery,
  take,
  type SagaGenerator,
} from "typed-redux-saga";
import type { Task } from "redux-saga";
import { invoke, isElectron } from "$lib/electron-bridge";
import { SESSION_STATS_CHANNELS } from "$shared/ipc/channels";
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

/** Poll workspace stats on mount; cancelled externally on workspaceUnmounted. */
function* watchWorkspaceStatsPollingSaga(wsId: string): SagaGenerator<void> {
  // Wait for agents to finish loading from disk before first fetch
  yield* call(waitForAgentsLoaded, wsId);

  // Initial fetch
  const sessionRequests: WorkspaceStatsSessionRequest[] = yield* call(
    getSessionRequestsForWorkspace,
    wsId,
  );
  yield* call(dispatchWorkspaceStatsOrClear, wsId, sessionRequests);

  // Periodic polling
  while (true) {
    yield* delay(POLL_INTERVAL_MS);
    const currentWsId: string | null = yield* selectActiveWorkspaceId.effect();
    if (currentWsId !== wsId) {
      // Workspace changed, stop polling
      return;
    }
    const freshSessionRequests: WorkspaceStatsSessionRequest[] = yield* call(
      getSessionRequestsForWorkspace,
      wsId,
    );
    yield* call(dispatchWorkspaceStatsOrClear, wsId, freshSessionRequests);
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

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* sessionStatsSaga(): SagaGenerator<void> {
  /**
   * Per-workspace polling tasks, keyed by workspace ID. Used to dedupe mount
   * forks and to cancel the poll loop deterministically on unmount (rather than
   * waiting for the next 60s delay to elapse).
   */
  const pollingTasks: Record<string, Task> = {};

  function* startPolling(wsId: string): SagaGenerator<void> {
    if (pollingTasks[wsId]) return;
    // Wrap the polling saga so pollingTasks[wsId] is cleared on any exit path
    // (cancel from stopPolling, early return on wsId change, or normal return).
    // Single cleanup point avoids stale entries that would dedupe a later mount.
    const task: Task = yield* fork(function* () {
      try {
        yield* call(watchWorkspaceStatsPollingSaga, wsId);
      } finally {
        delete pollingTasks[wsId];
      }
    });
    pollingTasks[wsId] = task;
  }

  function* stopPolling(wsId: string): SagaGenerator<void> {
    const task = pollingTasks[wsId];
    if (task) {
      yield* cancel(task);
      // Cleanup of pollingTasks[wsId] is handled by the wrapper's finally block.
    }
  }

  /**
   * Per-workspace fetch tasks (keyed by wsId) and per-agent fetch tasks
   * (keyed by agentId). Used to cancel in-flight fetches on clearSessionStats
   * and to dedupe rapid same-agent fetches.
   */
  const wsFetchTasks: Record<string, Task> = {};
  const agentFetchTasks: Record<string, Task> = {};

  // Workspace stats: track task per wsId so clearSessionStats can cancel it.
  yield* fork(function* () {
    yield* takeEvery(fetchWorkspaceStats, function* (action) {
      const [wsId] = action.payload;
      // Cancel any previous in-flight fetch for this workspace
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
  });

  // Agent stats: cancel previous in-flight fetch for the same agentId.
  yield* fork(function* () {
    yield* takeEvery(fetchAgentStats, function* (action) {
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
  });

  // clearSessionStats: cancel in-flight workspace fetch and agent fetches
  // for agents belonging to that workspace.
  yield* fork(function* () {
    yield* takeEvery(clearSessionStats, function* (action) {
      const [wsId] = action.payload;
      // Cancel workspace fetch task
      const wsTask = wsFetchTasks[wsId];
      if (wsTask) {
        yield* cancel(wsTask);
      }
      // Cancel agent fetch tasks for agents in this workspace
      const agents: Array<{ id: string }> = yield* selectAllWorkspaceAgents.effect(wsId);
      for (const agent of agents) {
        const agentTask = agentFetchTasks[agent.id];
        if (agentTask) {
          yield* cancel(agentTask);
          yield* put(clearAgentStatsLoading(agent.id));
        }
      }
    });
  });

  // removeAgent: cancel in-flight agent fetch for the removed agent.
  yield* fork(function* () {
    yield* takeEvery(removeAgent, function* (action) {
      const [, agentId] = action.payload;
      const agentTask = agentFetchTasks[agentId];
      if (agentTask) {
        yield* cancel(agentTask);
        delete agentFetchTasks[agentId];
      }
    });
  });

  // Agent activity refetch: when an agent finishes a turn (`agent:idle`),
  // proactively refetch the workspace stats so the credit display reflects
  // newly-spent credits without waiting for the next 60s poll tick. Bursts of
  // idle events (parent + sub-agents finishing back-to-back) are coalesced
  // into a single fetch per workspace via `takeLatest`-style debouncing.
  const agentActivityRefetchTasks: Record<string, Task> = {};
  yield* fork(function* () {
    while (true) {
      const action: ReturnType<typeof eventReceived> = yield* take(eventReceived);
      const [wsId, event] = action.payload;
      if (event?.type !== "agent:idle") continue;

      // Cancel any pending debounced refetch for this workspace and start a
      // fresh one — only the latest agent:idle in the burst wins.
      const prev = agentActivityRefetchTasks[wsId];
      if (prev) {
        yield* cancel(prev);
      }
      const task: Task = yield* fork(function* () {
        try {
          yield* delay(AGENT_ACTIVITY_DEBOUNCE_MS);
          const sessionRequests: WorkspaceStatsSessionRequest[] = yield* call(
            getSessionRequestsForWorkspace,
            wsId,
          );
          yield* call(dispatchWorkspaceStatsOrClear, wsId, sessionRequests);
        } finally {
          if (agentActivityRefetchTasks[wsId] === task) {
            delete agentActivityRefetchTasks[wsId];
          }
        }
      });
      agentActivityRefetchTasks[wsId] = task;
    }
  });

  // Unmount: cancel the poller for this workspace and clear its stats.
  // Also cancel any pending agent-activity debounce so an unmounted workspace
  // doesn't fire a stale refetch after teardown.
  yield* fork(function* () {
    while (true) {
      const action: ReturnType<typeof workspaceUnmounted> = yield* take(
        workspaceUnmounted,
      );
      const [wsId] = action.payload;
      yield* call(stopPolling, wsId);
      const refetchTask = agentActivityRefetchTasks[wsId];
      if (refetchTask) {
        yield* cancel(refetchTask);
      }
      yield* put(clearSessionStats(wsId));
    }
  });

  // For each workspace mount, start a polling saga (deduped per workspace).
  yield* fork(function* () {
    while (true) {
      const action: ReturnType<typeof workspaceMounted> = yield* take(workspaceMounted);
      const [wsId] = action.payload;
      yield* call(startPolling, wsId);
    }
  });

  // Retroactive mount check: if workspaceMounted fired before this saga
  // registered its take, replay the mount so stats still load. The startPolling
  // dedupe guards against the real workspaceMounted arriving concurrently.
  yield* fork(function* retroactiveSessionStatsMountCheck() {
    const activeWsId: string | null = yield* selectActiveWorkspaceId.effect();
    if (activeWsId) {
      yield* call(startPolling, activeWsId);
    }
  });
}
