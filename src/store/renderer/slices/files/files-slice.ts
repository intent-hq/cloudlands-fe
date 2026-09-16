import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  removeItem,
  upsertItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  FileContentEntry,
  FileContentReadOptions,
  FileContentSaveOptions,
  LegacyFileDownloadResult,
  FilesState,
  FilesWorkspaceState,
} from './files-types';

export type { FileContentReadOptions, FileContentSaveOptions, FilesState, FilesWorkspaceState };

export const emptyFilesWorkspaceState: FilesWorkspaceState = {
  files: createCollection<FileContentEntry, 'path'>('path'),
  fileNameSearches: {},
  mediaResolutions: {},
};

export const initialState: FilesState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyFilesWorkspaceState);

function createEmptyFileEntry(path: string, absolutePath: string | null = null): FileContentEntry {
  return {
    path,
    absolutePath,
    originalContent: null,
    localContent: null,
    lastUpdated: 0,
    loading: false,
    saving: false,
    error: null,
    isBinary: false,
    truncated: false,
    notFoundCandidates: null,
  };
}

function upsertFileEntry(
  state: FilesState,
  wsId: string,
  path: string,
  updater: (entry: FileContentEntry) => FileContentEntry,
): FilesState {
  const workspaceState = getWorkspaceState(state, wsId);
  const current = getItem(workspaceState.files, path) ?? createEmptyFileEntry(path);
  const next = updater(current);
  if (next === current) return state;
  return setWorkspaceState(state, wsId, {
    ...workspaceState,
    files: upsertItem(workspaceState.files, next),
  });
}

function removeFileEntry(state: FilesState, wsId: string, path: string): FilesState {
  const workspaceState = state.byWorkspaceId[wsId];
  if (!workspaceState) return state;

  const files = removeItem(workspaceState.files, path);
  if (files === workspaceState.files) return state;

  return setWorkspaceState(state, wsId, {
    ...workspaceState,
    files,
  });
}

function bumpLastUpdated(entry: FileContentEntry): number {
  return entry.lastUpdated + 1;
}

export const removeFileContentEntry = createAction<[wsId: string, path: string]>(
  'files/removeFileContentEntry',
);

export const loadFileContentRequested = createAction<
  [wsId: string, path: string, absolutePath: string, options?: FileContentReadOptions]
>('files/loadFileContentRequested');

export const loadFileContentSucceeded = createAction<
  [
    wsId: string,
    path: string,
    absolutePath: string,
    content: string,
    isBinary?: boolean,
    truncated?: boolean,
  ]
>('files/loadFileContentSucceeded');

export const loadFileContentFailed = createAction<
  [wsId: string, path: string, absolutePath: string, error: string, notFoundCandidates?: string[]]
>('files/loadFileContentFailed');

export const updateFileContent =
  createAction<[wsId: string, path: string, content: string]>('files/updateFileContent');

export const saveFileContentRequested = createAction<
  [
    wsId: string,
    path: string,
    absolutePath: string,
    content: string,
    options?: FileContentSaveOptions,
  ]
>('files/saveFileContentRequested');

export const saveFileContentSucceeded = createAction<[wsId: string, path: string, content: string]>(
  'files/saveFileContentSucceeded',
);

export const saveFileContentFailed = createAction<[wsId: string, path: string, error: string]>(
  'files/saveFileContentFailed',
);

export const searchFileNamesRequested = createAction<
  [wsId: string, searchId: string, pattern: string, limit: number, debounceMs: number]
>('files/searchFileNamesRequested');
export const searchFileNamesSucceeded = createAction<
  [wsId: string, searchId: string, pattern: string, files: string[]]
>('files/searchFileNamesSucceeded');
export const searchFileNamesFailed = createAction<
  [wsId: string, searchId: string, pattern: string, error: string]
>('files/searchFileNamesFailed');

export const resolveWorkspaceMediaRequested = createAction<
  [wsId: string, resolutionId: string, requestedPath: string, sourcePath: string, tabId: string]
>('files/resolveWorkspaceMediaRequested');
export const resolveWorkspaceMediaSucceeded = createAction<
  [wsId: string, resolutionId: string, requestedPath: string, resolvedPath: string]
>('files/resolveWorkspaceMediaSucceeded');
export const resolveWorkspaceMediaFailed = createAction<
  [wsId: string, resolutionId: string, requestedPath: string, error: string]
>('files/resolveWorkspaceMediaFailed');

export const openLegacyFileRequested = createAsyncAction<
  [workspaceId: string, path: string],
  string
>('files/openLegacyFile', 'files/openLegacyFileRequested');
export const saveLegacyFileRequested = createAsyncAction<
  [workspaceId: string, path: string, content: string],
  void
>('files/saveLegacyFile', 'files/saveLegacyFileRequested');
export const readLegacyFileRequested = createAsyncAction<[path: string], string>(
  'files/readLegacyFile',
  'files/readLegacyFileRequested',
);
export const deleteLegacyFileRequested = createAsyncAction<
  [workspaceId: string, path: string],
  void
>('files/deleteLegacyFile', 'files/deleteLegacyFileRequested');
export const writeLegacyFileRequested = createAsyncAction<
  [workspaceId: string, path: string, content: string],
  void
>('files/writeLegacyFile', 'files/writeLegacyFileRequested');
export const downloadLegacyFileRequested = createAsyncAction<
  [path: string],
  LegacyFileDownloadResult
>('files/downloadLegacyFile', 'files/downloadLegacyFileRequested');
export const revealLegacyFileRequested = createAsyncAction<[path: string], void>(
  'files/revealLegacyFile',
  'files/revealLegacyFileRequested',
);

export const filesReducer = createReducer<FilesState>(initialState);
filesReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
filesReducer.with(removeFileContentEntry, (state, { payload: [wsId, path] }) =>
  removeFileEntry(state, wsId, path),
);
filesReducer.with(loadFileContentRequested, (state, { payload: [wsId, path, absolutePath] }) =>
  upsertFileEntry(state, wsId, path, (entry) => ({
    ...entry,
    absolutePath,
    loading: true,
    error: null,
    isBinary: false,
    truncated: false,
    notFoundCandidates: null,
  })),
);
filesReducer.with(
  loadFileContentSucceeded,
  (state, { payload: [wsId, path, absolutePath, content, isBinary, truncated] }) =>
    upsertFileEntry(state, wsId, path, (entry) => {
      const hasPendingEdits =
        entry.localContent !== null && entry.localContent !== entry.originalContent;
      const nextLocal = hasPendingEdits ? entry.localContent : content;
      return {
        ...entry,
        absolutePath,
        originalContent: content,
        localContent: nextLocal,
        loading: false,
        error: null,
        isBinary: isBinary ?? false,
        truncated: truncated ?? false,
        notFoundCandidates: null,
      };
    }),
);
filesReducer.with(
  loadFileContentFailed,
  (state, { payload: [wsId, path, absolutePath, error, notFoundCandidates] }) =>
    upsertFileEntry(state, wsId, path, (entry) => ({
      ...entry,
      absolutePath,
      originalContent: null,
      localContent: null,
      loading: false,
      error,
      truncated: false,
      notFoundCandidates: notFoundCandidates ?? null,
    })),
);
filesReducer.with(updateFileContent, (state, { payload: [wsId, path, content] }) =>
  upsertFileEntry(state, wsId, path, (entry) => {
    if (entry.localContent === content) return entry;
    return { ...entry, localContent: content };
  }),
);
filesReducer.with(saveFileContentRequested, (state, { payload: [wsId, path, absolutePath] }) =>
  upsertFileEntry(state, wsId, path, (entry) => ({
    ...entry,
    absolutePath,
    saving: true,
    error: null,
  })),
);
filesReducer.with(saveFileContentSucceeded, (state, { payload: [wsId, path, content] }) =>
  upsertFileEntry(state, wsId, path, (entry) => {
    const hasPendingEdits =
      entry.localContent !== null && entry.localContent !== entry.originalContent;
    const nextLocal = hasPendingEdits ? entry.localContent : content;
    return {
      ...entry,
      originalContent: content,
      localContent: nextLocal,
      lastUpdated: bumpLastUpdated(entry),
      saving: false,
      error: null,
      truncated: false,
    };
  }),
);
filesReducer.with(saveFileContentFailed, (state, { payload: [wsId, path, error] }) =>
  upsertFileEntry(state, wsId, path, (entry) => ({
    ...entry,
    saving: false,
    error,
  })),
);
filesReducer.with(searchFileNamesRequested, (state, { payload: [wsId, searchId, pattern] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...workspaceState,
    fileNameSearches: {
      ...workspaceState.fileNameSearches,
      [searchId]: { pattern, files: [], loading: pattern.length > 0, error: null },
    },
  });
});
filesReducer.with(
  searchFileNamesSucceeded,
  (state, { payload: [wsId, searchId, pattern, files] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.fileNameSearches[searchId]?.pattern !== pattern) return state;
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      fileNameSearches: {
        ...workspaceState.fileNameSearches,
        [searchId]: { pattern, files, loading: false, error: null },
      },
    });
  },
);
filesReducer.with(searchFileNamesFailed, (state, { payload: [wsId, searchId, pattern, error] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  if (workspaceState.fileNameSearches[searchId]?.pattern !== pattern) return state;
  return setWorkspaceState(state, wsId, {
    ...workspaceState,
    fileNameSearches: {
      ...workspaceState.fileNameSearches,
      [searchId]: { pattern, files: [], loading: false, error },
    },
  });
});
filesReducer.with(
  resolveWorkspaceMediaRequested,
  (state, { payload: [wsId, resolutionId, requestedPath] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      mediaResolutions: {
        ...workspaceState.mediaResolutions,
        [resolutionId]: { requestedPath, resolvedPath: null, loading: true, error: null },
      },
    });
  },
);
filesReducer.with(
  resolveWorkspaceMediaSucceeded,
  (state, { payload: [wsId, resolutionId, requestedPath, resolvedPath] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.mediaResolutions[resolutionId]?.requestedPath !== requestedPath)
      return state;
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      mediaResolutions: {
        ...workspaceState.mediaResolutions,
        [resolutionId]: { requestedPath, resolvedPath, loading: false, error: null },
      },
    });
  },
);
filesReducer.with(
  resolveWorkspaceMediaFailed,
  (state, { payload: [wsId, resolutionId, requestedPath, error] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.mediaResolutions[resolutionId]?.requestedPath !== requestedPath)
      return state;
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      mediaResolutions: {
        ...workspaceState.mediaResolutions,
        [resolutionId]: { requestedPath, resolvedPath: requestedPath, loading: false, error },
      },
    });
  },
);
