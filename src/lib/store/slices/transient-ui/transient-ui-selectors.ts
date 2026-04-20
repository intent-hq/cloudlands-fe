import { createSelector } from "../../utils/create-selector";
import type { GitOperationFlagName } from "./transient-ui-slice";
import { emptyWorkspaceTransientUiState } from "./transient-ui-slice";
import type { PostMergeState } from "./transient-ui-slice";

const defaultPostMergeState: PostMergeState = {
  aheadOfTrunk: null,
  behindTrunk: 0,
  hasConflicts: false,
  isContentMergedToTrunk: false,
  hasRemote: true,
  isMergedToTrunk: false,
  mergeHeadSha: null,
  hasResetToTrunk: false,
};

export const selectTransientUiWorkspaceState = createSelector((state, workspaceId: string) => {
  return state.transientUi.byWorkspaceId[workspaceId] ?? emptyWorkspaceTransientUiState;
});

export const selectAcceptChangesState = createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).acceptChanges;
});

export const selectSidebarChangesState = createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).sidebarChanges;
});

export const selectPostMergeState = createSelector((state, workspaceId: string): PostMergeState => {
  return (
    selectSidebarChangesState.select(state, workspaceId).postMergeState ?? defaultPostMergeState
  );
});

export const selectSidebarActiveTab = createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).sidebarActiveTab;
});

export const selectViewedFiles = createSelector((state, workspaceId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).viewedFiles;
});

export const selectChatDraft = createSelector((state, workspaceId: string, agentId: string) => {
  return selectTransientUiWorkspaceState.select(state, workspaceId).chatDrafts[agentId] ?? "";
});

export const selectSidebarCommitWhenReady = createSelector((state, workspaceId: string) => {
  return selectSidebarChangesState.select(state, workspaceId).commitWhenReady;
});

export const selectSidebarMergeWhenReady = createSelector((state, workspaceId: string) => {
  return selectSidebarChangesState.select(state, workspaceId).mergeWhenReady;
});

export const selectPendingAutoAction = createSelector((state, workspaceId: string) => {
  return selectSidebarChangesState.select(state, workspaceId).pendingAutoAction;
});

export const selectGitOperationFlags = createSelector((state, workspaceId: string) => {
  return selectSidebarChangesState.select(state, workspaceId).gitOperations;
});

export const selectGitOperationFlag = createSelector(
  (state, workspaceId: string, flag: GitOperationFlagName) => {
    return selectGitOperationFlags.select(state, workspaceId)[flag];
  }
);