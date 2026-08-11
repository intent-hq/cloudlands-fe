import { buffers, channel, type Channel } from 'redux-saga';
import type { SagaGenerator } from 'typed-redux-saga';
import { all, call, flush, fork, put, race, take, takeEvery, takeLeading } from 'typed-redux-saga';

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

type ReadJob = {
  workspaceId?: string;
  run: () => SagaGenerator<void>;
};

type ReadMessage = { kind: 'read'; job: ReadJob } | { kind: 'cleanup' };
type ReadMailbox = { workspaceId?: string; channel: Channel<ReadMessage> };
type ReadCoordinator = { mailboxes: Map<string, ReadMailbox> };

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
  if (agents.length === 0) return;
  const firstForeground = agents.find((agent) => !agent.isBackground) ?? agents[0];
  yield* put(setActiveAgentId(workspaceId, String(firstForeground.id)));
}

function* runReadJob(key: string, job: ReadJob): SagaGenerator<boolean> {
  try {
    if (!job.workspaceId) {
      yield* call(job.run);
      return false;
    }
    const { cleanup } = yield* race({
      read: call(job.run),
      cleanup: take(matchesWorkspaceCleanup(job.workspaceId)),
    });
    return cleanup !== undefined;
  } catch (error) {
    logger.error(`Refresh failed for ${key}`, error);
    return false;
  }
}

function* runReadMailbox(
  coordinator: ReadCoordinator,
  key: string,
  mailbox: ReadMailbox,
  initialJob: ReadJob,
): SagaGenerator<void> {
  let message: ReadMessage = { kind: 'read', job: initialJob };
  try {
    while (message.kind === 'read') {
      if (yield* call(runReadJob, key, message.job)) return;
      const pending = yield* flush(mailbox.channel);
      if (!Array.isArray(pending) || pending.length === 0) return;
      const next = pending[pending.length - 1];
      if (!next || next.kind === 'cleanup') return;
      message = next;
    }
  } finally {
    if (coordinator.mailboxes.get(key) === mailbox) coordinator.mailboxes.delete(key);
    mailbox.channel.close();
  }
}

function* enqueueRead(
  coordinator: ReadCoordinator,
  key: string,
  job: ReadJob,
  trailing: boolean,
): SagaGenerator<void> {
  const existing = coordinator.mailboxes.get(key);
  if (existing) {
    if (trailing) yield* put(existing.channel, { kind: 'read', job });
    return;
  }
  const mailbox: ReadMailbox = {
    workspaceId: job.workspaceId,
    channel: channel<ReadMessage>(buffers.sliding(1)),
  };
  coordinator.mailboxes.set(key, mailbox);
  yield* fork(runReadMailbox, coordinator, key, mailbox, job);
}

function* cleanupWorkspaceReads(
  coordinator: ReadCoordinator,
  initializedContexts: Set<string>,
  workspaceId: string,
): SagaGenerator<void> {
  initializedContexts.delete(workspaceId);
  for (const [key, mailbox] of coordinator.mailboxes) {
    if (mailbox.workspaceId !== workspaceId) continue;
    yield* put(mailbox.channel, { kind: 'cleanup' });
    mailbox.channel.close();
    coordinator.mailboxes.delete(key);
  }
}

function* loadWorkspacesWorker(): SagaGenerator<void> {
  try {
    yield* call(refreshWorkspaces);
  } catch (error) {
    logger.error('Refresh failed for workspaces', error);
  }
}

function* ensureTasksWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof ensureWorkspaceTasksLoaded>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `tasks:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        yield* refreshTasks(workspaceId, true);
      },
    },
    true,
  );
}

function* loadTasksWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof loadWorkspaceTasksRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `tasks:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        yield* refreshTasks(workspaceId, false);
      },
    },
    true,
  );
}

function* eventsWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof loadEventsRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `events:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        const events: Awaited<ReturnType<typeof appClient.events.list>> = yield* call(
          [appClient.events, appClient.events.list],
          workspaceId,
        );
        yield* put(eventsLoaded(workspaceId, events));
      },
    },
    false,
  );
}

function* tokenUsageWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof fetchWorkspaceTokenUsage>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `tokenUsage:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        yield* refreshTokenUsage(workspaceId);
      },
    },
    false,
  );
}

function* contextWorker(
  coordinator: ReadCoordinator,
  initializedContexts: Set<string>,
  action: ReturnType<typeof initContextForWorkspace>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId || initializedContexts.has(workspaceId)) return;
  yield* enqueueRead(
    coordinator,
    `context:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        const items: Awaited<ReturnType<typeof appClient.workspaces.getContext>> = yield* call(
          [appClient.workspaces, appClient.workspaces.getContext],
          workspaceId,
        );
        yield* put(hydrateContextItems(workspaceId, Array.isArray(items) ? items : []));
        initializedContexts.add(workspaceId);
      },
    },
    false,
  );
}

function* taskAgentLinksWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof hydrateTaskAgentAssociationsRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `taskAgentLinks:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        const byNoteId: Awaited<ReturnType<typeof appClient.tasks.listAgentLinks>> = yield* call(
          [appClient.tasks, appClient.tasks.listAgentLinks],
          workspaceId,
        );
        yield* put(hydrateTaskAgentAssociations(workspaceId, byNoteId));
      },
    },
    false,
  );
}

function* skillsWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof loadSkillsRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `skills:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        const skills: Awaited<ReturnType<typeof appClient.skills.list>> = yield* call(
          [appClient.skills, appClient.skills.list],
          workspaceId,
        );
        yield* put(setSkills(workspaceId, skills));
      },
    },
    false,
  );
}

function* scriptsWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof refreshScripts>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `scripts:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        const scripts: Awaited<ReturnType<typeof appClient.scripts.list>> = yield* call(
          [appClient.scripts, appClient.scripts.list],
          workspaceId,
        );
        yield* put(setScriptsData(workspaceId, scripts));
        yield* put(setScriptsInitialized(workspaceId, true));
      },
    },
    false,
  );
}

function* prStatusWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof refreshPRStatusRequested>,
): SagaGenerator<void> {
  const [workspaceId, force] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `prStatus:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        yield* refreshPrStatus(workspaceId, force);
      },
    },
    false,
  );
}

function* refreshChangesWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof refreshRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `changes:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        yield* refreshChanges(workspaceId);
      },
    },
    true,
  );
}

function* loadChangesWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof loadWorkspaceDataRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `changes:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        yield* refreshChanges(workspaceId);
      },
    },
    true,
  );
}

function* olderCommitsWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof loadOlderCommitsRequested>,
): SagaGenerator<void> {
  const workspaceId = action.payload.wsId;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `olderCommits:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        yield* refreshOlderCommits(workspaceId);
      },
    },
    false,
  );
}

function* agentLineStatsWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof requestAgentLineStats>,
): SagaGenerator<void> {
  const { agentId, forceRefresh } = action.payload;
  if (!agentId) return;
  yield* enqueueRead(
    coordinator,
    `agentLineStats:${agentId}`,
    {
      run: function* () {
        yield* refreshAgentStats(agentId, forceRefresh);
      },
    },
    false,
  );
}

function* agentsWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof hydrateAgentsRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `agents:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        yield* hydrateAgents(workspaceId);
      },
    },
    true,
  );
}

function* terminalsWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof hydrateTerminalsRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* enqueueRead(
    coordinator,
    `terminals:${workspaceId}`,
    {
      workspaceId,
      run: function* () {
        const result: Awaited<ReturnType<typeof appClient.terminals.list>> = yield* call(
          [appClient.terminals, appClient.terminals.list],
          workspaceId,
        );
        yield* put(
          Array.isArray(result)
            ? loadWorkspaceTerminals(workspaceId, result)
            : loadWorkspaceTerminals(workspaceId, result.terminals, null, result.daemonBootId),
        );
      },
    },
    false,
  );
}

export function* lifecycleReadSaga(): SagaGenerator<void> {
  const coordinator: ReadCoordinator = { mailboxes: new Map() };
  const initializedContexts = new Set<string>();
  yield* all([
    takeLeading(loadWorkspacesRequested, loadWorkspacesWorker),
    takeEvery(ensureWorkspaceTasksLoaded, ensureTasksWorker, coordinator),
    takeEvery(loadWorkspaceTasksRequested, loadTasksWorker, coordinator),
    takeEvery(loadEventsRequested, eventsWorker, coordinator),
    takeEvery(fetchWorkspaceTokenUsage, tokenUsageWorker, coordinator),
    takeEvery(initContextForWorkspace, contextWorker, coordinator, initializedContexts),
    takeEvery(hydrateTaskAgentAssociationsRequested, taskAgentLinksWorker, coordinator),
    takeEvery(loadSkillsRequested, skillsWorker, coordinator),
    takeEvery(refreshScripts, scriptsWorker, coordinator),
    takeEvery(refreshPRStatusRequested, prStatusWorker, coordinator),
    takeEvery(refreshRequested, refreshChangesWorker, coordinator),
    takeEvery(loadWorkspaceDataRequested, loadChangesWorker, coordinator),
    takeEvery(loadOlderCommitsRequested, olderCommitsWorker, coordinator),
    takeEvery(requestAgentLineStats, agentLineStatsWorker, coordinator),
    takeEvery(hydrateAgentsRequested, agentsWorker, coordinator),
    takeEvery(hydrateTerminalsRequested, terminalsWorker, coordinator),
    takeEvery(workspaceDeleted, function* (action) {
      const [workspaceId] = action.payload;
      if (workspaceId) yield* cleanupWorkspaceReads(coordinator, initializedContexts, workspaceId);
    }),
    takeEvery(workspaceUnmounted, function* (action) {
      const [workspaceId] = action.payload;
      if (workspaceId) yield* cleanupWorkspaceReads(coordinator, initializedContexts, workspaceId);
    }),
  ]);
}
