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

export const selectReleaseNotesInitialized = store.createSelector(
  (state) => state.releaseNotes.initialized,
);

