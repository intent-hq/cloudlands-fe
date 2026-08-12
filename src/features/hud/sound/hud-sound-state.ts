/**
 * HUD sound enable state — a localStorage-persisted boolean (default OFF)
 * shared by the header speaker toggle and the HUD sound service. Deliberately
 * HUD-window-local (task spec): NOT Redux userPreferences and NOT the
 * notification sound settings — toggling HUD sounds never affects
 * notification sounds. Exposed as a reactive readable (for the header button)
 * plus a synchronous read (`isHudSoundEnabled`) the sound service gates on.
 */
import { writable, type Readable } from 'svelte/store';

import { safeLocalStorage } from '$lib/utils/safe-storage';

/** localStorage key holding 'true' / 'false'; absent = OFF (the default). */
export const HUD_SOUND_ENABLED_STORAGE_KEY = 'hudSoundEnabled';

function readPersisted(): boolean {
  return safeLocalStorage.getItem(HUD_SOUND_ENABLED_STORAGE_KEY) === 'true';
}

let current = readPersisted();
const store = writable(current);

/** Reactive enable state (subscribe-only; mutate via the setters below). */
export const hudSoundEnabled: Readable<boolean> = { subscribe: store.subscribe };

/** Synchronous read for non-reactive callers (the sound service's gate). */
export function isHudSoundEnabled(): boolean {
  return current;
}

/** Set + persist the enable state (persistence is best-effort). */
export function setHudSoundEnabled(enabled: boolean): void {
  current = enabled;
  store.set(enabled);
  safeLocalStorage.setItem(HUD_SOUND_ENABLED_STORAGE_KEY, String(enabled));
}

/** Flip the enable state; returns the new value (for the toggle button). */
export function toggleHudSoundEnabled(): boolean {
  const next = !current;
  setHudSoundEnabled(next);
  return next;
}
