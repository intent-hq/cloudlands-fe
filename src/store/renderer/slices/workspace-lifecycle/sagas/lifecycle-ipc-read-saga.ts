import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { externalEditorsClient } from '$features/external-editors/external-editors.client';
import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import { invoke } from '$lib/electron-bridge';
import {
  selectInstalledEditors,
  selectInstalledEditorsLoading,
  selectLastFetched,
} from '../../external-editors/external-editors-selectors';
import { selectPanels } from '../../panel-layout/panel-layout-selectors';
import { selectMultiSelectSidebarSelectedTabIds } from '../../sidebar-nav/sidebar-nav-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { selectIsWorkspaceHydrated } from '../workspace-lifecycle-selectors';
import { createLifecycleIpcReadSaga } from './lifecycle-ipc-read-saga-factory';

/**
 * Svelte compatibility binding for the existing renderer root. Keep the sole
 * receiver here until that root is retired at the production React cutover.
 */
export const lifecycleIpcReadSaga = createLifecycleIpcReadSaga({
  selectPrincipalConnectionContext,
  selectInstalledEditors,
  selectInstalledEditorsLoading,
  selectLastFetched,
  selectPanels,
  selectMultiSelectSidebarSelectedTabIds,
  selectWorkspaceById,
  selectIsWorkspaceHydrated,
  githubAuthClient,
  externalEditorsClient,
  invoke,
});
