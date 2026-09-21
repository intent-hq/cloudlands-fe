/**
 * Git-roots selectors (multi git root tracking, intent-hq/monorepo#2053).
 *
 * The daemon only tracks *secondary* roots (subtree checkouts, submodules,
 * sibling clones); the workspace's own worktree is the implicit primary root.
 * `selectWorkspaceGitRootEntries` synthesizes the primary entry first from
 * the stored workspace so consumers get one uniform list.
 */
import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { GitRootRow } from '$features/git-roots/git-roots-service';
import type { PullRequestInfo, PullRequestStatus, Workspace } from '$shared/types';
import { selectWorkspaceById } from '../workspace/workspace-selectors';

/** Uniform entry for the roots list: the synthesized primary workspace root
 * or a registered secondary root. */
export interface WorkspaceGitRootEntry {
  /** Stable list key: `primary` for the synthesized entry, else the root id. */
  key: string;
  isPrimary: boolean;
  path?: string;
  branch?: string;
  repoOwner?: string;
  repoName?: string;
  prNumber?: number;
  prUrl?: string;
  prStatus?: PullRequestStatus;
  pullRequests?: PullRequestInfo[];
  /** The registered wire row; absent on the primary entry. */
  gitRoot?: GitRootRow;
}

/** All registered (secondary) git roots for a workspace, in seed order. */
export const selectGitRoots = store.createSelector((state, workspaceId: string): GitRootRow[] => {
  // Optional chain: cross-slice consumers run against partial test states
  // without this slice.
  const ws = state.gitRoots?.byWorkspaceId?.[workspaceId];
  if (!ws) return [];
  return getItems(ws.gitRoots);
});

function primaryEntry(workspace: Workspace): WorkspaceGitRootEntry {
  return {
    key: 'primary',
    isPrimary: true,
    path: workspace.worktreePath ?? workspace.path,
    branch: workspace.branch,
    repoOwner: workspace.repositoryOwner,
    repoName: workspace.repositoryName,
    prNumber: workspace.prNumber,
    prUrl: workspace.prUrl,
    prStatus: workspace.prStatus,
    pullRequests: workspace.pullRequests,
  };
}

function secondaryEntry(root: GitRootRow): WorkspaceGitRootEntry {
  return {
    key: root.id,
    isPrimary: false,
    path: root.path,
    branch: root.branch,
    repoOwner: root.repoOwner,
    repoName: root.repoName,
    prNumber: root.prNumber,
    prUrl: root.prUrl,
    prStatus: root.prStatus,
    pullRequests: root.pullRequests,
    gitRoot: root,
  };
}

/**
 * The workspace's full roots list: the primary root synthesized first from
 * the workspace entity itself, then every registered secondary root in seed
 * order. Empty until the workspace entity is hydrated (there is no primary
 * to synthesize from).
 */
export const selectWorkspaceGitRootEntries = store.createSelector(
  (state, workspaceId: string): WorkspaceGitRootEntry[] => {
    const workspace = selectWorkspaceById.select(state, workspaceId);
    const roots = selectGitRoots.select(state, workspaceId).map(secondaryEntry);
    if (!workspace) return roots;
    return [primaryEntry(workspace), ...roots];
  },
);

/** Whether the workspace tracks any secondary roots (multi-root UI gate). */
export const selectHasSecondaryGitRoots = store.createSelector(
  (state, workspaceId: string): boolean => selectGitRoots.select(state, workspaceId).length > 0,
);
