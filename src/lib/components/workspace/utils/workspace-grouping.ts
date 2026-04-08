import type { Workspace } from '$shared/types';

/**
 * GitHub owner/name info resolved from a repository path.
 */
export interface RepoGithubInfo {
  owner: string;
  name: string;
}

/**
 * Result of resolving a workspace's group key for repo-based grouping.
 */
export interface GroupKeyResult {
  key: string;
  label: string;
  isGithub: boolean;
  owner?: string;
}

/**
 * Build a lookup from repositoryPath → {owner, name} so workspaces missing
 * owner/name can be merged into the correct group instead of creating duplicates.
 *
 * Optionally seeds from a `knownRepos` list (persistent registry) before
 * overlaying info from the workspaces themselves.
 */
export function buildRepoPathLookup(
  workspaces: Workspace[],
  knownRepos?: { path: string; name: string; owner?: string }[],
): Map<string, RepoGithubInfo> {
  const map = new Map<string, RepoGithubInfo>();

  // Seed from knownRepos (persistent registry) if provided
  if (knownRepos) {
    for (const repo of knownRepos) {
      if (repo.owner && repo.name && repo.path) {
        map.set(repo.path, { owner: repo.owner, name: repo.name });
      }
    }
  }

  // Overlay from workspaces themselves (in case knownRepos is stale)
  for (const ws of workspaces) {
    if (ws.repositoryPath && ws.repositoryOwner && ws.repositoryName) {
      map.set(ws.repositoryPath, { owner: ws.repositoryOwner, name: ws.repositoryName });
    }
  }

  return map;
}

/**
 * Get the group key for a workspace based on its repository information.
 *
 * Uses the lookup map (from `buildRepoPathLookup`) to resolve workspaces
 * that only have a `repositoryPath` but are missing `repositoryOwner`/`repositoryName`.
 *
 * @param ws - The workspace to resolve
 * @param repoPathLookup - Map from repositoryPath to GitHub info
 * @param noRepoLabel - Label for workspaces with no repository (default: "Unknown Repository")
 */
export function getGroupKey(
  ws: Workspace,
  repoPathLookup: Map<string, RepoGithubInfo>,
  noRepoLabel = 'Unknown Repository',
): GroupKeyResult {
  if (ws.repositoryOwner && ws.repositoryName) {
    return {
      key: `${ws.repositoryOwner}/${ws.repositoryName}`,
      label: `${ws.repositoryOwner}/${ws.repositoryName}`,
      isGithub: true,
      owner: ws.repositoryOwner,
    };
  }

  if (ws.repositoryName && !ws.repositoryOwner) {
    return {
      key: ws.repositoryName,
      label: ws.repositoryName,
      isGithub: false,
    };
  }

  if (ws.repositoryPath) {
    const githubInfo = repoPathLookup.get(ws.repositoryPath);
    if (githubInfo) {
      return {
        key: `${githubInfo.owner}/${githubInfo.name}`,
        label: `${githubInfo.owner}/${githubInfo.name}`,
        isGithub: true,
        owner: githubInfo.owner,
      };
    }
    return {
      key: ws.repositoryPath,
      label: ws.repositoryPath.split('/').pop() || ws.repositoryPath,
      isGithub: false,
    };
  }

  return { key: noRepoLabel, label: noRepoLabel, isGithub: false };
}
