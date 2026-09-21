/**
 * Git Selectors
 *
 * Selectors for workspace-scoped git state.
 */

import { store } from '../../store';
import type { AppSelector } from '../../types';
import { defaultGitOperationFlags, getGitWorkspaceState } from './git-slice';
import type { GitOperationFlags, PostMergeState } from './git-types';
import type { GitStatus } from '$shared/types';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { CommitFile } from '$features/file-tracking/types';
import type { CommitInfo } from '$shared/types';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';

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

export const selectGitStatus: AppSelector<GitStatus | null, [wsId: string]> = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).status,
);

export const selectGitAhead: AppSelector<number, [wsId: string]> = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).ahead,
);

export const selectGitBehind: AppSelector<number, [wsId: string]> = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).behind,
);

export type SecondaryRootGitViewState = {
  status: GitStatus | null;
  commits: CommitInfo[];
  nextToken?: string;
  commitFiles: Record<string, CommitFile[] | null>;
  loading: boolean;
  error: string | null;
};

const emptySecondaryRootState: SecondaryRootGitViewState = {
  status: null,
  commits: [],
  commitFiles: {},
  loading: false,
  error: null,
};
export { emptySecondaryRootState };

export const selectSecondaryRootGitRoots: AppSelector<
  Record<string, SecondaryRootGitViewState>,
  [wsId: string]
> = store.createSelector((state, wsId: string) =>
  Object.fromEntries(
    Object.entries(getGitWorkspaceState(state.git, wsId).secondaryRoots).map(
      ([gitRootId, root]): [string, SecondaryRootGitViewState] => [
        gitRootId,
        {
          ...root,
          commits: getItems(root.commits),
          commitFiles: Object.fromEntries(
            getItems(root.commitFiles).map(({ commitHash, files }) => [
              commitHash,
              files ? getItems(files) : null,
            ]),
          ),
        },
      ],
    ),
  ),
);

// ── Sidebar post-merge / git operation flag selectors (moved from transient-ui) ──

export const selectPostMergeState: AppSelector<PostMergeState, [wsId: string]> =
  store.createSelector(
    (state, wsId: string): PostMergeState =>
      getGitWorkspaceState(state.git, wsId).postMergeState ?? defaultPostMergeState,
  );

export const selectAcceptChangesStatus: AppSelector<WorkspaceGitStatus | null, [wsId: string]> =
  store.createSelector(
    (state, wsId: string) => getGitWorkspaceState(state.git, wsId).acceptChangesStatus,
  );

export const selectAcceptChangesStatusLoading: AppSelector<boolean, [wsId: string]> =
  store.createSelector(
    (state, wsId: string) => getGitWorkspaceState(state.git, wsId).acceptChangesStatusLoading,
  );

export const selectGitOperationFlags: AppSelector<GitOperationFlags, [wsId: string]> =
  store.createSelector((state, wsId: string) => {
    const ws = getGitWorkspaceState(state.git, wsId);
    return ws.gitOperations ?? defaultGitOperationFlags;
  });
