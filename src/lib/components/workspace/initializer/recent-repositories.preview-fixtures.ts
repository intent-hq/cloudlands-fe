import { appClient } from '$lib/client';
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { store as appStore } from '$store/renderer/store';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import {
  selectWorkspaceInitializerRecentRepos,
  selectWorkspaceInitializerDismissedRecentRepoKeys,
  selectWorkspaceInitializerHydrated,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
import {
  setWorkspaceInitializerRecentRepos,
  hydrateWorkspaceInitializer,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { workspaceInitializerSaga } from '$store/renderer/slices/workspace-initializer/sagas/workspace-initializer-saga';
import { invalidateCowIsolationSetting } from './cow-isolation-setting';
import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import {
  principalContextChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';

/** Isolated sources; optional real initializer saga backed by a fixture-only settings adapter. */
export function setupRecentRepositoriesPreview(persist = false, hydrationReady?: Promise<void>) {
  const previousPrincipal = appStore.state.principal;
  admitLegacyPrincipal();
  const names = [
    'app',
    'tools',
    'a-deliberately-long-repository-name-that-must-truncate-in-this-list',
  ];
  const repos = names.flatMap((name, index) => [
    {
      path: `/fixture/${name}`,
      name,
      ...(index === 1 ? { owner: 'fixture-owner' } : {}),
      addedAt: '2026-09-01T00:00:00Z',
      lastUsedAt: '2026-09-01T00:00:00Z',
    },
    {
      path: `fixture-owner/${name}`,
      name,
      owner: 'fixture-owner',
      githubUrl: `https://github.com/fixture-owner/${name}`,
      addedAt: '2026-09-01T00:00:00Z',
      lastUsedAt: '2026-09-01T00:00:00Z',
    },
  ]);
  const previousWorkspaces = selectWorkspaceItems.select(appStore.state);
  const previousRecent = selectWorkspaceInitializerRecentRepos.select(appStore.state);
  const previousDismissals = selectWorkspaceInitializerDismissedRecentRepoKeys.select(
    appStore.state,
  );
  const previousUpdateSetting = appClient.settings.update;
  const previousList = workspaceClient.list;
  const previousGetSetting = appClient.settings.get;
  workspaceClient.list = async () => ({ ok: true, data: [] });
  appClient.settings.get = async () => null;
  invalidateCowIsolationSetting();
  appStore.dispatch(setWorkspaceInitializerRecentRepos([]));
  const restoreRegistry = overrideMockIpcHandler(
    WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES,
    () => ({
      success: true,
      data: repos,
    }),
  );
  let stopPersistence: (() => void) | undefined;
  if (persist) {
    const key = 'recent-repositories-preview-settings';
    appClient.settings.get = async (path) => {
      if (path !== 'workspaceInitializer.state') return null;
      const value = hydrationReady
        ? { recentRepos: [{ path: '/fixture/app', type: 'local', name: 'app' }] }
        : JSON.parse(sessionStorage.getItem(key) ?? '{"recentRepos":[]}');
      await hydrationReady;
      return {
        path,
        label: 'Fixture initializer',
        description: '',
        category: 'workspaceInitializer',
        type: 'object',
        defaultValue: {},
        value,
        origin: 'default',
        revision: 0,
      };
    };
    appClient.settings.update = async (updates) => {
      const update = updates.find((item) => item.path === 'workspaceInitializer.state');
      if (update) sessionStorage.setItem(key, JSON.stringify(update.value));
      return [];
    };
    stopPersistence = appStore.runSaga(workspaceInitializerSaga);
  }
  return () => {
    stopPersistence?.();
    restoreRegistry();
    workspaceClient.list = previousList;
    appClient.settings.get = previousGetSetting;
    appClient.settings.update = previousUpdateSetting;
    invalidateCowIsolationSetting();
    appStore.dispatch(replaceWorkspaceList(previousWorkspaces));
    // A preview without the persistence saga may still have pending sources.
    // Settle that first so restoring the prior fixture is an ordinary hydration.
    if (!selectWorkspaceInitializerHydrated.select(appStore.state)) {
      appStore.dispatch(hydrateWorkspaceInitializer({}));
    }
    appStore.dispatch(
      hydrateWorkspaceInitializer({
        recentRepos: previousRecent,
        dismissedRecentRepoKeys: previousDismissals,
      }),
    );
    appStore.dispatch(principalContextChanged(previousPrincipal.context));
    if (previousPrincipal.context && previousPrincipal.snapshot)
      appStore.dispatch(
        principalReceived(
          { context: previousPrincipal.context, invalidation: 0, presentationVersion: 0 },
          previousPrincipal.snapshot,
        ),
      );
  };
}
