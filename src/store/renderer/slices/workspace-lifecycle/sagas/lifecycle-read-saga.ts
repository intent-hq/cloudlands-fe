import type { SagaGenerator } from 'typed-redux-saga';
import { all, call, put, race, take, takeEvery, takeLeading } from 'typed-redux-saga';

import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { reconcileGitStatusChanges } from '$features/file-tracking/git-status-reconciliation';
import { getAgentLineStats } from '$features/line-changes/line-changes.client';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { Workspace } from '$shared/types';
import { selectActiveBackendId } from '../../../utils/backend-storage-namespace';
import {
  takeLeadingByAgent,
  takeLeadingByWorkspace,
  takeLeadingInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { bulkUpsertSessions, upsertSession } from '../../agent-session/agent-session-slice';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import {
  agentLineStatsRequestFailed,
  agentLineStatsRequestStarted,
  agentLineStatsRequestSucceeded,
  appendOlderCommits,
  loadOlderCommitsRequested,
  loadWorkspaceDataRequested,
  refreshRequested,
  requestAgentLineStats,
  setChangesData,
  setCommitsData,
  setHasLoadedInitialData,
  setLoadingOlderCommits,
  updateAgentStats,
} from '../../changes/changes-slice';
import { selectShouldRequestAgentLineStats } from '../../changes/changes-selectors';
import { hydrateContextItems, initContextForWorkspace } from '../../context/context-slice';
import { prBranchLookupSucceeded } from '../../pr-branch-lookup/pr-branch-lookup-slice';
import type { PrBranchLookupPayload } from '../../pr-branch-lookup/pr-branch-lookup-types';
import { selectPRStatusLastRefreshTime } from '../../pr-status/pr-status-selectors';
import {
  prStatusRefreshCompleted,
  prStatusRefreshStarted,
  refreshPRStatusRequested,
} from '../../pr-status/pr-status-slice';
import { refreshScripts, setScriptsData, setScriptsInitialized } from '../../scripts/scripts-slice';
import { loadSkillsRequested, setSkills } from '../../skills/skills-slice';
import {
  hydrateTaskAgentAssociations,
  hydrateTaskAgentAssociationsRequested,
} from '../../task-agent-associations/task-agent-associations-slice';
import { hydrateTerminalsRequested, loadWorkspaceTerminals } from '../../terminals/terminals-slice';
import {
  fetchWorkspaceTokenUsage,
  tokenUsageFetchFailed,
  tokenUsageReceived,
} from '../../token-usage/token-usage-slice';
import {
  hydrateAgentsRequested,
  setActiveAgentId,
  setAgents,
  setAgentsLoaded,
} from '../../workspace-agents/workspace-agents-slice';
import {
  selectActiveAgentId,
  selectWorkspaceAgentIds,
} from '../../workspace-agents/workspace-agents-selectors';
import { eventsLoaded, loadEventsRequested } from '../../workspace-events/workspace-events-slice';
import {
  ensureWorkspaceTasksLoaded,
  loadWorkspaceTasksRequested,
  loadWorkspaceTasksSucceeded,
} from '../../workspace-tasks/workspace-tasks-slice';
import {
  selectWorkspaceTasksInitialized,
  selectWorkspaceTasksLoading,
} from '../../workspace-tasks/workspace-tasks-selectors';
import {
  loadRecencyData,
  loadWorkspacesRequested,
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '../../workspace/workspace-slice';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { workspaceDeleted, workspaceUnmounted } from '../workspace-lifecycle-slice';
import {
  createWorkspaceReadScheduler,
  type WorkspaceReadScheduler,
} from './workspace-read-scheduler';

const logger = createLogger('LifecycleReadSaga');

/**
 * Skip a non-forced `pr.refresh` when the last successful refresh is within this window.
 * `lastRefreshTime` is only stamped on success, so a failed/errored refresh never arms
 * the TTL and the next trigger will retry immediately.
 */
const PR_STATUS_REFRESH_TTL_MS = 60_000;

function matchesWorkspaceCleanup(workspaceId: string) {
  return (action: { type: string; payload?: unknown }) =>
    action.type === workspaceUnmounted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId;
}

function isWorkspaceCleanupAction(action: { type: string }): boolean {
  return action.type === workspaceUnmounted.type;
}

function workspaceReadContext(action: { type: string; payload: [string, ...unknown[]] }) {
  const context = action.payload[0];
  return isWorkspaceCleanupAction(action) ? { context, cancel: true as const } : context;
}

function scriptsReadContext(action: { type: string; payload: [string, ...unknown[]] }) {
  const context = action.payload[0];
  return action.type === workspaceDeleted.type || action.type === workspaceUnmounted.type
    ? { context, cancel: true as const }
    : context;
}

function* refreshWorkspaces(): SagaGenerator<void> {
  const workspaces: Awaited<ReturnType<typeof appClient.workspaces.list>> = yield* call(
    [appClient.workspaces, appClient.workspaces.list],
    { includeArchived: true },
  );
  const backendId = yield* selectActiveBackendId();
  yield* put(replaceWorkspaceList(workspaces));
  yield* put(setWorkspaceHasLoaded(true, backendId));
  const recentViews: Awaited<ReturnType<typeof appClient.workspaces.recentViews>> = yield* call([
    appClient.workspaces,
    appClient.workspaces.recentViews,
  ]);
  yield* put(loadRecencyData({ lastViewedAt: recentViews }));
}

function* refreshTasks(workspaceId: string, guarded: boolean): SagaGenerator<void> {
  if (guarded) {
    const loading = yield* selectWorkspaceTasksLoading.effect(workspaceId);
    const initialized = yield* selectWorkspaceTasksInitialized.effect(workspaceId);
    if (loading || initialized) return;
  }
  const result: Awaited<ReturnType<typeof appClient.tasks.list>> = yield* call(
    [appClient.tasks, appClient.tasks.list],
    workspaceId,
  );
  yield* put(loadWorkspaceTasksSucceeded(workspaceId, result.tasks, result.stats));
}

function* refreshTokenUsage(workspaceId: string): SagaGenerator<void> {
  try {
    const usage: Awaited<ReturnType<typeof appClient.workspaces.getTokenUsage>> = yield* call(
      [appClient.workspaces, appClient.workspaces.getTokenUsage],
      workspaceId,
    );
    yield* put(usage ? tokenUsageReceived(workspaceId, usage) : tokenUsageFetchFailed(workspaceId));
  } catch (error) {
    yield* put(tokenUsageFetchFailed(workspaceId));
    throw error;
  }
}

function* refreshPrStatus(workspaceId: string, force: boolean): SagaGenerator<void> {
  if (!force) {
    const lastRefreshTime = yield* selectPRStatusLastRefreshTime.effect(workspaceId);
    if (lastRefreshTime != null && Date.now() - lastRefreshTime < PR_STATUS_REFRESH_TTL_MS) {
      return;
    }
  }
  yield* put(prStatusRefreshStarted(workspaceId));
  try {
    const refresh: Awaited<ReturnType<typeof appClient.git.prRefresh>> = yield* call(
      [appClient.git, appClient.git.prRefresh],
      workspaceId,
    );
    if (refresh === null) {
      yield* put(prStatusRefreshCompleted(workspaceId, false, 'pr.refresh failed'));
      return;
    }
    yield* put(prStatusRefreshCompleted(workspaceId, true));
    const workspace: Workspace | undefined = yield* selectWorkspaceById.effect(workspaceId);
    if (refresh.prNumber != null && workspace?.repositoryOwner && workspace.repositoryName) {
      const payload: PrBranchLookupPayload = {
        owner: workspace.repositoryOwner,
        repo: workspace.repositoryName,
        prNumber: refresh.prNumber,
        key: `${workspace.repositoryOwner}/${workspace.repositoryName}#${refresh.prNumber}`,
      };
      yield* put(prBranchLookupSucceeded(payload, workspace.branch));
    }
  } catch (error) {
    yield* put(
      prStatusRefreshCompleted(
        workspaceId,
        false,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

/**
 * Broad refreshes own the Changes slice. Git status is read here only as
 * reconciliation input; gitReadSaga is the sole owner of Git-slice updates.
 */
function* refreshChanges(workspaceId: string): SagaGenerator<void> {
  const { status, trackedChanges, commitsEnvelope } = yield* all({
    status: call([appClient.git, appClient.git.status], workspaceId),
    trackedChanges: call([appClient.git, appClient.git.trackedChanges], workspaceId),
    commitsEnvelope: call([appClient.git, appClient.git.commitsWithBoundary], workspaceId),
  });
  if (!status || trackedChanges === null) return;
  const changes = reconcileGitStatusChanges(status.files, trackedChanges);
  yield* put(setChangesData(workspaceId, changes, false, changes.length));
  yield* put(setCommitsData(workspaceId, commitsEnvelope.commits, commitsEnvelope.boundarySha));
  yield* put(setHasLoadedInitialData(workspaceId, true));
}

function* refreshOlderCommits(workspaceId: string): SagaGenerator<void> {
  yield* put(setLoadingOlderCommits(workspaceId, true));
  try {
    const envelope: Awaited<ReturnType<typeof appClient.git.commitsWithBoundary>> = yield* call(
      [appClient.git, appClient.git.commitsWithBoundary],
      workspaceId,
      true,
    );
    yield* put(appendOlderCommits(workspaceId, envelope.commits));
  } finally {
    yield* put(setLoadingOlderCommits(workspaceId, false));
  }
}

function* refreshAgentStats(agentId: string, forceRefresh: boolean): SagaGenerator<void> {
  if (!(yield* selectShouldRequestAgentLineStats.effect(agentId, forceRefresh))) return;
  yield* put(agentLineStatsRequestStarted(agentId, new Date().toISOString()));
  try {
    const metrics: Awaited<ReturnType<typeof getAgentLineStats>> = yield* call(
      getAgentLineStats,
      agentId,
    );
    if (metrics) {
      yield* put(
        updateAgentStats(agentId, {
          additions: metrics.additions,
          deletions: metrics.deletions,
          timestamp: new Date().toISOString(),
        }),
      );
    }
    yield* put(agentLineStatsRequestSucceeded(agentId, new Date().toISOString()));
  } catch (error) {
    yield* put(
      agentLineStatsRequestFailed(
        agentId,
        error instanceof Error ? error.message : String(error),
        new Date().toISOString(),
      ),
    );
  }
}

function* hydrateAgents(workspaceId: string): SagaGenerator<void> {
  // `includeRetired` (§5.5 soft retire, v7.5): retired rows are excluded from
  // the default read daemon-side, but the sidebar's Retired bin needs them —
  // they arrive carrying `retiredAt` and are partitioned out of the active
  // sections in the UI rather than dropped here.
  const listed: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(
    [appClient.agents, appClient.agents.list],
    workspaceId,
    { includeRetired: true },
  );
  const fetched = [] as typeof listed;
  for (const agent of listed) {
    // Drop rows the FE soft-hid (local pending registry) and rows carrying the
    // daemon's delete-grace-window deadline (PROTOCOL §5.5 `pendingDeleteAt`,
    // v6.7+) — e.g. a deletion scheduled by another window.
    if (agent.pendingDeleteAt) continue;
    if (!(yield* call(isAgentDeletionPending, String(agent.id)))) fetched.push(agent);
  }
  yield* put(setAgentsLoaded(workspaceId, true));

  const agents = [] as typeof fetched;
  for (const agent of fetched) {
    const existing = yield* selectAgentSession.effect(String(agent.id));
    agents.push(
      agent.messages.length === 0 && existing && existing.messages.length > 0
        ? { ...agent, messages: existing.messages }
        : agent,
    );
  }
  yield* put(setAgents(workspaceId, agents));
  if (agents.length > 0) {
    yield* put(bulkUpsertSessions(agents));
    for (const agent of agents) yield* put(upsertSession(agent));
  }

  const activeAgentId = yield* selectActiveAgentId.effect(workspaceId);
  const agentIds = yield* selectWorkspaceAgentIds.effect(workspaceId);
  if (activeAgentId && agentIds.includes(activeAgentId)) return;
  // Retired rows are hydrated for the sidebar's Retired bin but never
  // auto-selected — the fallback active agent must be a working one.
  const selectable = agents.filter((agent) => !agent.retiredAt);
  if (selectable.length === 0) return;
  const firstForeground = selectable.find((agent) => !agent.isBackground) ?? selectable[0];
  yield* put(setActiveAgentId(workspaceId, String(firstForeground.id)));
}

type WorkspaceRead = (workspaceId: string) => SagaGenerator<void>;

/**
 * Runs `worker` while holding one of the scheduler's slots, so a fan-out of one
 * read per registered workspace queues instead of hitting the daemon at once.
 * The slot is released on completion, failure and cancellation alike — whether
 * the cleanup race below cancels the read or, for coalesced domains, the
 * context watcher cancels the whole worker task.
 */
function* withReadSlot(
  scheduler: WorkspaceReadScheduler,
  workspaceId: string,
  worker: WorkspaceRead,
  workspaceIdContext: string | null,
): SagaGenerator<void> {
  const slot = scheduler.acquire(workspaceId === workspaceIdContext);
  try {
    // Uncontended reads start synchronously — only a queued read awaits.
    if (!slot.granted) yield* call(() => slot.acquired);
    yield* call(worker, workspaceId);
  } finally {
    slot.release();
  }
}

/**
 * Coalesced domains pass `false` because their context watcher must be the sole cleanup
 * owner; racing the same cleanup action here could finish the worker and start its
 * trailing read before the watcher cancels and retires the context.
 */
function* runWorkspaceRead(
  scheduler: WorkspaceReadScheduler,
  key: string,
  workspaceId: string,
  worker: WorkspaceRead,
  cancelOnWorkspaceCleanup = true,
  workspaceIdContext: string | null = null,
) {
  if (!workspaceId) return;
  try {
    if (cancelOnWorkspaceCleanup) {
      yield* race({
        read: call(withReadSlot, scheduler, workspaceId, worker, workspaceIdContext),
        cleanup: take(matchesWorkspaceCleanup(workspaceId)),
      });
    } else {
      yield* call(withReadSlot, scheduler, workspaceId, worker, workspaceIdContext);
    }
  } catch (error) {
    logger.error(`Refresh failed for ${key}:${workspaceId}`, error);
  }
}

function* refreshEvents(workspaceId: string): SagaGenerator<void> {
  const events: Awaited<ReturnType<typeof appClient.events.list>> = yield* call(
    [appClient.events, appClient.events.list],
    workspaceId,
  );
  yield* put(eventsLoaded(workspaceId, events));
}

function* refreshTaskAgentLinks(workspaceId: string): SagaGenerator<void> {
  const byNoteId: Awaited<ReturnType<typeof appClient.tasks.listAgentLinks>> = yield* call(
    [appClient.tasks, appClient.tasks.listAgentLinks],
    workspaceId,
  );
  yield* put(hydrateTaskAgentAssociations(workspaceId, byNoteId));
}

function* refreshSkills(workspaceId: string): SagaGenerator<void> {
  const skills: Awaited<ReturnType<typeof appClient.skills.list>> = yield* call(
    [appClient.skills, appClient.skills.list],
    workspaceId,
  );
  yield* put(setSkills(workspaceId, skills));
}

function* refreshWorkspaceScripts(workspaceId: string): SagaGenerator<void> {
  const scripts: Awaited<ReturnType<typeof appClient.scripts.list>> = yield* call(
    [appClient.scripts, appClient.scripts.list],
    workspaceId,
  );
  yield* put(setScriptsData(workspaceId, scripts));
  yield* put(setScriptsInitialized(workspaceId, true));
}

function* refreshTerminals(workspaceId: string): SagaGenerator<void> {
  const result: Awaited<ReturnType<typeof appClient.terminals.list>> = yield* call(
    [appClient.terminals, appClient.terminals.list],
    workspaceId,
  );
  yield* put(
    Array.isArray(result)
      ? loadWorkspaceTerminals(workspaceId, result)
      : loadWorkspaceTerminals(workspaceId, result.terminals, null, result.daemonBootId),
  );
}

function* loadWorkspacesWorker() {
  try {
    yield* refreshWorkspaces();
  } catch (error) {
    logger.error('Refresh failed for workspaces', error);
  }
}

type TasksReadAction = ReturnType<
  typeof ensureWorkspaceTasksLoaded | typeof loadWorkspaceTasksRequested | typeof workspaceUnmounted
>;

function tasksReadContext(pendingForcedReads: Set<string>, action: TasksReadAction) {
  const workspaceId = action.payload[0];
  if (isWorkspaceCleanupAction(action)) {
    pendingForcedReads.delete(workspaceId);
    return { context: workspaceId, cancel: true as const };
  }
  if (workspaceId && action.type === loadWorkspaceTasksRequested.type) {
    pendingForcedReads.add(workspaceId);
  }
  return workspaceId;
}

function* tasksWorker(
  scheduler: WorkspaceReadScheduler,
  pendingForcedReads: Set<string>,
  workspaceIdContext: string | null,
  action: TasksReadAction,
) {
  if (isWorkspaceCleanupAction(action)) return;
  const workspaceId = action.payload[0];
  const force = pendingForcedReads.delete(workspaceId);
  yield* runWorkspaceRead(
    scheduler,
    'tasks',
    workspaceId,
    function* (id) {
      yield* refreshTasks(id, !force);
    },
    false,
    workspaceIdContext,
  );
}

function* eventsWorker(
  scheduler: WorkspaceReadScheduler,
  workspaceIdContext: string | null,
  action: ReturnType<typeof loadEventsRequested>,
) {
  yield* runWorkspaceRead(
    scheduler,
    'events',
    action.payload[0],
    refreshEvents,
    true,
    workspaceIdContext,
  );
}

function* tokenUsageWorker(
  scheduler: WorkspaceReadScheduler,
  workspaceIdContext: string | null,
  action: ReturnType<typeof fetchWorkspaceTokenUsage>,
) {
  yield* runWorkspaceRead(
    scheduler,
    'tokenUsage',
    action.payload[0],
    refreshTokenUsage,
    true,
    workspaceIdContext,
  );
}

function* taskAgentLinksWorker(
  scheduler: WorkspaceReadScheduler,
  workspaceIdContext: string | null,
  action: ReturnType<typeof hydrateTaskAgentAssociationsRequested>,
) {
  yield* runWorkspaceRead(
    scheduler,
    'taskAgentLinks',
    action.payload[0],
    refreshTaskAgentLinks,
    true,
    workspaceIdContext,
  );
}

function* skillsWorker(
  scheduler: WorkspaceReadScheduler,
  workspaceIdContext: string | null,
  action: ReturnType<typeof loadSkillsRequested>,
) {
  yield* runWorkspaceRead(
    scheduler,
    'skills',
    action.payload[0],
    refreshSkills,
    true,
    workspaceIdContext,
  );
}

type ScriptsReadAction = ReturnType<
  typeof refreshScripts | typeof workspaceDeleted | typeof workspaceUnmounted
>;

function* scriptsWorker(
  scheduler: WorkspaceReadScheduler,
  workspaceIdContext: string | null,
  action: ScriptsReadAction,
) {
  if (!isWorkspaceCleanupAction(action)) {
    yield* runWorkspaceRead(
      scheduler,
      'scripts',
      action.payload[0],
      refreshWorkspaceScripts,
      false,
      workspaceIdContext,
    );
  }
}

type ChangesReadAction = ReturnType<
  typeof refreshRequested | typeof loadWorkspaceDataRequested | typeof workspaceUnmounted
>;

function* changesWorker(
  scheduler: WorkspaceReadScheduler,
  workspaceIdContext: string | null,
  action: ChangesReadAction,
) {
  if (isWorkspaceCleanupAction(action)) return;
  if (action.type === refreshRequested.type || action.type === loadWorkspaceDataRequested.type) {
    yield* runWorkspaceRead(
      scheduler,
      'changes',
      action.payload[0],
      refreshChanges,
      false,
      workspaceIdContext,
    );
  }
}

type AgentsReadAction = ReturnType<typeof hydrateAgentsRequested | typeof workspaceUnmounted>;

function* coalescedAgentsWorker(
  scheduler: WorkspaceReadScheduler,
  workspaceIdContext: string | null,
  action: AgentsReadAction,
) {
  if (!isWorkspaceCleanupAction(action)) {
    yield* runWorkspaceRead(
      scheduler,
      'agents',
      action.payload[0],
      hydrateAgents,
      false,
      workspaceIdContext,
    );
  }
}

function* terminalsWorker(
  scheduler: WorkspaceReadScheduler,
  workspaceIdContext: string | null,
  action: ReturnType<typeof hydrateTerminalsRequested>,
) {
  yield* runWorkspaceRead(
    scheduler,
    'terminals',
    action.payload[0],
    refreshTerminals,
    true,
    workspaceIdContext,
  );
}

function* prStatusWorker(action: ReturnType<typeof refreshPRStatusRequested>) {
  const [workspaceId, force] = action.payload;
  if (!workspaceId) return;
  try {
    yield* race({
      read: call(refreshPrStatus, workspaceId, force),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
  } catch (error) {
    logger.error(`Refresh failed for prStatus:${workspaceId}`, error);
  }
}

function* olderCommitsWorker(
  scheduler: WorkspaceReadScheduler,
  workspaceIdContext: string | null,
  action: ReturnType<typeof loadOlderCommitsRequested>,
) {
  yield* runWorkspaceRead(
    scheduler,
    'olderCommits',
    action.payload.wsId,
    refreshOlderCommits,
    true,
    workspaceIdContext,
  );
}

function* agentLineStatsWorker(action: ReturnType<typeof requestAgentLineStats>) {
  const { agentId, forceRefresh } = action.payload;
  if (agentId) yield* refreshAgentStats(agentId, forceRefresh);
}

function* contextWorker(
  initializedContexts: Set<string>,
  action: ReturnType<typeof initContextForWorkspace>,
) {
  const [workspaceId] = action.payload;
  if (!workspaceId || initializedContexts.has(workspaceId)) return;
  try {
    yield* race({
      read: call(function* () {
        const items: Awaited<ReturnType<typeof appClient.workspaces.getContext>> = yield* call(
          [appClient.workspaces, appClient.workspaces.getContext],
          workspaceId,
        );
        yield* put(hydrateContextItems(workspaceId, Array.isArray(items) ? items : []));
        initializedContexts.add(workspaceId);
      }),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
  } catch (error) {
    logger.error(`Refresh failed for context:${workspaceId}`, error);
  }
}

function* clearUnmountedInitializedContext(
  initializedContexts: Set<string>,
  action: ReturnType<typeof workspaceUnmounted>,
) {
  initializedContexts.delete(action.payload[0]);
}

export function* lifecycleReadSaga(options?: {
  activeWorkspaceId?: string | null;
}): SagaGenerator<void> {
  const initializedContexts = new Set<string>();
  const pendingForcedTaskReads = new Set<string>();
  const workspaceIdContext = options?.activeWorkspaceId ?? null;
  // One scheduler per saga run: it dies with the saga, so a restart can never
  // inherit slots held by reads that were cancelled with the previous run.
  const scheduler = createWorkspaceReadScheduler();
  try {
    yield* all([
      takeLeading(loadWorkspacesRequested, loadWorkspacesWorker),
      takeSingleFlightInContext(
        [ensureWorkspaceTasksLoaded, loadWorkspaceTasksRequested, workspaceUnmounted],
        (action) => tasksReadContext(pendingForcedTaskReads, action),
        tasksWorker,
        scheduler,
        pendingForcedTaskReads,
        workspaceIdContext,
      ),
      takeLeadingByWorkspace(loadEventsRequested, eventsWorker, scheduler, workspaceIdContext),
      takeLeadingByWorkspace(
        fetchWorkspaceTokenUsage,
        tokenUsageWorker,
        scheduler,
        workspaceIdContext,
      ),
      takeLeadingByWorkspace(initContextForWorkspace, contextWorker, initializedContexts),
      takeLeadingByWorkspace(
        hydrateTaskAgentAssociationsRequested,
        taskAgentLinksWorker,
        scheduler,
        workspaceIdContext,
      ),
      takeLeadingByWorkspace(loadSkillsRequested, skillsWorker, scheduler, workspaceIdContext),
      takeSingleFlightInContext(
        [refreshScripts, workspaceDeleted, workspaceUnmounted],
        scriptsReadContext,
        scriptsWorker,
        scheduler,
        workspaceIdContext,
      ),
      takeLeadingByWorkspace(refreshPRStatusRequested, prStatusWorker),
      takeSingleFlightInContext(
        [refreshRequested, loadWorkspaceDataRequested, workspaceUnmounted],
        workspaceReadContext,
        changesWorker,
        scheduler,
        workspaceIdContext,
      ),
      takeLeadingInContext(
        loadOlderCommitsRequested,
        (action) => action.payload.wsId,
        olderCommitsWorker,
        scheduler,
        workspaceIdContext,
      ),
      takeLeadingByAgent(requestAgentLineStats, agentLineStatsWorker),
      takeSingleFlightInContext(
        [hydrateAgentsRequested, workspaceUnmounted],
        workspaceReadContext,
        coalescedAgentsWorker,
        scheduler,
        workspaceIdContext,
      ),
      takeLeadingByWorkspace(
        hydrateTerminalsRequested,
        terminalsWorker,
        scheduler,
        workspaceIdContext,
      ),
      takeEvery(workspaceUnmounted, clearUnmountedInitializedContext, initializedContexts),
    ]);
  } finally {
    initializedContexts.clear();
    pendingForcedTaskReads.clear();
  }
}
