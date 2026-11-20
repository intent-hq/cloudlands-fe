/**
 * Repositories hidden from the Home sidebar. A hidden entry records the newest
 * workspace creation time the repository had when hidden; a newer workspace
 * brings it back. Daemon timestamps on both sides keep client clock skew out.
 */
import type { Workspace } from '$shared/types';

type HiddenRepos = Readonly<Record<string, number>>;
interface HiddenRepoCandidate {
  key: string;
  workspaces: readonly Pick<Workspace, 'createdAt'>[];
}

/** Newest workspace creation time (daemon clock, ms); `0` for none. */
export function newestHomeRepositoryWorkspace(
  workspaces: HiddenRepoCandidate['workspaces'],
): number {
  let newest = 0;
  for (const workspace of workspaces) {
    const time = Date.parse(workspace.createdAt);
    if (Number.isFinite(time) && time > newest) newest = time;
  }
  return newest;
}

export function isHomeRepositoryHidden(hidden: HiddenRepos, repo: HiddenRepoCandidate): boolean {
  const newest = hidden[repo.key];
  return newest !== undefined && newestHomeRepositoryWorkspace(repo.workspaces) <= newest;
}

/** Keys of hidden repositories that gained a newer workspace. */
export function revivedHomeRepositories(
  hidden: HiddenRepos,
  repos: readonly HiddenRepoCandidate[],
): string[] {
  return repos
    .filter((repo) => hidden[repo.key] !== undefined && !isHomeRepositoryHidden(hidden, repo))
    .map((repo) => repo.key);
}

/** Expansion key of the sidebar's collapsed Hidden section. */
export const HOME_HIDDEN_REPOS_GROUP = 'sidebar:hidden';

/** Hidden repositories for the sidebar's Hidden section, A–Z; removed folders stay out. */
export function hiddenHomeRepositories<T extends HiddenRepoCandidate & { label: string }>(
  hidden: HiddenRepos,
  repos: readonly T[],
  removed: readonly string[] = [],
): T[] {
  return repos
    .filter((repo) => isHomeRepositoryHidden(hidden, repo) && !removed.includes(repo.key))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Keys of removed folders the user added again: back in the recent list after the
 * removal. The hide records the newest workspace, so an entry added after it is new.
 */
export function readdedHomeRepositories(
  hidden: HiddenRepos,
  removed: readonly string[],
  repos: readonly (HiddenRepoCandidate & { repoPath?: string })[],
  known: readonly { path: string; addedAt: string }[],
): string[] {
  const added = new Map(known.map((repo) => [repo.path, Date.parse(repo.addedAt)]));
  return repos
    .filter((repo) => {
      const newest = hidden[repo.key];
      const at = repo.repoPath === undefined ? undefined : added.get(repo.repoPath);
      return removed.includes(repo.key) && newest !== undefined && at !== undefined && at > newest;
    })
    .map((repo) => repo.key);
}
