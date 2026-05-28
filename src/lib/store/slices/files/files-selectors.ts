import { createSelector } from "../../utils/create-selector";
import {
  getItem,
  getItems,
} from "../../utils/collection-utils";
import { emptyFilesWorkspaceState } from "./files-slice";
import type { FileContentEntry, FilesWorkspaceState } from "./files-types";

export const selectFilesWorkspaceState = createSelector(
  (state, wsId: string): FilesWorkspaceState => state.files.byWorkspaceId[wsId] ?? emptyFilesWorkspaceState,
);

export const selectAllFileContentEntries = createSelector((state, wsId: string): FileContentEntry[] => {
  return getItems(selectFilesWorkspaceState.select(state, wsId).files);
});

export const selectFileContentEntry = createSelector(
  (state, wsId: string, path: string | null | undefined): FileContentEntry | undefined => {
    if (!path) return undefined;
    return getItem(selectFilesWorkspaceState.select(state, wsId).files, path);
  },
);

export const selectFileContent = createSelector(
  (state, wsId: string, path: string | null | undefined): string | null =>
    selectFileContentEntry.select(state, wsId, path)?.localContent ?? null,
);

export const selectOriginalFileContent = createSelector(
  (state, wsId: string, path: string | null | undefined): string | null =>
    selectFileContentEntry.select(state, wsId, path)?.originalContent ?? null,
);

export const selectFileLastUpdated = createSelector(
  (state, wsId: string, path: string | null | undefined): number =>
    selectFileContentEntry.select(state, wsId, path)?.lastUpdated ?? 0,
);

export const selectFileLoading = createSelector(
  (state, wsId: string, path: string | null | undefined): boolean =>
    selectFileContentEntry.select(state, wsId, path)?.loading ?? false,
);

export const selectFileSaving = createSelector(
  (state, wsId: string, path: string | null | undefined): boolean =>
    selectFileContentEntry.select(state, wsId, path)?.saving ?? false,
);

export const selectFileError = createSelector(
  (state, wsId: string, path: string | null | undefined): string | null =>
    selectFileContentEntry.select(state, wsId, path)?.error ?? null,
);

export const selectFileIsBinary = createSelector(
  (state, wsId: string, path: string | null | undefined): boolean =>
    selectFileContentEntry.select(state, wsId, path)?.isBinary ?? false,
);

export const selectFileTruncated = createSelector(
  (state, wsId: string, path: string | null | undefined): boolean =>
    selectFileContentEntry.select(state, wsId, path)?.truncated ?? false,
);

export const selectFileIsDirty = createSelector(
  (state, wsId: string, path: string | null | undefined): boolean => {
    const entry = selectFileContentEntry.select(state, wsId, path);
    return entry ? entry.localContent !== entry.originalContent : false;
  },
);
