import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";
import {
  createCollection,
  getItem,
  removeItem,
  upsertItem,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type {
  FileContentEntry,
  FileContentReadOptions,
  FileContentSaveOptions,
  FilesState,
  FilesWorkspaceState,
} from "./files-types";

export type { FileContentEntry, FileContentReadOptions, FileContentSaveOptions, FilesState, FilesWorkspaceState };

export const emptyFilesWorkspaceState: FilesWorkspaceState = {
  files: createCollection<FileContentEntry, "path">("path"),
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
  "files/removeFileContentEntry",
);

export const loadFileContentRequested = createAction<
  [wsId: string, path: string, absolutePath: string, options?: FileContentReadOptions]
>("files/loadFileContentRequested");

export const loadFileContentSucceeded = createAction<
  [wsId: string, path: string, absolutePath: string, content: string, isBinary?: boolean, truncated?: boolean]
>("files/loadFileContentSucceeded");

export const loadFileContentFailed = createAction<
  [wsId: string, path: string, absolutePath: string, error: string]
>("files/loadFileContentFailed");

export const updateFileContent = createAction<[wsId: string, path: string, content: string]>(
  "files/updateFileContent",
);

export const applyExternalFileContent = createAction<
  [wsId: string, path: string, content: string, isBinary?: boolean, truncated?: boolean]
>("files/applyExternalFileContent");

export const saveFileContentRequested = createAction<
  [wsId: string, path: string, absolutePath: string, content: string, options?: FileContentSaveOptions]
>("files/saveFileContentRequested");

export const saveFileContentSucceeded = createAction<[wsId: string, path: string, content: string]>(
  "files/saveFileContentSucceeded",
);

export const saveFileContentFailed = createAction<[wsId: string, path: string, error: string]>(
  "files/saveFileContentFailed",
);

export const filesReducer = createReducer<FilesState>(initialState)
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId))
  .with(removeFileContentEntry, (state, { payload: [wsId, path] }) => removeFileEntry(state, wsId, path))
  .with(loadFileContentRequested, (state, { payload: [wsId, path, absolutePath] }) =>
    upsertFileEntry(state, wsId, path, (entry) => ({
      ...entry,
      absolutePath,
      loading: true,
      error: null,
      isBinary: false,
      truncated: false,
    })),
  )
  .with(loadFileContentSucceeded, (state, { payload: [wsId, path, absolutePath, content, isBinary, truncated] }) =>
    upsertFileEntry(state, wsId, path, (entry) => {
      const hasPendingEdits = entry.localContent !== null && entry.localContent !== entry.originalContent;
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
      };
    }),
  )
  .with(loadFileContentFailed, (state, { payload: [wsId, path, absolutePath, error] }) =>
    upsertFileEntry(state, wsId, path, (entry) => ({
      ...entry,
      absolutePath,
      originalContent: null,
      localContent: null,
      loading: false,
      error,
      truncated: false,
    })),
  )
  .with(updateFileContent, (state, { payload: [wsId, path, content] }) =>
    upsertFileEntry(state, wsId, path, (entry) => {
      if (entry.localContent === content) return entry;
      return { ...entry, localContent: content };
    }),
  )
  .with(applyExternalFileContent, (state, { payload: [wsId, path, content, isBinary, truncated] }) =>
    upsertFileEntry(state, wsId, path, (entry) => {
      const hasPendingEdits = entry.localContent !== null && entry.localContent !== entry.originalContent;
      const nextLocal = hasPendingEdits ? entry.localContent : content;
      return {
        ...entry,
        originalContent: content,
        localContent: nextLocal,
        lastUpdated: bumpLastUpdated(entry),
        loading: false,
        error: null,
        isBinary: isBinary ?? entry.isBinary,
        truncated: truncated ?? false,
      };
    }),
  )
  .with(saveFileContentRequested, (state, { payload: [wsId, path, absolutePath] }) =>
    upsertFileEntry(state, wsId, path, (entry) => ({
      ...entry,
      absolutePath,
      saving: true,
      error: null,
    })),
  )
  .with(saveFileContentSucceeded, (state, { payload: [wsId, path, content] }) =>
    upsertFileEntry(state, wsId, path, (entry) => {
      const hasPendingEdits = entry.localContent !== null && entry.localContent !== entry.originalContent;
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
  )
  .with(saveFileContentFailed, (state, { payload: [wsId, path, error] }) =>
    upsertFileEntry(state, wsId, path, (entry) => ({
      ...entry,
      saving: false,
      error,
    })),
  );