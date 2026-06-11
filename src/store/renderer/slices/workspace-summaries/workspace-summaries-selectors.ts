/**
 * Workspace Summaries Selectors
 *
 * Component API for on-demand diff/git summaries fetched from the
 * WORKSPACE_CHANNELS.GET_DIFF_SUMMARY / GET_GIT_SUMMARY endpoints.
 */

import { store } from "../../store";
import type { WorkspaceDiffSummary, WorkspaceGitSummary } from "$shared/types";
import { emptyWorkspaceSummariesState } from "./workspace-summaries-slice";
import type { WorkspaceSummariesWorkspaceState } from "./workspace-summaries-types";

export const selectWorkspaceSummariesState = store.createSelector(
  (state, workspaceId: string): WorkspaceSummariesWorkspaceState =>
    state.workspaceSummaries.byWorkspaceId[workspaceId] ?? emptyWorkspaceSummariesState,
);

export const selectWorkspaceDiffSummary = store.createSelector(
  (state, workspaceId: string): WorkspaceDiffSummary | null =>
    state.workspaceSummaries.byWorkspaceId[workspaceId]?.diffSummary ?? null,
);

export const selectWorkspaceGitSummary = store.createSelector(
  (state, workspaceId: string): WorkspaceGitSummary | null =>
    state.workspaceSummaries.byWorkspaceId[workspaceId]?.gitSummary ?? null,
);

export const selectWorkspaceSummariesLoading = store.createSelector(
  (state, workspaceId: string): boolean =>
    state.workspaceSummaries.byWorkspaceId[workspaceId]?.loading ?? false,
);

export const selectWorkspaceSummariesInitialized = store.createSelector(
  (state, workspaceId: string): boolean =>
    state.workspaceSummaries.byWorkspaceId[workspaceId]?.initialized ?? false,
);

