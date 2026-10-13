import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { FileContentEntry, FilesState } from './files-types';

/** Bind this canonical cache projection with the host Store's createSelector. */
export function getFileContentEntry(
  state: { files: FilesState },
  workspaceId: string,
  path: string | null | undefined,
): FileContentEntry | undefined {
  if (!path) return undefined;
  const workspace = state.files.byWorkspaceId[workspaceId];
  return workspace ? getItem(workspace.files, path) : undefined;
}
