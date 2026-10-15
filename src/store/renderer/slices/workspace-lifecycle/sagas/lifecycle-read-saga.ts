import { installTaskEventCompletionOwner } from '$features/events/task-event-completion';
import { trackWorktreeSnapshotRead } from '$features/file-tracking/worktree-read-lane';
import {
  acquireWorkspaceActivityDemand,
  runWorkspaceActivityRead,
  workspaceActivityRecoveryKey,
} from '$features/events/workspace-activity-recovery';
import { runWorkspaceProjectionRead } from '$features/events/workspace-list-recovery';
import { tasksRecoveryKey, runTaskListRead } from '$features/events/task-list-recovery';
import { terminalsRecoveryKey } from '$features/events/terminal-list-recovery';
import {
  acquireSkillsRecoveryDemand,
  readSkillsWithRecovery,
  skillsRecoveryKey,
} from '$features/events/skills-recovery';
import {
  acquireLifecycleMetadataDemand,
  runLifecycleMetadataRead,
  tokenUsageRecoveryKey,
  contextRecoveryKey,
  taskAgentLinksRecoveryKey,
} from '$features/events/lifecycle-metadata-recovery';
import {
  acquireAgentMetadataDemand,
  trackAgentMetadataRead,
} from '$features/agent/agent-metadata-recovery';
import { agentMetadataRecoveryKey } from '$features/agent/agent-recovery-keys';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import {
  WORKSPACE_LIST_RECOVERY_KEY,
  runWorkspaceListRead,
} from '$features/events/workspace-list-recovery';
import {
  scriptsRecoveryKey,
  trackScriptsRecoveryRead,
  recordScriptsRecoveryPage,
} from '$features/scripts/scripts-event-recovery';
import {
  rendererEventRecovery,
  type RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
import {
  changesRecoveryKey,
  registerChangesRecovery,
} from '$features/file-tracking/changes-event-recovery';
import {
  getRecoveryAdmission,
  getRecoveryLifetime,
  withRecoveryLifetime,
} from '../../../middlewares/event-recovery';
import {
  selectAllWorkspaceScriptEntries,
  selectScriptListPageState,
} from '../../scripts/scripts-selectors';
import {
  beginScriptRead,
  isScriptReadCurrent,
  reconcileScriptRead,
} from '../../scripts/utils/script-read-context';
import { buffers } from 'redux-saga';
import { store } from '../../../store';
import { refreshIntegrationAuthAfterReconnect } from '../../workspace-share/sagas/workspace-share-saga';
import { selectAgentSessionWorkspaceId } from '$store/renderer/slices/agent-session/agent-session-selectors';
import type { StoreState } from '../../../types';
import type { SagaGenerator } from 'typed-redux-saga';
import {
  actionChannel,
  all,
  call,
  getContext,
  cancelled,
  delay,
  flush,
  fork,
  put,
  race,
  select,
  take,
  takeEvery,
} from 'typed-redux-saga';

import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { staleRuntimeFlagClearUpsertOptions } from '$features/agent/utils/stale-runtime-flag-clear';
import { reconcileGitStatusChanges } from '$features/file-tracking/git-status-reconciliation';
import { getAgentLineStats } from '$features/line-changes/line-changes.client';
import { getPeopleActivity } from '$features/presence/components/people-activity';
import { appClient } from '$lib/client';
import { parsePushedGitStatus, toTrackedChange } from '$lib/client/live/live-git-client';
import type { GitStatus } from '$shared/types';
import type { TrackedChange } from '$features/file-tracking/types';
import { isForbiddenErrorResponse } from '$lib/client/live/backend-transport-types';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentDelegatedCounts, AgentSession, Workspace } from '$shared/types';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import { selectActiveBackendId } from '../../../utils/backend-storage-namespace';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  selectHostRole,
  selectPrincipalActionContext,
  selectPrincipalConnectionContext,
} from '../../principal/principal-selectors';
import { selectWorkspacePeopleIdentities } from '../../presence/presence-selectors';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import { CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS } from '../../tab-state/tab-state-slice';
import {
  takeLeadingByAgent,
  takeLeadingByWorkspace,
  takeLeadingInContext,
  takeLatestByContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { bulkUpsertSessions } from '../../agent-session/agent-session-slice';
import {
  selectAgentSession,
  selectAgentSessionsById,
} from '../../agent-session/agent-session-selectors';
import {
  clearAgentLineStats,
  agentLineStatsRequestFailed,
  agentLineStatsRequestStarted,
  agentLineStatsRequestSucceeded,
  appendOlderCommits,
  changesEventReceived,
  changesConsumerMounted,
  changesConsumerUnmounted,
  reconcileChangesRequested,
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
import {
  refreshScripts,
  loadMoreScripts,
  setScriptPageCursor,
  setScriptsData,
  setScriptsInitialized,
  setScriptListState,
  setActiveScriptsData,
  scriptReadFinished,
  scriptReadReconciled,
} from '../../scripts/scripts-slice';
import { loadSkillsFailed, loadSkillsRequested, setSkills } from '../../skills/skills-slice';
import {
  hydrateTaskAgentAssociations,
  hydrateTaskAgentAssociationsRequested,
} from '../../task-agent-associations/task-agent-associations-slice';
import { selectTerminalsForWorkspace } from '../../terminals/terminals-selectors';
import {
  hydrateTerminalsRequested,
  loadWorkspaceTerminals,
  removeTerminal,
} from '../../terminals/terminals-slice';
import {
  fetchWorkspaceTokenUsage,
  tokenUsageFetchFailed,
  tokenUsageReceived,
} from '../../token-usage/token-usage-slice';
import {
  addAgent,
  adjustDelegatedParentCount,
  adjustScopeCount,
  fetchBackgroundAgentsRequested,
  fetchDelegatedAgentsRequested,
  fetchOrphanedDelegatedAgentsRequested,
  fetchRetiredAgentsRequested,
  hydrateAgentsRequested,
  setActiveAgentId,
  setAgents,
  setAgentsLoaded,
  setDelegatedCounts,
  setDelegatedParentLoaded,
  setIsLoadingDelegatedParent,
  setIsLoadingLazyBin,
  setIsLoadingOrphanedDelegatedAgents,
  setIsLoadingRetiredAgents,
  setLazyBinLoaded,
  setOrphanedDelegatedAgentIds,
  setOrphanedDelegatedAgentsLoaded,
  setRetiredAgentsLoaded,
  setRetiredCount,
  setScopeCounts,
  type LazyAgentListBin,
} from '../../workspace-agents/workspace-agents-slice';
import { agentDelegationParentOf, classifyAgentScope } from '$shared/utils/agent-scope';
import {
  selectActiveAgentId,
  selectAllWorkspaceAgents,
  selectBackgroundAgentsLoaded,
  selectDelegatedAgentsLoaded,
  selectDelegatedCounts,
  selectDelegatedParentLoaded,
  selectIsLoadingBackgroundAgents,
  selectIsLoadingDelegatedAgents,
  selectIsLoadingDelegatedParent,
  selectIsLoadingOrphanedDelegatedAgents,
  selectIsLoadingRetiredAgents,
  selectLoadedDelegatedParentIds,
  selectOrphanedDelegatedAgentsLoaded,
  selectRetiredAgentsLoaded,
  selectScopeCounts,
  selectScopeCountsGeneration,
  selectWorkspaceAgentIds,
} from '../../workspace-agents/workspace-agents-selectors';
import {
  selectOlderEventsNextToken,
  selectOlderEventsEndReached,
  selectPeopleEventsInitialized,
  selectWorkspaceEvents,
} from '../../workspace-events/workspace-events-selectors';
import {
  eventsLoaded,
  eventsLoadFailed,
  eventsLoadStarted,
  loadEventsRequested,
  loadOlderEventsRequested,
  loadPeopleEventsRequested,
  olderEventsLoaded,
  olderEventsLoadFailed,
  peopleEventsLoadStarted,
  peopleEventsLoadFinished,
} from '../../workspace-events/workspace-events-slice';
import {
  acquireWorkspaceTasksDemand,
  clearWorkspaceTasks,
  ensureWorkspaceTasksLoaded,
  workspaceTasksReadStarted,
  workspaceTasksReadAbandoned,
  loadWorkspaceTasksFailed,
  loadWorkspaceTasksRequested,
  loadWorkspaceTasksSucceeded,
} from '../../workspace-tasks/workspace-tasks-slice';
import {
  selectDemandedTaskWorkspaceIds,
  selectWorkspaceTasksShouldLoad,
  selectWorkspaceTasksState,
} from '../../workspace-tasks/workspace-tasks-selectors';
import {
  bulkUpdateWorkspaceEntities,
  loadRecencyData,
  loadWorkspacesRequested,
  refreshWorkspaceMembershipRequested,
  replaceWorkspaceList,
  removeWorkspaceEntity,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  updateWorkspaceEntity,
} from '../../workspace/workspace-slice';
import {
  selectWorkspaceById,
  selectWorkspaceListLoadedForBackend,
} from '../../workspace/workspace-selectors';
import {
  backendReconnected,
  workspaceDeleted,
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
import {
  createWorkspaceReadScheduler,
  type WorkspaceReadScheduler,
} from './workspace-read-scheduler';

const logger = createLogger('LifecycleReadSaga');

/**
 * Skip a non-forced `pr.refresh` when the last successful refresh is within this window.
 * `lastRefreshTime` is only stamped on success, so a failed/errored refresh never arms
 * the TTL and the next trigger can retry the command. The daemon still applies
 * automatic admission before spending forge quota.
 */
const PR_STATUS_REFRESH_TTL_MS = 60_000;
/** Initial/latest page size; pages arrive newest→oldest and are stored oldest→newest. */
const EVENTS_PAGE_LIMIT = 100;
const PEOPLE_ROWS_PER_REQUEST = 20;
const PEOPLE_MAX_PAGES_PER_REQUEST = 10;
/**
 * Backoff for a `workspace.list` that fails before the list has ever loaded
 * for the active backend (e.g. the guest's tailcat tunnel is not up at boot).
 * Later attempts wait `WORKSPACE_LIST_RETRY_CAP_MS`.
 */
const WORKSPACE_LIST_RETRY_DELAYS_MS = [1_000, 2_000, 5_000];
const WORKSPACE_LIST_RETRY_CAP_MS = 15_000;
/**
 * Message of the daemon's `-32003 Forbidden` envelope. The workspace IPC
 * bridge flattens daemon errors to their message string, so this is the only
 * field the renderer can key the refusal off when it arrives via
 * `workspaceClient`.
 */
const FORBIDDEN_ERROR_MESSAGE = 'Forbidden';

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

type WorkspaceProjectionAction = ReturnType<
  | typeof setWorkspaceEntity
  | typeof updateWorkspaceEntity
  | typeof bulkUpdateWorkspaceEntities
  | typeof removeWorkspaceEntity
  | typeof workspaceDeleted
>;

function* refreshWorkspaces(): SagaGenerator<void> {
  const authority = rendererEventRecovery.captureAuthority(WORKSPACE_LIST_RECOVERY_KEY);
  let published = false;
  const receipt = rendererEventRecovery.capture(WORKSPACE_LIST_RECOVERY_KEY);
  if (!receipt.commit(() => undefined)) return;
  const dispatch = store.dispatch;
  const backendId = yield* selectActiveBackendId();
  const context = yield* selectPrincipalActionContext.effect();
  const changes = yield* actionChannel(
    [
      setWorkspaceEntity,
      updateWorkspaceEntity,
      bulkUpdateWorkspaceEntities,
      removeWorkspaceEntity,
      workspaceDeleted,
    ],
    buffers.expanding<WorkspaceProjectionAction>(),
  );
  try {
    const deletionTokens = store.state.workspace.deletionTokens;
    const result = yield* call(() =>
      runWorkspaceListRead(receipt, () => workspaceClient.list({ lite: true })),
    );
    if (
      !receipt.commit(() => undefined) ||
      store.dispatch !== dispatch ||
      backendId !== (yield* selectActiveBackendId()) ||
      context !== (yield* selectPrincipalActionContext.effect())
    )
      return;
    if (!result.ok) throw new Error(result.error);
    // Replay only fields carried by current events. A title-only event must not
    // copy a prior admission's capability fields over the fresh list projection.
    const rows = new Map(result.data.map((row) => [row.id as string, row]));
    const record = (action: WorkspaceProjectionAction) => {
      if (action.type === bulkUpdateWorkspaceEntities.type) {
        for (const nested of action.payload[0] as ReturnType<typeof updateWorkspaceEntity>[])
          record(nested);
      } else if (action.type === setWorkspaceEntity.type) {
        const row = action.payload[0] as Workspace;
        rows.set(row.id, row);
      } else if (action.type === updateWorkspaceEntity.type) {
        const [id, patch] = action.payload as [string, Partial<Workspace>];
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, ...patch });
      } else rows.delete(action.payload[0] as string);
    };
    for (const action of yield* flush(changes)) record(action);
    yield* put(
      withRecoveryLifetime(
        replaceWorkspaceList([...rows.values()], {
          complete: result.complete === true,
          deletionTokens,
        }),
        receipt,
      ),
    );
    published = receipt.commit(() => undefined);
    yield* put(withRecoveryLifetime(setWorkspaceHasLoaded(true, backendId, context), receipt));
    const recentViews = yield* call([appClient.workspaces, appClient.workspaces.recentViews]);
    if (
      !receipt.commit(() => undefined) ||
      store.dispatch !== dispatch ||
      backendId !== (yield* selectActiveBackendId()) ||
      context !== (yield* selectPrincipalActionContext.effect())
    )
      return;
    yield* put(withRecoveryLifetime(loadRecencyData({ lastViewedAt: recentViews }), receipt));
  } finally {
    changes.close();
    if (!published && !receipt.isCurrent() && authority.isCurrent()) {
      yield* put(withRecoveryLifetime(loadWorkspacesRequested(), authority));
    }
  }
}

function* refreshTasks(workspaceId: string, original?: RecoveryLifetime): SagaGenerator<void> {
  if (!(yield* selectWorkspaceTasksShouldLoad.effect(workspaceId))) return;
  const authority = rendererEventRecovery.captureAuthority(tasksRecoveryKey(workspaceId));
  const receipt = original ?? rendererEventRecovery.capture(tasksRecoveryKey(workspaceId));
  if (!receipt.commit(() => undefined)) return;
  yield* put(withRecoveryLifetime(workspaceTasksReadStarted(workspaceId), receipt));
  const { readRevision } = yield* selectWorkspaceTasksState.effect(workspaceId);
  try {
    const result: Awaited<ReturnType<typeof appClient.tasks.list>> = yield* call(() =>
      rendererEventRecovery.hasOwner(tasksRecoveryKey(workspaceId))
        ? runTaskListRead(workspaceId, receipt, () => appClient.tasks.list(workspaceId))
        : appClient.tasks.list(workspaceId),
    );
    yield* put(
      withRecoveryLifetime(
        loadWorkspaceTasksSucceeded(workspaceId, result.tasks, result.stats),
        receipt,
      ),
    );
  } catch (error) {
    yield* put(withRecoveryLifetime(loadWorkspaceTasksFailed(workspaceId, String(error)), receipt));
    throw error;
  } finally {
    if (!receipt.isCurrent() && authority.isCurrent()) {
      yield* put(
        withRecoveryLifetime(workspaceTasksReadAbandoned(workspaceId, readRevision), authority),
      );
      yield* put(withRecoveryLifetime(ensureWorkspaceTasksLoaded(workspaceId), authority));
    }
  }
}

function readLifecycleMetadata<T>(
  key: string,
  receipt: RecoveryLifetime,
  read: () => Promise<T>,
): Promise<T> {
  return rendererEventRecovery.hasOwner(key)
    ? runLifecycleMetadataRead(key, receipt, read)
    : read();
}

function* refreshTokenUsage(workspaceId: string): SagaGenerator<void> {
  const release = acquireLifecycleMetadataDemand(workspaceId, 'tokenUsage');
  const key = tokenUsageRecoveryKey(workspaceId);
  const receipt = rendererEventRecovery.capture(key);
  try {
    if (!receipt.commit(() => undefined)) return;
    try {
      const usage: Awaited<ReturnType<typeof appClient.workspaces.getTokenUsage>> = yield* call(
        () =>
          readLifecycleMetadata(key, receipt, () =>
            appClient.workspaces.getTokenUsage(workspaceId),
          ),
      );
      yield* put(
        withRecoveryLifetime(
          usage ? tokenUsageReceived(workspaceId, usage) : tokenUsageFetchFailed(workspaceId),
          receipt,
        ),
      );
    } catch (error) {
      yield* put(withRecoveryLifetime(tokenUsageFetchFailed(workspaceId), receipt));
      throw error;
    }
  } finally {
    release();
  }
}

/**
 * Targeted `workspace.get` (§5.1) that merges membership rights and summary
 * onto the stored row. Invite create / revoke deltas carry no counts, and
 * the archive teardown's per-member `memberCount` frames say nothing about
 * the invites it revoked, so the row is re-derived from the daemon instead
 * of patched client-side. Never a per-workspace fan-out: one read per
 * delta-bearing workspace, coalesced by the watcher.
 */
function* refreshMembershipSummary(
  workspaceId: string,
  isLatest: () => boolean,
): SagaGenerator<void> {
  const receipt = rendererEventRecovery.capture(WORKSPACE_LIST_RECOVERY_KEY);
  if (!receipt.commit(() => undefined)) return;
  const context = yield* selectPrincipalActionContext.effect();
  const previous = yield* selectWorkspaceById.effect(workspaceId);
  const workspace: Awaited<ReturnType<typeof appClient.workspaces.get>> = yield* call(() =>
    runWorkspaceProjectionRead(
      receipt,
      workspaceId,
      () => appClient.workspaces.get(workspaceId),
      `normalized-get:${workspaceId}`,
    ),
  );
  if (
    !receipt.commit(() => undefined) ||
    !workspace ||
    !isLatest() ||
    context !== (yield* selectPrincipalActionContext.effect())
  )
    return;
  const current = yield* selectWorkspaceById.effect(workspaceId);
  // Another authoritative hydration must not be overwritten by an older read.
  if (current?.canManage !== previous?.canManage || current?.myRole !== previous?.myRole) return;
  const changes: Partial<Workspace> = {};
  if (context !== null) {
    if (typeof workspace.canManage === 'boolean') changes.canManage = workspace.canManage;
    if (workspace.myRole === 'owner' || workspace.myRole === 'collaborator') {
      changes.myRole = workspace.myRole;
    }
  }
  if (typeof workspace.memberCount === 'number' && Number.isFinite(workspace.memberCount)) {
    changes.memberCount = workspace.memberCount;
  }
  if (typeof workspace.openInviteCount === 'number' && Number.isFinite(workspace.openInviteCount)) {
    changes.openInviteCount = workspace.openInviteCount;
  }
  if (Object.keys(changes).length === 0) return;
  yield* put(
    withRecoveryLifetime(
      bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, changes)]),
      receipt,
    ),
  );
}

function* refreshPrStatus(
  workspaceId: string,
  force: boolean,
  isManual: boolean,
): SagaGenerator<void> {
  const receipt = rendererEventRecovery.capture(WORKSPACE_LIST_RECOVERY_KEY);
  if (!receipt.commit(() => undefined)) return;
  if (!force) {
    const lastRefreshTime = yield* selectPRStatusLastRefreshTime.effect(workspaceId);
    if (lastRefreshTime != null && Date.now() - lastRefreshTime < PR_STATUS_REFRESH_TTL_MS) {
      return;
    }
  }
  yield* put(withRecoveryLifetime(prStatusRefreshStarted(workspaceId), receipt));
  try {
    const refresh: Awaited<ReturnType<typeof appClient.git.prRefresh>> = yield* call(
      [appClient.git, appClient.git.prRefresh],
      workspaceId,
      // Forced hydration/reconnect bypasses only this renderer's freshness cache.
      { automatic: !isManual },
    );
    if (refresh === null) {
      yield* put(
        withRecoveryLifetime(
          prStatusRefreshCompleted(workspaceId, false, 'pr.refresh failed'),
          receipt,
        ),
      );
      return;
    }
    yield* put(withRecoveryLifetime(prStatusRefreshCompleted(workspaceId, true), receipt));
    const workspace: Workspace | undefined = yield* selectWorkspaceById.effect(workspaceId);
    if (refresh.prNumber != null && workspace?.repositoryOwner && workspace.repositoryName) {
      const payload: PrBranchLookupPayload = {
        owner: workspace.repositoryOwner,
        repo: workspace.repositoryName,
        prNumber: refresh.prNumber,
        key: `${workspace.repositoryOwner}/${workspace.repositoryName}#${refresh.prNumber}`,
      };
      yield* put(withRecoveryLifetime(prBranchLookupSucceeded(payload, workspace.branch), receipt));
    }
  } catch (error) {
    yield* put(
      withRecoveryLifetime(
        prStatusRefreshCompleted(
          workspaceId,
          false,
          error instanceof Error ? error.message : String(error),
        ),
        receipt,
      ),
    );
  }
}

/**
 * Broad refreshes own the Changes slice. Git status is read here only as
 * reconciliation input; gitReadSaga is the sole owner of Git-slice updates.
 */
function* admittedWorkspaceRead(workspaceId: string): SagaGenerator<string | null> {
  const state: StoreState = yield* select();
  const context = selectPrincipalActionContext.select(state);
  const role = selectHostRole.select(state);
  if (
    !context ||
    (role !== 'owner' && role !== 'member') ||
    (role === 'member' && workspaceId === CHIEF_WORKSPACE_ID) ||
    !selectWorkspaceById.select(state, workspaceId) ||
    !selectWorkspaceListLoadedForBackend.select(state, state.connections.windowBackendId) ||
    state.workspace.capabilityContext !== context
  )
    return null;
  return context;
}

type ChangesEntry = {
  recovery?: RendererRecoveryHandle;
  stopRecovery?: () => void;
  explicitReads?: number;
  context: string;
  filesRevision: number;
  historyRevision: number;
  filesDirty: boolean;
  historyDirty: boolean;
  status?: GitStatus;
  tracked?: TrackedChange[];
  historyIdentity?: string;
  loadedHistoryIdentity?: string;
  historyRecoveryAttempted?: boolean;
};
type ChangesReads = Map<string, ChangesEntry>;
type ChangesDemand = Map<string, { files: number; history: number }>;

function* hasChangesDemand(
  demand: ChangesDemand,
  workspaceId: string,
  scope?: 'files' | 'history',
): SagaGenerator<boolean> {
  return (
    (scope
      ? (demand.get(workspaceId)?.[scope] ?? 0) > 0
      : (demand.get(workspaceId)?.files ?? 0) + (demand.get(workspaceId)?.history ?? 0) > 0) &&
    (yield* selectCurrentWorkspaceTabId.effect()) === workspaceId
  );
}

function changesEntry(reads: ChangesReads, workspaceId: string, context: string): ChangesEntry {
  let entry = reads.get(workspaceId);
  if (!entry || entry.context !== context) {
    entry?.stopRecovery?.();
    entry = {
      context,
      filesRevision: 0,
      historyRevision: 0,
      filesDirty: !!entry,
      historyDirty: !!entry,
    };
    reads.set(workspaceId, entry);
  }
  return entry;
}

function ensureChangesRecovery(
  reads: ChangesReads,
  demand: ChangesDemand,
  workspaceId: string,
  entry: ChangesEntry,
) {
  if (reads.get(workspaceId) !== entry) return;
  const desired = () => {
    const visible = selectCurrentWorkspaceTabId.select(store.state) === workspaceId;
    return {
      files: !!entry.explicitReads || (visible && (demand.get(workspaceId)?.files ?? 0) > 0),
      history: !!entry.explicitReads || (visible && (demand.get(workspaceId)?.history ?? 0) > 0),
    };
  };
  if (!entry.stopRecovery) {
    entry.stopRecovery = rendererEventRecovery.onSession((scope) => {
      const deletion = store.state.workspace.deletionTokens[workspaceId];
      const handle = registerChangesRecovery(scope, workspaceId, {
        isCurrent: () =>
          reads.get(workspaceId) === entry &&
          selectPrincipalActionContext.select(store.state) === entry.context &&
          !!selectWorkspaceById.select(store.state, workspaceId) &&
          store.state.workspace.capabilityContext === entry.context &&
          store.state.workspace.deletionTokens[workspaceId] === deletion,
        demand: desired,
        loadedHistoryIdentity: () => entry.loadedHistoryIdentity,
        retired: () => {
          entry.loadedHistoryIdentity = undefined;
          entry.historyIdentity = undefined;
          entry.status = undefined;
          entry.tracked = undefined;
          entry.filesDirty = true;
          entry.historyDirty = true;
          entry.filesRevision++;
          entry.historyRevision++;
          entry.historyRecoveryAttempted = false;
        },
        invalidate: () => {
          entry.filesRevision++;
          entry.historyRevision++;
          entry.filesDirty = true;
          entry.historyDirty = true;
          entry.status = undefined;
          entry.tracked = undefined;
          entry.historyIdentity = undefined;
          entry.historyRecoveryAttempted = false;
        },
        applied: (snapshot) => {
          if (snapshot.status && snapshot.tracked) {
            entry.status = snapshot.status;
            entry.tracked = snapshot.tracked;
            entry.filesDirty = false;
          }
          if (snapshot.history || snapshot.historyIdentity) {
            entry.loadedHistoryIdentity =
              snapshot.history?.historyIdentity ?? snapshot.historyIdentity;
            entry.historyIdentity = entry.loadedHistoryIdentity;
            entry.historyDirty = false;
          }
        },
        dispatch: (action) => store.dispatch(action),
      });
      entry.recovery = handle;
      return () => {
        if (entry.recovery === handle) entry.recovery = undefined;
        handle.dispose();
      };
    });
  }
  entry.recovery?.setActive(desired().files || desired().history);
}

function* refreshChanges(
  reads: ChangesReads,
  demand: ChangesDemand,
  workspaceId: string,
  explicit: boolean,
): SagaGenerator<void> {
  const context = yield* admittedWorkspaceRead(workspaceId);
  if (!context) return;
  const entry = changesEntry(reads, workspaceId, context);
  if (explicit) entry.explicitReads = (entry.explicitReads ?? 0) + 1;
  ensureChangesRecovery(reads, demand, workspaceId, entry);
  try {
    if (!entry.recovery?.status.stale)
      yield* refreshChangesSnapshot(reads, demand, workspaceId, explicit);
  } finally {
    if (explicit) entry.explicitReads = Math.max(0, (entry.explicitReads ?? 0) - 1);
    ensureChangesRecovery(reads, demand, workspaceId, entry);
  }
}

function readChangesSnapshotValue<T>(
  workspaceId: string,
  receipt: RecoveryLifetime,
  read: () => Promise<T>,
): Promise<T> {
  return trackWorktreeSnapshotRead(changesRecoveryKey(workspaceId), () => {
    if (!receipt.commit(() => undefined)) throw new Error('Changes read superseded');
    return read();
  });
}

function* refreshChangesSnapshot(
  reads: ChangesReads,
  demand: ChangesDemand,
  workspaceId: string,
  explicit: boolean,
): SagaGenerator<void> {
  const context = yield* admittedWorkspaceRead(workspaceId);
  if (!context) return;
  const entry = changesEntry(reads, workspaceId, context);
  const receipt = rendererEventRecovery.capture(changesRecoveryKey(workspaceId));
  if (!receipt.commit(() => undefined)) return;
  if (explicit) {
    entry.historyRevision++;
    // A manual/initial read establishes fresh correspondence, including when
    // the status push announcing a newer history was missed. Later pushes
    // still advance the revision and reject this response if superseded.
    entry.historyIdentity = undefined;
    entry.loadedHistoryIdentity = undefined;
    entry.historyRecoveryAttempted = false;
    entry.filesDirty = true;
    entry.historyDirty = true;
    entry.status = undefined;
    entry.tracked = undefined;
  } else if (!(yield* hasChangesDemand(demand, workspaceId))) return;
  const filesRevision = entry.filesRevision;
  const historyRevision = entry.historyRevision;
  const historyIdentity = entry.historyIdentity;
  const filesDirty =
    entry.filesDirty && (explicit || (yield* hasChangesDemand(demand, workspaceId, 'files')));
  const historyDirty =
    entry.historyDirty && (explicit || (yield* hasChangesDemand(demand, workspaceId, 'history')));
  if (!filesDirty && !historyDirty) return;
  if (filesDirty) entry.filesDirty = false;
  if (historyDirty) entry.historyDirty = false;
  const { status, trackedChanges, commitsEnvelope } = yield* call(function* (): SagaGenerator<{
    status: GitStatus | null;
    trackedChanges: TrackedChange[] | null;
    commitsEnvelope: Awaited<ReturnType<typeof appClient.git.commitsWithBoundary>> | null;
  }> {
    try {
      return yield* all({
        status: call(function* (): SagaGenerator<GitStatus | null> {
          if (!filesDirty) return null;
          return (
            entry.status ??
            (yield* call(() =>
              readChangesSnapshotValue(workspaceId, receipt, () =>
                appClient.git.status(workspaceId),
              ),
            ))
          );
        }),
        trackedChanges: call(function* (): SagaGenerator<TrackedChange[] | null> {
          if (!filesDirty) return null;
          return (
            entry.tracked ??
            (yield* call(() =>
              readChangesSnapshotValue(workspaceId, receipt, () =>
                appClient.git.trackedChanges(workspaceId),
              ),
            ))
          );
        }),
        commitsEnvelope: call(function* (): SagaGenerator<Awaited<
          ReturnType<typeof appClient.git.commitsWithBoundary>
        > | null> {
          return historyDirty
            ? yield* call(() =>
                readChangesSnapshotValue(workspaceId, receipt, () =>
                  appClient.git.commitsWithBoundary(workspaceId),
                ),
              )
            : null;
        }),
      });
    } catch (error) {
      if (entry.filesRevision === filesRevision) entry.filesDirty ||= filesDirty;
      if (entry.historyRevision === historyRevision) entry.historyDirty ||= historyDirty;
      throw error;
    }
  });
  if (
    !receipt.commit(() => undefined) ||
    (yield* admittedWorkspaceRead(workspaceId)) !== context ||
    reads.get(workspaceId) !== entry
  )
    return;
  if (filesDirty && filesRevision === entry.filesRevision) {
    if (!status || trackedChanges === null) {
      entry.filesDirty = true;
      entry.historyDirty ||= historyDirty;
      return;
    }
    entry.status = status;
    entry.tracked = trackedChanges;
    const changes = reconcileGitStatusChanges(status.files, trackedChanges);
    yield* put(
      withRecoveryLifetime(setChangesData(workspaceId, changes, false, changes.length), receipt),
    );
  }
  if (commitsEnvelope && historyRevision === entry.historyRevision) {
    const responseIdentity = commitsEnvelope.historyIdentity;
    if (historyIdentity && responseIdentity !== historyIdentity) {
      // A status push cannot prove which immutable snapshot the history read
      // captured (including A -> B -> A). Retry once, then keep the dirty
      // marker for the next demand/event rather than looping on missing data.
      entry.historyDirty = true;
      entry.loadedHistoryIdentity = undefined;
      if (!entry.historyRecoveryAttempted) {
        entry.historyRecoveryAttempted = true;
        yield* put(reconcileChangesRequested(workspaceId));
      }
    } else {
      yield* put(
        withRecoveryLifetime(
          setCommitsData(workspaceId, commitsEnvelope.commits, commitsEnvelope.boundarySha),
          receipt,
        ),
      );
      entry.loadedHistoryIdentity = responseIdentity;
      entry.historyIdentity = responseIdentity;
      entry.historyDirty = false;
      entry.historyRecoveryAttempted = false;
    }
  }
  if (explicit)
    yield* put(withRecoveryLifetime(setHasLoadedInitialData(workspaceId, true), receipt));
}

function* receiveChangesEvent(
  reads: ChangesReads,
  demand: ChangesDemand,
  action: ReturnType<typeof changesEventReceived>,
): SagaGenerator<void> {
  const [workspaceId, type, data] = action.payload;
  if (typeof data.gitRootId === 'string' && data.gitRootId) return;
  const admitted = getRecoveryAdmission(action, changesRecoveryKey(workspaceId));
  if (admitted === null) return;
  if (
    admitted
      ? !admitted.commit(() => undefined)
      : !rendererEventRecovery.push(changesRecoveryKey(workspaceId))
  )
    return;
  const context = yield* admittedWorkspaceRead(workspaceId);
  if (!context) return;
  const entry = changesEntry(reads, workspaceId, context);
  if (type === 'workspace:updated' && !Object.hasOwn(data.changes ?? {}, 'branch')) {
    entry.historyRevision++;
    entry.historyIdentity = undefined;
    entry.historyRecoveryAttempted = false;
    entry.historyDirty = true;
    if (yield* hasChangesDemand(demand, workspaceId))
      yield* put(reconcileChangesRequested(workspaceId));
    return;
  }
  entry.filesRevision++;
  if (type === 'changes:tracked' && Array.isArray(data.changes)) {
    const tracked = data.changes.map(toTrackedChange);
    if (tracked.every((change): change is TrackedChange => change !== null)) {
      entry.tracked = tracked;
      // This push contains attribution, not an as-of working-tree snapshot.
      // Read only membership/stage; never infer that untracked paths vanished
      // or that the previously read index still matches this new attribution.
      entry.status = undefined;
      entry.filesDirty = true;
      if (yield* hasChangesDemand(demand, workspaceId, 'files')) {
        yield* put(reconcileChangesRequested(workspaceId));
      }
      return;
    }
  }
  entry.filesDirty = true;
  entry.tracked = undefined;
  entry.status = undefined;
  const status =
    data.status && typeof data.status === 'object'
      ? (data.status as Record<string, unknown>)
      : undefined;
  entry.status = parsePushedGitStatus(status?.gitStatus) ?? undefined;
  if (type !== 'changes:tracked') {
    const identity =
      typeof status?.historyIdentity === 'string' && status.historyIdentity
        ? status.historyIdentity
        : undefined;
    if (!identity || identity !== entry.historyIdentity) {
      entry.historyRevision++;
      entry.historyRecoveryAttempted = false;
    }
    entry.historyIdentity = identity;
    entry.historyDirty ||= !identity || entry.loadedHistoryIdentity !== identity;
  }
  if (yield* hasChangesDemand(demand, workspaceId))
    yield* put(reconcileChangesRequested(workspaceId));
}

function* reconcileVisibleChanges(reads: ChangesReads, demand: ChangesDemand): SagaGenerator<void> {
  for (const [id, entry] of reads) ensureChangesRecovery(reads, demand, id, entry);
  const workspaceId = yield* selectCurrentWorkspaceTabId.effect();
  if (!workspaceId || !(yield* hasChangesDemand(demand, workspaceId))) return;
  const entry = reads.get(workspaceId);
  if (entry?.filesDirty || entry?.historyDirty) yield* put(reconcileChangesRequested(workspaceId));
}

function* changeChangesDemand(
  reads: ChangesReads,
  demand: ChangesDemand,
  action: ReturnType<typeof changesConsumerMounted | typeof changesConsumerUnmounted>,
): SagaGenerator<void> {
  const [workspaceId, scope = 'all'] = action.payload;
  const delta = action.type === changesConsumerMounted.type ? 1 : -1;
  const counts = demand.get(workspaceId) ?? { files: 0, history: 0 };
  if (scope !== 'history') counts.files = Math.max(0, counts.files + delta);
  if (scope !== 'files') counts.history = Math.max(0, counts.history + delta);
  demand.set(workspaceId, counts);
  const context = yield* admittedWorkspaceRead(workspaceId);
  if (context)
    ensureChangesRecovery(reads, demand, workspaceId, changesEntry(reads, workspaceId, context));
  yield* reconcileVisibleChanges(reads, demand);
}

function* reconnectChanges(reads: ChangesReads, demand: ChangesDemand): SagaGenerator<void> {
  for (const entry of reads.values()) {
    entry.filesRevision++;
    entry.historyRevision++;
    entry.filesDirty = true;
    entry.historyDirty = true;
    entry.status = undefined;
    entry.tracked = undefined;
    entry.historyIdentity = undefined;
    entry.loadedHistoryIdentity = undefined;
    entry.historyRecoveryAttempted = false;
  }
  yield* reconcileVisibleChanges(reads, demand);
}

function* refreshOlderCommits(reads: ChangesReads, workspaceId: string): SagaGenerator<void> {
  const context = yield* admittedWorkspaceRead(workspaceId);
  if (!context) return;
  const receipt = rendererEventRecovery.capture(changesRecoveryKey(workspaceId));
  const entry = reads.get(workspaceId);
  const revision = entry?.historyRevision;
  yield* put(withRecoveryLifetime(setLoadingOlderCommits(workspaceId, true), receipt));
  try {
    const envelope: Awaited<ReturnType<typeof appClient.git.commitsWithBoundary>> = yield* call(
      () =>
        readChangesSnapshotValue(workspaceId, receipt, () =>
          appClient.git.commitsWithBoundary(workspaceId, true),
        ),
    );
    if (
      receipt.isCurrent() &&
      (yield* admittedWorkspaceRead(workspaceId)) === context &&
      reads.get(workspaceId) === entry &&
      entry?.historyRevision === revision
    ) {
      if (
        entry?.loadedHistoryIdentity &&
        envelope.historyIdentity !== entry.loadedHistoryIdentity
      ) {
        entry.historyDirty = true;
        entry.loadedHistoryIdentity = undefined;
        yield* put(reconcileChangesRequested(workspaceId));
      } else {
        yield* put(
          withRecoveryLifetime(appendOlderCommits(workspaceId, envelope.commits), receipt),
        );
      }
    }
  } finally {
    if ((yield* admittedWorkspaceRead(workspaceId)) === context)
      yield* put(withRecoveryLifetime(setLoadingOlderCommits(workspaceId, false), receipt));
  }
}

function* refreshAgentStats(agentId: string, forceRefresh: boolean): SagaGenerator<void> {
  if (!(yield* selectShouldRequestAgentLineStats.effect(agentId, forceRefresh))) return;
  const workspaceId = yield* selectAgentSessionWorkspaceId.effect(agentId);
  if (!workspaceId) return;
  const release = acquireAgentMetadataDemand(workspaceId, { agentId, lineStats: true });
  const receipt = rendererEventRecovery.capture(agentMetadataRecoveryKey(workspaceId));
  try {
    if (!receipt.commit(() => undefined)) return;
    yield* put(
      withRecoveryLifetime(
        agentLineStatsRequestStarted(agentId, new Date().toISOString()),
        receipt,
      ),
    );
    const metrics: Awaited<ReturnType<typeof getAgentLineStats>> = yield* call(() =>
      readAgentMetadata(receipt, workspaceId, () => getAgentLineStats(agentId, workspaceId)),
    );
    if (metrics) {
      yield* put(
        withRecoveryLifetime(
          updateAgentStats(agentId, {
            additions: metrics.additions,
            deletions: metrics.deletions,
            timestamp: new Date().toISOString(),
          }),
          receipt,
        ),
      );
      yield* put(
        withRecoveryLifetime(
          agentLineStatsRequestSucceeded(agentId, new Date().toISOString()),
          receipt,
        ),
      );
    } else yield* put(withRecoveryLifetime(clearAgentLineStats(agentId), receipt));
  } catch (error) {
    yield* put(
      withRecoveryLifetime(
        agentLineStatsRequestFailed(
          agentId,
          error instanceof Error ? error.message : String(error),
          new Date().toISOString(),
        ),
        receipt,
      ),
    );
  } finally {
    release();
  }
}

/**
 * Drop rows the FE soft-hid (local pending registry) and rows carrying the
 * daemon's delete-grace-window deadline (PROTOCOL §5.5 `pendingDeleteAt`)
 * — e.g. a deletion scheduled by another window.
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

/** Id-deduped union of two `agent.list` reads, the later read winning on overlap. */
function mergeListedRows(
  earlier: Awaited<ReturnType<typeof appClient.agents.list>>,
  later: Awaited<ReturnType<typeof appClient.agents.list>>,
): Awaited<ReturnType<typeof appClient.agents.list>> {
  const laterIds = new Set(later.map((row) => String(row.id)));
  return [...earlier.filter((row) => !laterIds.has(String(row.id))), ...later];
}

function readAgentMetadata<T>(
  receipt: RecoveryLifetime,
  workspaceId: string,
  read: () => Promise<T>,
): Promise<T> {
  if (!rendererEventRecovery.hasOwner(agentMetadataRecoveryKey(workspaceId))) return read();
  return trackAgentMetadataRead(workspaceId, () => {
    if (!receipt.commit(() => undefined)) throw new Error('Agent metadata read superseded');
    return read();
  });
}

function* hydrateAgents(workspaceId: string): SagaGenerator<void> {
  const release = acquireAgentMetadataDemand(workspaceId, { bin: 'topLevel' });
  const receipt = rendererEventRecovery.capture(agentMetadataRecoveryKey(workspaceId));
  try {
    if (!receipt.commit(() => undefined)) return;
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
    // Default read: `scope: "topLevel"` (§5.5 row scope) — only the parentless
    // foreground rows the sidebar lists by default ride the hydration frame;
    // the Delegated and Background bins render their collapsed toggles from
    // the daemon-served `scopeCounts` and load their rows on demand via the
    // scoped reads, the same way the Retired bin (§5.5 soft retire) renders
    // from `retiredCount` and loads via the retired-only read. An older daemon
    // ignores `scope`, serves every non-retired row and omits `scopeCounts` —
    // that absence is the signal to run the pre-scope all-rows path (no bins).
    const {
      agents: defaultRows,
      retiredCount,
      scopeCounts,
      delegatedCounts,
    }: Awaited<ReturnType<typeof appClient.agents.listWithMeta>> = yield* call(() =>
      readAgentMetadata(receipt, workspaceId, () =>
        appClient.agents.listWithMeta(workspaceId, { scope: 'topLevel' as const }),
      ),
    );
    let listed = defaultRows;
    // `setAgents` replaces the workspace snapshot, so once a lazy bin's rows
    // have been loaded a rehydrate must re-read that bin too — otherwise the
    // reconcile would evict every one of its ids from the workspace list.
    // Each extra read is a separate daemon round trip, so a row that moved
    // bins between them can appear in two lists — dedupe by id, preferring
    // the later (fresher) read; the retired-only row is read last since it
    // carries the fresher `retiredAt`. Delegated rows loaded per parent (the
    // by-parent read) are re-read the same way when the whole bin is not
    // loaded, and the orphan-only subset while the delegated parents are not
    // covered (`selectDelegatedParentsCovered`, against the FRESH background
    // count) — the whole-bin rows alone cannot tell an orphan from the child of
    // an unloaded live background parent, so its membership stays authoritative
    // until then. The orphan re-read is gated on the FRESH
    // `delegatedCounts.orphaned`, not the stored flag alone: a reconnect to a
    // daemon predating it would otherwise send `orphanedOnly` to a daemon that
    // ignores the flag and answers with the whole bin.
    const delegatedLoadedAtRead = scopeCounts
      ? yield* selectDelegatedAgentsLoaded.effect(workspaceId)
      : false;
    const backgroundLoadedAtRead = scopeCounts
      ? yield* selectBackgroundAgentsLoaded.effect(workspaceId)
      : false;
    const delegatedParentsCoveredAtRead = scopeCounts
      ? yield* selectDelegatedParentsCovered(workspaceId, scopeCounts.background)
      : false;
    const loadedParentIdsAtRead =
      scopeCounts && !delegatedLoadedAtRead
        ? Object.keys(yield* selectLoadedDelegatedParentIds.effect(workspaceId))
        : [];
    const orphanedServed = Boolean(scopeCounts && delegatedCounts?.orphaned);
    const orphanedLoadedAtRead =
      orphanedServed && !delegatedParentsCoveredAtRead
        ? yield* selectOrphanedDelegatedAgentsLoaded.effect(workspaceId)
        : false;
    const retiredLoadedAtRead = yield* selectRetiredAgentsLoaded.effect(workspaceId);
    if (delegatedLoadedAtRead) {
      const delegatedRows: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(() =>
        readAgentMetadata(receipt, workspaceId, () =>
          appClient.agents.list(workspaceId, { scope: 'delegated' as const }),
        ),
      );
      listed = mergeListedRows(listed, delegatedRows);
    }
    for (const parentAgentId of loadedParentIdsAtRead) {
      const childRows: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(() =>
        readAgentMetadata(receipt, workspaceId, () =>
          appClient.agents.list(workspaceId, { scope: 'delegated' as const, parentAgentId }),
        ),
      );
      listed = mergeListedRows(listed, childRows);
    }
    if (orphanedLoadedAtRead) {
      const orphanedRows: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(() =>
        readAgentMetadata(receipt, workspaceId, () =>
          appClient.agents.list(workspaceId, { scope: 'delegated' as const, orphanedOnly: true }),
        ),
      );
      listed = mergeListedRows(listed, orphanedRows);
      // The bin's membership re-baselines with the rows: a parent deleted or
      // retired since the last read turned its children into orphans.
      yield* put(
        withRecoveryLifetime(
          setOrphanedDelegatedAgentIds(
            workspaceId,
            orphanedRows.map((row) => String(row.id)),
          ),
          receipt,
        ),
      );
    }
    if (backgroundLoadedAtRead) {
      const backgroundRows: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(() =>
        readAgentMetadata(receipt, workspaceId, () =>
          appClient.agents.list(workspaceId, { scope: 'background' as const }),
        ),
      );
      listed = mergeListedRows(listed, backgroundRows);
    }
    if (retiredLoadedAtRead) {
      const retiredRows: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(() =>
        readAgentMetadata(receipt, workspaceId, () =>
          appClient.agents.list(workspaceId, { retiredOnly: true }),
        ),
      );
      listed = mergeListedRows(listed, retiredRows);
    }
    // Everything from the loaded-checks above through the `setAgents` put below
    // is synchronous saga work (sync calls, selects, puts — no promise yields),
    // so a concurrent lazy-bin completion cannot interleave here. The mid-flight
    // case — a lazy load finishing while the reads above were awaiting — is
    // caught by the re-checks just after `setAgents`.
    const fetched = yield* filterPendingDeletions(listed);
    yield* put(withRecoveryLifetime(setAgentsLoaded(workspaceId, true), receipt));
    yield* put(withRecoveryLifetime(setRetiredCount(workspaceId, retiredCount), receipt));
    yield* put(withRecoveryLifetime(setScopeCounts(workspaceId, scopeCounts ?? null), receipt));
    yield* put(
      withRecoveryLifetime(setDelegatedCounts(workspaceId, delegatedCounts ?? null), receipt),
    );

    const agents = [] as typeof fetched;
    // Crash-leftover runtime-flag convergence (monorepo#4135): a stored session
    // whose both-true isStreaming/isProcessing pair predates this read (the
    // pre-fetch snapshot above) and whose fresh list row reports the turn idle
    // is a crash leftover no event will ever clear — tag that row for stale
    // clearing in the single batch so list refresh converges it, matching the
    // per-agent fetch path (agent-read-service). Genuinely live rows retain the
    // default pair-guard semantics (monorepo#1250). The per-agent `existing`
    // read stays post-fetch on purpose: the message merge wants the latest
    // stored transcript.
    const staleRuntimeFlagClearAgentIds: string[] = [];
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
        staleRuntimeFlagClearAgentIds.push(String(agent.id));
      }
    }
    yield* put(withRecoveryLifetime(setAgents(workspaceId, agents), receipt));
    // A lazy load that completed while this hydration's daemon reads were in
    // flight: the snapshot above just evicted its rows while the loaded flag
    // reads true (bin would render empty and never refetch). Reset the flag and
    // re-request so the bin's worker re-adds the rows.
    if (!retiredLoadedAtRead && (yield* selectRetiredAgentsLoaded.effect(workspaceId))) {
      yield* put(withRecoveryLifetime(setRetiredAgentsLoaded(workspaceId, false), receipt));
      yield* put(withRecoveryLifetime(fetchRetiredAgentsRequested(workspaceId), receipt));
    }
    if (scopeCounts) {
      if (!delegatedLoadedAtRead && (yield* selectDelegatedAgentsLoaded.effect(workspaceId))) {
        yield* put(
          withRecoveryLifetime(setLazyBinLoaded(workspaceId, 'delegated', false), receipt),
        );
        yield* put(withRecoveryLifetime(fetchDelegatedAgentsRequested(workspaceId), receipt));
      } else if (!delegatedLoadedAtRead) {
        // Same guard per parent: a by-parent load that landed mid-hydration.
        const loadedParentIds = yield* selectLoadedDelegatedParentIds.effect(workspaceId);
        for (const parentAgentId of Object.keys(loadedParentIds)) {
          if (loadedParentIdsAtRead.includes(parentAgentId)) continue;
          yield* put(
            withRecoveryLifetime(
              setDelegatedParentLoaded(workspaceId, parentAgentId, false),
              receipt,
            ),
          );
          yield* put(
            withRecoveryLifetime(
              fetchDelegatedAgentsRequested(workspaceId, parentAgentId),
              receipt,
            ),
          );
        }
      }
      // Same guard for the orphan subset — and the capability-loss path: the
      // daemon stopped serving `delegatedCounts.orphaned`, so a loaded flag
      // is stale (the bin falls back to the whole-bin read) and must not
      // suppress a later orphan-only load once the capability returns.
      if (
        !delegatedParentsCoveredAtRead &&
        !orphanedLoadedAtRead &&
        (yield* selectOrphanedDelegatedAgentsLoaded.effect(workspaceId))
      ) {
        yield* put(
          withRecoveryLifetime(setOrphanedDelegatedAgentsLoaded(workspaceId, false), receipt),
        );
        if (orphanedServed)
          yield* put(
            withRecoveryLifetime(fetchOrphanedDelegatedAgentsRequested(workspaceId), receipt),
          );
      }
      if (!backgroundLoadedAtRead && (yield* selectBackgroundAgentsLoaded.effect(workspaceId))) {
        yield* put(
          withRecoveryLifetime(setLazyBinLoaded(workspaceId, 'background', false), receipt),
        );
        yield* put(withRecoveryLifetime(fetchBackgroundAgentsRequested(workspaceId), receipt));
      }
    }
    if (agents.length > 0) {
      // `agent.list` rows are the slim §5.5 list projection: detail-only fields
      // an earlier `agent.get` stored must survive this refresh.
      if (staleRuntimeFlagClearAgentIds.length > 0) {
        yield* put(
          withRecoveryLifetime(
            bulkUpsertSessions(agents, { staleRuntimeFlagClearAgentIds, listProjection: true }),
            receipt,
          ),
        );
      } else {
        yield* put(
          withRecoveryLifetime(bulkUpsertSessions(agents, { listProjection: true }), receipt),
        );
      }
    }

    const activeAgentId = yield* selectActiveAgentId.effect(workspaceId);
    const agentIds = yield* selectWorkspaceAgentIds.effect(workspaceId);
    if (activeAgentId && agentIds.includes(activeAgentId)) return;
    // Retired rows are hydrated for the sidebar's Retired bin but never
    // auto-selected — the fallback active agent must be a working one.
    const selectable = agents.filter((agent) => !agent.retiredAt);
    if (selectable.length === 0) return;
    const firstForeground = selectable.find((agent) => !agent.isBackground) ?? selectable[0];
    yield* put(
      withRecoveryLifetime(setActiveAgentId(workspaceId, String(firstForeground.id)), receipt),
    );
  } finally {
    release();
  }
}

/**
 * On-demand retired-row load (§5.5 soft retire, `retiredOnly: true`): triggered when the
 * sidebar's Retired bin expands (or an active search needs retired coverage).
 * Loads once per workspace — a failed read leaves `retiredAgentsLoaded` false
 * so the next expand retries. Rows merge in via `addAgent` (append-only) so a
 * concurrent hydration snapshot is never clobbered.
 */
function* fetchRetiredAgents(workspaceId: string): SagaGenerator<void> {
  const release = acquireAgentMetadataDemand(workspaceId, { bin: 'retired' });
  const receipt = rendererEventRecovery.capture(agentMetadataRecoveryKey(workspaceId));
  try {
    if (!receipt.commit(() => undefined)) return;
    if (yield* selectRetiredAgentsLoaded.effect(workspaceId)) return;
    if (yield* selectIsLoadingRetiredAgents.effect(workspaceId)) return;
    yield* put(withRecoveryLifetime(setIsLoadingRetiredAgents(workspaceId, true), receipt));
    try {
      const listed: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(() =>
        readAgentMetadata(receipt, workspaceId, () =>
          appClient.agents.list(workspaceId, { retiredOnly: true }),
        ),
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
        yield* put(
          withRecoveryLifetime(bulkUpsertSessions(agents, { listProjection: true }), receipt),
        );
        for (const agent of agents) {
          yield* put(withRecoveryLifetime(addAgent(workspaceId, agent), receipt));
        }
      }
      // Re-baseline the count to the rows actually loaded so the bin label and
      // its contents can never disagree after a load.
      yield* put(withRecoveryLifetime(setRetiredCount(workspaceId, fetched.length), receipt));
      yield* put(withRecoveryLifetime(setRetiredAgentsLoaded(workspaceId, true), receipt));
    } finally {
      yield* put(withRecoveryLifetime(setIsLoadingRetiredAgents(workspaceId, false), receipt));
    }
  } finally {
    release();
  }
}

const LAZY_BIN_LOADED_SELECTOR = {
  delegated: selectDelegatedAgentsLoaded,
  background: selectBackgroundAgentsLoaded,
} as const satisfies Record<LazyAgentListBin, unknown>;
const LAZY_BIN_LOADING_SELECTOR = {
  delegated: selectIsLoadingDelegatedAgents,
  background: selectIsLoadingBackgroundAgents,
} as const satisfies Record<LazyAgentListBin, unknown>;

/**
 * On-demand scoped-bin load (§5.5 row scope, `scope: "delegated"` /
 * `scope: "background"`): triggered when the sidebar's bin expands (or an
 * active search needs its rows). Same contract as `fetchRetiredAgents`: loads
 * once per workspace, a failed read leaves the loaded flag false so the next
 * expand retries, rows merge in via `addAgent` (append-only). A no-op while no
 * `scopeCounts` are held — an older daemon ignores `scope` and already served
 * every row on the default read, so there is nothing to load.
 */
function* fetchLazyBinAgents(workspaceId: string, bin: LazyAgentListBin): SagaGenerator<void> {
  const release = acquireAgentMetadataDemand(workspaceId, { bin });
  const receipt = rendererEventRecovery.capture(agentMetadataRecoveryKey(workspaceId));
  try {
    if (!receipt.commit(() => undefined)) return;
    if (!(yield* selectScopeCounts.effect(workspaceId))) return;
    if (yield* LAZY_BIN_LOADED_SELECTOR[bin].effect(workspaceId)) return;
    if (yield* LAZY_BIN_LOADING_SELECTOR[bin].effect(workspaceId)) return;
    yield* put(withRecoveryLifetime(setIsLoadingLazyBin(workspaceId, bin, true), receipt));
    try {
      const listed: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(() =>
        readAgentMetadata(receipt, workspaceId, () =>
          appClient.agents.list(workspaceId, { scope: bin }),
        ),
      );
      const fetched = yield* filterPendingDeletions(listed);
      if (fetched.length > 0) {
        const agents = [] as typeof fetched;
        for (const agent of fetched) {
          const existing = yield* selectAgentSession.effect(String(agent.id));
          agents.push(
            agent.messages.length === 0 && existing && existing.messages.length > 0
              ? { ...agent, messages: existing.messages }
              : agent,
          );
        }
        yield* put(
          withRecoveryLifetime(bulkUpsertSessions(agents, { listProjection: true }), receipt),
        );
        for (const agent of agents) {
          yield* put(withRecoveryLifetime(addAgent(workspaceId, agent), receipt));
        }
      }
      // Re-baseline the bin's count to the rows actually loaded so the bin
      // label and its contents can never disagree after a load. The delegated
      // bin's rows are every parent's children, so its `byParent` totals
      // re-baseline from the same read — `Σ byParent[*].total` must keep
      // matching `scopeCounts.delegated` (§5.5).
      const counts = yield* selectScopeCounts.effect(workspaceId);
      if (counts) {
        yield* put(
          withRecoveryLifetime(
            adjustScopeCount(workspaceId, bin, fetched.length - counts[bin]),
            receipt,
          ),
        );
      }
      if (bin === 'delegated') {
        yield* rebaselineDelegatedCountsFromRows(workspaceId, fetched, receipt);
      }
      yield* put(withRecoveryLifetime(setLazyBinLoaded(workspaceId, bin, true), receipt));
    } finally {
      yield* put(withRecoveryLifetime(setIsLoadingLazyBin(workspaceId, bin, false), receipt));
    }
  } finally {
    release();
  }
}

/**
 * Replace `delegatedCounts.byParent` with the totals of the delegated rows a
 * whole-bin read served, grouped by the parent key the daemon groups by.
 * `running` is not derivable from a list row here, so each parent keeps its
 * daemon-served running count clipped to the new total (loaded rows are
 * authoritative for running once hydrated) and the workspace-wide `running`
 * stays `Σ byParent[*].running`. `orphaned` is not derivable from a list row
 * (orphan-ness is a daemon-side parent lookup), so it is carried verbatim.
 */
function* rebaselineDelegatedCountsFromRows(
  workspaceId: string,
  rows: readonly AgentSession[],
  receipt: RecoveryLifetime,
): SagaGenerator<void> {
  const counts = yield* selectDelegatedCounts.effect(workspaceId);
  if (!counts) return;
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const parentAgentId = agentDelegationParentOf(row);
    if (parentAgentId) totals[parentAgentId] = (totals[parentAgentId] ?? 0) + 1;
  }
  const byParent: AgentDelegatedCounts['byParent'] = {};
  let running = 0;
  for (const [parentAgentId, total] of Object.entries(totals)) {
    const parentRunning = Math.min(total, counts.byParent[parentAgentId]?.running ?? 0);
    byParent[parentAgentId] = { total, running: parentRunning };
    running += parentRunning;
  }
  yield* put(
    withRecoveryLifetime(
      setDelegatedCounts(workspaceId, {
        running,
        byParent,
        ...(counts.orphaned ? { orphaned: counts.orphaned } : {}),
      }),
      receipt,
    ),
  );
}

/**
 * Every live delegated parent is in the cache: the whole delegated bin is
 * loaded and so is the Background bin — or there is no Background bin to
 * load, the same rule the sidebar applies (`WorkspaceAgentsList`): a zero
 * `backgroundCount` (the fresh read's, else the stored `scopeCounts`) and no
 * standalone background row already cached, since a lifecycle event can
 * hydrate one before the count catches up. Without that exception a
 * workspace with no background agents would keep the orphan subset
 * "uncovered" forever — the bin is never requested, so the flag never sets.
 */
function* selectDelegatedParentsCovered(
  workspaceId: string,
  backgroundCount?: number,
): SagaGenerator<boolean> {
  if (!(yield* selectDelegatedAgentsLoaded.effect(workspaceId))) return false;
  if (yield* selectBackgroundAgentsLoaded.effect(workspaceId)) return true;
  const count = backgroundCount ?? (yield* selectScopeCounts.effect(workspaceId))?.background ?? 0;
  if (count > 0) return false;
  const cached = yield* selectAllWorkspaceAgents.effect(workspaceId);
  return !cached.some((agent) => !agent.retiredAt && classifyAgentScope(agent) === 'background');
}

/**
 * On-demand orphan-only delegated load (§5.5, `scope: "delegated"` +
 * `orphanedOnly: true`): triggered when the sidebar's Delegated bin — which
 * holds only the orphaned delegated rows — expands. Same contract as
 * `fetchDelegatedAgentsForParent`: loads once (a whole-bin load covers the
 * orphans too, but only once every delegated parent is covered —
 * `selectDelegatedParentsCovered` — since its rows alone cannot tell an
 * orphan from the child of an unloaded live background parent), a failed
 * read leaves the flag false so the next expand
 * retries, rows merge in via `addAgent`. Gated on `delegatedCounts.orphaned`
 * presence — an older daemon ignores `orphanedOnly` and would answer with the
 * whole bin, so there is nothing to load until the daemon serves the count.
 * `orphaned.total` re-baselines to the rows served (running clipped to it)
 * unless a fresher baseline landed while the read was in flight. The served
 * ids are retained as the bin's membership: orphan-hood is daemon-owned, so
 * the bin never infers it from a parent's absence in the partial cache.
 */
function* fetchOrphanedDelegatedAgents(workspaceId: string): SagaGenerator<void> {
  const release = acquireAgentMetadataDemand(workspaceId, { bin: 'delegated', orphanedOnly: true });
  const receipt = rendererEventRecovery.capture(agentMetadataRecoveryKey(workspaceId));
  try {
    if (!receipt.commit(() => undefined)) return;
    if (!(yield* selectScopeCounts.effect(workspaceId))) return;
    if (!(yield* selectDelegatedCounts.effect(workspaceId))?.orphaned) return;
    if (yield* selectDelegatedParentsCovered(workspaceId)) return;
    if (yield* selectOrphanedDelegatedAgentsLoaded.effect(workspaceId)) return;
    if (yield* selectIsLoadingOrphanedDelegatedAgents.effect(workspaceId)) return;
    const baselineGeneration = yield* selectScopeCountsGeneration.effect(workspaceId);
    yield* put(
      withRecoveryLifetime(setIsLoadingOrphanedDelegatedAgents(workspaceId, true), receipt),
    );
    try {
      const listed: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(() =>
        readAgentMetadata(receipt, workspaceId, () =>
          appClient.agents.list(workspaceId, { scope: 'delegated' as const, orphanedOnly: true }),
        ),
      );
      const fetched = yield* filterPendingDeletions(listed);
      if (fetched.length > 0) {
        const agents = [] as typeof fetched;
        for (const agent of fetched) {
          const existing = yield* selectAgentSession.effect(String(agent.id));
          agents.push(
            agent.messages.length === 0 && existing && existing.messages.length > 0
              ? { ...agent, messages: existing.messages }
              : agent,
          );
        }
        yield* put(
          withRecoveryLifetime(bulkUpsertSessions(agents, { listProjection: true }), receipt),
        );
        for (const agent of agents) {
          yield* put(withRecoveryLifetime(addAgent(workspaceId, agent), receipt));
        }
      }
      const superseded =
        (yield* selectDelegatedParentsCovered(workspaceId)) ||
        (yield* selectScopeCountsGeneration.effect(workspaceId)) !== baselineGeneration;
      const counts = yield* selectDelegatedCounts.effect(workspaceId);
      if (counts?.orphaned && !superseded && counts.orphaned.total !== fetched.length) {
        yield* put(
          withRecoveryLifetime(
            setDelegatedCounts(workspaceId, {
              ...counts,
              orphaned: {
                total: fetched.length,
                running: Math.min(fetched.length, counts.orphaned.running),
              },
            }),
            receipt,
          ),
        );
      }
      yield* put(
        withRecoveryLifetime(
          setOrphanedDelegatedAgentIds(
            workspaceId,
            fetched.map((row) => String(row.id)),
          ),
          receipt,
        ),
      );
      yield* put(
        withRecoveryLifetime(setOrphanedDelegatedAgentsLoaded(workspaceId, true), receipt),
      );
    } finally {
      yield* put(
        withRecoveryLifetime(setIsLoadingOrphanedDelegatedAgents(workspaceId, false), receipt),
      );
    }
  } finally {
    release();
  }
}

/**
 * On-demand by-parent delegated load (§5.5, `scope: "delegated"` +
 * `parentAgentId`): triggered when one top-level agent's collapsed delegated
 * group expands. Same contract as `fetchLazyBinAgents`, scoped to one parent:
 * loads once per parent (a whole-bin load counts as loaded for every parent),
 * a failed read leaves the parent unloaded so the next expand retries, rows
 * merge in via `addAgent`. The parent's `byParent` total re-baselines to the
 * rows served, with `scopeCounts.delegated` moved by the same delta so the
 * two stay in lockstep; `running` is left to the loaded rows. The
 * re-baseline is skipped when a fresher baseline landed while the read was
 * in flight — a whole-bin load (which re-baselines every parent from its own
 * rows) or a hydration read (`setScopeCounts`, generation bump) — so a
 * superseded per-parent read never moves counts a newer read already owns;
 * its rows still merge in.
 */
function* fetchDelegatedAgentsForParent(
  workspaceId: string,
  parentAgentId: string,
): SagaGenerator<void> {
  const release = acquireAgentMetadataDemand(workspaceId, { bin: 'delegated', parentAgentId });
  const receipt = rendererEventRecovery.capture(agentMetadataRecoveryKey(workspaceId));
  try {
    if (!receipt.commit(() => undefined)) return;
    if (!(yield* selectScopeCounts.effect(workspaceId))) return;
    if (yield* selectDelegatedParentLoaded.effect(workspaceId, parentAgentId)) return;
    if (yield* selectIsLoadingDelegatedParent.effect(workspaceId, parentAgentId)) return;
    const baselineGeneration = yield* selectScopeCountsGeneration.effect(workspaceId);
    yield* put(
      withRecoveryLifetime(setIsLoadingDelegatedParent(workspaceId, parentAgentId, true), receipt),
    );
    try {
      const listed: Awaited<ReturnType<typeof appClient.agents.list>> = yield* call(() =>
        readAgentMetadata(receipt, workspaceId, () =>
          appClient.agents.list(workspaceId, { scope: 'delegated' as const, parentAgentId }),
        ),
      );
      const fetched = yield* filterPendingDeletions(listed);
      if (fetched.length > 0) {
        const agents = [] as typeof fetched;
        for (const agent of fetched) {
          const existing = yield* selectAgentSession.effect(String(agent.id));
          agents.push(
            agent.messages.length === 0 && existing && existing.messages.length > 0
              ? { ...agent, messages: existing.messages }
              : agent,
          );
        }
        yield* put(
          withRecoveryLifetime(bulkUpsertSessions(agents, { listProjection: true }), receipt),
        );
        for (const agent of agents) {
          yield* put(withRecoveryLifetime(addAgent(workspaceId, agent), receipt));
        }
      }
      const superseded =
        (yield* selectDelegatedAgentsLoaded.effect(workspaceId)) ||
        (yield* selectScopeCountsGeneration.effect(workspaceId)) !== baselineGeneration;
      const counts = yield* selectDelegatedCounts.effect(workspaceId);
      if (counts && !superseded) {
        const delta = fetched.length - (counts.byParent[parentAgentId]?.total ?? 0);
        if (delta !== 0) {
          yield* put(
            withRecoveryLifetime(
              adjustDelegatedParentCount(workspaceId, parentAgentId, delta),
              receipt,
            ),
          );
          yield* put(
            withRecoveryLifetime(adjustScopeCount(workspaceId, 'delegated', delta), receipt),
          );
        }
      }
      yield* put(
        withRecoveryLifetime(setDelegatedParentLoaded(workspaceId, parentAgentId, true), receipt),
      );
    } finally {
      yield* put(
        withRecoveryLifetime(
          setIsLoadingDelegatedParent(workspaceId, parentAgentId, false),
          receipt,
        ),
      );
    }
  } finally {
    release();
  }
}

function* fetchDelegatedAgents(workspaceId: string, parentAgentId?: string): SagaGenerator<void> {
  if (parentAgentId) {
    yield* fetchDelegatedAgentsForParent(workspaceId, parentAgentId);
  } else {
    yield* fetchLazyBinAgents(workspaceId, 'delegated');
  }
}

function* fetchBackgroundAgents(workspaceId: string): SagaGenerator<void> {
  yield* fetchLazyBinAgents(workspaceId, 'background');
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
  const release = acquireWorkspaceActivityDemand(workspaceId);
  const key = workspaceActivityRecoveryKey(workspaceId);
  const receipt = rendererEventRecovery.capture(key);
  try {
    if (!receipt.commit(() => undefined)) return;
    yield* put(withRecoveryLifetime(eventsLoadStarted(workspaceId), receipt));
    const page: Awaited<ReturnType<typeof appClient.events.queryPage>> = yield* call(() =>
      runWorkspaceActivityRead(key, receipt, () =>
        appClient.events.queryPage(workspaceId, { limit: EVENTS_PAGE_LIMIT }),
      ),
    );
    yield* put(
      withRecoveryLifetime(
        eventsLoaded(workspaceId, [...page.items].reverse(), page.nextToken),
        receipt,
      ),
    );
  } catch (error) {
    yield* put(
      withRecoveryLifetime(
        eventsLoadFailed(workspaceId, error instanceof Error ? error.message : String(error)),
        receipt,
      ),
    );
    throw error;
  } finally {
    release();
  }
}

function* refreshOlderEvents(workspaceId: string): SagaGenerator<void> {
  const release = acquireWorkspaceActivityDemand(workspaceId);
  const key = workspaceActivityRecoveryKey(workspaceId);
  const original = rendererEventRecovery.capture(key);
  const nextToken = yield* selectOlderEventsNextToken.effect(workspaceId);
  const redux = yield* getContext<{ getState(): StoreState } | undefined>('reduxStore');
  const initialState: StoreState = yield* select();
  const historyGeneration =
    initialState.workspaceEvents.byWorkspaceId[workspaceId]?.historyGeneration;
  const cursorCurrent = (state: StoreState = redux?.getState() ?? initialState) =>
    selectOlderEventsNextToken.select(state, workspaceId) === nextToken &&
    state.workspaceEvents.byWorkspaceId[workspaceId]?.historyGeneration === historyGeneration;
  const receipt: RecoveryLifetime = {
    key: original.key,
    isCurrent: () => original.isCurrent() && cursorCurrent(),
    commit: (mutation) => cursorCurrent() && original.commit(mutation),
  };
  try {
    if (!receipt.commit(() => undefined)) return;
    if (!nextToken) {
      yield* put(withRecoveryLifetime(olderEventsLoaded(workspaceId, [], null), receipt));
      return;
    }
    const page: Awaited<ReturnType<typeof appClient.events.queryPage>> = yield* call(() =>
      runWorkspaceActivityRead(key, receipt, () => {
        if (!cursorCurrent()) throw new Error('Activity cursor superseded');
        return appClient.events.queryPage(workspaceId, { limit: EVENTS_PAGE_LIMIT, nextToken });
      }),
    );
    if (!(yield* select(cursorCurrent))) return;
    yield* put(
      withRecoveryLifetime(
        olderEventsLoaded(workspaceId, [...page.items].reverse(), page.nextToken),
        receipt,
      ),
    );
  } catch (error) {
    if (!(yield* select(cursorCurrent))) return;
    yield* put(
      withRecoveryLifetime(
        olderEventsLoadFailed(workspaceId, error instanceof Error ? error.message : String(error)),
        receipt,
      ),
    );
    throw error;
  } finally {
    release();
  }
}

function* countPeopleEvents(workspaceId: string): SagaGenerator<number> {
  return getPeopleActivity(
    workspaceId,
    yield* selectWorkspaceEvents.effect(workspaceId),
    yield* selectWorkspacePeopleIdentities.effect(workspaceId),
  ).length;
}

function* refreshPeopleEvents(
  scheduler: WorkspaceReadScheduler,
  action: ReturnType<typeof loadPeopleEventsRequested>,
): SagaGenerator<void> {
  const [workspaceId, mode, force = false] = action.payload;
  if (!workspaceId) return;
  if (mode === 'initial' && !force && (yield* selectPeopleEventsInitialized.effect(workspaceId))) {
    return;
  }
  const release = acquireWorkspaceActivityDemand(workspaceId);
  const key = workspaceActivityRecoveryKey(workspaceId);
  const receipt = rendererEventRecovery.capture(key);
  const completion = rendererEventRecovery.captureAuthority(key);
  const redux = yield* getContext<{ getState(): StoreState } | undefined>('reduxStore');
  const requestId = crypto.randomUUID();
  const dispatch = store.dispatch;
  const backendId = yield* selectActiveBackendId();
  const principal = yield* selectPrincipalActionContext.effect();
  const connection = yield* selectPrincipalConnectionContext.effect();
  function* isCurrent(): SagaGenerator<boolean> {
    return (
      receipt.commit(() => undefined) &&
      dispatch === store.dispatch &&
      backendId === (yield* selectActiveBackendId()) &&
      principal === (yield* selectPrincipalActionContext.effect()) &&
      connection === (yield* selectPrincipalConnectionContext.effect())
    );
  }
  let initialized = false;
  let error: string | null = null;
  try {
    if (!receipt.commit(() => undefined)) return;
    yield* put(withRecoveryLifetime(peopleEventsLoadStarted(workspaceId, requestId), receipt));
    yield* call(withReadSlot, scheduler, workspaceId, function* () {
      if (!(yield* isCurrent())) return;
      const target =
        PEOPLE_ROWS_PER_REQUEST + (mode === 'more' ? yield* countPeopleEvents(workspaceId) : 0);
      for (let pageIndex = 0; pageIndex < PEOPLE_MAX_PAGES_PER_REQUEST; pageIndex += 1) {
        const nextToken = yield* selectOlderEventsNextToken.effect(workspaceId);
        if (yield* selectOlderEventsEndReached.effect(workspaceId)) break;
        // Establish a cursor even when a live-only cache already has enough rows.
        if (nextToken && (yield* countPeopleEvents(workspaceId)) >= target) break;
        const initialState: StoreState = yield* select();
        const generation =
          initialState.workspaceEvents.byWorkspaceId[workspaceId]?.historyGeneration;
        const cursorCurrent = (state: StoreState = redux?.getState() ?? initialState) =>
          selectOlderEventsNextToken.select(state, workspaceId) === nextToken &&
          state.workspaceEvents.byWorkspaceId[workspaceId]?.historyGeneration === generation;
        const pageReceipt: RecoveryLifetime = {
          key: receipt.key,
          isCurrent: () => receipt.isCurrent() && cursorCurrent(),
          commit: (mutation) => cursorCurrent() && receipt.commit(mutation),
        };
        const page: Awaited<ReturnType<typeof appClient.events.queryPage>> = yield* call(() =>
          runWorkspaceActivityRead(key, pageReceipt, () =>
            appClient.events.queryPage(
              workspaceId,
              nextToken ? { limit: EVENTS_PAGE_LIMIT, nextToken } : { limit: EVENTS_PAGE_LIMIT },
            ),
          ),
        );
        if (!(yield* isCurrent()) || !(yield* select(cursorCurrent))) return;
        // Merge even the first page: the cache may already contain newer live events.
        yield* put(
          withRecoveryLifetime(
            olderEventsLoaded(workspaceId, [...page.items].reverse(), page.nextToken),
            pageReceipt,
          ),
        );
        // Invalid pages or a non-advancing server cursor must not spin or hide continuation.
        if ((yield* selectOlderEventsNextToken.effect(workspaceId)) === nextToken) break;
      }
      initialized = true;
    });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    initialized = true;
  } finally {
    try {
      const current = yield* isCurrent();
      yield* put(
        withRecoveryLifetime(
          peopleEventsLoadFinished(
            workspaceId,
            requestId,
            initialized && current && !(yield* cancelled()),
            current ? error : null,
          ),
          completion,
        ),
      );
    } finally {
      release();
    }
  }
}

function* refreshTaskAgentLinks(workspaceId: string): SagaGenerator<void> {
  const release = acquireLifecycleMetadataDemand(workspaceId, 'taskAgentLinks');
  const key = taskAgentLinksRecoveryKey(workspaceId);
  const receipt = rendererEventRecovery.capture(key);
  try {
    if (!receipt.commit(() => undefined)) return;
    const byNoteId: Awaited<ReturnType<typeof appClient.tasks.listAgentLinks>> = yield* call(() =>
      readLifecycleMetadata(key, receipt, () => appClient.tasks.listAgentLinks(workspaceId)),
    );
    yield* put(withRecoveryLifetime(hydrateTaskAgentAssociations(workspaceId, byNoteId), receipt));
  } finally {
    release();
  }
}

function* refreshSkills(workspaceId: string): SagaGenerator<void> {
  const release = acquireSkillsRecoveryDemand(workspaceId);
  const receipt = rendererEventRecovery.capture(skillsRecoveryKey(workspaceId));
  try {
    if (!receipt.commit(() => undefined)) return;
    const skills: Awaited<ReturnType<typeof appClient.skills.list>> = yield* call(() =>
      readSkillsWithRecovery(workspaceId, receipt, () => appClient.skills.list(workspaceId)),
    );
    yield* put(withRecoveryLifetime(setSkills(workspaceId, skills), receipt));
  } catch (error) {
    yield* put(
      withRecoveryLifetime(
        loadSkillsFailed(workspaceId, error instanceof Error ? error.message : String(error)),
        receipt,
      ),
    );
    throw error;
  } finally {
    release();
  }
}

/**
 * Scripts and terminals are owner-only surfaces (multiplayer w3): a
 * collaborator connection is refused with `-32003` on every read. That is a
 * stable answer, not a failure, so these reads settle to an empty list
 * instead of logging an error on every refresh.
 */
function* refreshWorkspaceScripts(workspaceId: string, append = false): SagaGenerator<void> {
  const receipt = rendererEventRecovery.capture(scriptsRecoveryKey(workspaceId));
  if (!receipt.commit(() => undefined)) return;
  const previous = yield* selectAllWorkspaceScriptEntries.effect(workspaceId);
  const ws = yield* selectScriptListPageState.effect(workspaceId);
  if (append && (!ws.nextCursor || ws.loading)) return;
  const context = yield* beginScriptRead(workspaceId);
  yield* put(withRecoveryLifetime(setScriptListState(workspaceId, true), receipt));
  try {
    const page = yield* call(() =>
      trackScriptsRecoveryRead(workspaceId, () =>
        append
          ? appClient.scripts.listPage(workspaceId, { cursor: ws.nextCursor })
          : appClient.scripts.listPage(workspaceId),
      ),
    );
    if (!receipt.commit(() => undefined)) return;
    const entries = append
      ? [...new Map([...previous, ...page.scripts].map((row) => [row.id, row])).values()]
      : page.scripts;
    const reconciled = yield* reconcileScriptRead(context, entries);
    if (!reconciled || !receipt.commit(() => undefined)) return;
    receipt.commit(() => {
      recordScriptsRecoveryPage(workspaceId, append);
    });
    yield* put(
      withRecoveryLifetime(
        scriptReadReconciled(workspaceId, context.requestId, reconciled.scripts),
        receipt,
      ),
    );
    yield* put(
      withRecoveryLifetime(setActiveScriptsData(workspaceId, reconciled.scripts), receipt),
    );
    yield* put(withRecoveryLifetime(setScriptPageCursor(workspaceId, page.nextCursor), receipt));
    yield* put(
      withRecoveryLifetime(setScriptListState(workspaceId, false, undefined, true), receipt),
    );
    yield* put(withRecoveryLifetime(setScriptsInitialized(workspaceId, true), receipt));
  } catch (error) {
    if (!receipt.commit(() => undefined) || !(yield* isScriptReadCurrent(context))) return;
    yield* put(
      withRecoveryLifetime(
        setScriptListState(
          workspaceId,
          false,
          error instanceof Error ? error.message : String(error),
        ),
        receipt,
      ),
    );
    if (!isForbiddenErrorResponse(error)) throw error;
    yield* put(withRecoveryLifetime(setScriptsData(workspaceId, []), receipt));
    yield* put(withRecoveryLifetime(setScriptsInitialized(workspaceId, true), receipt));
  } finally {
    yield* put(withRecoveryLifetime(scriptReadFinished(workspaceId, context.requestId), receipt));
  }
}

function* refreshTerminals(workspaceId: string): SagaGenerator<void> {
  const receipt = rendererEventRecovery.capture(terminalsRecoveryKey(workspaceId));
  if (!receipt.commit(() => undefined)) return;
  let result: Awaited<ReturnType<typeof appClient.terminals.list>>;
  try {
    result = yield* call([appClient.terminals, appClient.terminals.list], workspaceId);
  } catch (error) {
    if (!isForbiddenErrorResponse(error)) throw error;
    logger.debug(`Terminals are owner-only for ${workspaceId}; treating as empty`);
    // A bare empty list preserves prior tabs (daemon-restart resilience), so
    // any tabs still held for this workspace are dropped explicitly.
    const stale = yield* selectTerminalsForWorkspace.effect(workspaceId);
    for (const terminal of stale) {
      yield* put(withRecoveryLifetime(removeTerminal(workspaceId, terminal.id), receipt));
    }
    result = { terminals: [] };
  }
  yield* put(
    withRecoveryLifetime(
      Array.isArray(result)
        ? loadWorkspaceTerminals(workspaceId, result)
        : loadWorkspaceTerminals(workspaceId, result.terminals, null, result.daemonBootId),
      receipt,
    ),
  );
}

/**
 * A `-32003 Forbidden` refusal is a stable answer: retrying gets the same
 * response until the client reconnects under a different credential.
 */
function isStableWorkspaceListFailure(error: unknown): boolean {
  if (isForbiddenErrorResponse(error)) return true;
  return error instanceof Error && error.message === FORBIDDEN_ERROR_MESSAGE;
}

/**
 * Until the list has loaded for the active backend, a failed `workspace.list`
 * is retried with bounded backoff from inside the single-flight worker, so
 * the trailing-coalesce guarantee holds and reads never fan out. A
 * `backendReconnected` during the wait ends the loop early: the reconnect
 * watcher re-puts `loadWorkspacesRequested`, which either queues as this
 * worker's trailing rerun or starts a fresh one — one immediate read either
 * way. Once loaded, a later failure is logged only.
 */
function* loadWorkspacesWorker() {
  for (let attempt = 0; ; attempt++) {
    try {
      yield* refreshWorkspaces();
      return;
    } catch (error) {
      const backendId = yield* selectActiveBackendId();
      const loaded = yield* selectWorkspaceListLoadedForBackend.effect(backendId);
      if (loaded || isStableWorkspaceListFailure(error)) {
        logger.error('Refresh failed for workspaces', error);
        return;
      }
      const delayMs = WORKSPACE_LIST_RETRY_DELAYS_MS[attempt] ?? WORKSPACE_LIST_RETRY_CAP_MS;
      logger.warn('Refresh failed for workspaces; retrying', { attempt, delayMs, error });
      const { reconnected } = yield* race({
        timeout: delay(delayMs),
        reconnected: take(backendReconnected),
      });
      if (reconnected) return;
    }
  }
}

/**
 * A transport that was down at boot (guest tunnel) or dropped mid-session
 * re-requests the list once it is back; the single-flight worker coalesces it.
 */
function* backendReconnectWorkspacesWatcher(): SagaGenerator<void> {
  while (true) {
    yield* take(backendReconnected);
    for (const workspaceId of yield* selectDemandedTaskWorkspaceIds.effect()) {
      yield* put(ensureWorkspaceTasksLoaded(workspaceId));
    }
    yield* put(loadWorkspacesRequested());
    yield* call(refreshIntegrationAuthAfterReconnect);
  }
}

type TasksReadAction = ReturnType<
  | typeof acquireWorkspaceTasksDemand
  | typeof ensureWorkspaceTasksLoaded
  | typeof loadWorkspaceTasksRequested
  | typeof workspaceUnmounted
  | typeof clearWorkspaceTasks
  | typeof removeWorkspaceEntity
>;

type EventsReadAction = ReturnType<
  | typeof loadEventsRequested
  | typeof loadOlderEventsRequested
  | typeof loadPeopleEventsRequested
  | typeof workspaceUnmounted
>;
type PeopleReads = Map<string, ReturnType<typeof loadPeopleEventsRequested>>;

function tasksReadContext(action: TasksReadAction) {
  const workspaceId = action.payload[0];
  if (
    isWorkspaceCleanupAction(action) ||
    action.type === clearWorkspaceTasks.type ||
    action.type === removeWorkspaceEntity.type
  ) {
    return { context: workspaceId, cancel: true as const };
  }
  return workspaceId;
}

function* tasksWorker(scheduler: WorkspaceReadScheduler, action: TasksReadAction) {
  const original = getRecoveryLifetime(action);
  yield* runWorkspaceRead(
    scheduler,
    'tasks',
    action.payload[0],
    function* (workspaceId) {
      yield* refreshTasks(workspaceId, original);
    },
    false,
  );
}

function eventsReadContext(
  pendingInitialReads: Set<string>,
  peopleReads: PeopleReads,
  action: EventsReadAction,
) {
  const workspaceId = action.payload[0];
  if (isWorkspaceCleanupAction(action)) {
    pendingInitialReads.delete(workspaceId);
    peopleReads.delete(workspaceId);
    return { context: workspaceId || '', cancel: true as const };
  }
  if (workspaceId && action.type === loadEventsRequested.type) {
    pendingInitialReads.add(workspaceId);
  }
  if (
    workspaceId &&
    action.type === loadPeopleEventsRequested.type &&
    !peopleReads.has(workspaceId)
  ) {
    peopleReads.set(workspaceId, action as ReturnType<typeof loadPeopleEventsRequested>);
  }
  return workspaceId || '';
}

function* eventsWorker(
  scheduler: WorkspaceReadScheduler,
  pendingInitialReads: Set<string>,
  peopleReads: PeopleReads,
  action: EventsReadAction,
) {
  if (isWorkspaceCleanupAction(action)) return;
  const workspaceId = action.payload[0];
  if (pendingInitialReads.delete(workspaceId)) {
    yield* runWorkspaceRead(scheduler, 'events', workspaceId, refreshEvents, false);
  }
  if (action.type === loadOlderEventsRequested.type) {
    yield* runWorkspaceRead(scheduler, 'olderEvents', workspaceId, refreshOlderEvents, false);
  }
  const peopleRequest = peopleReads.get(workspaceId);
  if (peopleRequest) {
    try {
      yield* refreshPeopleEvents(scheduler, peopleRequest);
    } finally {
      if (peopleReads.get(workspaceId) === peopleRequest) peopleReads.delete(workspaceId);
    }
  }
}

function* tokenUsageWorker(
  scheduler: WorkspaceReadScheduler,
  action: ReturnType<typeof fetchWorkspaceTokenUsage>,
) {
  yield* runWorkspaceRead(scheduler, 'tokenUsage', action.payload[0], refreshTokenUsage);
}

function* membershipSummaryWorker(
  scheduler: WorkspaceReadScheduler,
  revisions: Map<string, symbol>,
  action: ReturnType<typeof refreshWorkspaceMembershipRequested>,
) {
  const workspaceId = action.payload[0];
  const revision = revisions.get(workspaceId);
  const isLatest = () => revisions.get(workspaceId) === revision;
  try {
    yield* runWorkspaceRead(
      scheduler,
      'membership',
      workspaceId,
      function* (id) {
        yield* refreshMembershipSummary(id, isLatest);
      },
      false,
    );
  } finally {
    if (isLatest()) revisions.delete(workspaceId);
  }
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
  | typeof refreshScripts
  | typeof loadMoreScripts
  | typeof workspaceDeleted
  | typeof workspaceUnmounted
>;

function* scriptsWorker(scheduler: WorkspaceReadScheduler, action: ScriptsReadAction) {
  if (!isWorkspaceCleanupAction(action)) {
    yield* runWorkspaceRead(
      scheduler,
      'scripts',
      action.payload[0],
      (workspaceId) => refreshWorkspaceScripts(workspaceId, action.type === loadMoreScripts.type),
      false,
    );
  }
}

type ChangesReadAction = ReturnType<
  | typeof refreshRequested
  | typeof loadWorkspaceDataRequested
  | typeof reconcileChangesRequested
  | typeof workspaceUnmounted
>;

function* changesWorker(
  scheduler: WorkspaceReadScheduler,
  reads: ChangesReads,
  demand: ChangesDemand,
  action: ChangesReadAction,
) {
  if (isWorkspaceCleanupAction(action)) return;
  const explicit = action.type !== reconcileChangesRequested.type;
  if (!explicit) yield* delay(1000);
  yield* runWorkspaceRead(
    scheduler,
    'changes',
    action.payload[0],
    function* (workspaceId) {
      yield* refreshChanges(reads, demand, workspaceId, explicit);
    },
    false,
  );
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

function* delegatedAgentsWorker(
  scheduler: WorkspaceReadScheduler,
  action: ReturnType<typeof fetchDelegatedAgentsRequested>,
) {
  const [workspaceId, parentAgentId] = action.payload;
  yield* runWorkspaceRead(scheduler, 'delegatedAgents', workspaceId, function* delegatedRead(id) {
    yield* fetchDelegatedAgents(id, parentAgentId);
  });
}

/** One leading read per workspace for the whole bin, and per parent for by-parent reads. */
function delegatedReadContextOf(action: ReturnType<typeof fetchDelegatedAgentsRequested>): string {
  const [workspaceId, parentAgentId] = action.payload;
  return parentAgentId ? `${workspaceId}::${parentAgentId}` : workspaceId;
}

function* orphanedDelegatedAgentsWorker(
  scheduler: WorkspaceReadScheduler,
  action: ReturnType<typeof fetchOrphanedDelegatedAgentsRequested>,
) {
  yield* runWorkspaceRead(
    scheduler,
    'orphanedDelegatedAgents',
    action.payload[0],
    fetchOrphanedDelegatedAgents,
  );
}

function* backgroundAgentsWorker(
  scheduler: WorkspaceReadScheduler,
  action: ReturnType<typeof fetchBackgroundAgentsRequested>,
) {
  yield* runWorkspaceRead(scheduler, 'backgroundAgents', action.payload[0], fetchBackgroundAgents);
}

function* terminalsWorker(
  scheduler: WorkspaceReadScheduler,
  action: ReturnType<typeof hydrateTerminalsRequested>,
) {
  yield* runWorkspaceRead(scheduler, 'terminals', action.payload[0], refreshTerminals);
}

function* prStatusWorker(action: ReturnType<typeof refreshPRStatusRequested>) {
  const [workspaceId, force, isManual] = action.payload;
  if (!workspaceId) return;
  try {
    yield* race({
      read: call(refreshPrStatus, workspaceId, force, isManual),
      reconnected: take(backendReconnected),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
  } catch (error) {
    logger.error(`Refresh failed for prStatus:${workspaceId}`, error);
  }
}

function* olderCommitsWorker(
  scheduler: WorkspaceReadScheduler,
  reads: ChangesReads,
  action: ReturnType<typeof loadOlderCommitsRequested>,
) {
  yield* runWorkspaceRead(scheduler, 'olderCommits', action.payload.wsId, function* (workspaceId) {
    yield* refreshOlderCommits(reads, workspaceId);
  });
}

function* agentLineStatsWorker(action: ReturnType<typeof requestAgentLineStats>) {
  const { agentId, forceRefresh } = action.payload;
  if (agentId) yield* refreshAgentStats(agentId, forceRefresh);
}

function* contextWorker(
  initializedContexts: Map<string, RecoveryLifetime>,
  action: ReturnType<typeof initContextForWorkspace>,
) {
  const [workspaceId, force] = action.payload;
  if (!workspaceId) return;
  const release = acquireLifecycleMetadataDemand(workspaceId, 'context');
  const key = contextRecoveryKey(workspaceId);
  if (force) rendererEventRecovery.push(key);
  const receipt = rendererEventRecovery.capture(key);
  try {
    // Cached data still acquires demand: loss may have dirtied its inactive owner.
    // Releasing this demand keeps any admitted recovery alive through its fence.
    if (!force && initializedContexts.get(workspaceId)?.isCurrent()) return;
    if (!receipt.commit(() => undefined)) return;
    yield* race({
      read: call(function* () {
        const items: Awaited<ReturnType<typeof appClient.workspaces.getContext>> = yield* call(() =>
          readLifecycleMetadata(key, receipt, () => appClient.workspaces.getContext(workspaceId)),
        );
        yield* put(
          withRecoveryLifetime(
            hydrateContextItems(workspaceId, Array.isArray(items) ? items : []),
            receipt,
          ),
        );
        receipt.commit(() => {
          initializedContexts.set(workspaceId, rendererEventRecovery.captureAuthority(key));
        });
      }),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
  } catch (error) {
    logger.error(`Refresh failed for context:${workspaceId}`, error);
  } finally {
    release();
  }
}

function* clearUnmountedInitializedContext(
  initializedContexts: Map<string, RecoveryLifetime>,
  action: ReturnType<typeof workspaceUnmounted>,
) {
  initializedContexts.delete(action.payload[0]);
}

export function* lifecycleReadSaga(): SagaGenerator<void> {
  const stopTaskCompletions = installTaskEventCompletionOwner();
  const changesReads: ChangesReads = new Map();
  const changesDemand: ChangesDemand = new Map();
  const membershipRevisions = new Map<string, symbol>();
  const initializedContexts = new Map<string, RecoveryLifetime>();
  const pendingInitialEventReads = new Set<string>();
  const peopleReads: PeopleReads = new Map();
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
      // Attention events stay subscribed while unfocused. Reconcile missed
      // events on transport recovery, not focus or console ownership changes.
      fork(backendReconnectWorkspacesWatcher),
      takeSingleFlightInContext(
        [
          acquireWorkspaceTasksDemand,
          ensureWorkspaceTasksLoaded,
          loadWorkspaceTasksRequested,
          workspaceUnmounted,
          clearWorkspaceTasks,
          removeWorkspaceEntity,
        ],
        tasksReadContext,
        tasksWorker,
        scheduler,
      ),
      takeSingleFlightInContext(
        [
          loadEventsRequested,
          loadOlderEventsRequested,
          loadPeopleEventsRequested,
          workspaceUnmounted,
        ],
        (action) => eventsReadContext(pendingInitialEventReads, peopleReads, action),
        eventsWorker,
        scheduler,
        pendingInitialEventReads,
        peopleReads,
      ),
      takeLeadingByWorkspace(fetchWorkspaceTokenUsage, tokenUsageWorker, scheduler),
      // Roster / invite deltas arrive in bursts (archive teardown emits one
      // frame per removed member plus one per revoked invite): single-flight
      // per workspace with one trailing re-read so the row converges on the
      // post-burst summary. Invalidate the older reply immediately: applying
      // stale rights before the trailing read could briefly restore management.
      takeSingleFlightInContext(
        refreshWorkspaceMembershipRequested,
        (action) => {
          const workspaceId = action.payload[0];
          membershipRevisions.set(workspaceId, Symbol());
          return workspaceId;
        },
        membershipSummaryWorker,
        scheduler,
        membershipRevisions,
      ),
      takeLatestByContext(
        initContextForWorkspace,
        (action) => ({
          context: action.payload[0],
          force: action.payload[1],
          generation: action.payload[2] ?? 0,
        }),
        contextWorker,
        initializedContexts,
      ),
      takeLeadingByWorkspace(
        hydrateTaskAgentAssociationsRequested,
        taskAgentLinksWorker,
        scheduler,
      ),
      takeLeadingByWorkspace(loadSkillsRequested, skillsWorker, scheduler),
      takeSingleFlightInContext(
        [refreshScripts, loadMoreScripts, workspaceDeleted, workspaceUnmounted],
        scriptsReadContext,
        scriptsWorker,
        scheduler,
      ),
      takeLeadingByWorkspace(refreshPRStatusRequested, prStatusWorker),
      takeSingleFlightInContext(
        [
          refreshRequested,
          loadWorkspaceDataRequested,
          reconcileChangesRequested,
          workspaceUnmounted,
        ],
        (action) => {
          if (isWorkspaceCleanupAction(action)) {
            changesReads.get(action.payload[0])?.stopRecovery?.();
            changesReads.delete(action.payload[0]);
            changesDemand.delete(action.payload[0]);
          }
          return workspaceReadContext(action);
        },
        changesWorker,
        scheduler,
        changesReads,
        changesDemand,
      ),
      takeEvery(changesEventReceived, receiveChangesEvent, changesReads, changesDemand),
      takeEvery(
        CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS,
        reconcileVisibleChanges,
        changesReads,
        changesDemand,
      ),
      takeEvery(backendReconnected, reconnectChanges, changesReads, changesDemand),
      takeEvery(
        [changesConsumerMounted, changesConsumerUnmounted],
        changeChangesDemand,
        changesReads,
        changesDemand,
      ),
      takeLeadingInContext(
        loadOlderCommitsRequested,
        (action) => action.payload.wsId,
        olderCommitsWorker,
        scheduler,
        changesReads,
      ),
      takeLeadingByAgent(requestAgentLineStats, agentLineStatsWorker),
      takeSingleFlightInContext(
        [hydrateAgentsRequested, workspaceUnmounted],
        workspaceReadContext,
        coalescedAgentsWorker,
        scheduler,
      ),
      takeLeadingByWorkspace(fetchRetiredAgentsRequested, retiredAgentsWorker, scheduler),
      takeLeadingInContext(
        fetchDelegatedAgentsRequested,
        delegatedReadContextOf,
        delegatedAgentsWorker,
        scheduler,
      ),
      takeLeadingByWorkspace(
        fetchOrphanedDelegatedAgentsRequested,
        orphanedDelegatedAgentsWorker,
        scheduler,
      ),
      takeLeadingByWorkspace(fetchBackgroundAgentsRequested, backgroundAgentsWorker, scheduler),
      takeLeadingByWorkspace(hydrateTerminalsRequested, terminalsWorker, scheduler),
      takeEvery(workspaceUnmounted, clearUnmountedInitializedContext, initializedContexts),
    ]);
  } finally {
    stopTaskCompletions();
    for (const entry of changesReads.values()) entry.stopRecovery?.();
    initializedContexts.clear();
    pendingInitialEventReads.clear();
    peopleReads.clear();
  }
}
