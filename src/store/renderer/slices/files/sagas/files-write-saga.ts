import { call, cancelled, delay, put, race, take, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import { m } from '$shared/paraglide/messages.js';
import { createFileRequested } from '../../app-layout/app-layout-slice';
import { selectFileExplorerState } from '../../file-explorer/file-explorer-selectors';
import { refreshDirectoryRequested } from '../../file-explorer/file-explorer-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { openWorkspaceFile } from '../../workspace-navigation/workspace-navigation-slice';
import { selectFileContentEntry } from '../files-selectors';
import {
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
  updateFileContent,
  deleteLegacyFileRequested,
  downloadLegacyFileRequested,
  openLegacyFileRequested,
  readLegacyFileRequested,
  revealLegacyFileRequested,
  saveLegacyFileRequested,
  writeLegacyFileRequested,
} from '../files-slice';
import type { LegacyFileDownloadResult } from '../files-types';

const logger = createLogger('FilesWriteSaga');
export const FILE_CONTENT_SAVE_DEBOUNCE_MS = 1500;
const pendingFileSaves = new Map<string, Promise<void>>();

function invokeLegacyOpen(workspaceId: string, path: string) {
  return invoke<{ success?: boolean; content?: string; error?: string }>('file:open', {
    path,
    workspaceId,
  });
}

function invokeLegacySave(workspaceId: string, filePath: string, content: string) {
  return invoke<{ success?: boolean; error?: string }>('file:save', {
    filePath,
    content,
    workspaceId,
  });
}

function invokeLegacyRead(path: string) {
  return invoke<{ content?: string }>('file:read', { path });
}

function invokeLegacyDelete(workspaceId: string, path: string) {
  return invoke<{ success?: boolean; error?: string }>('file:delete', {
    path,
    ...(workspaceId ? { workspaceId } : {}),
  });
}

function invokeLegacyWrite(workspaceId: string, path: string, content: string) {
  return invoke('file:write', { path, content, workspaceId });
}

function invokeLegacyDownload(path: string) {
  return invoke<{
    success?: boolean;
    canceled?: boolean;
    data?: { filePath?: string };
    error?: { message?: string };
  }>('file:download', { path });
}

function invokeLegacyReveal(path: string) {
  return invoke('shell:showItemInFolder', { path });
}

function emitFileDeleted(workspaceId: string, filePath: string) {
  dispatchWindowEvent('file:changed', { workspaceId, type: 'delete', filePath });
}

function emitFileCreated(workspaceId: string, filePath: string) {
  dispatchWindowEvent('file:changed', { workspaceId, type: 'create', filePath });
}

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
    action.type === workspaceUnmounted.type &&
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
  const [workspaceId, path] = action.payload;
  const entry = yield* selectFileContentEntry.effect(workspaceId, path);
  if (!entry?.absolutePath) return;
  const { elapsed } = yield* race({
    elapsed: delay(FILE_CONTENT_SAVE_DEBOUNCE_MS, true),
    directSave: take((save: ObservedAction) => isSaveFor(save, workspaceId, path)),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
  if (!elapsed) return;
  const latestEntry = yield* selectFileContentEntry.effect(workspaceId, path);
  if (!latestEntry?.absolutePath || latestEntry.localContent === null) return;
  yield* put(
    saveFileContentRequested(workspaceId, path, latestEntry.absolutePath, latestEntry.localContent),
  );
}

function* saveFileContentActionWorker(action: SaveAction) {
  const [workspaceId, path, absolutePath, content] = action.payload;
  const key = JSON.stringify([workspaceId, path]);
  const previousSave = pendingFileSaves.get(key);
  let completeSave!: () => void;
  const currentSave = new Promise<void>((resolve) => {
    completeSave = resolve;
  });
  pendingFileSaves.set(key, currentSave);

  try {
    if (previousSave) {
      const { ready } = yield* race({
        ready: call(() => previousSave.then(() => true)),
        cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
      });
      if (!ready) return;
    }
    yield* race({
      save: call(saveFileContentWorker, { workspaceId, path, absolutePath, content }),
      cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
    });
  } finally {
    completeSave();
    if (pendingFileSaves.get(key) === currentSave) pendingFileSaves.delete(key);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function* openLegacyFileWorker(action: ReturnType<typeof openLegacyFileRequested>) {
  let settled = false;
  try {
    const [workspaceId, path] = action.payload;
    const result = yield* call(invokeLegacyOpen, workspaceId, path);
    if (!result?.success)
      throw new Error(result?.error ?? m.fileExplorer_layout_loadFailed_error());
    yield* put(action.success(result.content ?? ''));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('File open cancelled')));
  }
}

function* saveLegacyFileWorker(action: ReturnType<typeof saveLegacyFileRequested>) {
  let settled = false;
  try {
    const [workspaceId, filePath, content] = action.payload;
    const result = yield* call(invokeLegacySave, workspaceId, filePath, content);
    if (!result?.success)
      throw new Error(result?.error ?? m.fileExplorer_layout_saveFailed_error());
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('File save cancelled')));
  }
}

function* readLegacyFileWorker(action: ReturnType<typeof readLegacyFileRequested>) {
  let settled = false;
  try {
    const result = yield* call(invokeLegacyRead, action.payload[0]);
    yield* put(action.success(result?.content ?? ''));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('File read cancelled')));
  }
}

function* deleteLegacyFileWorker(action: ReturnType<typeof deleteLegacyFileRequested>) {
  let settled = false;
  try {
    const [workspaceId, path] = action.payload;
    const result = yield* call(invokeLegacyDelete, workspaceId, path);
    if (!result?.success)
      throw new Error(result?.error ?? m.fileExplorer_tree_deleteFailed_error());
    yield* call(emitFileDeleted, workspaceId, path);
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('File delete cancelled')));
  }
}

function* writeLegacyFileWorker(action: ReturnType<typeof writeLegacyFileRequested>) {
  let settled = false;
  try {
    const [workspaceId, path, content] = action.payload;
    yield* call(invokeLegacyWrite, workspaceId, path, content);
    yield* call(emitFileCreated, workspaceId, path);
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('File write cancelled')));
  }
}

function* downloadLegacyFileWorker(action: ReturnType<typeof downloadLegacyFileRequested>) {
  let settled = false;
  try {
    const result = yield* call(invokeLegacyDownload, action.payload[0]);
    const mapped: LegacyFileDownloadResult = {
      success: result?.success === true,
      ...(result?.canceled !== undefined ? { canceled: result.canceled } : {}),
      ...(result?.data?.filePath ? { filePath: result.data.filePath } : {}),
      ...(result?.error?.message ? { error: result.error.message } : {}),
    };
    yield* put(action.success(mapped));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('File download cancelled')));
    }
  }
}

function* revealLegacyFileWorker(action: ReturnType<typeof revealLegacyFileRequested>) {
  let settled = false;
  try {
    yield* call(invokeLegacyReveal, action.payload[0]);
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('File reveal cancelled')));
    }
  }
}

export function* filesWriteSaga() {
  yield* takeEvery(createFileRequested, createFileActionWorker);
  yield* takeEvery(updateFileContent, updateFileContentWorker);
  yield* takeEvery(saveFileContentRequested, saveFileContentActionWorker);
  yield* takeEvery(openLegacyFileRequested, openLegacyFileWorker);
  yield* takeEvery(saveLegacyFileRequested, saveLegacyFileWorker);
  yield* takeEvery(readLegacyFileRequested, readLegacyFileWorker);
  yield* takeEvery(deleteLegacyFileRequested, deleteLegacyFileWorker);
  yield* takeEvery(writeLegacyFileRequested, writeLegacyFileWorker);
  yield* takeEvery(downloadLegacyFileRequested, downloadLegacyFileWorker);
  yield* takeEvery(revealLegacyFileRequested, revealLegacyFileWorker);
}
