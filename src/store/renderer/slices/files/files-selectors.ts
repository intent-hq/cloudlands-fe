import { store } from '../../store';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { emptyFilesWorkspaceState } from './files-slice';
import { getFileContentEntry, getFileIsDirty } from './files-projections';
import type { FileContentEntry, FilesWorkspaceState } from './files-types';

const selectFilesWorkspaceState = store.createSelector(
  (state, wsId: string): FilesWorkspaceState =>
    state.files.byWorkspaceId[wsId] ?? emptyFilesWorkspaceState,
);

export const selectAllFileContentEntries = store.createSelector(
  (state, wsId: string): FileContentEntry[] => {
    return getItems(selectFilesWorkspaceState.select(state, wsId).files);
  },
);

export const selectFileContentEntry = store.createSelector(getFileContentEntry);

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

export const selectFileNotFoundCandidates = store.createSelector(
  (state, wsId: string, path: string | null | undefined): string[] | null =>
    selectFileContentEntry.select(state, wsId, path)?.notFoundCandidates ?? null,
);

export const selectFileIsBinary = store.createSelector(
  (state, wsId: string, path: string | null | undefined): boolean =>
    selectFileContentEntry.select(state, wsId, path)?.isBinary ?? false,
);

export const selectFileIsDirty = store.createSelector(getFileIsDirty);
