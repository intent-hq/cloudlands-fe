import { store } from '../index';

export const selectAutoUpdateStatus = store.createSelector((state) => state.autoUpdate.status);
export const selectAutoUpdateCurrentVersion = store.createSelector(
  (state) => state.autoUpdate.currentVersion,
);
export const selectAutoUpdateInfo = store.createSelector((state) => state.autoUpdate.updateInfo);
export const selectAutoUpdateProgress = store.createSelector((state) => state.autoUpdate.progress);
export const selectAutoUpdateError = store.createSelector((state) => state.autoUpdate.error);
