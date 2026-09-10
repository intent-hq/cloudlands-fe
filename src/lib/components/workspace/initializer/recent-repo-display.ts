/**
 * Pure helpers for rendering and filtering the RepoSelector "Recent" list.
 *
 * Local repos are keyed by their checkout path, so two clones of the same
 * GitHub repo share an "owner / name" label. These helpers lead with the
 * folder name for local entries and keep "owner/repo" as a dimmed suffix,
 * matching the repo trigger's `name (owner/repo)` format.
 */

export interface RecentRepoEntry {
  path: string;
  type: 'local' | 'github';
  name: string;
  owner?: string;
}

export interface RecentRepoLabel {
  /** Dimmed "owner /" prefix, GitHub entries only */
  ownerPrefix?: string;
  /** Main label: folder name for local entries, repo name for GitHub entries */
  primary: string;
  /** Dimmed "(owner/repo)" suffix, local entries with a known GitHub origin */
  suffix?: string;
}

/** Last path segment of a repo path, tolerating both POSIX and Windows separators. */
export function getRepoFolderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/**
 * Derive the Recent-list label parts for a repo entry.
 * GitHub entries keep the existing "owner / name" rendering.
 */
export function getRecentRepoLabel(repo: RecentRepoEntry): RecentRepoLabel {
  if (repo.type !== 'local') {
    return { ownerPrefix: repo.owner, primary: repo.name };
  }

  const folderName = getRepoFolderName(repo.path) || repo.name;
  const suffix = repo.owner ? `${repo.owner}/${repo.name}` : undefined;
  return { primary: folderName, suffix };
}

/**
 * Hover tooltip for a Recent-list entry: the full checkout path for local
 * entries, nothing for (path-less) GitHub entries.
 */
export function getRecentRepoTooltip(repo: RecentRepoEntry): string | undefined {
  return repo.type === 'local' && repo.path ? repo.path : undefined;
}

/**
 * Path segments owned by the daemon rather than the user: the legacy clone
 * directory and the repo cache (`<workspaces_root>/.repo-cache/<owner>/<repo>`,
 * docs/PROTOCOL.md). Repos living there are not copyable local repos.
 */
const DAEMON_MANAGED_PATH_SEGMENTS = ['/.clones/', '/.repo-cache/'];

/** Whether a repo path lives inside a daemon-managed directory. */
export function isDaemonManagedRepoPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  return DAEMON_MANAGED_PATH_SEGMENTS.some((segment) => normalized.includes(segment));
}

export interface WorkspaceCheckoutPaths {
  repositoryPath?: string;
  worktreePath?: string;
}

/**
 * Repository paths that are workspace-owned standalone checkouts (GitHub picks
 * provisioned under the workspaces root), identified by the workspace's
 * `repositoryPath` being its own `worktreePath` — there is no separate
 * user-local repo to copy from.
 */
export function getWorkspaceOwnedCheckoutPaths(workspaces: WorkspaceCheckoutPaths[]): Set<string> {
  const owned = new Set<string>();
  for (const workspace of workspaces) {
    const { repositoryPath, worktreePath } = workspace;
    if (repositoryPath && worktreePath && repositoryPath === worktreePath) {
      owned.add(repositoryPath);
    }
  }
  return owned;
}

export interface GitHubPickSelection {
  /** Current trigger value: `owner/repo` shorthand for GitHub picks, a path otherwise */
  selectedValue: string;
  selectedRepoType: 'local' | 'github' | 'new';
  /** GitHub URL captured when the user explicitly confirmed a GitHub repo */
  confirmedGithubUrl?: string;
}

/**
 * Bare `owner/repo` shorthand guard shared with the trigger label: exactly one
 * slash and nothing that could be a local path (leading `/`, backslashes, drive
 * letters).
 */
function getShorthandOwner(value: string): string | undefined {
  if (value.includes('\\') || value.includes(':') || value.startsWith('/')) return undefined;
  const match = /^([^/]+)\/[^/]+$/.exec(value);
  return match?.[1];
}

/**
 * GitHub owner login for the current selection when — and only when — the pick
 * is a GitHub repo, for the trigger avatar. Local repos (even with a known
 * GitHub origin), new repos, and the empty state resolve to `undefined`.
 */
export function getGitHubPickOwner(
  selection: GitHubPickSelection,
  parseGitHubUrl: (input: string) => { owner: string } | null,
): string | undefined {
  const { selectedValue, selectedRepoType, confirmedGithubUrl } = selection;
  if (selectedRepoType !== 'github' || !selectedValue) return undefined;

  if (confirmedGithubUrl) {
    const owner = parseGitHubUrl(confirmedGithubUrl)?.owner;
    if (owner) return owner;
  }

  return getShorthandOwner(selectedValue);
}

/** Whether a Recent-list entry matches the search term (folder name included). */
export function matchesRecentRepoSearch(repo: RecentRepoEntry, searchTerm: string): boolean {
  const search = searchTerm.trim().toLowerCase();
  if (search === '') return true;

  const candidates = [
    repo.name,
    repo.path,
    getRepoFolderName(repo.path),
    repo.owner,
    repo.owner ? `${repo.owner}/${repo.name}` : undefined,
  ];

  return candidates.some((candidate) => candidate?.toLowerCase().includes(search) ?? false);
}
