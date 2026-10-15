import { createFileExplorerReadSaga } from '../../../../../../src/store/renderer/slices/file-explorer/sagas/file-explorer-read-saga-factory';
import { createFileSearchSaga } from '../../../../../../src/store/renderer/slices/file-explorer/sagas/file-search-saga-factory';
import { createBackendFileNameSearch } from '$lib/client/live/backend-file-name-search';
import { fork } from 'typed-redux-saga';
import { createFileListDirectory } from '$lib/client/live/backend-file-list-directory';
import { backendRequest } from '@/features/backend/backend-transport';
import { store } from '@/store';
import {
  selectFileExplorerContext,
  selectFileExplorerRoot,
  selectFileExplorerState,
  selectFileSearch,
} from '../file-explorer-selectors';

const listDirectory = createFileListDirectory(backendRequest, { strict: true });

const searchFiles = createFileSearchSaga({
  read: createBackendFileNameSearch(backendRequest),
  admission: {
    readCurrentContext: (workspaceId) => selectFileExplorerContext.select(store.state, workspaceId),
    readSearch: (workspaceId, consumerId) =>
      selectFileSearch.select(store.state, workspaceId, consumerId),
    dispatch: (action) => store.dispatch(action),
  },
  skipWhitespaceOnly: true,
});

export function* fileExplorerSaga(mode: 'browser' | 'desktop' = 'browser') {
  const readExplorer = createFileExplorerReadSaga({
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
      readCurrentContext: (workspaceId) =>
        selectFileExplorerContext.select(store.state, workspaceId),
      dispatch: (action) => store.dispatch(action),
    },
    compactChains: mode === 'desktop',
    bounded: mode !== 'desktop',
  });

  yield* fork(readExplorer);
  yield* fork(searchFiles);
}
