/**
 * Recent-repo entries for the sidebar "+" new-workspace card.
 *
 * A workspace provisioned from a GitHub pick is a standalone checkout, so its
 * `repositoryPath` and `worktreePath` are the same path. A workspace copied
 * from a local repo keeps `repositoryPath` pointing at the user's source repo,
 * distinct from `worktreePath`. Both fields are BE-provided (PROTOCOL §5.1).
 */

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
  path: string;
  branch: string;
}

function basename(path: string): string | undefined {
  return path.split('/').filter(Boolean).pop();
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
 * Deduplicate workspaces by repository path (input order is preserved, so pass
 * them already sorted by recency) and derive the display entry for each.
 */
export function deriveRecentRepoEntries(
  workspaces: RecentRepoWorkspace[],
  limit = 4,
): RecentRepoEntry[] {
  const entries = new Map<string, RecentRepoEntry>();

  for (const workspace of workspaces) {
    const path = workspace.repositoryPath;
    if (!path || entries.has(path)) continue;

    const source = detectRecentRepoSource(workspace);
    entries.set(path, {
      source,
      name: workspace.repositoryName || basename(path),
      owner: workspace.repositoryOwner,
      folderName: source === 'local' ? basename(path) : undefined,
      branch: workspace.branch || 'main',
      path,
    });
    if (entries.size >= limit) break;
  }

  return [...entries.values()];
}
