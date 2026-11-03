import type { Workspace } from '$shared/types';

/**
 * Plain-folder workspaces (PROTOCOL §5.1 Plain-folder workspaces) have no git,
 * checkout or forge, so every git surface (Changes, branch names, PR badges,
 * accept/commit/PR actions, checkpoints, transfer) hides for them. The mode is
 * read only from the explicit `plainFolder` flag: an empty `branch` is not a
 * signal, and the Labs flag never gates existing plain-folder workspaces.
 */
export function isPlainFolderWorkspace(
  workspace: Pick<Workspace, 'plainFolder'> | null | undefined,
): boolean {
  return workspace?.plainFolder === true;
}
