import { store } from '$store/renderer/store';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';

export const selectMachineSetup = store.createSelector((state) => state.machineSetup);

/**
 * Labs SSH machine setup is on and this is the desktop app (the SSH runner
 * lives in Electron main; intent-web never offers it).
 */
export const selectSshMachineSetupAvailable = store.createSelector(
  (state) => state.userPreferences?.labsSshMachineSetupEnabled === true && isElectronPlatform(),
);
