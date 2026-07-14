import { store } from "../../store";

export const selectAutoUpdateStatus = store.createSelector((state) => state.autoUpdate.status);

export const selectAutoUpdateCurrentVersion = store.createSelector(
  (state) => state.autoUpdate.currentVersion,
);

export const selectAutoUpdateInfo = store.createSelector((state) => state.autoUpdate.updateInfo);

export const selectAutoUpdateProgress = store.createSelector((state) => state.autoUpdate.progress);

export const selectAutoUpdateError = store.createSelector((state) => state.autoUpdate.error);

export const selectAutoUpdateToastVisible = store.createSelector(
  (state) => state.autoUpdate.toastVisible,
);

export const selectAutoUpdateDismissedAt = store.createSelector(
  (state) => state.autoUpdate.downloadedToastDismissedAt,
);

export const selectAutoUpdateChannel = store.createSelector(
  (state) => state.autoUpdate.channel,
);

export const selectIsDownloading = store.createSelector(
  (state) => state.autoUpdate.status === "downloading",
);

export const selectIsReadyToInstall = store.createSelector(
  (state) => state.autoUpdate.status === "downloaded",
);

