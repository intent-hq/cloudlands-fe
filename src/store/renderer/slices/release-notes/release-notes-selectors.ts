import { store } from '../../store';
/**
 * Release Notes — Selectors
 */

export const selectReleaseNotes = store.createSelector((state) => state.releaseNotes.releaseNotes);

export const selectShowReleaseNotesModal = store.createSelector(
  (state) => state.releaseNotes.showModal,
);

/** Actual native view visibility, including the period while a switch is starting. */
export const selectReleaseNotesRendererShown = store.createSelector((state): boolean => {
  const rail = state.machineRail;
  const shownId = rail?.shownId || rail?.selectedId;
  return !rail?.enabled || !shownId || shownId === state.connections.windowBackendId;
});
