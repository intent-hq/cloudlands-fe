/**
 * Git Selectors
 *
 * Selectors for workspace-scoped git state.
 */

import { store } from '../../store';
import type { AppSelector } from '../../types';
import { defaultGitOperationFlags, getGitWorkspaceState } from './git-slice';
import type {
  GitBranchStatusData,
  GitBranchesData,
  GitCommitDetailsEntry,
  GitDiffReadEntry,
  GitEnrichmentReadEntry,
  GitFileReadEntry,
  GitMutationRequestEntry,
  GitOperationFlags,
  GitStatusReadOperation,
  PostMergeState,
} from './git-types';
import type { GitStatus } from '$shared/types';
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { CommitFile } from '$features/file-tracking/types';
import type { CommitInfo } from '$shared/types';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';
import type { GitDiffsOptions } from '$lib/client';
import {
  commitDetailsKey,
  gitDiffReadKey,
  gitFileReadKey,
  gitMutationKey,
} from './utils/git-read-keys';

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

export const selectGitStatusReadOperation: AppSelector<GitStatusReadOperation, [wsId: string]> =
  store.createSelector(
    (state, wsId: string) => getGitWorkspaceState(state.git, wsId).statusReadOperation,
  );

export const selectGitAhead: AppSelector<number, [wsId: string]> = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).ahead,
);

export const selectGitBehind: AppSelector<number, [wsId: string]> = store.createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).behind,
);

export const selectCommitDetails: AppSelector<
  GitCommitDetailsEntry | undefined,
  [wsId: string, commitHash: string, gitRootId?: string]
> = store.createSelector((state, wsId, commitHash, gitRootId) =>
  getItem(
    getGitWorkspaceState(state.git, wsId).commitDetails,
    commitDetailsKey(commitHash, gitRootId),
  ),
);

export const selectCommitDetailsEntries: AppSelector<GitCommitDetailsEntry[], [wsId: string]> =
  store.createSelector((state, wsId) =>
    getItems(getGitWorkspaceState(state.git, wsId).commitDetails),
  );

export const selectGitDiffRead: AppSelector<
  GitDiffReadEntry | undefined,
  [wsId: string, options?: GitDiffsOptions]
> = store.createSelector((state, wsId, options) =>
  getItem(getGitWorkspaceState(state.git, wsId).diffReads, gitDiffReadKey(options)),
);

export const selectGitFileRead: AppSelector<
  GitFileReadEntry | undefined,
  [wsId: string, path: string, ref: string, gitRootId?: string]
> = store.createSelector((state, wsId, path, ref, gitRootId) =>
  getItem(getGitWorkspaceState(state.git, wsId).fileReads, gitFileReadKey(path, ref, gitRootId)),
);

export const selectGitMutationRequest: AppSelector<
  GitMutationRequestEntry | undefined,
  [wsId: string, operation: string, scope?: string]
> = store.createSelector((state, wsId, operation, scope = '') =>
  getItem(getGitWorkspaceState(state.git, wsId).mutationRequests, gitMutationKey(operation, scope)),
);

export const selectGitEnrichment: AppSelector<
  GitEnrichmentReadEntry | undefined,
  [wsId: string, key: string]
> = store.createSelector((state, wsId, key) =>
  getItem(getGitWorkspaceState(state.git, wsId).enrichmentReads, key),
);

export const selectGitRepoBranches: AppSelector<GitBranchesData | null, [repoPath: string]> =
  store.createSelector((state, repoPath) => state.git.byRepoPath[repoPath]?.branches ?? null);
export const selectGitRepoBranchesLoading: AppSelector<boolean, [repoPath: string]> =
  store.createSelector((state, repoPath) =>
    Boolean(state.git.byRepoPath[repoPath]?.branchesLoading),
  );
export const selectGitRepoBranchesError: AppSelector<string | null, [repoPath: string]> =
  store.createSelector((state, repoPath) => state.git.byRepoPath[repoPath]?.branchesError ?? null);
export const selectGitBranchStatus: AppSelector<
  GitBranchStatusData | null,
  [repoPath: string, branchName: string]
> = store.createSelector(
  (state, repoPath, branchName) =>
    state.git.byRepoPath[repoPath]?.branchStatuses[branchName] ?? null,
);
export const selectGitBranchStatusLoading: AppSelector<
  boolean,
  [repoPath: string, branchName: string]
> = store.createSelector((state, repoPath, branchName) =>
  Boolean(state.git.byRepoPath[repoPath]?.branchStatusLoading[branchName]),
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
export const selectGitBranchStatusError: AppSelector<
  string | null,
  [repoPath: string, branchName: string]
> = store.createSelector(
  (state, repoPath: string, branchName: string) =>
    state.git.byRepoPath[repoPath]?.branchStatusErrors[branchName] ?? null,
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
