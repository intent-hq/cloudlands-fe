import { store } from "../../store";
import {
  getItem,
  getItems,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import { emptyFilesWorkspaceState } from "./files-slice";
import type { FileContentEntry, FilesWorkspaceState } from "./files-types";

const selectFilesWorkspaceState = store.createSelector(
  (state, wsId: string): FilesWorkspaceState => state.files.byWorkspaceId[wsId] ?? emptyFilesWorkspaceState,
);

export const selectAllFileContentEntries = store.createSelector((state, wsId: string): FileContentEntry[] => {
  return getItems(selectFilesWorkspaceState.select(state, wsId).files);
});

export const selectFileContentEntry = store.createSelector(
  (state, wsId: string, path: string | null | undefined): FileContentEntry | undefined => {
    if (!path) return undefined;
    return getItem(selectFilesWorkspaceState.select(state, wsId).files, path);
  },
);

export const selectFileContent = store.createSelector(
  (state, wsId: string, path: string | null | undefined): string | null =>
    selectFileContentEntry.select(state, wsId, path)?.localContent ?? null,
);

export const selectOriginalFileContent = store.createSelector(
  (state, wsId: string, path: string | null | undefined): string | null =>
    selectFileContentEntry.select(state, wsId, path)?.originalContent ?? null,
);

export const selectFileLastUpdated = store.createSelector(
  (state, wsId: string, path: string | null | undefined): number =>
    selectFileContentEntry.select(state, wsId, path)?.lastUpdated ?? 0,
);

export const selectFileLoading = store.createSelector(
  (state, wsId: string, path: string | null | undefined): boolean =>
    selectFileContentEntry.select(state, wsId, path)?.loading ?? false,
);

export const selectFileSaving = store.createSelector(
  (state, wsId: string, path: string | null | undefined): boolean =>
    selectFileContentEntry.select(state, wsId, path)?.saving ?? false,
);

export const selectFileError = store.createSelector(
  (state, wsId: string, path: string | null | undefined): string | null =>
    selectFileContentEntry.select(state, wsId, path)?.error ?? null,
);

export const selectFileIsBinary = store.createSelector(
  (state, wsId: string, path: string | null | undefined): boolean =>
    selectFileContentEntry.select(state, wsId, path)?.isBinary ?? false,
);

export const selectFileIsDirty = store.createSelector(
  (state, wsId: string, path: string | null | undefined): boolean => {
    const entry = selectFileContentEntry.select(state, wsId, path);
    return entry ? entry.localContent !== entry.originalContent : false;
  },
);
