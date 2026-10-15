import { clearPanelLayoutAdapter } from '$features/layout/panel-layout-adapter';
import {
  selectAllWorkspaceAgents,
  selectAgentsLoaded,
} from '../../workspace-agents/workspace-agents-selectors';
import {
  selectIsWorkspaceCollaborator,
  selectWorkspaceManagementDenied,
} from '../../workspace/workspace-selectors';
import {
  selectSpec,
  selectWorkspaceNotesState,
} from '../../workspace-notes/workspace-notes-selectors';
import { selectPanelLayoutWorkspace, selectPanelColumnCount } from '../panel-layout-selectors';
import { createPanelLayoutSagas } from './panel-layout-saga-factory';

// Preserve the Svelte saga/registry imports until renderer cutover; the shared
// factory owns all behavior and each renderer binds exactly one lifetime.
export const {
  panelLayoutSaga,
  hydrateWorkspaceLayout,
  waitForWorkspaceLayoutRestore,
  rehydrateTunneledBrowserTabs,
  watchRightmostColumnRequests,
  isStoredLayoutValid,
} = createPanelLayoutSagas({
  selectors: {
    selectAllWorkspaceAgents,
    selectAgentsLoaded,
    selectIsWorkspaceCollaborator,
    selectWorkspaceManagementDenied,
    selectSpec,
    selectWorkspaceNotesState,
    selectPanelLayoutWorkspace,
    selectPanelColumnCount,
  },
  clearPanelLayoutAdapter,
});
