import { call, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { invoke } from '$lib/electron-bridge';
import { takeEveryFromElectronChannel } from '$lib/store/utils/ipc-channel';
import { pathsMatch } from '$lib/utils/file-utils';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { selectAllFileContentEntries, selectFileContentEntry } from '../files-selectors';
import {
  applyExternalFileContent,
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
  refreshFileContentRequested,
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
} from '../files-slice';
import type {
  AgentFileChangedEvent,
  FileContentChangedEvent,
  FileContentEntry,
  FileReadResponse,
  FileWriteResponse,
} from '../files-types';

const STALE_WRITE_ERROR =
  'File changed on disk. Reload the file before saving to avoid overwriting external changes.';

function formatIpcError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const maybeError = error as { message?: string; code?: string } | null | undefined;
  return maybeError?.message ?? maybeError?.code ?? 'Unknown error';
}

function normalizeFileReadResponse(response: FileReadResponse): {
  content: string;
  isBinary: boolean;
  truncated: boolean;
} {
  if (response.success === false) {
    throw new Error(formatIpcError(response.error));
  }
  const data = response.data;
  if (typeof data === 'string') return { content: data, isBinary: false, truncated: false };
  return {
    content: data?.content ?? '',
    isBinary: data?.isBinary ?? false,
    truncated: data?.truncated ?? false,
  };
}

function isMissingFileError(message: string): boolean {
  return message.includes('ENOENT') || message.includes('not found') || message.includes('no such file');
}

function eventPathMatchesEntry(eventPath: string | undefined, entry: FileContentEntry): boolean {
  return pathsMatch(eventPath, entry.path) || pathsMatch(eventPath, entry.absolutePath);
}

function getEventPath(data: FileContentChangedEvent | AgentFileChangedEvent): string | undefined {
  return data.path ?? data.filePath ?? ('relativePath' in data ? data.relativePath : undefined);
}

export function* handleLoadFileContentRequested(
  action: ReturnType<typeof loadFileContentRequested>,
): SagaGenerator<void> {
  const [wsId, path, absolutePath, options] = action.payload;
  try {
    const response = yield* call(invoke<FileReadResponse>, 'file:read', {
      workspaceId: wsId,
      path: absolutePath,
      ...options,
    });
    const { content, isBinary, truncated } = normalizeFileReadResponse(response);
    yield* put(loadFileContentSucceeded(wsId, path, absolutePath, content, isBinary, truncated));
  } catch (error) {
    const message = formatIpcError(error);
    if (
      message.includes('ENOENT') ||
      message.includes('not found') ||
      message.includes('no such file')
    ) {
      yield* put(loadFileContentSucceeded(wsId, path, absolutePath, '', false, false));
      return;
    }
    yield* put(loadFileContentFailed(wsId, path, absolutePath, message));
  }
}

export function* handleRefreshFileContentRequested(
  action: ReturnType<typeof refreshFileContentRequested>,
): SagaGenerator<void> {
  const [wsId, path, absolutePath, options] = action.payload;
  try {
    const response = yield* call(invoke<FileReadResponse>, 'file:read', {
      workspaceId: wsId,
      path: absolutePath,
      ...options,
    });
    const { content, isBinary, truncated } = normalizeFileReadResponse(response);
    yield* put(applyExternalFileContent(wsId, path, content, isBinary, truncated));
  } catch (error) {
    yield* put(loadFileContentFailed(wsId, path, absolutePath, formatIpcError(error)));
  }
}

export function* handleSaveFileContentRequested(
  action: ReturnType<typeof saveFileContentRequested>,
): SagaGenerator<void> {
  const [wsId, path, absolutePath, content, options] = action.payload;
  const isRestore = options?.intent === 'restore';
  try {
    const entry = yield* selectFileContentEntry.effect(wsId, path);
    if (!isRestore && entry?.originalContent != null) {
      let currentDiskContent: string;
      try {
        const readResponse = yield* call(invoke<FileReadResponse>, 'file:read', {
          workspaceId: wsId,
          path: absolutePath,
        });
        currentDiskContent = normalizeFileReadResponse(readResponse).content;
      } catch (error) {
        const message = formatIpcError(error);
        if (!isMissingFileError(message)) throw error;
        currentDiskContent = '';
      }

      if (currentDiskContent !== entry.originalContent) {
        throw new Error(STALE_WRITE_ERROR);
      }
    }

    const response = yield* call(invoke<FileWriteResponse>, 'file:write', {
      workspaceId: wsId,
      path: absolutePath,
      content,
    });
    if (response.success === false) {
      throw new Error(formatIpcError(response.error));
    }
    yield* put(saveFileContentSucceeded(wsId, path, content));
    yield* call(() =>
      dispatchWindowEvent('file:changed', {
        workspaceId: wsId,
        files: [absolutePath],
        type: isRestore ? 'create' : 'change',
      }),
    );
  } catch (error) {
    yield* put(saveFileContentFailed(wsId, path, formatIpcError(error)));
  }
}

export function* handleFileContentChangedEvent(
  wsId: string,
  data: FileContentChangedEvent,
): SagaGenerator<void> {
  if (!data.workspaceId) return;
  if (data.workspaceId && data.workspaceId !== wsId) return;
  const eventPath = getEventPath(data);
  if (!eventPath) return;

  const entries = yield* selectAllFileContentEntries.effect(wsId);
  for (const entry of entries) {
    if (!eventPathMatchesEntry(eventPath, entry)) continue;
    if (entry.saving) continue;
    if (typeof data.content === 'string') {
      yield* put(applyExternalFileContent(wsId, entry.path, data.content, entry.isBinary));
    } else {
      yield* put(refreshFileContentRequested(wsId, entry.path, entry.absolutePath ?? entry.path));
    }
  }
}

export function* handleAgentFileChangedEvent(data: AgentFileChangedEvent): SagaGenerator<void> {
  const wsId = data.workspaceId;
  if (!wsId) return;
  const eventPath = getEventPath(data);
  if (!eventPath) return;

  const entries = yield* selectAllFileContentEntries.effect(wsId);
  for (const entry of entries) {
    if (!entry.saving && eventPathMatchesEntry(eventPath, entry)) {
      yield* put(refreshFileContentRequested(wsId, entry.path, entry.absolutePath ?? entry.path));
    }
  }
}

export function* watchGlobalFileContentChanged() {
  yield* takeEveryFromElectronChannel<FileContentChangedEvent>(
    'file:content-changed',
    function* (data) {
      yield* call(handleFileContentChangedEvent, data.workspaceId ?? '', data);
    },
  );
}

export function* watchAgentFileChangedGlobal() {
  yield* takeEveryFromElectronChannel<AgentFileChangedEvent>(
    'file-tracking:agent-file-changed',
    handleAgentFileChangedEvent,
  );
}

export function* filesSaga(): SagaGenerator<void> {
  yield* fork(watchGlobalFileContentChanged);
  yield* fork(watchAgentFileChangedGlobal);
  yield* takeEvery(loadFileContentRequested, handleLoadFileContentRequested);
  yield* takeEvery(refreshFileContentRequested, handleRefreshFileContentRequested);
  yield* takeEvery(saveFileContentRequested, handleSaveFileContentRequested);
}
