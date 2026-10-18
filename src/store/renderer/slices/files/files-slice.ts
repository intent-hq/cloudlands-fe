import { fileContentData } from '$features/file/utils/file-content';
import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  FileContentEntry,
  FileContentReadOptions,
  EditableText,
  RestorableSnapshot,
  FileContent,
  FileContentUpdateOptions,
  FileDeleteOptions,
  FilesState,
  FilesWorkspaceState,
} from './files-types';

export type { FileContentReadOptions, FilesState, FilesWorkspaceState };

export const emptyFilesWorkspaceState: FilesWorkspaceState = {
  files: createCollection<FileContentEntry, 'path'>('path'),
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
    ...fileContentData({ kind: 'preview-only', isBinary: false }),
    lastUpdated: 0,
    loading: false,
    saving: false,
    error: null,
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
  [wsId: string, path: string, absolutePath: string, content: FileContent, truncated?: boolean]
>('files/loadFileContentSucceeded');

export const loadFileContentFailed = createAction<
  [wsId: string, path: string, absolutePath: string, error: string, notFoundCandidates?: string[]]
>('files/loadFileContentFailed');

export const updateFileContent =
  createAction<
    [wsId: string, path: string, content: EditableText, options?: FileContentUpdateOptions]
  >('files/updateFileContent');

export const deleteFileWithUndoRequested = createAction<
  [wsId: string, path: string, options: FileDeleteOptions]
>('files/deleteFileWithUndoRequested');

export const deleteFileRequested = createAsyncAction<
  [wsId: string, path: string, options: FileDeleteOptions],
  RestorableSnapshot
>('files/deleteFileRequested', 'files/deleteFile');

export const restoreFileContentRequested = createAsyncAction<
  [wsId: string, path: string, absolutePath: string, snapshot: RestorableSnapshot],
  void
>('files/restoreFileContentRequested', 'files/restoreFileContent');

export const saveFileContentRequested = createAction<
  [wsId: string, path: string, absolutePath: string, content: EditableText]
>('files/saveFileContentRequested');

export const saveFileContentSucceeded = createAction<
  [wsId: string, path: string, content: EditableText | RestorableSnapshot]
>('files/saveFileContentSucceeded');

export const saveFileContentFailed = createAction<[wsId: string, path: string, error: string]>(
  'files/saveFileContentFailed',
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
    truncated: false,
    notFoundCandidates: null,
  })),
);
filesReducer.with(
  loadFileContentSucceeded,
  (state, { payload: [wsId, path, absolutePath, content, truncated] }) =>
    upsertFileEntry(state, wsId, path, (entry) => {
      const hasPendingEdits =
        entry.localContent !== null && entry.localContent !== entry.originalContent;
      const data = fileContentData(content);
      if (data.kind === 'editable-text' && entry.kind === 'editable-text' && hasPendingEdits) {
        data.localContent = entry.localContent;
      }
      return {
        ...entry,
        absolutePath,
        ...data,
        loading: false,
        error: null,
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
      ...fileContentData({ kind: 'preview-only', isBinary: entry.isBinary }),
      loading: false,
      error,
      truncated: false,
      notFoundCandidates: notFoundCandidates ?? null,
    })),
);
filesReducer.with(updateFileContent, (state, { payload: [wsId, path, content] }) =>
  upsertFileEntry(state, wsId, path, (entry) => {
    if (entry.kind !== 'editable-text' || entry.localContent === content.content) return entry;
    return { ...entry, localContent: content.content };
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
    // A write already in flight cannot replace a newer binary read in the cache.
    if (entry.isBinary) return { ...entry, saving: false };
    if (content.kind === 'restorable-snapshot' && content.isBinary) {
      return {
        ...entry,
        ...fileContentData(content),
        lastUpdated: bumpLastUpdated(entry),
        saving: false,
        error: null,
        truncated: false,
      };
    }
    const hasPendingEdits =
      entry.localContent !== null && entry.localContent !== entry.originalContent;
    const nextLocal = hasPendingEdits ? entry.localContent : content.content;
    return {
      ...entry,
      kind: 'editable-text',
      isBinary: false,
      originalContent: content.content,
      localContent: nextLocal ?? content.content,
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
