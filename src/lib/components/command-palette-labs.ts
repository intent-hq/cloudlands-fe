import { setDockLabEnabled } from '$lib/dock-lab';
import { store as appStore } from '$store/renderer/store';
import { setBrowserAccessEnabledRequested } from '$store/renderer/slices/browser-access/browser-access-slice';
import {
  setLabsBrowserAccessEnabled,
  setLabsCursorProviderEnabled,
  setLabsPlainFolderWorkspacesEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';

const ENABLE_DOCK = 'enable-experimental-dock';
const DISABLE_DOCK = 'disable-experimental-dock';
const ENABLE_PLAIN_FOLDERS = 'enable-experimental-plain-folders';
const DISABLE_PLAIN_FOLDERS = 'disable-experimental-plain-folders';
const ENABLE_BROWSER_ACCESS = 'enable-experimental-browser-access';
const DISABLE_BROWSER_ACCESS = 'disable-experimental-browser-access';
const ENABLE_CURSOR = 'enable-experimental-cursor';
const DISABLE_CURSOR = 'disable-experimental-cursor';

/** The Labs command that would set a lab to its current value is hidden. */
export function isLabCommandHidden(
  commandId: string,
  dockEnabled: boolean,
  plainFoldersEnabled = false,
  browserAccessEnabled = false,
  cursorEnabled = false,
): boolean {
  return (
    commandId === (dockEnabled ? ENABLE_DOCK : DISABLE_DOCK) ||
    commandId === (plainFoldersEnabled ? ENABLE_PLAIN_FOLDERS : DISABLE_PLAIN_FOLDERS) ||
    commandId === (browserAccessEnabled ? ENABLE_BROWSER_ACCESS : DISABLE_BROWSER_ACCESS) ||
    commandId === (cursorEnabled ? ENABLE_CURSOR : DISABLE_CURSOR)
  );
}

export function runLabCommand(commandId: string): boolean {
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
  if (commandId === ENABLE_CURSOR || commandId === DISABLE_CURSOR) {
    // Entry-point gate only: never touches `providers.enabled.cursor`, so an
    // enabled Cursor keeps working when the lab is turned off.
    appStore.dispatch(setLabsCursorProviderEnabled(commandId === ENABLE_CURSOR));
    return true;
  }
  if (commandId !== ENABLE_DOCK && commandId !== DISABLE_DOCK) return false;
  void setDockLabEnabled(commandId === ENABLE_DOCK);
  return true;
}
