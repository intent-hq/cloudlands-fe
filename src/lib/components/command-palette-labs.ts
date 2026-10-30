import { store as appStore } from '$store/renderer/store';
import { setLabsProviderProfilesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { setDockLabEnabled } from '$lib/dock-lab';

const ENABLE_PROVIDER_PROFILES = 'enable-experimental-provider-profiles';
const DISABLE_PROVIDER_PROFILES = 'disable-experimental-provider-profiles';

/** Hides the Provider profiles Labs command that would not change the current setting. */
function isProfilesLabCommandHidden(commandId: string, enabled: boolean): boolean {
  return commandId === (enabled ? ENABLE_PROVIDER_PROFILES : DISABLE_PROVIDER_PROFILES);
}

/** Runs a Provider profiles Labs command; returns false for any other command. */
function runProfilesLabCommand(commandId: string): boolean {
  if (commandId !== ENABLE_PROVIDER_PROFILES && commandId !== DISABLE_PROVIDER_PROFILES)
    return false;
  appStore.dispatch(setLabsProviderProfilesEnabled(commandId === ENABLE_PROVIDER_PROFILES));
  return true;
}

const ENABLE_DOCK = 'enable-experimental-dock';
const DISABLE_DOCK = 'disable-experimental-dock';

/** Hides the experimental dock Labs command that would not change the current setting. */
function isDockLabCommandHidden(commandId: string, enabled: boolean): boolean {
  return commandId === (enabled ? ENABLE_DOCK : DISABLE_DOCK);
}

/** Runs an experimental dock Labs command; returns false for any other command. */
function runDockLabCommand(commandId: string): boolean {
  if (commandId !== ENABLE_DOCK && commandId !== DISABLE_DOCK) return false;
  void setDockLabEnabled(commandId === ENABLE_DOCK);
  return true;
}

/** Hides a Labs command handled here (Provider profiles, dock) that would not change its setting. */
export function isLabCommandHidden(
  commandId: string,
  profilesEnabled: boolean,
  dockEnabled: boolean,
): boolean {
  return (
    isProfilesLabCommandHidden(commandId, profilesEnabled) ||
    isDockLabCommandHidden(commandId, dockEnabled)
  );
}

/** Runs a Labs command handled here; returns false for any other command. */
export function runLabCommand(commandId: string): boolean {
  return runProfilesLabCommand(commandId) || runDockLabCommand(commandId);
}
