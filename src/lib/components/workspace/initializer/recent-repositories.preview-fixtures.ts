import { appClient } from '$lib/client';
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { store as appStore } from '$store/renderer/store';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { selectWorkspaceInitializerRecentRepos } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
import { setWorkspaceInitializerRecentRepos } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { invalidateCowIsolationSetting } from './cow-isolation-setting';
import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import {
  principalContextChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';

/** Preview-only adapters: no daemon calls, persistence, or application sagas. */
export function setupRecentRepositoriesPreview() {
  const previousPrincipal = appStore.state.principal;
  // This isolated fixture represents an admitted owner connection; no app sagas run here.
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
  return () => {
    restoreRegistry();
    workspaceClient.list = previousList;
    appClient.settings.get = previousGetSetting;
    invalidateCowIsolationSetting();
    appStore.dispatch(replaceWorkspaceList(previousWorkspaces));
    appStore.dispatch(setWorkspaceInitializerRecentRepos(previousRecent));
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
