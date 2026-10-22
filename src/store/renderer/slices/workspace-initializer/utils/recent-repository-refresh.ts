import { getRecentRepos } from '$lib/utils/workspace-utils';
import {
  getRecentRepoIdentity,
  getWorkspaceOwnedCheckoutPaths,
  isDaemonManagedRepoPath,
} from '$lib/components/workspace/initializer/recent-repo-display';
import type { Workspace } from '$shared/types';
import type { KnownRepo } from '$shared/types/known-repo';
import type { RepositoryTarget } from '$shared/types/repository-context';
import type { WorkspaceInitializerRecentRepo } from '../workspace-initializer-types';

export function recentRepositoryOriginPaths(
  workspaces: Workspace[],
  registryRepos: KnownRepo[],
): string[] {
  const remotePaths = new Set(
    workspaces
      .filter((workspace) => workspace.isRemote)
      .flatMap((workspace) => [workspace.repositoryPath, workspace.worktreePath]),
  );
  return [
    ...new Set([
      ...getRecentRepos(workspaces, 10).map((repo) => repo.path),
      ...registryRepos.filter((repo) => !repo.githubUrl).map((repo) => repo.path),
    ]),
  ]
    .filter((path) => path && !remotePaths.has(path) && !isDaemonManagedRepoPath(path))
    .slice(0, 10);
}

export function aggregateRecentRepositories(
  saved: WorkspaceInitializerRecentRepo[],
  workspaces: Workspace[],
  registryRepos: KnownRepo[],
  origins: ReadonlyMap<string, RepositoryTarget | null>,
  gitlabInstance?: string,
): WorkspaceInitializerRecentRepo[] {
  const ownedCheckouts = getWorkspaceOwnedCheckoutPaths(workspaces);
  const workspaceRecents = getRecentRepos(workspaces, 10);
  const entries = new Map<string, WorkspaceInitializerRecentRepo>();
  const recency = new Map<string, number>();
  const keyFor = (repo: WorkspaceInitializerRecentRepo) => {
    if (repo.type === 'local') return `local:${repo.path}`;
    const identity = getRecentRepoIdentity(repo, gitlabInstance);
    return identity?.provider === 'gitlab'
      ? `gitlab:${identity.instanceBaseUrl}/${identity.projectPath}`
      : `github:${repo.path.toLowerCase()}`;
  };
  const noteRecency = (key: string, timestamp?: string) => {
    const time = timestamp ? Date.parse(timestamp) : NaN;
    if (Number.isFinite(time)) recency.set(key, Math.max(recency.get(key) ?? 0, time));
  };

  for (const repo of saved) {
    if (!isDaemonManagedRepoPath(repo.path) && !ownedCheckouts.has(repo.path)) {
      entries.set(keyFor(repo), repo);
    }
  }
  for (const repo of registryRepos) {
    if (repo.githubUrl) {
      const entry = {
        path: repo.path,
        type: 'github' as const,
        githubUrl: repo.githubUrl,
        name: repo.name,
        owner: repo.owner,
      };
      const key = keyFor(entry);
      entries.set(key, entry);
      noteRecency(key, repo.lastUsedAt);
    } else if (repo.path && !isDaemonManagedRepoPath(repo.path) && !ownedCheckouts.has(repo.path)) {
      const entry = {
        path: repo.path,
        type: 'local' as const,
        name: repo.name,
        owner: repo.owner,
        repositoryIdentity: origins.get(repo.path) ?? null,
      };
      const key = keyFor(entry);
      entries.set(key, entry);
      noteRecency(key, repo.lastUsedAt);
    }
  }
  for (const repo of workspaceRecents) {
    if (isDaemonManagedRepoPath(repo.path)) continue;
    if (ownedCheckouts.has(repo.path)) {
      if (!repo.owner || !repo.name) continue;
      const shorthand = `${repo.owner}/${repo.name}`;
      const observed = origins.get(repo.path);
      const registered = entries.get(`github:${shorthand.toLowerCase()}`);
      const entry: WorkspaceInitializerRecentRepo = {
        path:
          observed?.provider === 'gitlab'
            ? `${observed.instanceBaseUrl}/${observed.projectPath}`
            : shorthand,
        type: 'github',
        githubUrl: observed
          ? `${observed.instanceBaseUrl}/${observed.projectPath}`
          : (registered?.githubUrl ?? `https://github.com/${shorthand}`),
        name: repo.name,
        owner: repo.owner,
        repositoryIdentity:
          observed ?? (registered ? getRecentRepoIdentity(registered, gitlabInstance) : null),
      };
      const key = keyFor(entry);
      entries.set(key, entry);
      noteRecency(key, repo.updatedAt);
      continue;
    }
    const isLocal =
      repo.path.startsWith('/') ||
      repo.path.startsWith('~') ||
      repo.path.startsWith('.') ||
      repo.path.includes(':\\');
    if (!isLocal) continue;
    const entry = {
      path: repo.path,
      type: 'local' as const,
      name: repo.name,
      owner: repo.owner,
      repositoryIdentity: origins.get(repo.path) ?? null,
    };
    const key = keyFor(entry);
    entries.set(key, entry);
    noteRecency(key, repo.updatedAt);
  }
  return [...entries.entries()]
    .sort(([a], [b]) => (recency.get(b) ?? 0) - (recency.get(a) ?? 0))
    .map(([, repo]) => repo);
}
