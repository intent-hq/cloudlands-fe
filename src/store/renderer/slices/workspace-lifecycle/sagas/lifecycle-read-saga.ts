import type { SagaGenerator } from 'typed-redux-saga';
import { all, call, put, race, take, takeEvery } from 'typed-redux-saga';

import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { staleRuntimeFlagClearUpsertOptions } from '$features/agent/utils/stale-runtime-flag-clear';
import { reconcileGitStatusChanges } from '$features/file-tracking/git-status-reconciliation';
import { getAgentLineStats } from '$features/line-changes/line-changes.client';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { Workspace } from '$shared/types';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import { selectActiveBackendId } from '../../../utils/backend-storage-namespace';
import { takeEveryFromWindowEvent } from '../../../utils/ipc-channel';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import {
  takeLeadingByAgent,
  takeLeadingByWorkspace,
  takeLeadingInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import {
  bulkUpsertSessions,
  upsertSession,
  type BulkUpsertSessionsOptions,
} from '../../agent-session/agent-session-slice';
import {
  selectAgentSession,
  selectAgentSessionsById,
} from '../../agent-session/agent-session-selectors';
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
import { consoleOwnerChanged } from '../../hardware-console/hardware-console-slice';
import { prBranchLookupSucceeded } from '../../pr-branch-lookup/pr-branch-lookup-slice';
import type { PrBranchLookupPayload } from '../../pr-branch-lookup/pr-branch-lookup-types';
import { selectPRStatusLastRefreshTime } from '../../pr-status/pr-status-selectors';
import {
  prStatusRefreshCompleted,
  prStatusRefreshStarted,
  refreshPRStatusRequested,
} from '../../pr-status/pr-status-slice';
import { refreshScripts, setScriptsData, setScriptsInitialized } from '../../scripts/scripts-slice';
import { loadSkillsFailed, loadSkillsRequested, setSkills } from '../../skills/skills-slice';
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
  addAgent,
  fetchRetiredAgentsRequested,
  hydrateAgentsRequested,
  setActiveAgentId,
  setAgents,
  setAgentsLoaded,
  setIsLoadingRetiredAgents,
  setRetiredAgentsLoaded,
  setRetiredCount,
} from '../../workspace-agents/workspace-agents-slice';
import {
  selectActiveAgentId,
  selectIsLoadingRetiredAgents,
  selectRetiredAgentsLoaded,
  selectWorkspaceAgentIds,
} from '../../workspace-agents/workspace-agents-selectors';
import { selectOlderEventsNextToken } from '../../workspace-events/workspace-events-selectors';
import {
  eventsLoaded,
  eventsLoadFailed,
  eventsLoadStarted,
  loadEventsRequested,
  loadOlderEventsRequested,
  olderEventsLoaded,
  olderEventsLoadFailed,
} from '../../workspace-events/workspace-events-slice';
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
/** Initial/latest page size; pages arrive newest→oldest and are stored oldest→newest. */
const EVENTS_PAGE_LIMIT = 100;

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
  const result: Awaited<ReturnType<typeof workspaceClient.list>> = yield* call(
    [workspaceClient, workspaceClient.list],
    { lite: true },
  );
  if (!result.ok) throw new Error(result.error);
  const backendId = yield* selectActiveBackendId();
  yield* put(replaceWorkspaceList(result.data));
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

/**
 * Drop rows the FE soft-hid (local pending registry) and rows carrying the
 * daemon's delete-grace-window deadline (PROTOCOL §5.5 `pendingDeleteAt`,
 * v6.7+) — e.g. a deletion scheduled by another window.
 */
function* filterPendingDeletions(
  listed: Awaited<ReturnType<typeof appClient.agents.list>>,
): SagaGenerator<Awaited<ReturnType<typeof appClient.agents.list>>> {
  const fetched = [] as typeof listed;
  for (const agent of listed) {
    if (agent.pendingDeleteAt) continue;
    if (!(yield* call(isAgentDeletionPending, String(agent.id)))) fetched.push(agent);
  }
  return fetched;
}

function* hydrateAgents(workspaceId: string): SagaGenerator<void> {
  // Crash-leftover runtime-flag convergence (monorepo#4135): snapshot which
  // stored sessions hold the both-true isStreaming/isProcessing pair BEFORE
  // any daemon read starts. A pair set while the reads below are in flight
  // (chatSendStarted racing this hydration — the designed #1250 race case)
  // must NOT count as pre-existing, or an older idle list row would clear a
  // genuinely live turn. Mirrors the per-agent fetch path's storedBefore read
  // in agent-read-service.
  const sessionsBeforeFetch = yield* selectAgentSessionsById.effect();
  const inFlightPairIdsBeforeFetch = new Set<string>();
  for (const [id, session] of Object.entries(sessionsBeforeFetch)) {
    if (session.isStreaming === true && session.isProcessing === true) {
      inFlightPairIdsBeforeFetch.add(id);
    }
  }
  // Default read (§5.5 soft retire): retired rows are excluded daemon-side
  // and no longer ride every hydration frame; the sidebar's Retired bin
  // renders its collapsed toggle from `retiredCount` (v8.2, served on every
  // read) and loads the rows on demand via the retired-only read.
  const {
    agents: defaultRows,
    retiredCount,
  }: Awaited<ReturnType<typeof appClient.agents.listWithMeta>> = yield* call(
    [appClient.agents, appClient.agents.listWithMeta],
    workspaceId,
  );
  let listed = defaultRows;
  // `setAgents` replaces the workspace snapshot, so once the retired rows have
  // been lazily loaded a rehydrate must re-read them too — otherwise the
  // reconcile would evict every retired id from the workspace list.
  const retiredLoadedAtRead = yield* selectRetiredAgentsLoaded.effect(workspaceId);
  if (retiredLoadedAtRead) {
    const retiredRows: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(
      [appClient.agents, appClient.agents.list],
      workspaceId,
      { retiredOnly: true },
    );
    // The two reads are separate daemon round trips, so an agent retired
    // between them appears in BOTH lists — dedupe by id, preferring the
    // retired-only row (it carries the fresher `retiredAt`).
    const retiredIds = new Set(retiredRows.map((row) => String(row.id)));
    listed = [...defaultRows.filter((row) => !retiredIds.has(String(row.id))), ...retiredRows];
  }
  // Everything from the loaded-check above through the `setAgents` put below
  // is synchronous saga work (sync calls, selects, puts — no promise yields),
  // so a concurrent `fetchRetiredAgents` completion cannot interleave here.
  // The mid-flight case — the lazy load finishing while the reads above were
  // awaiting — is caught by the re-check just before `setAgents`.
  const fetched = yield* filterPendingDeletions(listed);
  yield* put(setAgentsLoaded(workspaceId, true));
  yield* put(setRetiredCount(workspaceId, retiredCount));

  const agents = [] as typeof fetched;
  // Crash-leftover runtime-flag convergence (monorepo#4135): a stored session
  // whose both-true isStreaming/isProcessing pair predates this read (the
  // pre-fetch snapshot above) and whose fresh list row reports the turn idle
  // is a crash leftover no event will ever clear — upsert it with the
  // stale-clear options so the list refresh converges it, matching the
  // per-agent fetch path (agent-read-service). A genuinely live turn returns
  // undefined options and keeps the default pair-guard preservation
  // semantics (monorepo#1250). The per-agent `existing` read stays post-fetch
  // on purpose: the message merge wants the latest stored transcript.
  const staleClearAgents = [] as typeof fetched;
  let staleClearOptions: BulkUpsertSessionsOptions | undefined;
  for (const agent of fetched) {
    const existing = yield* selectAgentSession.effect(String(agent.id));
    const hadInFlightPairBeforeFetch = inFlightPairIdsBeforeFetch.has(String(agent.id));
    const merged =
      agent.messages.length === 0 && existing && existing.messages.length > 0
        ? { ...agent, messages: existing.messages }
        : agent;
    agents.push(merged);
    const clearOptions = staleRuntimeFlagClearUpsertOptions(hadInFlightPairBeforeFetch, agent);
    if (clearOptions) {
      staleClearOptions = clearOptions;
      staleClearAgents.push(merged);
    }
  }
  yield* put(setAgents(workspaceId, agents));
  if (!retiredLoadedAtRead && (yield* selectRetiredAgentsLoaded.effect(workspaceId))) {
    // The lazy retired load completed while this hydration's daemon reads were
    // in flight: the snapshot above just evicted its rows while the loaded
    // flag reads true (bin would render empty and never refetch). Reset the
    // flag and re-request so the retired worker re-adds the rows.
    yield* put(setRetiredAgentsLoaded(workspaceId, false));
    yield* put(fetchRetiredAgentsRequested(workspaceId));
  }
  if (agents.length > 0) {
    if (staleClearAgents.length > 0) {
      const staleClearIds = new Set(staleClearAgents.map((agent) => String(agent.id)));
      const preserved = agents.filter((agent) => !staleClearIds.has(String(agent.id)));
      if (preserved.length > 0) yield* put(bulkUpsertSessions(preserved));
      yield* put(bulkUpsertSessions(staleClearAgents, staleClearOptions));
    } else {
      yield* put(bulkUpsertSessions(agents));
    }
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

/**
 * On-demand retired-row load (§5.5 soft retire, v8.2): triggered when the
 * sidebar's Retired bin expands (or an active search needs retired coverage).
 * Loads once per workspace — a failed read leaves `retiredAgentsLoaded` false
 * so the next expand retries. Rows merge in via `addAgent` (append-only) so a
 * concurrent hydration snapshot is never clobbered.
 */
function* fetchRetiredAgents(workspaceId: string): SagaGenerator<void> {
  if (yield* selectRetiredAgentsLoaded.effect(workspaceId)) return;
  if (yield* selectIsLoadingRetiredAgents.effect(workspaceId)) return;
  yield* put(setIsLoadingRetiredAgents(workspaceId, true));
  try {
    const listed: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(
      [appClient.agents, appClient.agents.list],
      workspaceId,
      { retiredOnly: true },
    );
    const fetched = yield* filterPendingDeletions(listed);
    if (fetched.length > 0) {
      // List rows carry message COUNTS, not transcripts — keep any transcript
      // already in the store (e.g. an agent retired live in this session).
      const agents = [] as typeof fetched;
      for (const agent of fetched) {
        const existing = yield* selectAgentSession.effect(String(agent.id));
        agents.push(
          agent.messages.length === 0 && existing && existing.messages.length > 0
            ? { ...agent, messages: existing.messages }
            : agent,
        );
      }
      yield* put(bulkUpsertSessions(agents));
      for (const agent of agents) {
        yield* put(upsertSession(agent));
        yield* put(addAgent(workspaceId, agent));
      }
    }
    // Re-baseline the count to the rows actually loaded so the bin label and
    // its contents can never disagree after a load.
    yield* put(setRetiredCount(workspaceId, fetched.length));
    yield* put(setRetiredAgentsLoaded(workspaceId, true));
  } finally {
    yield* put(setIsLoadingRetiredAgents(workspaceId, false));
  }
}

type WorkspaceRead = (workspaceId: string) => SagaGenerator<void>;

/**
 * Runs `worker` while holding one of the scheduler's slots, so a fan-out of one
 * read per registered workspace queues instead of hitting the daemon at once.
 * The slot is released on completion, failure and cancellation alike — whether
 * the cleanup race below cancels the read or, for coalesced domains, the
 * context watcher cancels the whole worker task.
 *
 * Priority is decided against the CURRENT tab at acquire time — selected live,
 * never captured at saga start — so a workspace focused long after boot
 * (e.g. an archived workspace opened via cmd+k) still queues its hydration
 * reads ahead of the background backlog instead of starving behind it.
 */
function* withReadSlot(
  scheduler: WorkspaceReadScheduler,
  workspaceId: string,
  worker: WorkspaceRead,
): SagaGenerator<void> {
  const activeWorkspaceId = yield* selectCurrentWorkspaceTabId.effect();
  const slot = scheduler.acquire(workspaceId === activeWorkspaceId);
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
) {
  if (!workspaceId) return;
  try {
    if (cancelOnWorkspaceCleanup) {
      yield* race({
        read: call(withReadSlot, scheduler, workspaceId, worker),
        cleanup: take(matchesWorkspaceCleanup(workspaceId)),
      });
    } else {
      yield* call(withReadSlot, scheduler, workspaceId, worker);
    }
  } catch (error) {
    logger.error(`Refresh failed for ${key}:${workspaceId}`, error);
  }
}

function* refreshEvents(workspaceId: string): SagaGenerator<void> {
  try {
    yield* put(eventsLoadStarted(workspaceId));
    const page: Awaited<ReturnType<typeof appClient.events.queryPage>> = yield* call(
      [appClient.events, appClient.events.queryPage],
      workspaceId,
      { limit: EVENTS_PAGE_LIMIT },
    );
    yield* put(eventsLoaded(workspaceId, [...page.items].reverse(), page.nextToken));
  } catch (error) {
    yield* put(
      eventsLoadFailed(workspaceId, error instanceof Error ? error.message : String(error)),
    );
    throw error;
  }
}

function* refreshOlderEvents(workspaceId: string): SagaGenerator<void> {
  const nextToken = yield* selectOlderEventsNextToken.effect(workspaceId);
  if (!nextToken) {
    yield* put(olderEventsLoaded(workspaceId, [], null));
    return;
  }
  try {
    const page: Awaited<ReturnType<typeof appClient.events.queryPage>> = yield* call(
      [appClient.events, appClient.events.queryPage],
      workspaceId,
      { limit: EVENTS_PAGE_LIMIT, nextToken },
    );
    yield* put(olderEventsLoaded(workspaceId, [...page.items].reverse(), page.nextToken));
  } catch (error) {
    yield* put(
      olderEventsLoadFailed(workspaceId, error instanceof Error ? error.message : String(error)),
    );
    throw error;
  }
}

function* refreshTaskAgentLinks(workspaceId: string): SagaGenerator<void> {
  const byNoteId: Awaited<ReturnType<typeof appClient.tasks.listAgentLinks>> = yield* call(
    [appClient.tasks, appClient.tasks.listAgentLinks],
    workspaceId,
  );
  yield* put(hydrateTaskAgentAssociations(workspaceId, byNoteId));
}

function* refreshSkills(workspaceId: string): SagaGenerator<void> {
  try {
    const skills: Awaited<ReturnType<typeof appClient.skills.list>> = yield* call(
      [appClient.skills, appClient.skills.list],
      workspaceId,
    );
    yield* put(setSkills(workspaceId, skills));
  } catch (error) {
    yield* put(
      loadSkillsFailed(workspaceId, error instanceof Error ? error.message : String(error)),
    );
    throw error;
  }
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

type EventsReadAction = ReturnType<
  typeof loadEventsRequested | typeof loadOlderEventsRequested | typeof workspaceUnmounted
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
  );
}

function eventsReadContext(pendingInitialReads: Set<string>, action: EventsReadAction) {
  const workspaceId = action.payload[0];
  if (isWorkspaceCleanupAction(action)) {
    pendingInitialReads.delete(workspaceId);
    return { context: workspaceId || '', cancel: true as const };
  }
  if (workspaceId && action.type === loadEventsRequested.type) {
    pendingInitialReads.add(workspaceId);
  }
  return workspaceId || '';
}

function* eventsWorker(
  scheduler: WorkspaceReadScheduler,
  pendingInitialReads: Set<string>,
  action: EventsReadAction,
) {
  if (isWorkspaceCleanupAction(action)) return;
  const workspaceId = action.payload[0];
  if (pendingInitialReads.delete(workspaceId)) {
    yield* runWorkspaceRead(scheduler, 'events', workspaceId, refreshEvents, false);
    if (action.type === loadOlderEventsRequested.type) {
      yield* runWorkspaceRead(scheduler, 'olderEvents', workspaceId, refreshOlderEvents, false);
    }
    return;
  }
  yield* runWorkspaceRead(scheduler, 'olderEvents', workspaceId, refreshOlderEvents, false);
}

function* tokenUsageWorker(
  scheduler: WorkspaceReadScheduler,
  action: ReturnType<typeof fetchWorkspaceTokenUsage>,
) {
  yield* runWorkspaceRead(scheduler, 'tokenUsage', action.payload[0], refreshTokenUsage);
}

function* taskAgentLinksWorker(
  scheduler: WorkspaceReadScheduler,
  action: ReturnType<typeof hydrateTaskAgentAssociationsRequested>,
) {
  yield* runWorkspaceRead(scheduler, 'taskAgentLinks', action.payload[0], refreshTaskAgentLinks);
}

function* skillsWorker(
  scheduler: WorkspaceReadScheduler,
  action: ReturnType<typeof loadSkillsRequested>,
) {
  yield* runWorkspaceRead(scheduler, 'skills', action.payload[0], refreshSkills);
}

type ScriptsReadAction = ReturnType<
  typeof refreshScripts | typeof workspaceDeleted | typeof workspaceUnmounted
>;

function* scriptsWorker(scheduler: WorkspaceReadScheduler, action: ScriptsReadAction) {
  if (!isWorkspaceCleanupAction(action)) {
    yield* runWorkspaceRead(
      scheduler,
      'scripts',
      action.payload[0],
      refreshWorkspaceScripts,
      false,
    );
  }
}

type ChangesReadAction = ReturnType<
  typeof refreshRequested | typeof loadWorkspaceDataRequested | typeof workspaceUnmounted
>;

function* changesWorker(scheduler: WorkspaceReadScheduler, action: ChangesReadAction) {
  if (isWorkspaceCleanupAction(action)) return;
  if (action.type === refreshRequested.type || action.type === loadWorkspaceDataRequested.type) {
    yield* runWorkspaceRead(scheduler, 'changes', action.payload[0], refreshChanges, false);
  }
}

type AgentsReadAction = ReturnType<typeof hydrateAgentsRequested | typeof workspaceUnmounted>;

function* coalescedAgentsWorker(scheduler: WorkspaceReadScheduler, action: AgentsReadAction) {
  if (!isWorkspaceCleanupAction(action)) {
    yield* runWorkspaceRead(scheduler, 'agents', action.payload[0], hydrateAgents, false);
  }
}

function* retiredAgentsWorker(
  scheduler: WorkspaceReadScheduler,
  action: ReturnType<typeof fetchRetiredAgentsRequested>,
) {
  yield* runWorkspaceRead(scheduler, 'retiredAgents', action.payload[0], fetchRetiredAgents);
}

function* terminalsWorker(
  scheduler: WorkspaceReadScheduler,
  action: ReturnType<typeof hydrateTerminalsRequested>,
) {
  yield* runWorkspaceRead(scheduler, 'terminals', action.payload[0], refreshTerminals);
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
  action: ReturnType<typeof loadOlderCommitsRequested>,
) {
  yield* runWorkspaceRead(scheduler, 'olderCommits', action.payload.wsId, refreshOlderCommits);
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

/**
 * Attention-flag reconciliation (PROTOCOL §9.9): a window that missed
 * `workspace:attention-changed` / `workspace:waiting-changed` /
 * `workspace:displayStatus-changed` deltas while unfocused (raise or clear
 * from another window / the daemon) must converge before its store answers
 * hardware key presses. Both triggers funnel into `loadWorkspacesRequested`, whose worker
 * is single-flight with trailing coalesce — a burst of focus/owner flips
 * collapses into at most one trailing `workspace.list` refetch, never an
 * O(workspaces) fan-out.
 */
function* windowFocusReconcileWorker() {
  yield* put(loadWorkspacesRequested());
}

function* consoleOwnerReconcileWorker(action: ReturnType<typeof consoleOwnerChanged>) {
  // Only acquisition needs a reconcile: this window is about to answer
  // hardware key presses from its own store. Losing ownership needs nothing.
  if (action.payload[0]) yield* put(loadWorkspacesRequested());
}

export function* lifecycleReadSaga(): SagaGenerator<void> {
  const initializedContexts = new Set<string>();
  const pendingForcedTaskReads = new Set<string>();
  const pendingInitialEventReads = new Set<string>();
  // One scheduler per saga run: it dies with the saga, so a restart can never
  // inherit slots held by reads that were cancelled with the previous run.
  const scheduler = createWorkspaceReadScheduler();
  try {
    yield* all([
      // Single-flight + trailing coalesce (AGENTS.md "Event-driven refetches"):
      // the daemon-events bridge dispatches this on workspace:created for IDs
      // unknown to the collection, so a create arriving while a list read is
      // in flight must queue one trailing refetch — takeLeading would drop it
      // and the fetched snapshot could predate the create.
      takeSingleFlightInContext(loadWorkspacesRequested, () => 'workspaces', loadWorkspacesWorker),
      // Reconcile missed attention deltas: refocus and console-owner
      // acquisition both re-request the list (coalesced by the worker above).
      takeEveryFromWindowEvent('focus', windowFocusReconcileWorker),
      takeEvery(consoleOwnerChanged, consoleOwnerReconcileWorker),
      takeSingleFlightInContext(
        [ensureWorkspaceTasksLoaded, loadWorkspaceTasksRequested, workspaceUnmounted],
        (action) => tasksReadContext(pendingForcedTaskReads, action),
        tasksWorker,
        scheduler,
        pendingForcedTaskReads,
      ),
      takeSingleFlightInContext(
        [loadEventsRequested, loadOlderEventsRequested, workspaceUnmounted],
        (action) => eventsReadContext(pendingInitialEventReads, action),
        eventsWorker,
        scheduler,
        pendingInitialEventReads,
      ),
      takeLeadingByWorkspace(fetchWorkspaceTokenUsage, tokenUsageWorker, scheduler),
      takeLeadingByWorkspace(initContextForWorkspace, contextWorker, initializedContexts),
      takeLeadingByWorkspace(
        hydrateTaskAgentAssociationsRequested,
        taskAgentLinksWorker,
        scheduler,
      ),
      takeLeadingByWorkspace(loadSkillsRequested, skillsWorker, scheduler),
      takeSingleFlightInContext(
        [refreshScripts, workspaceDeleted, workspaceUnmounted],
        scriptsReadContext,
        scriptsWorker,
        scheduler,
      ),
      takeLeadingByWorkspace(refreshPRStatusRequested, prStatusWorker),
      takeSingleFlightInContext(
        [refreshRequested, loadWorkspaceDataRequested, workspaceUnmounted],
        workspaceReadContext,
        changesWorker,
        scheduler,
      ),
      takeLeadingInContext(
        loadOlderCommitsRequested,
        (action) => action.payload.wsId,
        olderCommitsWorker,
        scheduler,
      ),
      takeLeadingByAgent(requestAgentLineStats, agentLineStatsWorker),
      takeSingleFlightInContext(
        [hydrateAgentsRequested, workspaceUnmounted],
        workspaceReadContext,
        coalescedAgentsWorker,
        scheduler,
      ),
      takeLeadingByWorkspace(fetchRetiredAgentsRequested, retiredAgentsWorker, scheduler),
      takeLeadingByWorkspace(hydrateTerminalsRequested, terminalsWorker, scheduler),
      takeEvery(workspaceUnmounted, clearUnmountedInitializedContext, initializedContexts),
    ]);
  } finally {
    initializedContexts.clear();
    pendingForcedTaskReads.clear();
    pendingInitialEventReads.clear();
  }
}
