import type { SagaGenerator } from 'typed-redux-saga';
import { all, call, put, takeEvery, takeLeading } from 'typed-redux-saga';

import { externalEditorsClient } from '$features/external-editors/external-editors.client';
import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import type { GithubRepo } from '$features/github-auth/types';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { KnownRepo } from '$shared/types/known-repo';
import { loadWorkspaceDataRequested } from '../../changes/changes-slice';
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
import { workspaceHydrationRequested, workspaceMounted } from '../workspace-lifecycle-slice';
import { selectIsWorkspaceHydrated } from '../workspace-lifecycle-selectors';

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

function* fanOutWorkspaceMounted(workspaceId: string): SagaGenerator<void> {
  yield* put(ensureWorkspaceTasksLoaded(workspaceId));
  yield* put(loadEventsRequested(workspaceId));
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

function* refreshEditorsWorker(action: ReturnType<typeof fetchEditors>): SagaGenerator<void> {
  yield* refreshEditors(Boolean(action.payload[0]));
}

function* workspaceMountedWorker(action: ReturnType<typeof workspaceMounted>): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (workspaceId) yield* fanOutWorkspaceMounted(workspaceId);
}

function* workspaceHydrationRequestedWorker(
  action: ReturnType<typeof workspaceHydrationRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId || (yield* selectIsWorkspaceHydrated.effect(workspaceId))) return;

  yield* put(workspaceMounted(workspaceId));
}

export function* lifecycleIpcReadSaga(): SagaGenerator<void> {
  yield* all([
    takeLeading(loadGithubRepos, refreshGithubRepos),
    takeLeading(fetchEditors, refreshEditorsWorker),
    takeLeading(loadKnownRepos, refreshKnownRepos),
    takeEvery(workspaceHydrationRequested, workspaceHydrationRequestedWorker),
    takeEvery(workspaceMounted, workspaceMountedWorker),
  ]);
}
