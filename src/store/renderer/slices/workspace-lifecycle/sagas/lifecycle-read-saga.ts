import type { Task } from 'redux-saga';
import type { SagaGenerator } from 'typed-redux-saga';
import { all, call, cancel, fork, put, take } from 'typed-redux-saga';

import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
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

/** Skip a non-forced `pr.refresh` when the last successful refresh is within this window. */
const PR_STATUS_REFRESH_TTL_MS = 60_000;

const triggers = [
  loadWorkspacesRequested,
  ensureWorkspaceTasksLoaded,
  loadWorkspaceTasksRequested,
  loadEventsRequested,
  fetchWorkspaceTokenUsage,
  initContextForWorkspace,
  hydrateTaskAgentAssociationsRequested,
  loadSkillsRequested,
  refreshScripts,
  refreshPRStatusRequested,
  refreshRequested,
  loadWorkspaceDataRequested,
  loadOlderCommitsRequested,
  requestAgentLineStats,
  hydrateAgentsRequested,
  hydrateTerminalsRequested,
  workspaceDeleted,
  workspaceUnmounted,
];

type LifecycleAction = ReturnType<(typeof triggers)[number]>;
type ReadDescriptor = { key: string; workspaceId?: string };
type RunningRead = ReadDescriptor & { task?: Task; token: symbol };

function tupleString(action: { payload?: unknown }): string | undefined {
  const value = Array.isArray(action.payload) ? action.payload[0] : undefined;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function descriptorFor(action: LifecycleAction): ReadDescriptor | undefined {
  if (action.type === loadWorkspacesRequested.type) return { key: 'workspaces' };
  if (action.type === loadOlderCommitsRequested.type) {
    const workspaceId = (action.payload as { wsId?: unknown }).wsId;
    return typeof workspaceId === 'string' && workspaceId.length > 0
      ? { key: `olderCommits:${workspaceId}`, workspaceId }
      : undefined;
  }
  if (action.type === requestAgentLineStats.type) {
    const agentId = (action.payload as { agentId?: unknown }).agentId;
    return typeof agentId === 'string' && agentId.length > 0
      ? { key: `agentLineStats:${agentId}` }
      : undefined;
  }

  const workspaceId = tupleString(action);
  if (!workspaceId) return undefined;
  if (
    action.type === ensureWorkspaceTasksLoaded.type ||
    action.type === loadWorkspaceTasksRequested.type
  ) return { key: `tasks:${workspaceId}`, workspaceId };
  if (action.type === loadEventsRequested.type) return { key: `events:${workspaceId}`, workspaceId };
  if (action.type === fetchWorkspaceTokenUsage.type) return { key: `tokenUsage:${workspaceId}`, workspaceId };
  if (action.type === initContextForWorkspace.type) return { key: `context:${workspaceId}`, workspaceId };
  if (action.type === hydrateTaskAgentAssociationsRequested.type) return { key: `taskAgentLinks:${workspaceId}`, workspaceId };
  if (action.type === loadSkillsRequested.type) return { key: `skills:${workspaceId}`, workspaceId };
  if (action.type === refreshScripts.type) return { key: `scripts:${workspaceId}`, workspaceId };
  if (action.type === refreshPRStatusRequested.type) return { key: `prStatus:${workspaceId}`, workspaceId };
  if (action.type === refreshRequested.type || action.type === loadWorkspaceDataRequested.type) {
    return { key: `changes:${workspaceId}`, workspaceId };
  }
  if (action.type === hydrateAgentsRequested.type) return { key: `agents:${workspaceId}`, workspaceId };
  if (action.type === hydrateTerminalsRequested.type) return { key: `terminals:${workspaceId}`, workspaceId };
  return undefined;
}

function* refreshWorkspaces(): SagaGenerator<void> {
  const workspaces: Awaited<ReturnType<typeof appClient.workspaces.list>> = yield* call(
    [appClient.workspaces, appClient.workspaces.list],
    { includeArchived: true },
  );
  yield* put(replaceWorkspaceList(workspaces));
  yield* put(setWorkspaceHasLoaded(true));
  const recentViews: Awaited<ReturnType<typeof appClient.workspaces.recentViews>> = yield* call(
    [appClient.workspaces, appClient.workspaces.recentViews],
  );
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
  const { changes, commitsEnvelope } = yield* all({
    changes: call([appClient.git, appClient.git.trackedChanges], workspaceId),
    commitsEnvelope: call([appClient.git, appClient.git.commitsWithBoundary], workspaceId),
  });
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
      yield* put(updateAgentStats(agentId, {
        additions: metrics.additions,
        deletions: metrics.deletions,
        timestamp: new Date().toISOString(),
      }));
    }
    yield* put(agentLineStatsRequestSucceeded(agentId, new Date().toISOString()));
  } catch (error) {
    yield* put(agentLineStatsRequestFailed(
      agentId,
      error instanceof Error ? error.message : String(error),
      new Date().toISOString(),
    ));
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

function* lifecycleReadWorker(
  action: LifecycleAction,
  initializedContexts: Set<string>,
): SagaGenerator<void> {
  if (action.type === loadWorkspacesRequested.type) return yield* call(refreshWorkspaces);
  if (action.type === requestAgentLineStats.type) {
    const { agentId, forceRefresh } = action.payload as { agentId: string; forceRefresh: boolean };
    return yield* call(refreshAgentStats, agentId, forceRefresh);
  }
  if (action.type === loadOlderCommitsRequested.type) {
    return yield* call(refreshOlderCommits, (action.payload as { wsId: string }).wsId);
  }

  const workspaceId = tupleString(action);
  if (!workspaceId) return;
  if (action.type === ensureWorkspaceTasksLoaded.type) return yield* call(refreshTasks, workspaceId, true);
  if (action.type === loadWorkspaceTasksRequested.type) return yield* call(refreshTasks, workspaceId, false);
  if (action.type === loadEventsRequested.type) {
    const events: Awaited<ReturnType<typeof appClient.events.list>> = yield* call(
      [appClient.events, appClient.events.list], workspaceId,
    );
    yield* put(eventsLoaded(workspaceId, events));
    return;
  }
  if (action.type === fetchWorkspaceTokenUsage.type) return yield* call(refreshTokenUsage, workspaceId);
  if (action.type === initContextForWorkspace.type) {
    const items: Awaited<ReturnType<typeof appClient.workspaces.getContext>> = yield* call(
      [appClient.workspaces, appClient.workspaces.getContext], workspaceId,
    );
    yield* put(hydrateContextItems(workspaceId, Array.isArray(items) ? items : []));
    initializedContexts.add(workspaceId);
    return;
  }
  if (action.type === hydrateTaskAgentAssociationsRequested.type) {
    const byNoteId: Awaited<ReturnType<typeof appClient.tasks.listAgentLinks>> = yield* call(
      [appClient.tasks, appClient.tasks.listAgentLinks], workspaceId,
    );
    yield* put(hydrateTaskAgentAssociations(workspaceId, byNoteId));
    return;
  }
  if (action.type === loadSkillsRequested.type) {
    const skills: Awaited<ReturnType<typeof appClient.skills.list>> = yield* call(
      [appClient.skills, appClient.skills.list], workspaceId,
    );
    yield* put(setSkills(workspaceId, skills));
    return;
  }
  if (action.type === refreshScripts.type) {
    const scripts: Awaited<ReturnType<typeof appClient.scripts.list>> = yield* call(
      [appClient.scripts, appClient.scripts.list], workspaceId,
    );
    yield* put(setScriptsData(workspaceId, scripts));
    yield* put(setScriptsInitialized(workspaceId, true));
    return;
  }
  if (action.type === refreshPRStatusRequested.type) {
    const [, force] = action.payload as [string, boolean, boolean];
    return yield* call(refreshPrStatus, workspaceId, force);
  }
  if (action.type === refreshRequested.type || action.type === loadWorkspaceDataRequested.type) {
    return yield* call(refreshChanges, workspaceId);
  }
  if (action.type === hydrateAgentsRequested.type) return yield* call(hydrateAgents, workspaceId);
  if (action.type === hydrateTerminalsRequested.type) {
		const result: Awaited<ReturnType<typeof appClient.terminals.list>> = yield* call(
      [appClient.terminals, appClient.terminals.list], workspaceId,
    );
      yield* put(
        Array.isArray(result)
          ? loadWorkspaceTerminals(workspaceId, result)
          : loadWorkspaceTerminals(workspaceId, result.terminals, null, result.daemonBootId),
      );
  }
}

export function* lifecycleReadSaga(): SagaGenerator<void> {
  const running = new Map<string, RunningRead>();
  const initializedContexts = new Set<string>();
  try {
    while (true) {
      const action: LifecycleAction = yield* take(triggers);
      if (action.type === workspaceDeleted.type || action.type === workspaceUnmounted.type) {
        const workspaceId = tupleString(action);
        if (!workspaceId) continue;
        initializedContexts.delete(workspaceId);
        for (const [key, read] of running) {
          if (read.workspaceId !== workspaceId) continue;
          running.delete(key);
          if (read.task) yield* cancel(read.task);
        }
        continue;
      }

      const descriptor = descriptorFor(action);
      if (!descriptor || running.has(descriptor.key)) continue;
      if (descriptor.key.startsWith('context:') && initializedContexts.has(descriptor.workspaceId ?? '')) {
        continue;
      }
      const token = Symbol(descriptor.key);
      running.set(descriptor.key, { ...descriptor, token });
      const task = yield* fork(function* () {
        try {
          yield* call(lifecycleReadWorker, action, initializedContexts);
        } catch (error) {
          logger.error(`Refresh failed for ${descriptor.key}`, error);
        } finally {
          if (running.get(descriptor.key)?.token === token) running.delete(descriptor.key);
        }
      });
      if (running.get(descriptor.key)?.token === token) {
        running.set(descriptor.key, { ...descriptor, task, token });
      }
    }
  } finally {
    for (const read of running.values()) if (read.task) yield* cancel(read.task);
    running.clear();
    initializedContexts.clear();
  }
}