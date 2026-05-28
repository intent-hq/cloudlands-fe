/**
 * Git Selectors
 *
 * Selectors for workspace-scoped git state.
 */

import { createSelector } from "../../utils/create-selector";
import {
  defaultGitOperationFlags,
  getGitWorkspaceState,
} from "./git-slice";
import type { GitOperationFlagName, PostMergeState } from "./git-types";

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

// ── Raw state selectors ──

export const selectGitWorkspaceState = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId)
);

export const selectGitStatus = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).status
);

export const selectGitDiffs = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).diffs
);

export const selectGitLoading = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).loading
);

export const selectGitError = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).error
);

export const selectGitBranch = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).branch
);

export const selectGitAhead = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).ahead
);

export const selectGitBehind = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).behind
);

// ── Derived selectors ──

export const selectGitHasChanges = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status ? status.files.length > 0 : false;
  }
);

export const selectGitHasUnstagedChanges = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.some((f) => !f.staged) || false;
  }
);

export const selectGitHasStagedChanges = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.some((f) => f.staged) || false;
  }
);

export const selectGitHasUnpushedCommits = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).ahead > 0
);

export const selectGitHasUnpulledCommits = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).behind > 0
);

export const selectGitUnstagedFiles = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.filter((f) => !f.staged) || [];
  }
);

export const selectGitStagedFiles = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.filter((f) => f.staged) || [];
  }
);

export const selectGitModifiedFiles = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files || [];
  }
);

export const selectGitStagedCount = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status ? status.files.filter((f) => f.staged).length : 0;
  }
);

export const selectGitUnstagedCount = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status ? status.files.filter((f) => !f.staged).length : 0;
  }
);

export const selectGitIsDiverged = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.diverged ?? false;
  }
);

// ── Git operation event selectors (absorbed from git-operations) ──

export const selectLastGitOperation = createSelector((state) => {
  return state.git.lastGitOperation;
});

export const selectLastGitError = createSelector((state) => {
  return state.git.lastGitError;
});

export const selectLastAutoCommitHookFailure = createSelector((state) => {
  return state.git.lastAutoCommitHookFailure;
});

// ── Sidebar post-merge / git operation flag selectors (moved from transient-ui) ──

export const selectPostMergeState = createSelector(
  (state, wsId: string): PostMergeState =>
    getGitWorkspaceState(state.git, wsId).postMergeState ?? defaultPostMergeState
);

export const selectGitOperationFlags = createSelector(
  (state, wsId: string) => {
    const ws = getGitWorkspaceState(state.git, wsId);
    return ws.gitOperations ?? defaultGitOperationFlags;
  }
);

export const selectGitOperationFlag = createSelector(
  (state, wsId: string, flag: GitOperationFlagName): boolean => {
    const ws = getGitWorkspaceState(state.git, wsId);
    return (ws.gitOperations ?? defaultGitOperationFlags)[flag];
  }
);
