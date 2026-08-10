/**
 * Recent-repo entries for the sidebar "+" new-workspace card.
 *
 * A workspace provisioned from a GitHub pick is a standalone checkout, so its
 * `repositoryPath` and `worktreePath` are the same path. A workspace copied
 * from a local repo keeps `repositoryPath` pointing at the user's source repo,
 * distinct from `worktreePath`. Both fields are BE-provided (PROTOCOL §5.1).
 */

import {
  getWorkspaceOwnedCheckoutPaths,
  isDaemonManagedRepoPath,
} from '$lib/components/workspace/initializer/recent-repo-display';

export type RecentRepoSource = 'github' | 'local';

/** The BE-provided workspace fields this module reads. */
export interface RecentRepoWorkspace {
  repositoryPath?: string;
  repositoryName?: string;
  repositoryOwner?: string;
  worktreePath?: string;
  checkoutMode?: 'cow' | 'worktree' | 'direct';
  branch?: string;
}

export interface RecentRepoEntry {
  source: RecentRepoSource;
  /** Repo name as reported by the daemon; undefined when it sent none. */
  name?: string;
  owner?: string;
  /** Basename of `repositoryPath`, for local-copy entries. */
  folderName?: string;
  /**
   * `repositoryPath` of the first workspace that produced this entry. Only a
   * valid prefill source for `local` entries — a `github` entry's path is a
   * workspace-owned checkout, not a user repo.
   */
  path: string;
  branch: string;
}

function basename(path: string): string | undefined {
  return path.split(/[\\/]/).filter(Boolean).pop();
}

/**
 * Classify how a workspace's repo was sourced. Falls back to `checkoutMode`
 * when `worktreePath` is absent; a workspace with neither signal keeps the
 * GitHub-style rendering.
 */
export function detectRecentRepoSource(workspace: RecentRepoWorkspace): RecentRepoSource {
  const { repositoryPath, worktreePath, checkoutMode } = workspace;
  if (repositoryPath && worktreePath) {
    return repositoryPath === worktreePath ? 'github' : 'local';
  }
  if (checkoutMode === 'worktree' || checkoutMode === 'cow') return 'local';
  return 'github';
}

/**
 * Deduplicate workspaces and derive the display entry for each (input order is
 * preserved, so pass them already sorted by recency; first occurrence wins).
 *
 * `github` entries are keyed by repo identity (`owner/name`, case-insensitive)
 * so N workspaces cloned from the same repo yield one entry; `local` entries
 * stay keyed by source path. A repository path that is some workspace's own
 * checkout (`repositoryPath === worktreePath`) is never treated as a local
 * source repo — it is a GitHub standalone checkout, matching the modal's
 * Recent list (`getWorkspaceOwnedCheckoutPaths`).
 */
export function deriveRecentRepoEntries(
  workspaces: RecentRepoWorkspace[],
  limit = 4,
): RecentRepoEntry[] {
  const ownedCheckoutPaths = getWorkspaceOwnedCheckoutPaths(workspaces);
  const entries = new Map<string, RecentRepoEntry>();

  for (const workspace of workspaces) {
    const path = workspace.repositoryPath;
    if (!path || isDaemonManagedRepoPath(path)) continue;

    const source = ownedCheckoutPaths.has(path) ? 'github' : detectRecentRepoSource(workspace);
    const name = workspace.repositoryName || basename(path);
    const key =
      source === 'github'
        ? `github:${githubRepoKey(workspace.repositoryOwner, name, path)}`
        : `local:${path}`;
    if (entries.has(key)) continue;

    entries.set(key, {
      source,
      name,
      owner: workspace.repositoryOwner,
      folderName: source === 'local' ? basename(path) : undefined,
      branch: workspace.branch || 'main',
      path,
    });
    if (entries.size >= limit) break;
  }

  return [...entries.values()];
}

/** Case-insensitive repo identity: `owner/name`, falling back to name, then path. */
function githubRepoKey(owner: string | undefined, name: string | undefined, path: string): string {
  if (owner && name) return `${owner}/${name}`.toLowerCase();
  if (name) return name.toLowerCase();
  return path;
}
