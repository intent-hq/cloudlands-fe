import type { SagaGenerator } from 'typed-redux-saga';
import { all, call, delay, put } from 'typed-redux-saga';
import { takeLatestInContext } from '$store/renderer/utils/context-saga-effects';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import { replaceWorkspaceList } from '../../workspace/workspace-slice';
import {
  selectCanAdministerHost,
  selectPrincipalActionContext,
} from '../../principal/principal-selectors';
import { invoke } from '$lib/electron-bridge';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import type { RecentRepositoriesClient } from '$lib/components/workspace/initializer/recent-repositories-client';
import { getRecentRepoIdentity } from '$lib/components/workspace/initializer/recent-repo-display';
import { debugConfig } from '$lib/config/debug';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import { performanceMonitor } from '$lib/utils/performance';
import { createLogger } from '$lib/utils/client-logger';
import { handleError } from '$lib/utils/error-handling';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { parseGitHubUrl } from '$lib/utils/workspace-validation';
import {
  fetchGitHubRepoConfigSetupScript,
  fetchRepoConfigSetupScript,
  toRepoConfigSubset,
} from '$features/setup-scripts/repo-config';
import type { KnownRepo } from '$shared/types/known-repo';
import type { RepositoryTarget } from '$shared/types/repository-context';
import {
  selectWorkspaceInitializerDirectoryStatusCheck,
  selectWorkspaceInitializerHydrated,
  selectWorkspaceInitializerRecentRepoRefresh,
  selectWorkspaceInitializerRecentRepos,
  selectWorkspaceInitializerRepoConfigProbe,
} from '../workspace-initializer-selectors';
import {
  setWorkspaceInitializerRecentRepos,
  workspaceInitializerDirectoryStatusFinished,
  workspaceInitializerDirectoryStatusRequested,
  workspaceInitializerRecentReposRefreshFinished,
  workspaceInitializerRecentReposRefreshRequested,
  workspaceInitializerRepoConfigProbeFinished,
  workspaceInitializerRepoConfigProbeRequested,
} from '../workspace-initializer-slice';
import { checkoutRepoConfigRequested } from '../../repository-checkout/repository-checkout-slice';
import type { WorkspaceInitializerDirectoryStatus } from '../workspace-initializer-types';
import {
  aggregateRecentRepositories,
  recentRepositoryOriginPaths,
} from '../utils/recent-repository-refresh';

const logger = createLogger('WorkspaceInitializerRepositorySaga');

async function readRegistry(): Promise<{ success: boolean; data?: KnownRepo[] } | null> {
  try {
    return await invoke(WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES, {});
  } catch {
    return null;
  }
}

async function readRecentSources() {
  return Promise.all([workspaceClient.list({ lite: true }), readRegistry()] as const);
}

async function readOrigins(
  client: RecentRepositoriesClient,
  paths: string[],
  gitlabInstance?: string,
): Promise<Map<string, RepositoryTarget | null>> {
  return new Map(
    await Promise.all(
      paths.map(async (path) => {
        const url = await client.git.originUrl(path);
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
    const [workspaceList, registry] = yield* call(readRecentSources);
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
    if (workspaceList.ok && publish) {
      yield* put(
        replaceWorkspaceList(workspaces, {
          complete: workspaceList.complete === true,
          deletionTokens,
        }),
      );
    }
    if (!(yield* call(refreshCurrent, id, requestId, admission, dispatch))) return;
    const origins = yield* call(
      readOrigins,
      client,
      recentRepositoryOriginPaths(workspaces, registryRepos),
      gitlabInstance,
    );
    if (!(yield* call(refreshCurrent, id, requestId, admission, dispatch))) return;
    const repos = aggregateRecentRepositories(
      yield* selectWorkspaceInitializerRecentRepos.effect(),
      workspaces,
      registryRepos,
      origins,
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
  if (!isElectronPlatform()) {
    yield* put(workspaceInitializerDirectoryStatusFinished(id, requestId, 'unsupported', null));
    return;
  }
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

function* repoConfigProbeCurrent(id: string, requestId: string, admission: string) {
  const current = yield* selectWorkspaceInitializerRepoConfigProbe.effect(id);
  return (
    current?.requestId === requestId &&
    current.admission === admission &&
    (yield* selectPrincipalActionContext.effect()) === admission
  );
}

function* probeRepoConfigWorker(
  action: ReturnType<typeof workspaceInitializerRepoConfigProbeRequested>,
) {
  const [id, requestId, admission, input] = action.payload;
  if (input.debounce) yield* delay(300);
  if (!(yield* call(repoConfigProbeCurrent, id, requestId, admission))) return;
  const { identity, checkout } = input;
  try {
    let script: string | null = null;
    if (checkout) {
      const read = checkoutRepoConfigRequested(checkout.formId, checkout.scopeKey, checkout.query);
      yield* put(read);
      const result = yield* call(() => read.promise);
      if (result.status !== 'ready') throw new Error('REPOSITORY_CONFIG_UNAVAILABLE');
      script = toRepoConfigSubset(result.value.config).setupScript;
    } else if (identity.type === 'local' && identity.path?.startsWith('/')) {
      script = yield* call(fetchRepoConfigSetupScript, identity.path);
    } else if (identity.type === 'github' && identity.path) {
      const github = parseGitHubUrl(identity.githubUrl || identity.path);
      if (github) {
        script = yield* call(
          fetchGitHubRepoConfigSetupScript,
          github.owner,
          github.repo,
          identity.branch || undefined,
        );
      }
    }
    if (!(yield* call(repoConfigProbeCurrent, id, requestId, admission))) return;
    yield* put(workspaceInitializerRepoConfigProbeFinished(id, requestId, 'ready', script));
  } catch {
    if (yield* call(repoConfigProbeCurrent, id, requestId, admission)) {
      yield* put(workspaceInitializerRepoConfigProbeFinished(id, requestId, 'failed', null));
    }
  }
}

export function* workspaceInitializerRepositorySaga(client: RecentRepositoriesClient = appClient) {
  yield* all([
    takeLatestInContext(
      workspaceInitializerRecentReposRefreshRequested,
      (action) => action.payload[0],
      refreshRecentRepositoriesWorker,
      client,
    ),
    takeLatestInContext(
      workspaceInitializerDirectoryStatusRequested,
      (action) => action.payload[0],
      checkDirectoryStatusWorker,
    ),
    takeLatestInContext(
      workspaceInitializerRepoConfigProbeRequested,
      (action) => action.payload[0],
      probeRepoConfigWorker,
    ),
  ]);
}
