import { store } from "../../store";
import type { DirectoryPickerListing } from "./directory-picker-slice";

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
