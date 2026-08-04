/**
 * Voice transcription engine preference — local persistence.
 *
 * The engine choice (daemon cloud transcription vs. local OS dictation) is a
 * client capability, not daemon state: the OS engine only exists where the
 * Electron main process bundles the macOS speech helper, so persisting it in
 * the daemon's settings would let one client turn on an engine another host
 * cannot run. It therefore lives in renderer localStorage, read/written only
 * by the voice-settings store-service (never by components or reducers).
 *
 * Dependency-light utility per src/lib AGENTS.md — no stores or services.
 */

/** Transcription engines: the daemon's cloud providers or local OS dictation. */
export type VoiceEngine = "daemon" | "os";

export const VOICE_ENGINE_STORAGE_KEY = "intent.voice.engine";

export function isVoiceEngine(value: unknown): value is VoiceEngine {
  return value === "daemon" || value === "os";
}

/** Read the persisted engine; malformed/absent values fold to `daemon`. */
export function loadVoiceEnginePreference(): VoiceEngine {
  try {
    const stored = localStorage.getItem(VOICE_ENGINE_STORAGE_KEY);
    return isVoiceEngine(stored) ? stored : "daemon";
  } catch {
    return "daemon";
  }
}

/** Persist the engine choice; storage failures are non-fatal (session-only). */
export function saveVoiceEnginePreference(engine: VoiceEngine): void {
  try {
    localStorage.setItem(VOICE_ENGINE_STORAGE_KEY, engine);
  } catch {
    // Quota/privacy-mode failures degrade to a session-scoped preference.
  }
}
