import { setDockLabEnabled } from '$lib/dock-lab';
import { store as appStore } from '$store/renderer/store';
import { setLabsPlainFolderWorkspacesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';

const ENABLE_DOCK = 'enable-experimental-dock';
const DISABLE_DOCK = 'disable-experimental-dock';
const ENABLE_PLAIN_FOLDERS = 'enable-experimental-plain-folders';
const DISABLE_PLAIN_FOLDERS = 'disable-experimental-plain-folders';

/** The Labs command that would set a lab to its current value is hidden. */
export function isLabCommandHidden(
  commandId: string,
  dockEnabled: boolean,
  plainFoldersEnabled = false,
): boolean {
  return (
    commandId === (dockEnabled ? ENABLE_DOCK : DISABLE_DOCK) ||
    commandId === (plainFoldersEnabled ? ENABLE_PLAIN_FOLDERS : DISABLE_PLAIN_FOLDERS)
  );
}

export function runLabCommand(commandId: string): boolean {
  if (commandId === ENABLE_PLAIN_FOLDERS || commandId === DISABLE_PLAIN_FOLDERS) {
    appStore.dispatch(setLabsPlainFolderWorkspacesEnabled(commandId === ENABLE_PLAIN_FOLDERS));
    return true;
  }
  if (commandId !== ENABLE_DOCK && commandId !== DISABLE_DOCK) return false;
  void setDockLabEnabled(commandId === ENABLE_DOCK);
  return true;
}
