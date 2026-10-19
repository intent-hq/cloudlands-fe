import { store as appStore } from '$store/renderer/store';
import { setLabsProviderProfilesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';

const ENABLE_PROVIDER_PROFILES = 'enable-experimental-provider-profiles';
const DISABLE_PROVIDER_PROFILES = 'disable-experimental-provider-profiles';

/** Hides the Provider profiles Labs command that would not change the current setting. */
export function isProfilesLabCommandHidden(commandId: string, enabled: boolean): boolean {
  return commandId === (enabled ? ENABLE_PROVIDER_PROFILES : DISABLE_PROVIDER_PROFILES);
}

/** Runs a Provider profiles Labs command; returns false for any other command. */
export function runProfilesLabCommand(commandId: string): boolean {
  if (commandId !== ENABLE_PROVIDER_PROFILES && commandId !== DISABLE_PROVIDER_PROFILES)
    return false;
  appStore.dispatch(setLabsProviderProfilesEnabled(commandId === ENABLE_PROVIDER_PROFILES));
  return true;
}
