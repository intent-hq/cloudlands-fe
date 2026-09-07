import type { Task } from 'redux-saga';
import type { SagaGenerator } from 'typed-redux-saga';
import {
  all,
  call,
  cancel,
  delay,
  fork,
  put,
  race,
  take,
  takeEvery,
  takeLeading,
} from 'typed-redux-saga';

import { externalEditorsClient } from '$features/external-editors/external-editors.client';
import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import type { GithubRepo } from '$features/github-auth/types';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { CHIEF_WORKSPACE_ID, ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { KnownRepo } from '$shared/types/known-repo';
import { loadWorkspaceDataRequested, setHasLoadedInitialData } from '../../changes/changes-slice';
import { connectionsListReceived } from '../../connections/connections-slice';
import { hydrateContextItems, initContextForWorkspace } from '../../context/context-slice';
import {
  CACHE_TTL_MS,
  clearError,
  fetchEditors,
  fetchEditorsFailure,
  fetchEditorsSuccess,
  setLoading,
} from '../../external-editors/external-editors-slice';
import {
  selectInstalledEditors,
  selectInstalledEditorsLoading,
  selectLastFetched,
} from '../../external-editors/external-editors-selectors';
import {
  hydrateFileExplorerRequested,
  setFileExplorerError,
  setFileExplorerLoading,
} from '../../file-explorer/file-explorer-slice';
import {
  loadGithubRepos,
  setGithubRepos,
  setGithubReposError,
  setGithubReposLoading,
  type GithubRepoItem,
} from '../../github-repos/github-repos-slice';
import { loadKnownRepos, setRepos } from '../../known-repos/known-repos-slice';
import { selectPanels } from '../../panel-layout/panel-layout-selectors';
import {
  prStatusRefreshCompleted,
  refreshPRStatusRequested,
} from '../../pr-status/pr-status-slice';
import { refreshScripts, setScriptsInitialized } from '../../scripts/scripts-slice';
import { selectMultiSelectSidebarSelectedTabIds } from '../../sidebar-nav/sidebar-nav-selectors';
import { loadSkillsFailed, loadSkillsRequested, setSkills } from '../../skills/skills-slice';
import {
  hydrateTaskAgentAssociations,
  hydrateTaskAgentAssociationsRequested,
} from '../../task-agent-associations/task-agent-associations-slice';
import { hydrateTerminalsRequested, loadWorkspaceTerminals } from '../../terminals/terminals-slice';
import {
  hydrateAgentsRequested,
  setAgentsLoaded,
} from '../../workspace-agents/workspace-agents-slice';
import {
  eventsLoaded,
  eventsLoadFailed,
  loadEventsRequested,
} from '../../workspace-events/workspace-events-slice';
import {
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  workspaceNotesHydrationRequested,
} from '../../workspace-notes/workspace-notes-slice';
import {
  ensureWorkspaceTasksLoaded,
  loadWorkspaceTasksFailed,
  loadWorkspaceTasksRequested,
  loadWorkspaceTasksSucceeded,
} from '../../workspace-tasks/workspace-tasks-slice';
import { selectActiveBackendId } from '../../../utils/backend-storage-namespace';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { setWorkspaceEntity } from '../../workspace/workspace-slice';
import {
  backendReconnected,
  workspaceHydrationBranchRequested,
  workspaceHydrationRequested,
  workspaceMounted,
  workspaceUnmounted,
  type WorkspaceHydrationBranch,
} from '../workspace-lifecycle-slice';
import { selectIsWorkspaceHydrated } from '../workspace-lifecycle-selectors';
import {
  createWorkspaceHydrationTierScheduler,
  WORKSPACE_HYDRATION_IDLE_FALLBACK_MS,
  type WorkspaceHydrationConsumers,
  type WorkspaceHydrationTierScheduler,
} from './workspace-read-scheduler';

const logger = createLogger('LifecycleIpcReadSaga');

type KnownReposResponse = { success: boolean; data?: KnownRepo[] };

function normalizeRepo(repo: GithubRepo): GithubRepoItem {
  return {
    id: `${repo.owner}/${repo.name}`,
    owner: repo.owner,
    name: repo.name,
    defaultBranch: repo.default_branch,
  };
}

function* refreshGithubRepos(): SagaGenerator<void> {
  yield* put(setGithubReposLoading());
  try {
    const repos: Awaited<ReturnType<typeof githubAuthClient.listRepos>> = yield* call([
      githubAuthClient,
      githubAuthClient.listRepos,
    ]);
    yield* put(setGithubRepos(repos.map(normalizeRepo)));
  } catch (error) {
    yield* put(setGithubReposError(error instanceof Error ? error.message : String(error)));
  }
}

function* refreshEditors(forceRefresh: boolean): SagaGenerator<void> {
  const loading = yield* selectInstalledEditorsLoading.effect();
  if (loading) return;
  if (!forceRefresh) {
    const editors = yield* selectInstalledEditors.effect();
    const lastFetched = yield* selectLastFetched.effect();
    if (editors.length > 0 && Date.now() - lastFetched < CACHE_TTL_MS) return;
  }
  yield* put(clearError());
  yield* put(setLoading(true));
  try {
    const editors: Awaited<ReturnType<typeof externalEditorsClient.detectInstalled>> = yield* call(
      [externalEditorsClient, externalEditorsClient.detectInstalled],
      forceRefresh,
    );
    yield* put(fetchEditorsSuccess(editors, Date.now()));
  } catch (error) {
    yield* put(fetchEditorsFailure(error instanceof Error ? error.message : String(error)));
  } finally {
    yield* put(setLoading(false));
  }
}

function* refreshKnownRepos(): SagaGenerator<void> {
  try {
    const result: KnownReposResponse = yield* call(
      invoke<KnownReposResponse>,
      IPC_CHANNELS.WORKSPACE.GET_RECENT_REPOSITORIES,
      {},
    );
    if (result.success && Array.isArray(result.data)) yield* put(setRepos(result.data));
    else logger.warn('Recent-repositories IPC returned no usable data; keeping prior known repos');
  } catch (error) {
    logger.error('Failed to load known repos; keeping prior known repos', error);
  }
}

function* readHydrationConsumers(workspaceId: string): SagaGenerator<WorkspaceHydrationConsumers> {
  const panels = yield* selectPanels.effect(workspaceId);
  const activePanelTypes = Object.values(panels).flatMap((panel) => {
    const tab = panel.tabs.find((candidate) => candidate.id === panel.activeTabId);
    return tab ? [tab.type] : [];
  });
  const visibleSidebarTabs = yield* selectMultiSelectSidebarSelectedTabIds.effect(workspaceId);
  return { activePanelTypes, visibleSidebarTabs };
}

function* putHydrationBranches(
  workspaceId: string,
  generation: number,
  force: boolean,
  branches: readonly WorkspaceHydrationBranch[],
): SagaGenerator<void> {
  for (const branch of branches) {
    yield* put(workspaceHydrationBranchRequested(workspaceId, branch, generation, force));
  }
}

function* deferredHydrationWorker(
  scheduler: WorkspaceHydrationTierScheduler,
  workspaceId: string,
  generation: number,
): SagaGenerator<void> {
  yield* delay(WORKSPACE_HYDRATION_IDLE_FALLBACK_MS);
  const due = scheduler.flush(workspaceId, generation);
  if (due) yield* putHydrationBranches(workspaceId, due.generation, due.force, due.branches);
}

type DeferredHydrationTaskSlot = { generation: number; task?: Task };

interface DeferredHydrationCoordinator {
  tasks: Map<string, DeferredHydrationTaskSlot>;
  generations: Map<string, number>;
}

function* cancelDeferredHydrationWorker(
  coordinator: DeferredHydrationCoordinator,
  workspaceId: string,
): SagaGenerator<void> {
  const active = coordinator.tasks.get(workspaceId);
  if (!active) return;
  coordinator.tasks.delete(workspaceId);
  if (active.task?.isRunning()) yield* cancel(active.task);
}

function* startDeferredHydrationWorker(
  scheduler: WorkspaceHydrationTierScheduler,
  coordinator: DeferredHydrationCoordinator,
  workspaceId: string,
  generation: number,
): SagaGenerator<void> {
  const active = coordinator.tasks.get(workspaceId);
  if (active && active.generation > generation) return;
  yield* cancelDeferredHydrationWorker(coordinator, workspaceId);
  const slot: DeferredHydrationTaskSlot = { generation };
  coordinator.tasks.set(workspaceId, slot);
  const task = yield* fork(function* trackedDeferredHydrationWorker(): SagaGenerator<void> {
    try {
      yield* deferredHydrationWorker(scheduler, workspaceId, generation);
    } finally {
      if (coordinator.tasks.get(workspaceId) === slot) {
        coordinator.tasks.delete(workspaceId);
      }
    }
  });
  slot.task = task;
  if (!task.isRunning() && coordinator.tasks.get(workspaceId) === slot) {
    coordinator.tasks.delete(workspaceId);
  }
}

type ObservedHydrationAction = { type: string; payload?: unknown };

function workspaceHasResolvedPath(workspace: {
  worktreePath?: string;
  repositoryPath?: string;
  path?: string;
}): boolean {
  return [workspace.worktreePath, workspace.repositoryPath, workspace.path].some((path) =>
    Boolean(path?.trim()),
  );
}

function isWorkspaceEntityResolution(
  action: ObservedHydrationAction,
  workspaceId: string,
): boolean {
  if (action.type !== setWorkspaceEntity.type || !Array.isArray(action.payload)) return false;
  const workspace = action.payload[0];
  return (
    workspace != null &&
    typeof workspace === 'object' &&
    'id' in workspace &&
    workspace.id === workspaceId
  );
}

function isHydrationPathWaitInvalidated(
  action: ObservedHydrationAction,
  workspaceId: string,
  branch: WorkspaceHydrationBranch,
  generation: number,
): boolean {
  if (action.type === backendReconnected.type) return true;
  if (!Array.isArray(action.payload) || action.payload[0] !== workspaceId) return false;
  if (action.type === workspaceUnmounted.type || action.type === workspaceMounted.type) return true;
  return (
    action.type === workspaceHydrationBranchRequested.type &&
    action.payload[1] === branch &&
    action.payload[2] !== generation
  );
}

function* waitForResolvedWorkspacePath(
  coordinator: DeferredHydrationCoordinator,
  workspaceId: string,
  branch: WorkspaceHydrationBranch,
  generation: number,
): SagaGenerator<boolean> {
  if (workspaceId === CHIEF_WORKSPACE_ID || workspaceId === ROOT_WORKSPACE_ID) return false;
  while (coordinator.generations.get(workspaceId) === generation) {
    const workspace = yield* selectWorkspaceById.effect(workspaceId);
    if (workspace && workspaceHasResolvedPath(workspace)) return true;
    const { action } = yield* race({
      action: take(
        (candidate: ObservedHydrationAction) =>
          isWorkspaceEntityResolution(candidate, workspaceId) ||
          isHydrationPathWaitInvalidated(candidate, workspaceId, branch, generation),
      ),
      timeout: delay(WORKSPACE_HYDRATION_IDLE_FALLBACK_MS),
    });
    if (!action) return false;
    if (isHydrationPathWaitInvalidated(action, workspaceId, branch, generation)) return false;
  }
  return false;
}

function* dispatchHydrationBranch(
  coordinator: DeferredHydrationCoordinator,
  action: ReturnType<typeof workspaceHydrationBranchRequested>,
): SagaGenerator<void> {
  const [workspaceId, branch, generation, force] = action.payload;
  if (
    (branch === 'skills' || branch === 'fileExplorer') &&
    !(yield* waitForResolvedWorkspacePath(coordinator, workspaceId, branch, generation))
  ) {
    return;
  }
  switch (branch) {
    case 'tasks':
      yield* put(
        force ? loadWorkspaceTasksRequested(workspaceId) : ensureWorkspaceTasksLoaded(workspaceId),
      );
      break;
    case 'events':
      yield* put(loadEventsRequested(workspaceId));
      break;
    case 'scripts':
      yield* put(refreshScripts(workspaceId));
      break;
    case 'skills':
      yield* put(loadSkillsRequested(workspaceId));
      break;
    case 'prStatus':
      yield* put(refreshPRStatusRequested(workspaceId, force, false));
      break;
    case 'changes':
      yield* put(loadWorkspaceDataRequested(workspaceId));
      break;
    case 'agents':
      yield* put(hydrateAgentsRequested(workspaceId));
      break;
    case 'terminals':
      yield* put(hydrateTerminalsRequested(workspaceId));
      break;
    case 'fileExplorer':
      yield* put(hydrateFileExplorerRequested(workspaceId, force, generation));
      break;
    case 'context':
      yield* put(initContextForWorkspace(workspaceId, force, generation));
      break;
    case 'taskAgentLinks':
      yield* put(hydrateTaskAgentAssociationsRequested(workspaceId));
      break;
    case 'notes':
      yield* put(workspaceNotesHydrationRequested(workspaceId, action.payload[2], force));
      break;
  }
}

function* refreshEditorsWorker(action: ReturnType<typeof fetchEditors>): SagaGenerator<void> {
  yield* refreshEditors(Boolean(action.payload[0]));
}

function* workspaceMountedWorker(
  scheduler: WorkspaceHydrationTierScheduler,
  mountedWorkspaceIds: Set<string>,
  coordinator: DeferredHydrationCoordinator,
  action: ReturnType<typeof workspaceMounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  mountedWorkspaceIds.add(workspaceId);
  const consumers = yield* readHydrationConsumers(workspaceId);
  const started = scheduler.start(workspaceId, consumers);
  coordinator.generations.set(workspaceId, started.generation);
  yield* putHydrationBranches(workspaceId, started.generation, false, started.branches);
  yield* startDeferredHydrationWorker(scheduler, coordinator, workspaceId, started.generation);
}

function workspaceIdFromConsumerAction(action: { payload?: unknown }): string | null {
  const payload = action.payload;
  if (Array.isArray(payload)) return typeof payload[0] === 'string' ? payload[0] : null;
  if (payload && typeof payload === 'object' && 'wsId' in payload) {
    const wsId = (payload as { wsId?: unknown }).wsId;
    return typeof wsId === 'string' ? wsId : null;
  }
  return null;
}

function isConsumerVisibilityAction(action: { type: string }): boolean {
  return action.type.startsWith('panelLayout/') || action.type.startsWith('sidebarNav/');
}

function* promoteVisibleConsumers(
  scheduler: WorkspaceHydrationTierScheduler,
  action: { type: string; payload?: unknown },
): SagaGenerator<void> {
  const workspaceId = workspaceIdFromConsumerAction(action);
  if (!workspaceId || !scheduler.hasPending(workspaceId)) return;
  const consumers = yield* readHydrationConsumers(workspaceId);
  const due = scheduler.promote(workspaceId, consumers);
  if (due) yield* putHydrationBranches(workspaceId, due.generation, due.force, due.branches);
}

function* workspaceUnmountedWorker(
  scheduler: WorkspaceHydrationTierScheduler,
  mountedWorkspaceIds: Set<string>,
  coordinator: DeferredHydrationCoordinator,
  action: ReturnType<typeof workspaceUnmounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  mountedWorkspaceIds.delete(workspaceId);
  scheduler.cancel(workspaceId);
  coordinator.generations.delete(workspaceId);
  yield* cancelDeferredHydrationWorker(coordinator, workspaceId);
}

function* restartMountedHydration(
  scheduler: WorkspaceHydrationTierScheduler,
  mountedWorkspaceIds: Set<string>,
  coordinator: DeferredHydrationCoordinator,
): SagaGenerator<void> {
  scheduler.reset();
  for (const workspaceId of [...coordinator.tasks.keys()]) {
    yield* cancelDeferredHydrationWorker(coordinator, workspaceId);
  }
  for (const workspaceId of mountedWorkspaceIds) {
    const consumers = yield* readHydrationConsumers(workspaceId);
    const started = scheduler.start(workspaceId, consumers, true);
    coordinator.generations.set(workspaceId, started.generation);
    yield* putHydrationBranches(workspaceId, started.generation, true, started.branches);
    yield* startDeferredHydrationWorker(scheduler, coordinator, workspaceId, started.generation);
  }
}

function* backendReconnectHydrationWatcher(
  scheduler: WorkspaceHydrationTierScheduler,
  mountedWorkspaceIds: Set<string>,
  coordinator: DeferredHydrationCoordinator,
): SagaGenerator<void> {
  while (true) {
    yield* take(backendReconnected);
    yield* restartMountedHydration(scheduler, mountedWorkspaceIds, coordinator);
  }
}

function* settleHydrationBranch(
  scheduler: WorkspaceHydrationTierScheduler,
  action: { type: string; payload?: unknown },
): SagaGenerator<void> {
  const payload = action.payload;
  const tuplePayload = Array.isArray(payload) ? payload : null;
  const prStatusPayload =
    action.type === prStatusRefreshCompleted.type &&
    payload != null &&
    typeof payload === 'object' &&
    !Array.isArray(payload)
      ? (payload as { wsId?: unknown; success?: unknown })
      : null;
  const first = tuplePayload?.[0];
  const workspaceId =
    typeof prStatusPayload?.wsId === 'string'
      ? prStatusPayload.wsId
      : Array.isArray(first)
        ? first[0]
        : first;
  if (typeof workspaceId !== 'string') return;
  const failureTypes = new Set([
    loadWorkspaceTasksFailed.type,
    eventsLoadFailed.type,
    loadSkillsFailed.type,
    loadWorkspaceNotesFailed.type,
  ]);
  const mappings: Partial<Record<string, WorkspaceHydrationBranch>> = {
    [loadWorkspaceTasksSucceeded.type]: 'tasks',
    [loadWorkspaceTasksFailed.type]: 'tasks',
    [eventsLoaded.type]: 'events',
    [eventsLoadFailed.type]: 'events',
    [setScriptsInitialized.type]: 'scripts',
    [setSkills.type]: 'skills',
    [loadSkillsFailed.type]: 'skills',
    [prStatusRefreshCompleted.type]: 'prStatus',
    [setHasLoadedInitialData.type]: 'changes',
    [setAgentsLoaded.type]: 'agents',
    [loadWorkspaceTerminals.type]: 'terminals',
    [setFileExplorerLoading.type]: 'fileExplorer',
    [setFileExplorerError.type]: 'fileExplorer',
    [hydrateContextItems.type]: 'context',
    [hydrateTaskAgentAssociations.type]: 'taskAgentLinks',
    [loadWorkspaceNotesSucceeded.type]: 'notes',
    [loadWorkspaceNotesFailed.type]: 'notes',
  };
  const branch = mappings[action.type];
  if (!branch) return;
  if (action.type === setFileExplorerLoading.type && tuplePayload?.[1] !== false) return;
  if (action.type === setFileExplorerError.type && tuplePayload?.[1] == null) return;
  const failed =
    failureTypes.has(action.type) ||
    (action.type === prStatusRefreshCompleted.type && prStatusPayload?.success === false) ||
    action.type === setFileExplorerError.type;
  scheduler.settle(workspaceId, branch, failed ? 'failure' : 'success');
}

const hydrationSettleActionTypes = new Set([
  loadWorkspaceTasksSucceeded.type,
  loadWorkspaceTasksFailed.type,
  eventsLoaded.type,
  eventsLoadFailed.type,
  setScriptsInitialized.type,
  setSkills.type,
  loadSkillsFailed.type,
  prStatusRefreshCompleted.type,
  setHasLoadedInitialData.type,
  setAgentsLoaded.type,
  loadWorkspaceTerminals.type,
  setFileExplorerLoading.type,
  setFileExplorerError.type,
  hydrateContextItems.type,
  hydrateTaskAgentAssociations.type,
  loadWorkspaceNotesSucceeded.type,
  loadWorkspaceNotesFailed.type,
]);

function isHydrationSettleAction(action: { type: string }): boolean {
  return hydrationSettleActionTypes.has(action.type);
}

function* workspaceHydrationRequestedWorker(
  action: ReturnType<typeof workspaceHydrationRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId || (yield* selectIsWorkspaceHydrated.effect(workspaceId))) return;

  yield* put(workspaceMounted(workspaceId));
}

function* backendIdentityChangedWorker(
  scheduler: WorkspaceHydrationTierScheduler,
  mountedWorkspaceIds: Set<string>,
  coordinator: DeferredHydrationCoordinator,
  backend: { id: string },
): SagaGenerator<void> {
  const nextBackendId = yield* selectActiveBackendId();
  if (nextBackendId === backend.id) return;
  backend.id = nextBackendId;
  yield* restartMountedHydration(scheduler, mountedWorkspaceIds, coordinator);
}

export function* lifecycleIpcReadSaga(): SagaGenerator<void> {
  const scheduler = createWorkspaceHydrationTierScheduler();
  const mountedWorkspaceIds = new Set<string>();
  const coordinator: DeferredHydrationCoordinator = { tasks: new Map(), generations: new Map() };
  const backend = { id: yield* selectActiveBackendId() };
  yield* all([
    takeLeading(loadGithubRepos, refreshGithubRepos),
    takeLeading(fetchEditors, refreshEditorsWorker),
    takeLeading(loadKnownRepos, refreshKnownRepos),
    takeEvery(workspaceHydrationRequested, workspaceHydrationRequestedWorker),
    takeEvery(
      workspaceMounted,
      workspaceMountedWorker,
      scheduler,
      mountedWorkspaceIds,
      coordinator,
    ),
    takeEvery(
      workspaceUnmounted,
      workspaceUnmountedWorker,
      scheduler,
      mountedWorkspaceIds,
      coordinator,
    ),
    takeEvery(workspaceHydrationBranchRequested, dispatchHydrationBranch, coordinator),
    takeEvery(isConsumerVisibilityAction, promoteVisibleConsumers, scheduler),
    takeEvery(isHydrationSettleAction, settleHydrationBranch, scheduler),
    fork(backendReconnectHydrationWatcher, scheduler, mountedWorkspaceIds, coordinator),
    takeEvery(
      connectionsListReceived,
      backendIdentityChangedWorker,
      scheduler,
      mountedWorkspaceIds,
      coordinator,
      backend,
    ),
  ]);
}
