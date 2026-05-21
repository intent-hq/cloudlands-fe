import { call, cancelled, delay, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import type { Task } from 'redux-saga';
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
  refreshOpenFileContentForPathsRequested,
  refreshFileContentRequested,
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
} from '../files-slice';
import type {
  AgentFileChangedEvent,
  FileChangedEvent,
  FileContentChangedEvent,
  FileContentEntry,
  FileReadResponse,
  FileWriteResponse,
  WatcherFileChangedEvent,
} from '../files-types';

const STALE_WRITE_ERROR =
  'File changed on disk. Reload the file before saving to avoid overwriting external changes.';
const WATCHER_FILE_CHANGED_DEBOUNCE_MS = 100;
const pendingWatcherFileChangedEvents = new Map<string, WatcherFileChangedEvent>();
let watcherFileChangedFlushTask: Task | null = null;

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
  return (
    message.includes('ENOENT') || message.includes('not found') || message.includes('no such file')
  );
}

function eventPathMatchesEntry(
  eventPaths: Array<string | undefined>,
  entry: FileContentEntry,
): boolean {
  return eventPaths.some(
    (eventPath) => pathsMatch(eventPath, entry.path) || pathsMatch(eventPath, entry.absolutePath),
  );
}

function entryHasPendingEdits(entry: FileContentEntry): boolean {
  return entry.localContent !== null && entry.localContent !== entry.originalContent;
}

function canRefreshOpenEntryFromDisk(entry: FileContentEntry): boolean {
  return !entry.saving && !entryHasPendingEdits(entry);
}

function getEventPaths(data: FileContentChangedEvent | AgentFileChangedEvent): string[] {
  return [data.path, data.filePath, 'relativePath' in data ? data.relativePath : undefined].filter(
    (path): path is string => typeof path === 'string' && path.length > 0,
  );
}

function actionRefreshesContent(action: string | undefined): boolean {
  if (!action) return true;
  return action.toLowerCase() !== 'delete';
}

function getFileChangedEventPaths(data: FileChangedEvent): string[] {
  const paths: string[] = [];
  if (actionRefreshesContent(data.data?.action)) {
    if (data.data?.path) paths.push(data.data.path);
    if (data.data?.relativePath) paths.push(data.data.relativePath);
  }

  for (const file of data.data?.files ?? []) {
    if (typeof file === 'string') {
      paths.push(file);
    } else if (actionRefreshesContent(file.action)) {
      if (file.path) paths.push(file.path);
      if (file.relativePath) paths.push(file.relativePath);
    }
  }

  return paths;
}

function getWatcherFileChangedBatchKey(data: WatcherFileChangedEvent): string {
  return `${data.workspaceId}:${data.relativePath || data.path}`;
}

export function* processWatcherFileChangedEvent(
  data: WatcherFileChangedEvent,
): SagaGenerator<void> {
  const { workspaceId: wsId, path, relativePath } = data;
  if (!wsId) return;

  const entries = yield* selectAllFileContentEntries.effect(wsId);
  for (const entry of entries) {
    if (canRefreshOpenEntryFromDisk(entry) && eventPathMatchesEntry([path, relativePath], entry)) {
      yield* put(refreshFileContentRequested(wsId, entry.path, entry.absolutePath ?? entry.path));
    }
  }
}

function* flushWatcherFileChangedEvents(): SagaGenerator<void> {
  try {
    yield* delay(WATCHER_FILE_CHANGED_DEBOUNCE_MS);
    const events = Array.from(pendingWatcherFileChangedEvents.values());
    pendingWatcherFileChangedEvents.clear();
    for (const event of events) {
      yield* call(processWatcherFileChangedEvent, event);
    }
  } finally {
    watcherFileChangedFlushTask = null;
    if (yield* cancelled()) {
      pendingWatcherFileChangedEvents.clear();
    } else if (pendingWatcherFileChangedEvents.size > 0) {
      watcherFileChangedFlushTask = yield* fork(flushWatcherFileChangedEvents);
    }
  }
}

export function* handleWatcherFileChangedEvent(
  data: WatcherFileChangedEvent,
): SagaGenerator<void> {
  pendingWatcherFileChangedEvents.set(getWatcherFileChangedBatchKey(data), data);
  if (!watcherFileChangedFlushTask) {
    watcherFileChangedFlushTask = yield* fork(flushWatcherFileChangedEvents);
  }
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

export function* handleRefreshOpenFileContentForPathsRequested(
  action: ReturnType<typeof refreshOpenFileContentForPathsRequested>,
): SagaGenerator<void> {
  const [wsId, paths] = action.payload;
  if (!wsId || paths.length === 0) return;

  const entries = yield* selectAllFileContentEntries.effect(wsId);
  for (const entry of entries) {
    if (!canRefreshOpenEntryFromDisk(entry)) continue;
    if (eventPathMatchesEntry(paths, entry)) {
      yield* put(refreshFileContentRequested(wsId, entry.path, entry.absolutePath ?? entry.path));
    }
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
  const eventPaths = getEventPaths(data);
  if (eventPaths.length === 0) return;

  const entries = yield* selectAllFileContentEntries.effect(wsId);
  for (const entry of entries) {
    if (!eventPathMatchesEntry(eventPaths, entry)) continue;
    if (typeof data.content === 'string') {
      if (entry.saving) continue;
      yield* put(applyExternalFileContent(wsId, entry.path, data.content, entry.isBinary));
    } else if (canRefreshOpenEntryFromDisk(entry)) {
      yield* put(refreshFileContentRequested(wsId, entry.path, entry.absolutePath ?? entry.path));
    }
  }
}

export function* handleAgentFileChangedEvent(data: AgentFileChangedEvent): SagaGenerator<void> {
  const wsId = data.workspaceId;
  if (!wsId) return;
  const eventPaths = getEventPaths(data);
  if (eventPaths.length === 0) return;

  const entries = yield* selectAllFileContentEntries.effect(wsId);
  for (const entry of entries) {
    if (canRefreshOpenEntryFromDisk(entry) && eventPathMatchesEntry(eventPaths, entry)) {
      yield* put(refreshFileContentRequested(wsId, entry.path, entry.absolutePath ?? entry.path));
    }
  }
}

export function* handleFileChangedEvent(data: FileChangedEvent): SagaGenerator<void> {
  const wsId = data.workspaceId;
  if (!wsId) return;
  const eventPaths = getFileChangedEventPaths(data);
  if (eventPaths.length === 0) return;

  const entries = yield* selectAllFileContentEntries.effect(wsId);
  for (const entry of entries) {
    if (canRefreshOpenEntryFromDisk(entry) && eventPathMatchesEntry(eventPaths, entry)) {
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

	// NOTE: Redundant once watcher:file-changed direct subscription is stable. See spec.
export function* watchFileChangedGlobal() {
  yield* takeEveryFromElectronChannel<FileChangedEvent>('file:changed', handleFileChangedEvent);
}

export function* watchWatcherFileChanged() {
  yield* takeEveryFromElectronChannel<WatcherFileChangedEvent>(
    'watcher:file-changed',
    handleWatcherFileChangedEvent,
  );
}

export function* filesSaga(): SagaGenerator<void> {
  yield* fork(watchGlobalFileContentChanged);
  yield* fork(watchAgentFileChangedGlobal);
  yield* fork(watchFileChangedGlobal);
	yield* fork(watchWatcherFileChanged);
  yield* takeEvery(loadFileContentRequested, handleLoadFileContentRequested);
  yield* takeEvery(refreshFileContentRequested, handleRefreshFileContentRequested);
  yield* takeEvery(
    refreshOpenFileContentForPathsRequested,
    handleRefreshOpenFileContentForPathsRequested,
  );
  yield* takeEvery(saveFileContentRequested, handleSaveFileContentRequested);
}
