import type { SagaGenerator } from 'typed-redux-saga';
import { all, call, delay, put, takeEvery } from 'typed-redux-saga';
import { takeLatestInContext } from '$store/renderer/utils/context-saga-effects';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import { replaceWorkspaceList } from '../../workspace/workspace-slice';
import {
  selectWorkspaceItems,
  selectWorkspaceListCurrentForAdmission,
} from '../../workspace/workspace-selectors';
import {
  selectCanAdministerHost,
  selectPrincipalActionContext,
  selectWorkspaceCreationVisible,
} from '../../principal/principal-selectors';
import { invoke } from '$lib/electron-bridge';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import type { RecentRepositoriesClient } from '$lib/components/workspace/initializer/recent-repositories-client';
import { getRecentRepoIdentity } from '$lib/components/workspace/initializer/recent-repo-display';
import { debugConfig } from '$lib/config/debug';
import { performanceMonitor } from '$lib/utils/performance';
import { createLogger } from '$lib/utils/client-logger';
import { handleError } from '$lib/utils/error-handling';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { Workspace } from '$shared/types';
import type { KnownRepo } from '$shared/types/known-repo';
import type { RepositoryTarget } from '$shared/types/repository-context';
import {
  selectKnownReposGitLabInstance,
  selectWorkspaceInitializerDirectoryStatusCheck,
  selectWorkspaceInitializerHydrated,
  selectWorkspaceInitializerRecentRepoRefresh,
  selectWorkspaceInitializerRecentRepos,
} from '../workspace-initializer-selectors';
import {
  ensureKnownReposLoaded,
  setWorkspaceInitializerRecentRepos,
  workspaceInitializerDirectoryStatusFinished,
  workspaceInitializerDirectoryStatusRequested,
  workspaceInitializerRecentReposRefreshFinished,
  workspaceInitializerRecentReposRefreshRequested,
} from '../workspace-initializer-slice';
import type { WorkspaceInitializerDirectoryStatus } from '../workspace-initializer-types';
import {
  aggregateRecentRepositories,
  recentRepositoryOriginPaths,
} from '../utils/recent-repository-refresh';
import { decideKnownReposLoad, KNOWN_REPOS_REFRESH_ID } from '../utils/known-repos';

const logger = createLogger('WorkspaceInitializerRepositorySaga');

async function readRegistry(): Promise<{ success: boolean; data?: KnownRepo[] } | null> {
  try {
    return await invoke(WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES, {});
  } catch {
    return null;
  }
}

/** A list already current for the admission is reused instead of read again. */
async function readRecentSources(stored: Workspace[] | null) {
  return Promise.all([
    stored
      ? { ok: true as const, data: stored, complete: true, stored: true }
      : workspaceClient.list({ lite: true }),
    readRegistry(),
  ] as const);
}

/**
 * Origin URLs per repo path for one admission, shared by every picker and
 * palette refresh; a new admission starts over. `originUrl` folds failures
 * into `null`, so a missing origin is read again next time.
 */
type OriginCache = { admission: string | null; urls: Map<string, Promise<string | null>> };

async function readOrigins(
  client: RecentRepositoriesClient,
  cache: OriginCache,
  admission: string,
  paths: string[],
  gitlabInstance?: string,
): Promise<Map<string, RepositoryTarget | null>> {
  if (cache.admission !== admission) {
    cache.admission = admission;
    cache.urls = new Map();
  }
  const { urls } = cache;
  return new Map(
    await Promise.all(
      paths.map(async (path) => {
        let read = urls.get(path);
        if (!read) {
          read = client.git.originUrl(path);
          urls.set(path, read);
        }
        const url = await read;
        if (url === null && urls.get(path) === read) urls.delete(path);
        return [
          path,
          url
            ? getRecentRepoIdentity(
                { path, type: 'local', name: '', githubUrl: url },
                gitlabInstance,
              )
            : null,
        ] as const;
      }),
    ),
  );
}

function* refreshCurrent(
  id: string,
  requestId: string,
  admission: string,
  dispatch: typeof appStore.dispatch,
) {
  const current = yield* selectWorkspaceInitializerRecentRepoRefresh.effect(id);
  return (
    current?.requestId === requestId &&
    current.admission === admission &&
    appStore.dispatch === dispatch &&
    (yield* selectPrincipalActionContext.effect()) === admission
  );
}

function* refreshRecentRepositoriesWorker(
  client: RecentRepositoriesClient,
  origins: OriginCache,
  action: ReturnType<typeof workspaceInitializerRecentReposRefreshRequested>,
): SagaGenerator<void> {
  const [id, requestId, admission, gitlabInstance] = action.payload;
  const dispatch = appStore.dispatch;
  performanceMonitor.start('loadRecentRepos');
  try {
    if (!(yield* call(refreshCurrent, id, requestId, admission, dispatch))) return;
    if (debugConfig.get('simulateSlowNetwork')) {
      yield* delay(debugConfig.get('networkDelay') || 0);
      if (!(yield* call(refreshCurrent, id, requestId, admission, dispatch))) return;
    }
    const previous = yield* selectWorkspaceInitializerRecentRepoRefresh.effect(id);
    const deletionTokens = { ...appStore.state.workspace.deletionTokens };
    const stored = (yield* selectWorkspaceListCurrentForAdmission.effect(admission))
      ? yield* selectWorkspaceItems.effect()
      : null;
    const [workspaceList, registry] = yield* call(readRecentSources, stored);
    if (!(yield* call(refreshCurrent, id, requestId, admission, dispatch))) return;
    if (!workspaceList.ok && !registry?.success) {
      yield* put(
        workspaceInitializerRecentReposRefreshFinished(
          id,
          requestId,
          'failed',
          previous?.repos ?? [],
          previous?.workspaces ?? [],
          previous?.registryRepos ?? [],
        ),
      );
      return;
    }
    const workspaces = workspaceList.ok ? workspaceList.data : (previous?.workspaces ?? []);
    const registryRepos = registry?.success
      ? (registry.data ?? [])
      : (previous?.registryRepos ?? []);
    const publish =
      !(yield* selectCanAdministerHost.effect()) ||
      (yield* selectWorkspaceInitializerHydrated.effect());
    if (workspaceList.ok && !('stored' in workspaceList) && publish) {
      yield* put(
        replaceWorkspaceList(workspaces, {
          complete: workspaceList.complete === true,
          deletionTokens,
        }),
      );
    }
    if (!(yield* call(refreshCurrent, id, requestId, admission, dispatch))) return;
    const repoOrigins = yield* call(
      readOrigins,
      client,
      origins,
      admission,
      recentRepositoryOriginPaths(workspaces, registryRepos),
      gitlabInstance,
    );
    if (!(yield* call(refreshCurrent, id, requestId, admission, dispatch))) return;
    const repos = aggregateRecentRepositories(
      yield* selectWorkspaceInitializerRecentRepos.effect(),
      workspaces,
      registryRepos,
      repoOrigins,
      gitlabInstance,
    );
    if (publish) yield* put(setWorkspaceInitializerRecentRepos(repos));
    yield* put(
      workspaceInitializerRecentReposRefreshFinished(
        id,
        requestId,
        'ready',
        repos,
        workspaces,
        registryRepos,
      ),
    );
  } catch (error) {
    if (!(yield* call(refreshCurrent, id, requestId, admission, dispatch))) return;
    const current = yield* selectWorkspaceInitializerRecentRepoRefresh.effect(id);
    logger.error(
      'Failed to load recent repositories',
      handleError(error, { component: 'RepoSelector', action: 'loadRecentRepos' }),
    );
    yield* put(
      workspaceInitializerRecentReposRefreshFinished(
        id,
        requestId,
        'failed',
        current?.repos ?? [],
        current?.workspaces ?? [],
        current?.registryRepos ?? [],
      ),
    );
  } finally {
    performanceMonitor.end('loadRecentRepos');
  }
}

function* directoryCurrent(id: string, requestId: string, admission: string) {
  const current = yield* selectWorkspaceInitializerDirectoryStatusCheck.effect(id);
  return (
    current?.requestId === requestId &&
    current.admission === admission &&
    (yield* selectPrincipalActionContext.effect()) === admission
  );
}

function* checkDirectoryStatusWorker(
  action: ReturnType<typeof workspaceInitializerDirectoryStatusRequested>,
) {
  const [id, requestId, admission, path] = action.payload;
  yield* delay(300);
  if (!(yield* call(directoryCurrent, id, requestId, admission))) return;
  // The bridge forwards to the daemon's host.directoryStatus in every build.
  try {
    const response = yield* call(
      invoke<{ success: boolean; data?: WorkspaceInitializerDirectoryStatus }>,
      IPC_CHANNELS.FILE.GET_DIRECTORY_STATUS,
      { path },
    );
    if (!(yield* call(directoryCurrent, id, requestId, admission))) return;
    yield* put(
      workspaceInitializerDirectoryStatusFinished(
        id,
        requestId,
        response.success && response.data ? 'ready' : 'failed',
        response.success && response.data ? response.data : null,
      ),
    );
  } catch {
    if (yield* call(directoryCurrent, id, requestId, admission)) {
      yield* put(workspaceInitializerDirectoryStatusFinished(id, requestId, 'failed', null));
    }
  }
}

/** One shared full load for the palette: reuse a running one, throttle a fresh one. */
export function* knownReposLoadSaga() {
  let readyAt: { requestId: string; at: number } | null = null;
  yield* all([
    takeEvery(
      workspaceInitializerRecentReposRefreshFinished,
      function* (action: ReturnType<typeof workspaceInitializerRecentReposRefreshFinished>) {
        const [id, requestId, status] = action.payload;
        if (id === KNOWN_REPOS_REFRESH_ID && status === 'ready') {
          readyAt = { requestId, at: Date.now() };
        }
      },
    ),
    takeEvery(ensureKnownReposLoaded, function* () {
      const admission = yield* selectPrincipalActionContext.effect();
      const decision = decideKnownReposLoad({
        visible: yield* selectWorkspaceCreationVisible.effect(),
        admission,
        entry: yield* selectWorkspaceInitializerRecentRepoRefresh.effect(KNOWN_REPOS_REFRESH_ID),
        readyAt,
        now: Date.now(),
      });
      if (decision !== 'load' || !admission) return;
      yield* put(
        workspaceInitializerRecentReposRefreshRequested(
          KNOWN_REPOS_REFRESH_ID,
          crypto.randomUUID(),
          admission,
          yield* selectKnownReposGitLabInstance.effect(),
        ),
      );
    }),
  ]);
}

export function* workspaceInitializerRepositorySaga(client: RecentRepositoriesClient = appClient) {
  const origins: OriginCache = { admission: null, urls: new Map() };
  yield* all([
    call(knownReposLoadSaga),
    takeLatestInContext(
      workspaceInitializerRecentReposRefreshRequested,
      (action) => action.payload[0],
      refreshRecentRepositoriesWorker,
      client,
      origins,
    ),
    takeLatestInContext(
      workspaceInitializerDirectoryStatusRequested,
      (action) => action.payload[0],
      checkDirectoryStatusWorker,
    ),
  ]);
}
