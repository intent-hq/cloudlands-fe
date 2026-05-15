/**
 * Accept Changes Status Saga
 *
 * Fetches AcceptChangesClient.getStatus() on workspace mount and on
 * explicit refresh requests, then dispatches setPostMergeState with the results.
 *
 * This replaces the $effect in SidebarChangesPanel.svelte that was doing the
 * same async call reactively.
 */

import {
  call,
  put,
  takeLatest,
  type SagaGenerator,
} from "typed-redux-saga";
import { createLogger } from "$lib/utils/client-logger";
import { AcceptChangesClient } from "$features/accept-changes/accept-changes.client";
import type { WorkspaceId } from "$shared/types/branded-ids";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { refreshAcceptChangesStatus } from "../../changes/changes-slice";
import { setPostMergeState } from "../../git/git-slice";
import { selectPostMergeState } from "../../git/git-selectors";

const logger = createLogger("AcceptChangesStatusSaga");

/**
 * Fetch accept-changes status for a workspace and dispatch post-merge state update.
 */
export function* handleFetchAcceptChangesStatus(
  workspaceId: string,
): SagaGenerator<void> {
  try {
    const status = yield* call(
      [AcceptChangesClient, AcceptChangesClient.getStatus],
      workspaceId as WorkspaceId,
    );
    // Merge with current state to preserve fields not returned by getStatus
    // (e.g. isMergedToTrunk, mergeHeadSha, hasResetToTrunk)
    const current = yield* selectPostMergeState.effect(workspaceId);
    yield* put(
      setPostMergeState(workspaceId, {
        ...current,
        aheadOfTrunk: status.aheadOfTrunk,
        behindTrunk: status.behindTrunk,
        hasConflicts: status.hasConflicts,
        hasRemote: status.hasRemote,
        isContentMergedToTrunk: status.isContentMergedToTrunk ?? false,
      }),
    );
  } catch (error) {
    logger.warn("Failed to fetch accept-changes status", { workspaceId, error });
    const current = yield* selectPostMergeState.effect(workspaceId);
    yield* put(
      setPostMergeState(workspaceId, {
        ...current,
        aheadOfTrunk: null,
        behindTrunk: 0,
        hasConflicts: false,
        isContentMergedToTrunk: false,
      }),
    );
  }
}

function* handleWorkspaceMounted(
  action: ReturnType<typeof workspaceMounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* call(handleFetchAcceptChangesStatus, workspaceId);
}

function* handleRefreshAcceptChangesStatus(
  action: ReturnType<typeof refreshAcceptChangesStatus>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* call(handleFetchAcceptChangesStatus, workspaceId);
}

export function* acceptChangesStatusSaga(): SagaGenerator<void> {
  // takeLatest so rapid workspace switches cancel stale fetches
  yield* takeLatest(workspaceMounted, handleWorkspaceMounted);
  yield* takeLatest(refreshAcceptChangesStatus, handleRefreshAcceptChangesStatus);
}
