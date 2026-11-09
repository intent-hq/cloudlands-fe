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

function newestCreatedAt(workspaces: HiddenRepoCandidate['workspaces']): number {
  let newest = 0;
  for (const workspace of workspaces) {
    const time = Date.parse(workspace.createdAt);
    if (Number.isFinite(time) && time > newest) newest = time;
  }
  return newest;
}

export function hideHomeRepository(
  hidden: HiddenRepos,
  key: string,
  workspaces: HiddenRepoCandidate['workspaces'],
): Record<string, number> {
  return { ...hidden, [key]: newestCreatedAt(workspaces) };
}

export function isHomeRepositoryHidden(hidden: HiddenRepos, repo: HiddenRepoCandidate): boolean {
  const newest = hidden[repo.key];
  return newest !== undefined && newestCreatedAt(repo.workspaces) <= newest;
}

/** The hidden map without repositories that gained a workspace; `null` when unchanged. */
export function withoutRevivedHomeRepositories(
  hidden: HiddenRepos,
  repos: readonly HiddenRepoCandidate[],
): Record<string, number> | null {
  const revived = repos.filter(
    (repo) => hidden[repo.key] !== undefined && !isHomeRepositoryHidden(hidden, repo),
  );
  if (revived.length === 0) return null;
  const next = { ...hidden };
  for (const repo of revived) delete next[repo.key];
  return next;
}

export function unhideHomeRepository(hidden: HiddenRepos, key: string): Record<string, number> {
  const next = { ...hidden };
  delete next[key];
  return next;
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
