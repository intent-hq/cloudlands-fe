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
 *
 * Dependency-light utility per src/lib AGENTS.md — no stores or services.
 */

export const VOICE_INPUT_DEVICE_STORAGE_KEY = "intent.voice.inputDevice";

/** Read the persisted device id; absent/blank values fold to the system default. */
export function loadVoiceInputDevicePreference(): string | null {
  try {
    const stored = localStorage.getItem(VOICE_INPUT_DEVICE_STORAGE_KEY);
    return typeof stored === "string" && stored !== "" ? stored : null;
  } catch {
    return null;
  }
}

/** Persist the device id (`null` clears back to the system default). */
export function saveVoiceInputDevicePreference(deviceId: string | null): void {
  try {
    if (deviceId === null) {
      localStorage.removeItem(VOICE_INPUT_DEVICE_STORAGE_KEY);
    } else {
      localStorage.setItem(VOICE_INPUT_DEVICE_STORAGE_KEY, deviceId);
    }
  } catch {
    // Quota/privacy-mode failures degrade to a session-scoped preference.
  }
}
