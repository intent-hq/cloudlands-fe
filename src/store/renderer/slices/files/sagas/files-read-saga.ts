import { call, put, race, take, takeLeading } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
} from '../files-slice';

const logger = createLogger('FilesReadSaga');

function* loadFileContentWorker(workspaceId: string, path: string, absolutePath: string) {
  try {
    const entry: Awaited<ReturnType<typeof appClient.files.read>> = yield* call(
      [appClient.files, appClient.files.read],
      workspaceId,
      path,
    );
    if (!entry) {
      yield* put(
        loadFileContentFailed(workspaceId, path, absolutePath, m.files_read_notFound_error()),
      );
      return;
    }
    yield* put(
      loadFileContentSucceeded(
        workspaceId,
        path,
        absolutePath,
        entry.originalContent ?? entry.localContent ?? '',
        entry.isBinary,
        entry.truncated,
      ),
    );
  } catch (error) {
    logger.error('Failed to load file content', error);
    const message = error instanceof Error ? error.message : String(error);
    yield* put(loadFileContentFailed(workspaceId, path, absolutePath, message));
  }
}

type WorkspaceCleanupAction =
  | ReturnType<typeof workspaceDeleted>
  | ReturnType<typeof workspaceUnmounted>;

function matchesWorkspaceCleanup(workspaceId: string) {
  return (action: WorkspaceCleanupAction) =>
    (action.type === workspaceDeleted.type || action.type === workspaceUnmounted.type) &&
    action.payload[0] === workspaceId;
}

function* loadFileContentRequestWorker(action: ReturnType<typeof loadFileContentRequested>) {
  const [workspaceId, path, absolutePath] = action.payload;
  if (!workspaceId || !path || typeof absolutePath !== 'string') return;
  yield* race({
    read: call(loadFileContentWorker, workspaceId, path, absolutePath),
    cleanup: take(matchesWorkspaceCleanup(workspaceId)),
  });
}

export function* filesReadSaga() {
  yield* takeLeading(loadFileContentRequested, loadFileContentRequestWorker);
}
