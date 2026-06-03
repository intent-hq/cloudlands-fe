/**
 * Git Selectors
 *
 * Selectors for workspace-scoped git state.
 */

import { store } from "../../store";
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

export const selectGitWorkspaceState = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId)
);

export const selectGitStatus = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).status
);

export const selectGitDiffs = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).diffs
);

export const selectGitLoading = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).loading
);

export const selectGitError = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).error
);

export const selectGitBranch = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).branch
);

export const selectGitAhead = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).ahead
);

export const selectGitBehind = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).behind
);

// ── Derived selectors ──

export const selectGitHasChanges = store.createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status ? status.files.length > 0 : false;
  }
);

export const selectGitHasUnstagedChanges = store.createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.some((f) => !f.staged) || false;
  }
);

export const selectGitHasStagedChanges = store.createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.some((f) => f.staged) || false;
  }
);

export const selectGitHasUnpushedCommits = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).ahead > 0
);

export const selectGitHasUnpulledCommits = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).behind > 0
);

export const selectGitUnstagedFiles = store.createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.filter((f) => !f.staged) || [];
  }
);

export const selectGitStagedFiles = store.createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.filter((f) => f.staged) || [];
  }
);

export const selectGitModifiedFiles = store.createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files || [];
  }
);

export const selectGitStagedCount = store.createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status ? status.files.filter((f) => f.staged).length : 0;
  }
);

export const selectGitUnstagedCount = store.createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status ? status.files.filter((f) => !f.staged).length : 0;
  }
);

export const selectGitIsDiverged = store.createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.diverged ?? false;
  }
);

// ── Git operation event selectors (absorbed from git-operations) ──

export const selectLastGitOperation = store.createSelector((state) => {
  return state.git.lastGitOperation;
});

export const selectLastGitError = store.createSelector((state) => {
  return state.git.lastGitError;
});

export const selectLastAutoCommitHookFailure = store.createSelector((state) => {
  return state.git.lastAutoCommitHookFailure;
});

// ── Sidebar post-merge / git operation flag selectors (moved from transient-ui) ──

export const selectPostMergeState = store.createSelector(
  (state, wsId: string): PostMergeState =>
    getGitWorkspaceState(state.git, wsId).postMergeState ?? defaultPostMergeState
);

export const selectGitOperationFlags = store.createSelector(
  (state, wsId: string) => {
    const ws = getGitWorkspaceState(state.git, wsId);
    return ws.gitOperations ?? defaultGitOperationFlags;
  }
);

export const selectGitOperationFlag = store.createSelector(
  (state, wsId: string, flag: GitOperationFlagName): boolean => {
    const ws = getGitWorkspaceState(state.git, wsId);
    return (ws.gitOperations ?? defaultGitOperationFlags)[flag];
  }
);
