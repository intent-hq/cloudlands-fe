import { call, put, race, take, takeLeading } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { resolveFileBySuffix } from '$lib/services/files/resolve-file-by-suffix';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { updateFileTabPath } from '../../panel-layout/panel-layout-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
  removeFileContentEntry,
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
      // Not found at the workspace root — the path may be submodule- or
      // worktree-relative (see monorepo#2059). Attempt suffix resolution.
      const candidates = yield* call(resolveFileBySuffix, workspaceId, path);
      if (candidates.length === 1 && candidates[0] !== path) {
        // Unique match: retarget open file tabs to the resolved path; the tab
        // component re-issues the read (and future saves) against it.
        yield* put(removeFileContentEntry(workspaceId, path));
        yield* put(updateFileTabPath(workspaceId, path, candidates[0]));
        return;
      }
      yield* put(
        loadFileContentFailed(
          workspaceId,
          path,
          absolutePath,
          m.files_read_notFound_error(),
          candidates,
        ),
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

function matchesWorkspaceCleanup(workspaceId: string) {
  return (action: { type: string; payload?: unknown }) =>
    (action.type === workspaceDeleted.type || action.type === workspaceUnmounted.type) &&
    Array.isArray(action.payload) &&
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
