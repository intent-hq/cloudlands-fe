import { createLifecycleIpcReadSaga } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/sagas/lifecycle-ipc-read-saga-factory';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import {
  selectInstalledEditors,
  selectInstalledEditorsLoading,
  selectLastFetched,
} from '../../external-editors/external-editors-selectors';
import { selectPanels } from '../../panel-layout/panel-layout-selectors';
import { selectMultiSelectSidebarSelectedTabIds } from '../../sidebar-nav/sidebar-nav-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { selectIsWorkspaceHydrated } from '../workspace-lifecycle-selectors';
import { githubRepositoryClient } from '../../../features/github-auth/github-repository-client';
import { externalEditorsClient } from '../../../features/external-editors/external-editors-client';
import { readKnownRepositories } from '../../../features/workspace/known-repositories-read';

/** Complete inactive binding. Only an explicit lifetime owner starts this generator. */
export const lifecycleIpcReadSaga = createLifecycleIpcReadSaga({
  selectPrincipalConnectionContext,
  selectInstalledEditors,
  selectInstalledEditorsLoading,
  selectLastFetched,
  selectPanels,
  selectMultiSelectSidebarSelectedTabIds,
  selectWorkspaceById,
  selectIsWorkspaceHydrated,
  githubAuthClient: githubRepositoryClient,
  externalEditorsClient,
  invoke: (_channel, _options) => readKnownRepositories(),
});
