import { getLocalPref, setLocalPref } from './local-prefs';
import { setMenuBarAutoHideEnabled } from '../shared/main/window-appearance';

const PREF_KEY = 'menuBarAutoHide';

let persisted: boolean | undefined;
let load: Promise<void> | null = null;

/**
 * The preference lives in renderer storage, so main keeps a copy on disk to
 * open the first window without the menu bar flashing in.
 */
export function loadMenuBarAutoHidePref(): Promise<void> {
  load ??= getLocalPref<boolean>(PREF_KEY)
    .then((value) => {
      if (typeof value !== 'boolean' || persisted !== undefined) return;
      persisted = value;
      setMenuBarAutoHideEnabled(value);
    })
    .catch(() => {});
  return load;
}

export async function saveMenuBarAutoHidePref(enabled: boolean): Promise<void> {
  setMenuBarAutoHideEnabled(enabled);
  if (persisted === enabled) return;
  persisted = enabled;
  await setLocalPref(PREF_KEY, enabled);
}
