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

/** Hidden repositories for the sidebar's Hidden section, A–Z. */
export function hiddenHomeRepositories<T extends HiddenRepoCandidate & { label: string }>(
  hidden: HiddenRepos,
  repos: readonly T[],
): T[] {
  return repos
    .filter((repo) => isHomeRepositoryHidden(hidden, repo))
    .sort((a, b) => a.label.localeCompare(b.label));
}
