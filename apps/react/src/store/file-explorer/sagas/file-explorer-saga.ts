import { createFileExplorerReadSaga } from '../../../../../../src/store/renderer/slices/file-explorer/sagas/file-explorer-read-saga-factory';
import { createFileListDirectory } from '$lib/client/live/backend-file-list-directory';
import { backendRequest } from '@/features/backend/backend-transport';
import { store } from '@/store';
import {
  selectFileExplorerContext,
  selectFileExplorerRoot,
  selectFileExplorerState,
} from '../file-explorer-selectors';

const listDirectory = createFileListDirectory(backendRequest, { strict: true });

export const fileExplorerSaga = createFileExplorerReadSaga({
  files: {
    listDirectory,
    explorerTree: async (workspaceId, current) => {
      const path = selectFileExplorerRoot.select(store.state, workspaceId);
      const children = await listDirectory(workspaceId, '', current);
      return { name: path.split('/').at(-1) || path, path, type: 'directory', children };
    },
  },
  selectFileExplorerState,
  admission: {
    readCurrentContext: (workspaceId) => selectFileExplorerContext.select(store.state, workspaceId),
    dispatch: (action) => store.dispatch(action),
  },
  compactChains: false,
  bounded: true,
});
