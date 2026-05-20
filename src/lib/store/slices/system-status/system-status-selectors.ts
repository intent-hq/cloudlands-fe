import { store } from "../../store";

export const selectNodeVersionOk = store.createSelector((state) => {
  return state.systemStatus.nodeVersionOk;
});

export const selectNodeVersion = store.createSelector((state) => {
  return state.systemStatus.nodeVersion;
});

export const selectAuggieInstalled = store.createSelector((state) => {
  return state.systemStatus.auggieInstalled;
});

export const selectBinaryInstallAvailable = store.createSelector((state) => {
  return state.systemStatus.binaryInstallAvailable;
});

export const selectShowNodeWarning = store.createSelector((state) => {
  return (
    state.systemStatus.nodeVersionOk === false &&
    !state.systemStatus.auggieInstalled &&
    !state.systemStatus.binaryInstallAvailable
  );
});