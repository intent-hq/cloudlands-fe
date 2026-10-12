import { createWorkspaceTabReconciliationSaga } from '../../../../../../src/store/renderer/slices/tab-state/sagas/workspace-tab-reconciliation-saga-factory';
import { selectWorkspaceTabsToReconcile } from '../tab-state-selectors';

/**
 * The root owner must supply real tab closing and navigation before startup.
 * React has no workspace navigation owner yet; there is deliberately no default.
 */
export function createReactWorkspaceTabReconciliationSaga(
  closeWorkspaceTabAndNavigateAway: (workspaceId: string) => Promise<void>,
) {
  return createWorkspaceTabReconciliationSaga({
    selectWorkspaceTabsToReconcile,
    closeWorkspaceTabAndNavigateAway,
  });
}
