import { createSelector } from "../../utils/create-selector";

export const selectNodeVersionOk = createSelector((state) => {
  return state.systemStatus.nodeVersionOk;
});

export const selectNodeVersion = createSelector((state) => {
  return state.systemStatus.nodeVersion;
});

export const selectAuggieInstalled = createSelector((state) => {
  return state.systemStatus.auggieInstalled;
});

export const selectBinaryInstallAvailable = createSelector((state) => {
  return state.systemStatus.binaryInstallAvailable;
});

export const selectShowNodeWarning = createSelector((state) => {
  return (
    state.systemStatus.nodeVersionOk === false &&
    !state.systemStatus.auggieInstalled &&
    !state.systemStatus.binaryInstallAvailable
  );
});