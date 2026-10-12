import {
  selectActiveWorkspaceIds,
  selectCurrentWorkspaceTabId,
} from '../../tab-state/tab-state-selectors';
import { selectIsWorkspaceSessionLive } from '../workspace-lifecycle-selectors';
import { createWorkspaceTabCleanupSaga } from './workspace-tab-cleanup-saga-factory';

// Compatibility binding for the existing root saga until the Svelte renderer is retired.
export const workspaceTabCleanupSaga = createWorkspaceTabCleanupSaga({
  selectCurrentWorkspaceTabId,
  selectActiveWorkspaceIds,
  selectIsWorkspaceSessionLive,
});
