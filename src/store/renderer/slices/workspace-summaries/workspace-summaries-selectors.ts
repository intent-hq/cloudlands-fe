/**
 * Workspace Summaries Selectors
 *
 * Component API for on-demand diff/git summaries fetched from the
 * WORKSPACE_CHANNELS.GET_DIFF_SUMMARY / GET_GIT_SUMMARY endpoints.
 */

import { store } from "../../store";
import type { WorkspaceDiffSummary, WorkspaceGitSummary } from "$shared/types";

export const selectWorkspaceDiffSummary = store.createSelector(
  (state, workspaceId: string): WorkspaceDiffSummary | null =>
    state.workspaceSummaries.byWorkspaceId[workspaceId]?.diffSummary ?? null,
);

export const selectWorkspaceGitSummary = store.createSelector(
  (state, workspaceId: string): WorkspaceGitSummary | null =>
    state.workspaceSummaries.byWorkspaceId[workspaceId]?.gitSummary ?? null,
);

