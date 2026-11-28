/**
 * Voice transcription engine preference — local persistence.
 *
 * The engine choice (daemon cloud transcription vs. local OS dictation) is a
 * client capability, not daemon state: the OS engine only exists where the
 * Electron main process bundles the macOS speech helper, so persisting it in
 * the daemon's settings would let one client turn on an engine another host
 * cannot run. It therefore lives in renderer localStorage, read/written only
 * by the voice-settings store-service (never by components or reducers).
 * Every host view of this app shares the choice.
 */
import { sharedPreference } from '$lib/utils/shared-preference';

/** Transcription engines: the daemon's cloud providers or local OS dictation. */
export type VoiceEngine = 'daemon' | 'os';

export const VOICE_ENGINE_STORAGE_KEY = 'intent.voice.engine';

export function isVoiceEngine(value: unknown): value is VoiceEngine {
  return value === 'daemon' || value === 'os';
}

const storage = sharedPreference<VoiceEngine>({
  key: VOICE_ENGINE_STORAGE_KEY,
  scope: 'app',
  format: 'text',
  parse: (stored) => (isVoiceEngine(stored) ? stored : undefined),
});

/** Read the persisted engine; malformed/absent values fold to `daemon`. */
export function loadVoiceEnginePreference(): VoiceEngine {
  return storage.read() ?? 'daemon';
}

/** Persist the engine choice; storage failures are non-fatal (session-only). */
export function saveVoiceEnginePreference(engine: VoiceEngine): void {
  storage.write(engine);
}

/** Calls `listener` with the engine each time another view of this app changes it. */
export function onVoiceEnginePreferenceChange(listener: (engine: VoiceEngine) => void): () => void {
  return storage.subscribe((engine) => listener(engine ?? 'daemon'));
}
