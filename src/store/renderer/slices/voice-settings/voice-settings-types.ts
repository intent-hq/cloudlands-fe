import type {
  VoiceOpenAiModel,
  VoiceProvider,
} from "$features/voice/voice-settings-service";
import type { VoiceEngine } from "$features/voice/voice-engine-preference";

/** Serializable projection of an audio-input MediaDeviceInfo. */
export interface VoiceInputDevice {
  deviceId: string;
  /** Empty until the user grants microphone permission (Web API behavior). */
  label: string;
}

export interface VoiceSettingsSliceState {
  /** True until the initial daemon read settles. */
  isLoading: boolean;
  /** Whether the connected daemon exposes the voice settings catalog. */
  available: boolean;
  /** Selected transcription engine: daemon cloud providers or local OS dictation. */
  engine: VoiceEngine;
  /** Whether the local OS dictation engine can run on this host (macOS + helper). */
  osEngineAvailable: boolean;
  /** Selected transcription provider (daemon default when unset). */
  provider: VoiceProvider;
  /** Presence of a stored API key per provider (redacted placeholder ⇒ configured). */
  keyConfigured: Record<VoiceProvider, boolean>;
  /** Vocabulary terms biased into every transcription; `null` when the daemon predates the setting. */
  vocabulary: string[] | null;
  /** OpenAI transcription model; `null` when the daemon's catalog lacks the setting. */
  openaiModel: VoiceOpenAiModel | null;
  /** Selected microphone device id; `null` = system default. */
  inputDeviceId: string | null;
  /** Enumerated audio-input devices (refreshed on `devicechange`). */
  inputDevices: VoiceInputDevice[];
  /** Provider with an in-flight key write/clear, if any. */
  busyProvider: VoiceProvider | null;
  /** Localized error surfaced by the last failed operation. */
  error: string | null;
}
