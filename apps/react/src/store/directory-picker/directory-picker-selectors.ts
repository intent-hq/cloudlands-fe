// ReactStore binding for the canonical directory-picker slice.
import { store } from '../index';
import type { DirectoryPickerListing } from '$store/renderer/slices/directory-picker/directory-picker-slice';

export const selectDirectoryPickerListing = store.createSelector(
  (state): DirectoryPickerListing | null => state.directoryPicker.listing,
);

export const selectDirectoryPickerLoading = store.createSelector(
  (state): boolean => state.directoryPicker.loading,
);

export const selectDirectoryPickerError = store.createSelector(
  (state): string | null => state.directoryPicker.error,
);

export const selectDirectoryPickerPathError = store.createSelector(
  (state): string | null => state.directoryPicker.pathError,
);

export const selectDirectoryPickerCreateError = store.createSelector(
  (state): string | null => state.directoryPicker.createError,
);
