import { put } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { resolveFileBySuffix } from '$lib/services/files/resolve-file-by-suffix';
import { createLogger } from '$lib/utils/client-logger';
import { updateFileTabPath } from '../../panel-layout/panel-layout-slice';
import { createFilesReadSaga } from './files-read-saga-factory';

// Source compatibility binding; remove at the renderer cutover. Keep the source
// transport lookup lazy and preserve its receiver for runtime and test replacements.
export { MAX_CONCURRENT_FILE_READS } from './files-read-saga-factory';
const logger = createLogger('FilesReadSaga');
export const filesReadSaga = createFilesReadSaga({
  files: { read: (...args) => appClient.files.read(...args) },
  resolveFileBySuffix: (...args) => resolveFileBySuffix(...args),
  onRetarget: function* (workspaceId, path, resolved) {
    yield* put(updateFileTabPath(workspaceId, path, resolved));
  },
  onError: (error) => logger.error('Failed to load file content', error),
});
