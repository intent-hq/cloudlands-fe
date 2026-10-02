import { call, takeEvery } from 'typed-redux-saga';
import {
  openWorkspaceFile,
  openWorkspaceDiff,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { store } from '$store/renderer/store';
import { prWorkflowSaga } from '$store/renderer/slices/pr-workflow/sagas/pr-workflow-saga';
import { installChangesSummaryMocks } from '$lib/components/workspace/sidebar/changes-summary.preview-fixtures';

/** Preview mode omits app roots; branch fixtures and the refresh owner share this lifetime. */
export function setupChangesSummaryPreview(
  workspaceId: string,
  branch: string,
  admittedOwner = true,
  onNavigation?: (action: { type: string; payload: unknown }) => void,
) {
  const restoreMocks = installChangesSummaryMocks(workspaceId, branch, admittedOwner);
  const stopWorkflow = store.runSaga(prWorkflowSaga);
  const stopNavigation = onNavigation
    ? store.runSaga(function* () {
        yield* takeEvery(
          [openWorkspaceFile.type, openWorkspaceDiff.type],
          function* (action: { type: string; payload: unknown }) {
            yield* call(onNavigation, action);
          },
        );
      })
    : undefined;
  return () => {
    stopNavigation?.();
    stopWorkflow();
    restoreMocks();
  };
}
