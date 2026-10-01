import { store } from '$store/renderer/store';
import { prWorkflowSaga } from '$store/renderer/slices/pr-workflow/sagas/pr-workflow-saga';
import { installChangesSummaryMocks } from '$lib/components/workspace/sidebar/changes-summary.preview-fixtures';

/** Preview mode omits app roots; branch fixtures and the refresh owner share this lifetime. */
export function setupChangesSummaryPreview(
  workspaceId: string,
  branch: string,
  admittedOwner = true,
) {
  const restoreMocks = installChangesSummaryMocks(workspaceId, branch, admittedOwner);
  const stopWorkflow = store.runSaga(prWorkflowSaga);
  return () => {
    stopWorkflow();
    restoreMocks();
  };
}
