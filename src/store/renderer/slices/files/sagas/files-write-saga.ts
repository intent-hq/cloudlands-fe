import {
  call,
  delay,
  put,
  race,
  take,
  takeEvery,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import { m } from '$shared/paraglide/messages.js';
import { createFileRequested } from '../../app-layout/app-layout-slice';
import { selectFileExplorerState } from '../../file-explorer/file-explorer-selectors';
import { refreshDirectoryRequested } from '../../file-explorer/file-explorer-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { openWorkspaceFile } from '../../workspace-navigation/workspace-navigation-slice';
import { selectFileContentEntry } from '../files-selectors';
import {
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
  updateFileContent,
} from '../files-slice';

const logger = createLogger('FilesWriteSaga');
export const FILE_CONTENT_SAVE_DEBOUNCE_MS = 1500;

type SaveRequest = {
  workspaceId: string;
  path: string;
  absolutePath: string;
  content: string;
};
type SaveAction = ReturnType<typeof saveFileContentRequested>;
type ObservedAction = { type: string; payload?: unknown };

function isWorkspaceCleanup(action: ObservedAction, workspaceId: string): boolean {
  return (
    (action.type === workspaceDeleted.type || action.type === workspaceUnmounted.type) &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId
  );
}

function isSaveFor(action: ObservedAction, workspaceId: string, path: string): boolean {
  return (
    action.type === saveFileContentRequested.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId &&
    action.payload[1] === path
  );
}

function* saveFileContentWorker(request: SaveRequest) {
  const { workspaceId, path, content } = request;
  try {
    const result: Awaited<ReturnType<typeof appClient.files.write>> = yield* call(
      [appClient.files, appClient.files.write],
      workspaceId,
      path,
      content,
    );
    if (result.success) {
      yield* put(saveFileContentSucceeded(workspaceId, path, content));
      return;
    }
    yield* put(
      saveFileContentFailed(
        workspaceId,
        path,
        result.error ?? m.fileExplorer_layout_saveFailed_error(),
      ),
    );
  } catch (error) {
    logger.error('Failed to save file content', error);
    const message = error instanceof Error ? error.message : String(error);
    yield* put(saveFileContentFailed(workspaceId, path, message));
  }
}

function* createFileWorker(workspaceId: string, folderPath: string, fileName: string) {
  const absoluteFilePath = `${folderPath}/${fileName}`;
  const explorer = yield* selectFileExplorerState.effect(workspaceId);
  const relativePath = stripWorkspacePrefix(absoluteFilePath, explorer.workspacePath);
  if (!explorer.workspacePath || !relativePath || relativePath === absoluteFilePath) {
    return;
  }
  try {
    const result: Awaited<ReturnType<typeof appClient.files.write>> = yield* call(
      [appClient.files, appClient.files.write],
      workspaceId,
      relativePath,
      '',
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

function* updateFileContentWorker(action: ReturnType<typeof updateFileContent>) {
  const [workspaceId, path, content] = action.payload;
  const entry = yield* selectFileContentEntry.effect(workspaceId, path);
  const absolutePath = entry?.absolutePath;
  if (!absolutePath) return;
  const { elapsed } = yield* race({
    elapsed: delay(FILE_CONTENT_SAVE_DEBOUNCE_MS, true),
    directSave: take((save: ObservedAction) => isSaveFor(save, workspaceId, path)),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
  if (elapsed) yield* put(saveFileContentRequested(workspaceId, path, absolutePath, content));
}

function* saveFileContentActionWorker(action: SaveAction) {
  const [workspaceId, path, absolutePath, content] = action.payload;
  yield* race({
    save: call(saveFileContentWorker, { workspaceId, path, absolutePath, content }),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

export function* filesWriteSaga() {
  yield* takeEvery(createFileRequested, createFileActionWorker);
  yield* takeEvery(updateFileContent, updateFileContentWorker);
  yield* takeEvery(saveFileContentRequested, saveFileContentActionWorker);
}
