import type { Task } from 'redux-saga';
import type { SagaGenerator } from 'typed-redux-saga';
import { call, cancel, fork, put, take } from 'typed-redux-saga';

import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
import { externalEditorsClient } from '$features/external-editors/external-editors.client';
import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import type { GithubRepo } from '$features/github-auth/types';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { KnownRepo } from '$shared/types/known-repo';
import { loadWorkspaceDataRequested, refreshAcceptChangesStatus } from '../../changes/changes-slice';
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
import { hydrateFileExplorerRequested } from '../../file-explorer/file-explorer-slice';
import { setPostMergeState } from '../../git/git-slice';
import { selectPostMergeState } from '../../git/git-selectors';
import type { PostMergeState } from '../../git/git-types';
import {
  loadGithubRepos,
  setGithubRepos,
  setGithubReposError,
  setGithubReposLoading,
  type GithubRepoItem,
} from '../../github-repos/github-repos-slice';
import { loadKnownRepos, setRepos } from '../../known-repos/known-repos-slice';
import { refreshPRStatusRequested } from '../../pr-status/pr-status-slice';
import { refreshScripts } from '../../scripts/scripts-slice';
import { loadSkillsRequested } from '../../skills/skills-slice';
import { hydrateTaskAgentAssociationsRequested } from '../../task-agent-associations/task-agent-associations-slice';
import { hydrateTerminalsRequested } from '../../terminals/terminals-slice';
import { hydrateAgentsRequested } from '../../workspace-agents/workspace-agents-slice';
import { loadEventsRequested } from '../../workspace-events/workspace-events-slice';
import { ensureWorkspaceTasksLoaded } from '../../workspace-tasks/workspace-tasks-slice';
import { initContextForWorkspace } from '../../context/context-slice';
import { workspaceMounted } from '../workspace-lifecycle-slice';

const logger = createLogger('LifecycleIpcReadSaga');

const triggers = [
  loadGithubRepos,
  fetchEditors,
  loadKnownRepos,
  refreshAcceptChangesStatus,
  workspaceMounted,
];

type LifecycleIpcAction = ReturnType<(typeof triggers)[number]>;
type RunningRead = { task?: Task; token: symbol };
type KnownReposResponse = { success: boolean; data?: KnownRepo[] };

function tupleString(action: { payload?: unknown }): string | undefined {
  const value = Array.isArray(action.payload) ? action.payload[0] : undefined;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function keyFor(action: LifecycleIpcAction): string | undefined {
  if (action.type === loadGithubRepos.type) return 'githubRepos';
  if (action.type === fetchEditors.type) return 'editors';
  if (action.type === loadKnownRepos.type) return 'knownRepos';
  const workspaceId = tupleString(action);
  if (!workspaceId) return undefined;
  if (action.type === refreshAcceptChangesStatus.type) return `acceptChanges:${workspaceId}`;
  if (action.type === workspaceMounted.type) return `workspaceMount:${workspaceId}`;
  return undefined;
}

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
    const repos: Awaited<ReturnType<typeof githubAuthClient.listRepos>> = yield* call(
      [githubAuthClient, githubAuthClient.listRepos],
    );
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

function* refreshAcceptChanges(workspaceId: string): SagaGenerator<void> {
  const current: PostMergeState = yield* selectPostMergeState.effect(workspaceId);
  try {
    const status: Awaited<ReturnType<typeof AcceptChangesClient.getStatus>> = yield* call(
      [AcceptChangesClient, AcceptChangesClient.getStatus],
      workspaceId as WorkspaceId,
    );
    yield* put(setPostMergeState(workspaceId, {
      ...current,
      aheadOfTrunk: status.aheadOfTrunk,
      behindTrunk: status.behindTrunk,
      hasConflicts: status.hasConflicts,
      hasRemote: status.hasRemote,
      isContentMergedToTrunk: status.isContentMergedToTrunk ?? false,
    }));
  } catch (error) {
    logger.warn('Failed to fetch accept-changes status', { workspaceId, error });
    yield* put(setPostMergeState(workspaceId, {
      ...current,
      aheadOfTrunk: null,
      behindTrunk: 0,
      hasConflicts: false,
      isContentMergedToTrunk: false,
    }));
  }
}

function* fanOutWorkspaceMounted(workspaceId: string): SagaGenerator<void> {
  yield* put(ensureWorkspaceTasksLoaded(workspaceId));
  yield* put(loadEventsRequested(workspaceId));
  yield* put(refreshAcceptChangesStatus(workspaceId));
  yield* put(refreshScripts(workspaceId));
  yield* put(loadSkillsRequested(workspaceId));
  yield* put(refreshPRStatusRequested(workspaceId, false, false));
  yield* put(loadWorkspaceDataRequested(workspaceId));
  yield* put(hydrateAgentsRequested(workspaceId));
  yield* put(hydrateTerminalsRequested(workspaceId));
  yield* put(hydrateFileExplorerRequested(workspaceId));
  yield* put(initContextForWorkspace(workspaceId));
  yield* put(hydrateTaskAgentAssociationsRequested(workspaceId));
}

function* lifecycleIpcReadWorker(action: LifecycleIpcAction): SagaGenerator<void> {
  if (action.type === loadGithubRepos.type) return yield* call(refreshGithubRepos);
  if (action.type === fetchEditors.type) {
    const forceRefresh = Array.isArray(action.payload) ? Boolean(action.payload[0]) : false;
    return yield* call(refreshEditors, forceRefresh);
  }
  if (action.type === loadKnownRepos.type) return yield* call(refreshKnownRepos);
  const workspaceId = tupleString(action);
  if (!workspaceId) return;
  if (action.type === refreshAcceptChangesStatus.type) {
    return yield* call(refreshAcceptChanges, workspaceId);
  }
  if (action.type === workspaceMounted.type) yield* call(fanOutWorkspaceMounted, workspaceId);
}

export function* lifecycleIpcReadSaga(): SagaGenerator<void> {
  const running = new Map<string, RunningRead>();
  try {
    while (true) {
      const action: LifecycleIpcAction = yield* take(triggers);
      const key = keyFor(action);
      if (!key || running.has(key)) continue;
      const token = Symbol(key);
      running.set(key, { token });
      const task = yield* fork(function* () {
        try {
          yield* call(lifecycleIpcReadWorker, action);
        } finally {
          if (running.get(key)?.token === token) running.delete(key);
        }
      });
      if (running.get(key)?.token === token) running.set(key, { task, token });
    }
  } finally {
    for (const read of running.values()) if (read.task) yield* cancel(read.task);
    running.clear();
  }
}