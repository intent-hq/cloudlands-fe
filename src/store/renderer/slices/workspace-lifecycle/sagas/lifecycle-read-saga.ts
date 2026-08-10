import type { StoreAction, StoreActionCreator } from '@augmentcode/themis/utils/store/create-action';
import type { Task } from 'redux-saga';
import type { SagaGenerator } from 'typed-redux-saga';
import {
  all,
  call,
  cancel,
  fork,
  put,
  race,
  take,
  takeEvery,
  takeLatest,
  takeLeading,
} from 'typed-redux-saga';

import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { reconcileGitStatusChanges } from '$features/file-tracking/git-status-reconciliation';
import { getAgentLineStats } from '$features/line-changes/line-changes.client';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { Workspace } from '$shared/types';
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

const logger = createLogger('LifecycleReadSaga');

/**
 * Skip a non-forced `pr.refresh` when the last successful refresh is within this window.
 * `lastRefreshTime` is only stamped on success, so a failed/errored refresh never arms
 * the TTL and the next trigger will retry immediately.
 */
const PR_STATUS_REFRESH_TTL_MS = 60_000;

function matchesWorkspaceCleanup(workspaceId: string) {
  return (action: { type: string; payload?: unknown }) =>
    (action.type === workspaceDeleted.type || action.type === workspaceUnmounted.type) &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId;
}

function* refreshWorkspaces(): SagaGenerator<void> {
  const workspaces: Awaited<ReturnType<typeof appClient.workspaces.list>> = yield* call(
    [appClient.workspaces, appClient.workspaces.list],
    { includeArchived: true },
  );
  yield* put(replaceWorkspaceList(workspaces));
  yield* put(setWorkspaceHasLoaded(true));
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
  const listed: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(
    [appClient.agents, appClient.agents.list],
    workspaceId,
  );
  const fetched = [] as typeof listed;
  for (const agent of listed) {
    if (!(yield* call(isAgentDeletionPending, String(agent.id)))) fetched.push(agent);
  }
  yield* put(setAgentsLoaded(workspaceId, true));
  if (fetched.length === 0) return;

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
  yield* put(bulkUpsertSessions(agents));
  for (const agent of agents) yield* put(upsertSession(agent));

  const activeAgentId = yield* selectActiveAgentId.effect(workspaceId);
  const agentIds = yield* selectWorkspaceAgentIds.effect(workspaceId);
  if (activeAgentId && agentIds.includes(activeAgentId)) return;
  const firstForeground = agents.find((agent) => !agent.isBackground) ?? agents[0];
  yield* put(setActiveAgentId(workspaceId, String(firstForeground.id)));
}

type WorkspaceRead = (workspaceId: string) => SagaGenerator<void>;

/**
 * `takeLatest` keyed per workspace: a new action supersedes (cancels) only the
 * in-flight worker for the same workspace. A plain `takeLatest` keys globally,
 * so concurrent loads for different workspaces cancelled each other
 * (intent-hq/monorepo#1934).
 */
function takeLatestByWorkspace<ARGS extends [workspaceId: string, ...rest: unknown[]]>(
  actionCreator: StoreActionCreator<ARGS, ARGS>,
  worker: (action: StoreAction<ARGS>) => Generator,
) {
  return fork(function* () {
    const running: Record<string, Task> = {};
    while (true) {
      const action: StoreAction<ARGS> = yield* take(actionCreator);
      const workspaceId = action.payload[0];
      const previous = running[workspaceId];
      if (previous?.isRunning()) yield* cancel(previous);
      running[workspaceId] = yield* fork(worker, action);
    }
  });
}

function* runWorkspaceRead(key: string, workspaceId: string, worker: WorkspaceRead) {
  if (!workspaceId) return;
  try {
    yield* race({
      read: call(worker, workspaceId),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
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

function* ensureTasksWorker(action: ReturnType<typeof ensureWorkspaceTasksLoaded>) {
  const [workspaceId] = action.payload;
  yield* runWorkspaceRead('tasks', workspaceId, function* (id) {
    yield* refreshTasks(id, true);
  });
}

function* loadTasksWorker(action: ReturnType<typeof loadWorkspaceTasksRequested>) {
  const [workspaceId] = action.payload;
  yield* runWorkspaceRead('tasks', workspaceId, function* (id) {
    yield* refreshTasks(id, false);
  });
}

function* eventsWorker(action: ReturnType<typeof loadEventsRequested>) {
  yield* runWorkspaceRead('events', action.payload[0], refreshEvents);
}

function* tokenUsageWorker(action: ReturnType<typeof fetchWorkspaceTokenUsage>) {
  yield* runWorkspaceRead('tokenUsage', action.payload[0], refreshTokenUsage);
}

function* taskAgentLinksWorker(action: ReturnType<typeof hydrateTaskAgentAssociationsRequested>) {
  yield* runWorkspaceRead('taskAgentLinks', action.payload[0], refreshTaskAgentLinks);
}

function* skillsWorker(action: ReturnType<typeof loadSkillsRequested>) {
  yield* runWorkspaceRead('skills', action.payload[0], refreshSkills);
}

function* scriptsWorker(action: ReturnType<typeof refreshScripts>) {
  yield* runWorkspaceRead('scripts', action.payload[0], refreshWorkspaceScripts);
}

function* refreshChangesWorker(action: ReturnType<typeof refreshRequested>) {
  yield* runWorkspaceRead('changes', action.payload[0], refreshChanges);
}

function* loadChangesWorker(action: ReturnType<typeof loadWorkspaceDataRequested>) {
  yield* runWorkspaceRead('changes', action.payload[0], refreshChanges);
}

function* agentsWorker(action: ReturnType<typeof hydrateAgentsRequested>) {
  yield* runWorkspaceRead('agents', action.payload[0], hydrateAgents);
}

function* terminalsWorker(action: ReturnType<typeof hydrateTerminalsRequested>) {
  yield* runWorkspaceRead('terminals', action.payload[0], refreshTerminals);
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

function* olderCommitsWorker(action: ReturnType<typeof loadOlderCommitsRequested>) {
  yield* runWorkspaceRead('olderCommits', action.payload.wsId, refreshOlderCommits);
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

function* clearDeletedInitializedContext(
  initializedContexts: Set<string>,
  action: ReturnType<typeof workspaceDeleted>,
) {
  initializedContexts.delete(action.payload[0]);
}

function* clearUnmountedInitializedContext(
  initializedContexts: Set<string>,
  action: ReturnType<typeof workspaceUnmounted>,
) {
  initializedContexts.delete(action.payload[0]);
}

export function* lifecycleReadSaga(): SagaGenerator<void> {
  const initializedContexts = new Set<string>();
  try {
    yield* all([
      takeLeading(loadWorkspacesRequested, loadWorkspacesWorker),
      takeLatestByWorkspace(ensureWorkspaceTasksLoaded, ensureTasksWorker),
      takeLatestByWorkspace(loadWorkspaceTasksRequested, loadTasksWorker),
      takeLeading(loadEventsRequested, eventsWorker),
      takeLeading(fetchWorkspaceTokenUsage, tokenUsageWorker),
      takeLeading(initContextForWorkspace, contextWorker, initializedContexts),
      takeLeading(hydrateTaskAgentAssociationsRequested, taskAgentLinksWorker),
      takeLeading(loadSkillsRequested, skillsWorker),
      takeLeading(refreshScripts, scriptsWorker),
      takeLeading(refreshPRStatusRequested, prStatusWorker),
      takeLatest(refreshRequested, refreshChangesWorker),
      takeLatest(loadWorkspaceDataRequested, loadChangesWorker),
      takeLeading(loadOlderCommitsRequested, olderCommitsWorker),
      takeLeading(requestAgentLineStats, agentLineStatsWorker),
      takeLatest(hydrateAgentsRequested, agentsWorker),
      takeLeading(hydrateTerminalsRequested, terminalsWorker),
      takeEvery(workspaceDeleted, clearDeletedInitializedContext, initializedContexts),
      takeEvery(workspaceUnmounted, clearUnmountedInitializedContext, initializedContexts),
    ]);
  } finally {
    initializedContexts.clear();
  }
}
