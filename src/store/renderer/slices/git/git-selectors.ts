/**
 * Git Selectors
 *
 * Selectors for workspace-scoped git state.
 */

import { store } from "../../store";
import type { AppSelector } from "../../types";
import {
  defaultGitOperationFlags,
  getGitWorkspaceState,
} from "./git-slice";
import type { GitOperationFlags, PostMergeState, SecondaryRootGitState } from "./git-types";
import type { GitStatus } from "$shared/types";

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

export const selectGitStatus: AppSelector<GitStatus | null, [wsId: string]> =
  store.createSelector(
    (state, wsId: string) => getGitWorkspaceState(state.git, wsId).status
  );

export const selectGitAhead: AppSelector<number, [wsId: string]> =
  store.createSelector(
    (state, wsId: string) => getGitWorkspaceState(state.git, wsId).ahead
  );

export const selectGitBehind: AppSelector<number, [wsId: string]> =
  store.createSelector(
    (state, wsId: string) => getGitWorkspaceState(state.git, wsId).behind
  );

const emptySecondaryRootState: SecondaryRootGitState = {
  status: null,
  commits: [],
  commitFiles: {},
  loading: false,
  error: null,
};
export { emptySecondaryRootState };

export const selectSecondaryRootGitRoots: AppSelector<
  Record<string, SecondaryRootGitState>,
  [wsId: string]
> = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).secondaryRoots
);

// ── Sidebar post-merge / git operation flag selectors (moved from transient-ui) ──

export const selectPostMergeState: AppSelector<PostMergeState, [wsId: string]> =
  store.createSelector(
    (state, wsId: string): PostMergeState =>
      getGitWorkspaceState(state.git, wsId).postMergeState ?? defaultPostMergeState
  );

export const selectGitOperationFlags: AppSelector<GitOperationFlags, [wsId: string]> =
  store.createSelector(
    (state, wsId: string) => {
      const ws = getGitWorkspaceState(state.git, wsId);
      return ws.gitOperations ?? defaultGitOperationFlags;
    }
  );
