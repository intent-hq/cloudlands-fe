/**
 * Repository default for the New space dialog when the sidebar has a
 * repository selected (`defaultToSidebarRepository`).
 *
 * A workspace created through "Clone" is cloned into its own folder, so
 * the daemon records `repositoryPath === worktreePath` for it. Such clones (and
 * daemon-managed clone/cache directories) are not "Existing folder" sources:
 * for a GitHub group the default is a user checkout from the group when one
 * exists, otherwise the GitHub pick. A saved GitHub pick of the same repository
 * is the user's last choice for it and is kept as is.
 *
 * Pure and dependency-light per FE conventions.
 */
import type { Workspace } from '$shared/types';
import type { CompactWorkspaceInitializerFormState } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';
import { parseGitHubUrl } from '$lib/utils/workspace-validation';
import { getWorkspaceOwnedCheckoutPaths, isDaemonManagedRepoPath } from './recent-repo-display';

export interface SidebarRepository {
  isGithub: boolean;
  owner?: string;
  name?: string;
  repoPath?: string;
  workspaces: Pick<Workspace, 'repositoryPath' | 'worktreePath' | 'skipWorktree'>[];
}

/** Read skipIsolation, falling back to the legacy pre-rename `skipWorktree` key. */
export function readSkipIsolation(
  formState: CompactWorkspaceInitializerFormState | null | undefined,
): boolean | undefined {
  return (
    formState?.skipIsolation ??
    (formState as { skipWorktree?: boolean } | null | undefined)?.skipWorktree
  );
}

function namesRepository(value: string | undefined, shorthand: string): boolean {
  const parsed = value ? parseGitHubUrl(value) : null;
  return !!parsed && `${parsed.owner}/${parsed.repo}`.toLowerCase() === shorthand.toLowerCase();
}

/**
 * The local path to copy for a GitHub group, or undefined when the group only
 * knows workspace-owned or daemon-managed clones. Direct-work workspaces also
 * report `repositoryPath === worktreePath`, but on the user's own checkout.
 */
function copyableGithubSource(repo: SidebarRepository, shorthand: string): string | undefined {
  const owned = getWorkspaceOwnedCheckoutPaths(
    repo.workspaces.filter((workspace) => !workspace.skipWorktree),
  );
  const copyable = (path: string | undefined): path is string =>
    !!path && path !== shorthand && !owned.has(path) && !isDaemonManagedRepoPath(path);
  if (copyable(repo.repoPath)) return repo.repoPath;
  return repo.workspaces.map((workspace) => workspace.repositoryPath).find(copyable);
}

export function resolveSidebarRepositoryDefault(
  repo: SidebarRepository | undefined,
  saved: CompactWorkspaceInitializerFormState | null | undefined,
): CompactWorkspaceInitializerFormState | null | undefined {
  if (!repo?.repoPath) return saved;
  const shorthand = repo.isGithub && repo.owner && repo.name && `${repo.owner}/${repo.name}`;
  let repoPath = repo.repoPath;
  let repoType: 'local' | 'github' = 'local';
  if (shorthand) {
    if (
      saved?.repoType === 'github' &&
      !saved.isNewRepo &&
      (namesRepository(saved.githubUrl, shorthand) || namesRepository(saved.repoPath, shorthand))
    )
      return saved;
    const source = copyableGithubSource(repo, shorthand);
    repoPath = source ?? shorthand;
    if (!source) repoType = 'github';
  }
  if (saved?.repoPath === repoPath && saved.repoType === repoType && !saved.isNewRepo) return saved;
  return {
    ...saved,
    repositoryCheckoutDraft: undefined,
    repoPath,
    repoType,
    skipIsolation: repoType === 'github' ? false : readSkipIsolation(saved),
    githubUrl: repo.owner && repo.name ? `https://github.com/${repo.owner}/${repo.name}` : '',
    isNewRepo: false,
    isValidPath: true,
    branch: '',
    scope: '',
    scopeRepoPath: undefined,
    remoteSetup: null,
  };
}
