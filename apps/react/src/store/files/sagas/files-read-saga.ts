import { createFilesReadSaga } from '../../../../../../src/store/renderer/slices/files/sagas/files-read-saga-factory';
import { loadFileContentFailed } from '../../../../../../src/store/renderer/slices/files/files-slice';
import { createFileRead } from '$lib/client/live/backend-file-read';
import { createFileListDirectory } from '$lib/client/live/backend-file-list-directory';
import { createFileSuffixResolver } from '$lib/services/files/file-suffix-resolver';
import { backendRequest } from '@/features/backend/backend-transport';
import { m } from '$shared/paraglide/messages.js';
import { store } from '../../index';
import { selectAdmittedWorkspaceReadContext } from '../../workspace-lifecycle/workspace-lifecycle-selectors';

export const filesReadSaga = createFilesReadSaga({
  files: { read: createFileRead(backendRequest) },
  resolveFileBySuffix: createFileSuffixResolver({
    request: backendRequest,
    listDirectory: createFileListDirectory(backendRequest),
  }),
  admission: {
    readCurrentContext: (workspaceId) =>
      selectAdmittedWorkspaceReadContext.select(store.state, workspaceId),
    dispatch: (action) => store.dispatch(action),
  },
  onRetarget: (workspaceId, path, resolved) => {
    store.dispatch(
      loadFileContentFailed(workspaceId, path, '', m.files_read_notFound_error(), [resolved]),
    );
  },
});
