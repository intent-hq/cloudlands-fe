/**
 * Workspace Summaries Saga
 *
 * Fetches on-demand diff/git summaries through the
 * WORKSPACE_CHANNELS.GET_DIFF_SUMMARY / GET_GIT_SUMMARY endpoints. Consumers
 * (e.g., hover cards) dispatch loadWorkspaceSummariesRequested when they need
 * fresh data; results are kept per workspace and stale values remain visible
 * while a refresh is in flight.
 */

import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";
import { WorkspaceId } from "$shared/types/branded-ids";
import type { WorkspaceDiffSummary, WorkspaceGitSummary } from "$shared/types";
import { call, fork, put, takeEvery } from "typed-redux-saga";
import {
  loadWorkspaceSummariesFailed,
  loadWorkspaceSummariesRequested,
  loadWorkspaceSummariesSucceeded,
} from "../workspace-summaries-slice";

export function* handleLoadWorkspaceSummariesRequested(
  action: ReturnType<typeof loadWorkspaceSummariesRequested>
) {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;

  try {
    const diffResult = yield* call(
      [workspaceClient, workspaceClient.getDiffSummary],
      WorkspaceId(workspaceId)
    );
    const gitResult = yield* call(
      [workspaceClient, workspaceClient.getGitSummary],
      WorkspaceId(workspaceId)
    );

    if (!diffResult.ok && !gitResult.ok) {
      yield* put(loadWorkspaceSummariesFailed(workspaceId, diffResult.error));
      return;
    }

    const diffSummary: WorkspaceDiffSummary | null = diffResult.ok
      ? (diffResult.data ?? null)
      : null;
    const gitSummary: WorkspaceGitSummary | null = gitResult.ok
      ? (gitResult.data ?? null)
      : null;

    yield* put(loadWorkspaceSummariesSucceeded(workspaceId, diffSummary, gitSummary));
  } catch (error) {
    yield* put(
      loadWorkspaceSummariesFailed(
        workspaceId,
        error instanceof Error ? error.message : "Unknown error"
      )
    );
  }
}

export function* watchLoadWorkspaceSummariesRequestedSaga() {
  yield* takeEvery(loadWorkspaceSummariesRequested, handleLoadWorkspaceSummariesRequested);
}

export function* workspaceSummariesSaga() {
  yield* fork(watchLoadWorkspaceSummariesRequestedSaga);
}

