import { createSelector } from "../../utils/create-selector";

export const selectAutoUpdateStatus = createSelector((state) => state.autoUpdate.status);

export const selectAutoUpdateCurrentVersion = createSelector(
  (state) => state.autoUpdate.currentVersion,
);

export const selectAutoUpdateInfo = createSelector((state) => state.autoUpdate.updateInfo);

export const selectAutoUpdateProgress = createSelector((state) => state.autoUpdate.progress);

export const selectAutoUpdateError = createSelector((state) => state.autoUpdate.error);

export const selectAutoUpdateChannel = createSelector((state) => state.autoUpdate.channel);

export const selectAutoUpdateToastVisible = createSelector(
  (state) => state.autoUpdate.toastVisible,
);

export const selectAutoUpdateDismissedAt = createSelector(
  (state) => state.autoUpdate.downloadedToastDismissedAt,
);

export const selectIsUpdateAvailable = createSelector(
  (state) => state.autoUpdate.status === "available",
);

export const selectIsDownloading = createSelector(
  (state) => state.autoUpdate.status === "downloading",
);

export const selectIsReadyToInstall = createSelector(
  (state) => state.autoUpdate.status === "downloaded",
);

export const selectIsChecking = createSelector(
  (state) => state.autoUpdate.status === "checking",
);

export const selectHasError = createSelector((state) => state.autoUpdate.status === "error");

