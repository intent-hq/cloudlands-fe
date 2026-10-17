/**
 * Repository default for the New space dialog when the sidebar has a
 * repository selected (`defaultToSidebarRepository`).
 *
 * A workspace created through "Pick a repo" is cloned into its own folder, so
 * the daemon records `repositoryPath === worktreePath` for it. When such a
 * clone is the only path the sidebar group knows, it must not be offered as a
 * "Copy local repo" source: the default is the GitHub pick instead. A saved
 * selection that already names the same GitHub repository is the user's last
 * choice for it and is kept as is.
 *
 * Pure and dependency-light per FE conventions.
 */
import type { Workspace } from '$shared/types';
import type { CompactWorkspaceInitializerFormState } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';
import { parseGitHubUrl } from '$lib/utils/workspace-validation';

export interface SidebarRepository {
  isGithub: boolean;
  owner?: string;
  name?: string;
  repoPath?: string;
  workspaces: Pick<Workspace, 'repositoryPath' | 'worktreePath'>[];
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

/** Whether `path` is a workspace's own forge clone rather than a user checkout. */
function isWorkspaceOwnedClone(path: string, repo: SidebarRepository): boolean {
  return repo.workspaces.some(
    (workspace) =>
      !!workspace.worktreePath &&
      workspace.repositoryPath === workspace.worktreePath &&
      workspace.worktreePath === path,
  );
}

function namesRepository(value: string | undefined, owner: string, name: string): boolean {
  const parsed = value ? parseGitHubUrl(value) : null;
  return (
    !!parsed &&
    parsed.owner.toLowerCase() === owner.toLowerCase() &&
    parsed.repo.toLowerCase() === name.toLowerCase()
  );
}

/** Whether the saved selection is a still-valid choice for the same GitHub repository. */
function savedChoiceForRepository(
  saved: CompactWorkspaceInitializerFormState,
  repo: SidebarRepository,
  owner: string,
  name: string,
): boolean {
  if (saved.isNewRepo || !saved.repoPath) return false;
  if (saved.repoType === 'github')
    return namesRepository(saved.githubUrl || saved.repoPath, owner, name);
  return (
    saved.repoType === 'local' &&
    namesRepository(saved.githubUrl, owner, name) &&
    !isWorkspaceOwnedClone(saved.repoPath, repo)
  );
}

export function resolveSidebarRepositoryDefault(
  repo: SidebarRepository | undefined,
  saved: CompactWorkspaceInitializerFormState | null | undefined,
): CompactWorkspaceInitializerFormState | null | undefined {
  if (!repo?.repoPath) return saved;
  const { owner, name } = repo;
  const shorthand = repo.isGithub && owner && name ? `${owner}/${name}` : undefined;
  if (shorthand && owner && name && saved && savedChoiceForRepository(saved, repo, owner, name))
    return saved;
  const githubPick =
    shorthand && (repo.repoPath === shorthand || isWorkspaceOwnedClone(repo.repoPath, repo))
      ? shorthand
      : undefined;
  const repoPath = githubPick ?? repo.repoPath;
  const repoType = githubPick ? 'github' : 'local';
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
