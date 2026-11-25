/**
 * HUD sound state — localStorage-persisted enable flag (default OFF) and
 * master volume (default 0.3), shared by the header speaker controls and the
 * HUD sound service. Deliberately HUD-window-local (task spec): NOT Redux
 * userPreferences and NOT the notification sound settings — toggling HUD
 * sounds never affects notification sounds. Every view of this app shares both
 * values and follows a change made in another view. Each value is exposed as a
 * reactive readable (for the header controls) plus a synchronous read
 * (`isHudSoundEnabled` / `getHudSoundVolume`) the sound player reads on.
 */
import { writable, type Readable } from 'svelte/store';

import { sharedPreference } from '$lib/utils/shared-preference';

/** localStorage key holding 'true' / 'false'; absent = OFF (the default). */
export const HUD_SOUND_ENABLED_STORAGE_KEY = 'hudSoundEnabled';

const enabledStorage = sharedPreference<boolean>({
  key: HUD_SOUND_ENABLED_STORAGE_KEY,
  scope: 'app',
  format: 'text',
  parse: (stored) => stored === 'true',
});

let current = enabledStorage.read() ?? false;
const store = writable(current);

// Another view of this app changed it: follow, so this view cannot save a stale value.
enabledStorage.subscribe((enabled) => {
  current = enabled ?? false;
  store.set(current);
});

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
  enabledStorage.write(enabled);
}

/** Flip the enable state; returns the new value (for the toggle button). */
export function toggleHudSoundEnabled(): boolean {
  const next = !current;
  setHudSoundEnabled(next);
  return next;
}

/** localStorage key holding the master volume (0..1); absent = 0.3. */
export const HUD_SOUND_VOLUME_STORAGE_KEY = 'hudSoundVolume';

/** First-run master volume — deliberately quiet (task spec). */
export const HUD_SOUND_DEFAULT_VOLUME = 0.3;

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return HUD_SOUND_DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, volume));
}

const volumeStorage = sharedPreference<number>({
  key: HUD_SOUND_VOLUME_STORAGE_KEY,
  scope: 'app',
  format: 'text',
  parse: (stored) => (stored === '' ? undefined : clampVolume(Number(stored))),
});

let currentVolume = volumeStorage.read() ?? HUD_SOUND_DEFAULT_VOLUME;
const volumeStore = writable(currentVolume);

volumeStorage.subscribe((volume) => {
  currentVolume = volume ?? HUD_SOUND_DEFAULT_VOLUME;
  volumeStore.set(currentVolume);
});

/** Reactive master volume (subscribe-only; mutate via `setHudSoundVolume`). */
export const hudSoundVolume: Readable<number> = { subscribe: volumeStore.subscribe };

/** Synchronous read for non-reactive callers (the sound player). */
export function getHudSoundVolume(): number {
  return currentVolume;
}

/** Set + persist the master volume, clamped to 0..1 (best-effort persist). */
export function setHudSoundVolume(volume: number): void {
  const clamped = clampVolume(volume);
  currentVolume = clamped;
  volumeStore.set(clamped);
  volumeStorage.write(clamped);
}
