import { editableText, fileSnapshot } from '$features/file/utils/file-content';
import type { RestorableSnapshot } from '../files-types';
import {
  call,
  cancelled,
  fork,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { MutationResult } from '$lib/client/app-client';
import { createLogger } from '$lib/utils/client-logger';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import { isAbsolutePath } from '$lib/utils/path-utils';
import { deleteWithUndo } from '$lib/utils/reversible-actions';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '../../../store';
import { serializeFileMutation } from '../utils/serialize-file-mutation';
import { createFilesSaveSaga } from './files-save-saga-factory';
import { createFilesAutosaveSaga } from './files-autosave-saga-factory';
import { createFileRequested } from '../../app-layout/app-layout-slice';
import {
  selectEffectiveFileExplorerWorkspacePath,
  selectFileExplorerState,
} from '../../file-explorer/file-explorer-selectors';
import { refreshDirectoryRequested } from '../../file-explorer/file-explorer-slice';
import { closeTab, closeTabsByType } from '../../panel-layout/panel-layout-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { openWorkspaceFile } from '../../workspace-navigation/workspace-navigation-slice';
import { selectAllFileContentEntries, selectFileContentEntry } from '../files-selectors';
import {
  loadFileContentSucceeded,
  deleteFileRequested,
  deleteFileWithUndoRequested,
  restoreFileContentRequested,
  removeFileContentEntry,
  saveFileContentSucceeded,
} from '../files-slice';

const logger = createLogger('FilesWriteSaga');
// Keep the source test/API import stable while both hosts share the autosave owner.
export { FILE_CONTENT_SAVE_DEBOUNCE_MS } from './files-autosave-saga-factory';
function* serializeWorkspaceFileMutation<T>(
  workspaceId: string,
  path: string,
  run: (relativePath: string) => Promise<T>,
  observeRead?: (action: ReturnType<typeof loadFileContentSucceeded>) => void,
): SagaGenerator<T> {
  const workspacePath = isAbsolutePath(path)
    ? yield* selectEffectiveFileExplorerWorkspacePath.effect(workspaceId)
    : '';
  return yield* serializeFileMutation(
    workspaceId,
    stripWorkspacePrefix(path, workspacePath),
    run,
    observeRead,
  );
}

type ObservedAction = { type: string; payload?: unknown };

function isWorkspaceCleanup(action: ObservedAction, workspaceId: string): boolean {
  return (
    action.type === workspaceUnmounted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId
  );
}

function* createFileWorker(workspaceId: string, folderPath: string, fileName: string) {
  const absoluteFilePath = `${folderPath}/${fileName}`;
  const explorer = yield* selectFileExplorerState.effect(workspaceId);
  const relativePath = stripWorkspacePrefix(absoluteFilePath, explorer.workspacePath);
  if (!explorer.workspacePath || !relativePath || relativePath === absoluteFilePath) {
    return;
  }
  try {
    const result = yield* call(
      serializeWorkspaceFileMutation<MutationResult>,
      workspaceId,
      relativePath,
      (mutationPath: string) => appClient.files.write(workspaceId, mutationPath, editableText('')),
    );
    if (!result.success) return;
    yield* put(refreshDirectoryRequested(workspaceId, absoluteFilePath));
    yield* put(openWorkspaceFile(workspaceId, absoluteFilePath));
  } catch (error) {
    logger.error('Failed to create file', error);
  }
}

function* createFileActionWorker(action: ReturnType<typeof createFileRequested>) {
  const [workspaceId, folderPath, fileName] = action.payload;
  if (!workspaceId || !folderPath || !fileName) return;
  yield* race({
    create: call(createFileWorker, workspaceId, folderPath, fileName),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* deleteFileWorker(action: ReturnType<typeof deleteFileRequested>) {
  const [workspaceId, path, options] = action.payload;
  const cannotRestore = (snapshot: RestorableSnapshot | undefined) =>
    !snapshot || (options.snapshot !== undefined && options.snapshot.content !== snapshot.content);
  // Like a queued save, a queued deletion outlives cache cleanup. Retain any
  // observation that invalidates its Undo snapshot until the transport settles.
  let unsafeSnapshot = selectAllFileContentEntries
    .select(appStore.state, workspaceId)
    .some(
      (entry) =>
        (entry.isBinary || entry.kind === 'read-only-text' || entry.truncated) &&
        (entry.path === path || entry.absolutePath === options.absolutePath) &&
        cannotRestore(fileSnapshot(entry)),
    );
  let requestCancelled = false;
  const assertActive = () => {
    if (requestCancelled) throw new Error(m.ui_reversibleActions_cancelled_message());
  };
  try {
    const { snapshot, relativePath } = yield* call(
      serializeWorkspaceFileMutation<{ snapshot: RestorableSnapshot; relativePath: string }>,
      workspaceId,
      path,
      async (relativePath: string) => {
        assertActive();
        const binaryEntry = [path, options.absolutePath, relativePath]
          .map((alias) => selectFileContentEntry.select(appStore.state, workspaceId, alias))
          .find((entry) => entry?.isBinary || entry?.kind === 'read-only-text' || entry?.truncated);
        if (unsafeSnapshot || (binaryEntry && cannotRestore(fileSnapshot(binaryEntry))))
          throw new Error(m.fileExplorer_tree_undoUnavailable_error());
        // Delete only when Undo has real contents. null is unavailable, never
        // a zero-byte file; an omitted panel draft means read the disk first.
        const entry =
          options.snapshot === undefined
            ? await appClient.files.read(workspaceId, relativePath)
            : null;
        assertActive();
        const snapshot = options.snapshot ?? fileSnapshot(entry ?? undefined);
        if (unsafeSnapshot || !snapshot)
          throw new Error(m.fileExplorer_tree_undoUnavailable_error());
        const result = await appClient.files.delete(workspaceId, relativePath);
        if (!result.success)
          throw new Error(result.error ?? m.fileExplorer_tree_deleteFailed_error());
        return { snapshot, relativePath };
      },
      ({ payload }: ReturnType<typeof loadFileContentSucceeded>) => {
        if (
          payload[0] === workspaceId &&
          (payload[3].kind === 'read-only-text' ||
            payload[4] ||
            ((payload[3].kind === 'restorable-snapshot' || payload[3].kind === 'preview-only') &&
              payload[3].isBinary)) &&
          (payload[1] === path || payload[2] === options.absolutePath) &&
          // A concurrent binary observation invalidates a pending tree snapshot.
          (options.snapshot === undefined ||
            cannotRestore(payload[3].kind === 'restorable-snapshot' ? payload[3] : undefined))
        )
          unsafeSnapshot = true;
      },
    );
    // Clear both tree and panel aliases before closing tabs: an absolute-path
    // draft must not survive a relative delete and flush from tab teardown.
    for (const alias of new Set([path, relativePath, options.absolutePath])) {
      yield* put(removeFileContentEntry(workspaceId, alias));
    }
    if (options.tabId) yield* put(closeTab(workspaceId, options.tabId));
    else {
      yield* put(closeTabsByType(workspaceId, 'file', 'filePath', path));
      if (options.absolutePath !== path)
        yield* put(closeTabsByType(workspaceId, 'file', 'filePath', options.absolutePath));
    }
    yield* call(() =>
      dispatchWindowEvent('file:changed', {
        workspaceId,
        type: 'delete',
        filePath: options.absolutePath,
      }),
    );
    yield* put(action.success(snapshot));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  } finally {
    if (yield* cancelled()) {
      requestCancelled = true;
      yield* put(action.failure(new Error(m.ui_reversibleActions_cancelled_message())));
    }
  }
}

function* deleteFileActionWorker(action: ReturnType<typeof deleteFileRequested>) {
  yield* race({
    deletion: call(deleteFileWorker, action),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, action.payload[0])),
  });
}

function* restoreFileWorker(action: ReturnType<typeof restoreFileContentRequested>) {
  const [workspaceId, path, absolutePath, snapshot] = action.payload;
  try {
    const result = yield* call(
      serializeWorkspaceFileMutation<MutationResult>,
      workspaceId,
      path,
      (relativePath: string) => appClient.files.write(workspaceId, relativePath, snapshot),
    );
    if (!result.success) throw new Error(result.error ?? m.fileExplorer_layout_saveFailed_error());
    yield* put(saveFileContentSucceeded(workspaceId, path, snapshot));
    yield* call(() =>
      dispatchWindowEvent('file:changed', {
        workspaceId,
        type: 'create',
        filePath: absolutePath,
      }),
    );
    yield* put(action.success());
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  } finally {
    if (yield* cancelled())
      yield* put(action.failure(new Error(m.ui_reversibleActions_cancelled_message())));
  }
}

function* restoreFileActionWorker(action: ReturnType<typeof restoreFileContentRequested>) {
  yield* race({
    restoration: call(restoreFileWorker, action),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, action.payload[0])),
  });
}

function* deleteFileWithUndoWorker(action: ReturnType<typeof deleteFileWithUndoRequested>) {
  const [workspaceId, path, options] = action.payload;
  let snapshot: RestorableSnapshot | undefined;
  yield* call(
    deleteWithUndo,
    `"${path.split('/').pop()}"`,
    async () => {
      const request = deleteFileRequested(workspaceId, path, options);
      appStore.dispatch(request);
      snapshot = await request.promise;
    },
    async () => {
      if (!snapshot) throw new Error(m.fileExplorer_tree_undoUnavailable_error());
      const request = restoreFileContentRequested(
        workspaceId,
        path,
        options.absolutePath,
        snapshot,
      );
      appStore.dispatch(request);
      await request.promise;
    },
  );
}

// Source binding remains lazy for app-client replacement in tests and at runtime.
const filesSaveSaga = createFilesSaveSaga({
  files: { write: (...args) => appClient.files.write(...args) },
  readEntries: (workspaceId) => selectAllFileContentEntries.select(appStore.state, workspaceId),
  resolveWorkspacePath: (workspaceId) =>
    selectEffectiveFileExplorerWorkspacePath.select(appStore.state, workspaceId),
  onError: (error) => logger.error('Failed to save file content', error),
});

const filesAutosaveSaga = createFilesAutosaveSaga({ selectFileContentEntry });

export function* filesWriteSaga() {
  yield* takeEvery(deleteFileWithUndoRequested, deleteFileWithUndoWorker);
  yield* takeEvery(deleteFileRequested, deleteFileActionWorker);
  yield* takeEvery(restoreFileContentRequested, restoreFileActionWorker);
  yield* takeEvery(createFileRequested, createFileActionWorker);
  yield* fork(filesAutosaveSaga);
  yield* fork(filesSaveSaga);
}
