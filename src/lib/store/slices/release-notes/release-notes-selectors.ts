/**
 * Release Notes — Selectors
 */

import { createSelector } from "../../utils/create-selector";

export const selectReleaseNotes = createSelector(
  (state) => state.releaseNotes.releaseNotes,
);

export const selectShowReleaseNotesModal = createSelector(
  (state) => state.releaseNotes.showModal,
);

export const selectReleaseNotesLoading = createSelector(
  (state) => state.releaseNotes.loading,
);

export const selectReleaseNotesError = createSelector(
  (state) => state.releaseNotes.error,
);

export const selectReleaseNotesInitialized = createSelector(
  (state) => state.releaseNotes.initialized,
);

