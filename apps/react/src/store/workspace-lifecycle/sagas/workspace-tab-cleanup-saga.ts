import {
  selectActiveWorkspaceIds,
  selectCurrentWorkspaceTabId,
} from '../../tab-state/tab-state-selectors';
import { selectIsWorkspaceSessionLive } from '../workspace-lifecycle-selectors';
import { createWorkspaceTabCleanupSaga } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/sagas/workspace-tab-cleanup-saga-factory';

export const workspaceTabCleanupSaga = createWorkspaceTabCleanupSaga({
  selectCurrentWorkspaceTabId,
  selectActiveWorkspaceIds,
  selectIsWorkspaceSessionLive,
});
