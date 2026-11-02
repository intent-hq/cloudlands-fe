import type { Workspace } from '$shared/types';

/**
 * A workspace's repository as the workspace sidebar shows it: `owner/name` (nested
 * GitLab groups stay in the owner, e.g. `group/sub/name`), else the local repository
 * folder's name, else empty.
 */
export function workspaceRepositoryLabel(
  workspace:
    Pick<Workspace, 'repositoryOwner' | 'repositoryName' | 'repositoryPath'> | null | undefined,
): string {
  if (workspace?.repositoryOwner && workspace.repositoryName)
    return `${workspace.repositoryOwner}/${workspace.repositoryName}`;
  return workspace?.repositoryPath?.split('/').pop() ?? '';
}
