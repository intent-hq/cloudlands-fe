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
import type { PostMergeState } from "./git-types";

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

export const selectGitStatus = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).status
);

export const selectGitAhead = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).ahead
);

export const selectGitBehind = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).behind
);

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
