import { setDockLabEnabled } from '$lib/dock-lab';
import { groupTabsByProjectAction } from '$lib/components/layout/workspace-tab-group-controller';
import { store as appStore } from '$store/renderer/store';
import { setBrowserAccessEnabledRequested } from '$store/renderer/slices/browser-access/browser-access-slice';
import { setMachineRailEnabledRequested } from '$store/renderer/slices/machine-rail/machine-rail-slice';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import {
  setLabsBrowserAccessEnabled,
  setLabsCloudMachinesEnabled,
  setLabsPlainFolderWorkspacesEnabled,
  setLabsSshMachineSetupEnabled,
  setLabsTabGroupsEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';

const ENABLE_MACHINE_RAIL = 'enable-experimental-machine-rail';
const DISABLE_MACHINE_RAIL = 'disable-experimental-machine-rail';
const ENABLE_DOCK = 'enable-experimental-dock';
const DISABLE_DOCK = 'disable-experimental-dock';
const ENABLE_PLAIN_FOLDERS = 'enable-experimental-plain-folders';
const DISABLE_PLAIN_FOLDERS = 'disable-experimental-plain-folders';
const ENABLE_BROWSER_ACCESS = 'enable-experimental-browser-access';
const DISABLE_BROWSER_ACCESS = 'disable-experimental-browser-access';
const ENABLE_CLOUD_MACHINES = 'enable-experimental-cloud-machines';
const DISABLE_CLOUD_MACHINES = 'disable-experimental-cloud-machines';
const ENABLE_SSH_MACHINE_SETUP = 'enable-experimental-ssh-machine-setup';
const DISABLE_SSH_MACHINE_SETUP = 'disable-experimental-ssh-machine-setup';
const ENABLE_TAB_GROUPS = 'enable-experimental-tab-groups';
const DISABLE_TAB_GROUPS = 'disable-experimental-tab-groups';
const GROUP_TABS_BY_PROJECT = 'group-tabs-by-project';

/** The Labs command that would set a lab to its current value is hidden. */
export function isLabCommandHidden(
  commandId: string,
  dockEnabled: boolean,
  plainFoldersEnabled = false,
  browserAccessEnabled = false,
  tabGroupsEnabled = false,
  cloudMachinesEnabled = false,
): boolean {
  return (
    commandId === (cloudMachinesEnabled ? ENABLE_CLOUD_MACHINES : DISABLE_CLOUD_MACHINES) ||
    (commandId === GROUP_TABS_BY_PROJECT && !tabGroupsEnabled) ||
    commandId === (tabGroupsEnabled ? ENABLE_TAB_GROUPS : DISABLE_TAB_GROUPS) ||
    commandId === (dockEnabled ? ENABLE_DOCK : DISABLE_DOCK) ||
    commandId === (plainFoldersEnabled ? ENABLE_PLAIN_FOLDERS : DISABLE_PLAIN_FOLDERS) ||
    commandId === (browserAccessEnabled ? ENABLE_BROWSER_ACCESS : DISABLE_BROWSER_ACCESS)
  );
}

/**
 * The machine rail lab exists in the desktop app only; elsewhere both of its
 * commands are hidden, and in the desktop app the one that would not change
 * the setting is.
 */
export function isMachineRailCommandHidden(commandId: string, railEnabled: boolean): boolean {
  if (commandId !== ENABLE_MACHINE_RAIL && commandId !== DISABLE_MACHINE_RAIL) return false;
  if (!isElectronPlatform()) return true;
  return commandId === (railEnabled ? ENABLE_MACHINE_RAIL : DISABLE_MACHINE_RAIL);
}

/** SSH machine setup runs in Electron main: its commands exist in the desktop app only. */
export function isSshMachineSetupCommandHidden(commandId: string, enabled: boolean): boolean {
  if (commandId !== ENABLE_SSH_MACHINE_SETUP && commandId !== DISABLE_SSH_MACHINE_SETUP)
    return false;
  if (!isElectronPlatform()) return true;
  return commandId === (enabled ? ENABLE_SSH_MACHINE_SETUP : DISABLE_SSH_MACHINE_SETUP);
}

export function runLabCommand(commandId: string): boolean {
  if (commandId === GROUP_TABS_BY_PROJECT) {
    groupTabsByProjectAction().run?.();
    return true;
  }
  if (commandId === ENABLE_MACHINE_RAIL || commandId === DISABLE_MACHINE_RAIL) {
    appStore.dispatch(setMachineRailEnabledRequested(commandId === ENABLE_MACHINE_RAIL));
    return true;
  }
  if (commandId === ENABLE_CLOUD_MACHINES || commandId === DISABLE_CLOUD_MACHINES) {
    appStore.dispatch(setLabsCloudMachinesEnabled(commandId === ENABLE_CLOUD_MACHINES));
    return true;
  }
  if (commandId === ENABLE_SSH_MACHINE_SETUP || commandId === DISABLE_SSH_MACHINE_SETUP) {
    appStore.dispatch(setLabsSshMachineSetupEnabled(commandId === ENABLE_SSH_MACHINE_SETUP));
    return true;
  }
  if (commandId === ENABLE_TAB_GROUPS || commandId === DISABLE_TAB_GROUPS) {
    appStore.dispatch(setLabsTabGroupsEnabled(commandId === ENABLE_TAB_GROUPS));
    return true;
  }
  if (commandId === ENABLE_PLAIN_FOLDERS || commandId === DISABLE_PLAIN_FOLDERS) {
    appStore.dispatch(setLabsPlainFolderWorkspacesEnabled(commandId === ENABLE_PLAIN_FOLDERS));
    return true;
  }
  if (commandId === ENABLE_BROWSER_ACCESS || commandId === DISABLE_BROWSER_ACCESS) {
    const enabled = commandId === ENABLE_BROWSER_ACCESS;
    appStore.dispatch(setLabsBrowserAccessEnabled(enabled));
    // Hiding the section must not leave a server running that nobody can see.
    if (!enabled) appStore.dispatch(setBrowserAccessEnabledRequested(false));
    return true;
  }
  if (commandId !== ENABLE_DOCK && commandId !== DISABLE_DOCK) return false;
  void setDockLabEnabled(commandId === ENABLE_DOCK);
  return true;
}
