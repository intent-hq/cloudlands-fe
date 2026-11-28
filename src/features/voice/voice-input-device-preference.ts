/**
 * Voice microphone input-device preference — local persistence.
 *
 * The selected audio-input device is a host capability, not daemon state:
 * MediaDevices device ids are specific to this machine (and browser
 * profile), so persisting one in the daemon's settings would leak a
 * meaningless id to other clients. It therefore lives in renderer
 * localStorage (same precedent as voice-engine-preference.ts), read/written
 * only by the voice-settings store-service and the recorder construction
 * site (never by components or reducers).
 *
 * `null` means "system default" — the recorder omits the device constraint.
 * Every host view of this app shares the choice.
 */
import { sharedPreference } from '$lib/utils/shared-preference';

export const VOICE_INPUT_DEVICE_STORAGE_KEY = 'intent.voice.inputDevice';

/**
 * In-session value, recorded by every save (whether or not the localStorage
 * write succeeded) and preferred by loads. This keeps recordings on the mic
 * the user just selected even when persistence fails (privacy mode/quota) —
 * the "session-scoped preference" degradation. `undefined` = no save yet
 * this session.
 */
let sessionDeviceId: string | null | undefined;

const storage = sharedPreference<string>({
  key: VOICE_INPUT_DEVICE_STORAGE_KEY,
  scope: 'app',
  format: 'text',
  parse: (stored) => (typeof stored === 'string' && stored !== '' ? stored : undefined),
});

/**
 * Read the preferred device id: the in-session selection when one was made,
 * else the persisted value. Absent/blank values fold to the system default.
 */
export function loadVoiceInputDevicePreference(): string | null {
  if (sessionDeviceId !== undefined) return sessionDeviceId;
  return storage.read() ?? null;
}

/** Persist the device id (`null` clears back to the system default). */
export function saveVoiceInputDevicePreference(deviceId: string | null): void {
  sessionDeviceId = deviceId;
  if (deviceId === null) storage.remove();
  else storage.write(deviceId);
}

/**
 * Calls `listener` with the device id each time another view of this app
 * changes it. That choice is newer than this view's in-session one.
 */
export function onVoiceInputDevicePreferenceChange(
  listener: (deviceId: string | null) => void,
): () => void {
  return storage.subscribe((stored) => {
    sessionDeviceId = stored ?? null;
    listener(sessionDeviceId);
  });
}

/** Test-only: forget the in-session selection so loads hit localStorage. */
export function resetVoiceInputDevicePreferenceSession(): void {
  sessionDeviceId = undefined;
}
