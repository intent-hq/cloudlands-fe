import { waitForDesktopFileAuthorityRetirement } from './desktop-file-lifetime';
import { createFilesSaveSaga } from '../../../../../../src/store/renderer/slices/files/sagas/files-save-saga-factory';
import {
  getFileSaveOperation,
  getFileSaveOperations,
} from '../../../../../../src/store/renderer/slices/files/files-projections';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '@/store';
import {
  gitReadsInvalidated,
  loadGitStatus,
} from '../../../../../../src/store/renderer/slices/git/git-slice';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import {
  captureFileSaveAuthority,
  captureFilePublicationAuthority,
  writeWorkspaceFile,
} from '@/features/workspace/file-save-runtime';

export const filesSaveSaga = createFilesSaveSaga({
  maxBytes: 500 * 1024,
  files: { write: writeWorkspaceFile },
  readEntries: (workspaceId) => {
    const entries = store.state.files.byWorkspaceId[workspaceId]?.files;
    return entries ? getItems(entries) : [];
  },
  resolveWorkspacePath: (workspaceId) => {
    const workspace = selectWorkspaceById.select(store.state, workspaceId);
    return workspace?.worktreePath || workspace?.repositoryPath || '';
  },
  admission: {
    captureAuthority: captureFileSaveAuthority,
    waitForRetirement: waitForDesktopFileAuthorityRetirement,
    capturePublicationAuthority: captureFilePublicationAuthority,
    readOperation: (id) => getFileSaveOperation(store.state, id),
    readOperations: (workspaceId, path) => getFileSaveOperations(store.state, workspaceId, path),
    dispatch: (action) => store.dispatch(action),
    onConfirmed: (workspaceId, path) => {
      // Reconcile existing Git read ownership; departure removes this canonical cache.
      // React does not use the source app's full workspace hydration lifecycle.
      if (store.state.git.byWorkspaceId[workspaceId]) {
        store.dispatch(loadGitStatus(workspaceId, true, { invalidatePending: true }));
        store.dispatch(gitReadsInvalidated(workspaceId, undefined, { worktreePath: path }));
      }
    },
  },
});
