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
import { createPanelLayoutSagas } from '../../../../../../src/store/renderer/slices/panel-layout/sagas/panel-layout-saga-factory';

/** The desktop lifetime owner supplies cleanup for its own panel DOM adapter. */
export function createReactPanelLayoutSagas({
  clearPanelLayoutAdapter,
}: {
  clearPanelLayoutAdapter: (workspaceId: string) => void;
}) {
  return createPanelLayoutSagas({
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
}
