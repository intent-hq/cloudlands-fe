import { store } from "../../store";
/**
 * Release Notes — Selectors
 */


export const selectReleaseNotes = store.createSelector(
  (state) => state.releaseNotes.releaseNotes,
);

export const selectShowReleaseNotesModal = store.createSelector(
  (state) => state.releaseNotes.showModal,
);

export const selectReleaseNotesLoading = store.createSelector(
  (state) => state.releaseNotes.loading,
);

export const selectReleaseNotesError = store.createSelector(
  (state) => state.releaseNotes.error,
);

export const selectReleaseNotesInitialized = store.createSelector(
  (state) => state.releaseNotes.initialized,
);

