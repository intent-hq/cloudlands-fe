import {
  getRepoFolderName,
  getWorkspaceOwnedCheckoutPaths,
  isDaemonManagedRepoPath,
} from '$lib/components/workspace/initializer/recent-repo-display';
import { getRecentRepos } from '$lib/utils/workspace-utils';
import type { Workspace } from '$shared/types';
import type { KnownRepo } from '$shared/types/known-repo';

export interface LocalRepoOption {
  path: string;
  name: string;
  owner?: string;
}

/** The same eligibility rules drive both the empty-list scan and its presentation. */
export function localRepoOptions(
  knownRepos: KnownRepo[],
  workspaces: Workspace[],
  discovered: LocalRepoOption[] = [],
  manuallyAddedPaths: string[] = [],
): LocalRepoOption[] {
  const owned = getWorkspaceOwnedCheckoutPaths(workspaces);
  const excluded = (path: string) => isDaemonManagedRepoPath(path) || owned.has(path);
  const repos = new Map<string, LocalRepoOption>();
  for (const path of manuallyAddedPaths) {
    repos.set(path, { path, name: getRepoFolderName(path) || path });
  }
  for (const repo of discovered) {
    if (!excluded(repo.path)) repos.set(repo.path, repo);
  }
  for (const repo of knownRepos) {
    if (repo.path && !repo.githubUrl && !excluded(repo.path)) {
      repos.set(repo.path, {
        path: repo.path,
        name: repo.name || getRepoFolderName(repo.path) || repo.path,
        owner: repo.owner,
      });
    }
  }
  for (const repo of getRecentRepos(workspaces, 10)) {
    const local =
      repo.path.startsWith('/') || repo.path.startsWith('~') || repo.path.startsWith('.');
    if (local && !excluded(repo.path)) repos.set(repo.path, repo);
  }
  return [...repos.values()];
}
