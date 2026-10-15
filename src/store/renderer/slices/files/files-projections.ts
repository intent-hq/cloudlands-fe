import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
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

/** Shared source/host dirty semantics; a save acknowledgement may leave newer local edits. */
export function getFileIsDirty(
  state: { files: FilesState },
  workspaceId: string,
  path: string | null | undefined,
): boolean {
  const entry = getFileContentEntry(state, workspaceId, path);
  return entry ? entry.localContent !== entry.originalContent : false;
}

/** Operation facts are independent of the current file view and its authority. */
export function getFileSaveOperation(state: { files: FilesState }, requestId: string) {
  return state.files.saveOperations ? getItem(state.files.saveOperations, requestId) : undefined;
}

export function getFileSaveOperations(
  state: { files: FilesState },
  workspaceId: string,
  path: string,
) {
  return state.files.saveOperations
    ? getItems(state.files.saveOperations).filter(
        (operation) =>
          operation.workspaceId === workspaceId &&
          (operation.path === path || operation.absolutePath === path),
      )
    : [];
}
