import { store } from '../../store';
import type { DirectoryPickerListing, DirectoryPickerSource } from './directory-picker-slice';

export const selectDirectoryPickerSource = store.createSelector(
  (state): DirectoryPickerSource => state.directoryPicker.source ?? 'daemon',
);

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
