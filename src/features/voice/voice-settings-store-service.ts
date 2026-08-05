/**
 * Voice settings store-service — daemon-backed provider + API-key flows.
 *
 * Mirrors the Linear paste-key precedent (linear-auth-store-service.ts): the
 * component dispatches trigger actions; this middleware calls the settings
 * seam (voice-settings-service.ts) and hydrates the voiceSettings slice with
 * the outcome. Localized error messages are resolved here so the slice stores
 * plain strings.
 *
 * Dependency-light per src/store AGENTS.md: imports only the settings-seam
 * service, the configured store, the slice actions, and the logger (NOT
 * selectors).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { store as appStore } from "$store/renderer/store";
import {
  addVoiceVocabularyTerm,
  changeVoiceEngine,
  changeVoiceInputDevice,
  changeVoiceOpenAiModel,
  changeVoiceProvider,
  clearVoiceKey,
  initializeVoiceSettings,
  removeVoiceVocabularyTerm,
  saveVoiceKey,
  setVoiceBusyProvider,
  setVoiceEngineValue,
  setVoiceInputDevices,
  setVoiceInputDeviceValue,
  setVoiceKeyConfigured,
  setVoiceOpenAiModelValue,
  setVoiceOsEngineAvailable,
  setVoiceProviderValue,
  setVoiceSettingsError,
  setVoiceSettingsSnapshot,
  setVoiceVocabularyValue,
} from "$store/renderer/slices/voice-settings/voice-settings-slice";
import {
  clearVoiceApiKey,
  isVoiceOpenAiModel,
  loadVoiceSettings,
  saveVoiceApiKey,
  setVoiceOpenAiModel,
  setVoiceProvider,
  setVoiceVocabulary,
  type VoiceOpenAiModel,
  type VoiceProvider,
} from "$features/voice/voice-settings-service";
import {
  isVoiceEngine,
  loadVoiceEnginePreference,
  saveVoiceEnginePreference,
  type VoiceEngine,
} from "$features/voice/voice-engine-preference";
import {
  loadVoiceInputDevicePreference,
  saveVoiceInputDevicePreference,
} from "$features/voice/voice-input-device-preference";
import {
  isOsTranscriptionAvailable,
  requestOsSpeechAuthorization,
} from "$features/voice/os-transcription-service";
import { createLogger } from "$lib/utils/client-logger";
import { m } from "$shared/paraglide/messages.js";

const logger = createLogger("VoiceSettingsService");

function isVoiceProvider(value: unknown): value is VoiceProvider {
  return value === "elevenlabs" || value === "openai";
}

/** Read the daemon snapshot and hydrate the slice. */
export async function initializeVoiceSettingsFlow(): Promise<void> {
  // Engine preference + OS-engine availability are client-local (localStorage
  // + main-process probe) and independent of the daemon settings read; the
  // mic-device preference and device list are likewise host-local.
  void hydrateVoiceEngineFlow();
  void hydrateVoiceInputDeviceFlow();
  try {
    const snapshot = await loadVoiceSettings();
    appStore.dispatch(
      setVoiceSettingsSnapshot(
        snapshot.available,
        snapshot.provider,
        snapshot.keyConfigured,
        snapshot.vocabulary,
        snapshot.openaiModel,
      ),
    );
  } catch (error) {
    appStore.dispatch(setVoiceSettingsSnapshot(false, "elevenlabs", {
      elevenlabs: false,
      openai: false,
    }, null, null));
    appStore.dispatch(setVoiceSettingsError(m.settings_voice_loadFailed_error()));
    logger.error("initialize error", error);
  }
}

/**
 * Hydrate the engine preference and OS-engine availability. A persisted
 * `os` choice is kept even when the host cannot currently run it (helper
 * missing, non-mac) — never a silent fallback to the cloud providers.
 * Transcription surfaces a clear error instead, and the settings panel
 * shows why the engine is unavailable.
 */
export async function hydrateVoiceEngineFlow(): Promise<void> {
  const available = await isOsTranscriptionAvailable();
  appStore.dispatch(setVoiceOsEngineAvailable(available));
  appStore.dispatch(setVoiceEngineValue(loadVoiceEnginePreference()));
}

/** Persist the engine selection locally (no daemon write — client capability). */
export function changeVoiceEngineFlow(engine: VoiceEngine): void {
  if (engine === appStore.state.voiceSettings.engine) return;
  if (engine === "os" && !appStore.state.voiceSettings.osEngineAvailable) {
    appStore.dispatch(setVoiceSettingsError(m.settings_voice_osEngineUnavailable_error()));
    return;
  }
  appStore.dispatch(setVoiceSettingsError(null));
  appStore.dispatch(setVoiceEngineValue(engine));
  saveVoiceEnginePreference(engine);
  // Enable-time TCC prompt: request macOS speech-recognition authorization
  // the moment the user picks the OS engine, not mid-dictation.
  if (engine === "os") void requestOsSpeechAuthorizationFlow();
}

/** Guard: the `devicechange` listener is registered once per renderer. */
let deviceChangeListenerRegistered = false;

/**
 * Enumerate audio-input devices and hydrate the slice. Enumeration failures
 * (no MediaDevices, permission-less contexts) leave the current list alone —
 * the selector still renders the "System default" option.
 */
export async function refreshVoiceInputDevicesFlow(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    appStore.dispatch(
      setVoiceInputDevices(
        devices
          .filter((device) => device.kind === "audioinput" && device.deviceId !== "")
          .map((device) => ({ deviceId: device.deviceId, label: device.label })),
      ),
    );
  } catch (error) {
    logger.error("input device enumeration error", error);
  }
}

/**
 * Hydrate the persisted mic-device preference, enumerate the current device
 * list, and keep it fresh on `devicechange` (plug/unplug).
 */
export async function hydrateVoiceInputDeviceFlow(): Promise<void> {
  appStore.dispatch(setVoiceInputDeviceValue(loadVoiceInputDevicePreference()));
  if (
    !deviceChangeListenerRegistered &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.addEventListener === "function"
  ) {
    deviceChangeListenerRegistered = true;
    navigator.mediaDevices.addEventListener("devicechange", () => {
      void refreshVoiceInputDevicesFlow();
    });
  }
  await refreshVoiceInputDevicesFlow();
}

/** Persist the mic-device selection locally (no daemon write — host-specific id). */
export function changeVoiceInputDeviceFlow(deviceId: string | null): void {
  if (deviceId === appStore.state.voiceSettings.inputDeviceId) return;
  appStore.dispatch(setVoiceInputDeviceValue(deviceId));
  saveVoiceInputDevicePreference(deviceId);
}

/**
 * Request macOS speech-recognition authorization (fires the TCC prompt when
 * not yet determined). A denied/restricted outcome surfaces the System
 * Settings hint; a failed request (helper crash, dev-terminal TCC
 * attribution) is logged only — the selection stands and dictation surfaces
 * its own typed error if the permission is actually missing.
 */
export async function requestOsSpeechAuthorizationFlow(): Promise<void> {
  try {
    const status = await requestOsSpeechAuthorization();
    if (status === "denied" || status === "restricted") {
      appStore.dispatch(setVoiceSettingsError(m.hardwareConsole_voice_osAuthDenied_error()));
    }
  } catch (error) {
    logger.error("speech authorization request error", error);
  }
}

/**
 * Persist the vocabulary after an optimistic add/remove reduced in the slice.
 * `previous` is the array captured before the reducer ran; a reducer no-op
 * (blank/duplicate/over-length term) leaves the reference unchanged and skips
 * the write. Rolls back to `previous` when the daemon rejects the update.
 */
export async function persistVoiceVocabularyFlow(previous: string[] | null): Promise<void> {
  const next = appStore.state.voiceSettings.vocabulary;
  if (previous === null || next === null || next === previous) return;
  appStore.dispatch(setVoiceSettingsError(null));
  try {
    await setVoiceVocabulary(next);
  } catch (error) {
    appStore.dispatch(setVoiceVocabularyValue(previous));
    appStore.dispatch(setVoiceSettingsError(m.settings_voice_vocabulary_saveFailed_error()));
    logger.error("vocabulary save error", error);
  }
}

/** Persist the provider selection; roll back the optimistic value on failure. */
export async function changeVoiceProviderFlow(provider: VoiceProvider): Promise<void> {
  const previous = appStore.state.voiceSettings.provider;
  if (provider === previous) return;
  appStore.dispatch(setVoiceSettingsError(null));
  appStore.dispatch(setVoiceProviderValue(provider));
  try {
    await setVoiceProvider(provider);
  } catch (error) {
    appStore.dispatch(setVoiceProviderValue(previous));
    appStore.dispatch(setVoiceSettingsError(m.settings_voice_providerSaveFailed_error()));
    logger.error("provider change error", error);
  }
}

/**
 * Persist the OpenAI transcription model; roll back the optimistic value on
 * failure. A `null` previous value means the daemon's catalog lacks the
 * setting (the panel hides the selector) — the write is skipped defensively.
 */
export async function changeVoiceOpenAiModelFlow(model: VoiceOpenAiModel): Promise<void> {
  const previous = appStore.state.voiceSettings.openaiModel;
  if (previous === null || model === previous) return;
  appStore.dispatch(setVoiceSettingsError(null));
  appStore.dispatch(setVoiceOpenAiModelValue(model));
  try {
    await setVoiceOpenAiModel(model);
  } catch (error) {
    appStore.dispatch(setVoiceOpenAiModelValue(previous));
    appStore.dispatch(setVoiceSettingsError(m.settings_voice_modelSaveFailed_error()));
    logger.error("openai model change error", error);
  }
}

/** Store a pasted API key through the daemon secrets-file path. */
export async function saveVoiceKeyFlow(provider: VoiceProvider, apiKey: string): Promise<void> {
  appStore.dispatch(setVoiceSettingsError(null));
  appStore.dispatch(setVoiceBusyProvider(provider));
  try {
    await saveVoiceApiKey(provider, apiKey);
    appStore.dispatch(setVoiceKeyConfigured(provider, true));
  } catch (error) {
    appStore.dispatch(setVoiceSettingsError(m.settings_voice_keySaveFailed_error()));
    logger.error("key save error", error);
  } finally {
    appStore.dispatch(setVoiceBusyProvider(null));
  }
}

/** Clear a stored API key (settings.reset deletes the secrets-file entry). */
export async function clearVoiceKeyFlow(provider: VoiceProvider): Promise<void> {
  appStore.dispatch(setVoiceSettingsError(null));
  appStore.dispatch(setVoiceBusyProvider(provider));
  try {
    await clearVoiceApiKey(provider);
    appStore.dispatch(setVoiceKeyConfigured(provider, false));
  } catch (error) {
    appStore.dispatch(setVoiceSettingsError(m.settings_voice_keyClearFailed_error()));
    logger.error("key clear error", error);
  } finally {
    appStore.dispatch(setVoiceBusyProvider(null));
  }
}

/**
 * Middleware that gives the voice settings triggers a real handler.
 * Fire-and-forget — dispatch stays synchronous and never throws.
 */
export function createVoiceSettingsMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    // Vocabulary edits reduce optimistically, so the pre-dispatch array is the
    // rollback target — capture it before the reducer runs.
    const isVocabularyEdit =
      action?.type === addVoiceVocabularyTerm.type ||
      action?.type === removeVoiceVocabularyTerm.type;
    const previousVocabulary = isVocabularyEdit
      ? appStore.state.voiceSettings.vocabulary
      : null;
    const result = next(action);
    switch (action?.type) {
      case addVoiceVocabularyTerm.type:
      case removeVoiceVocabularyTerm.type:
        void persistVoiceVocabularyFlow(previousVocabulary);
        break;
      case initializeVoiceSettings.type:
        void initializeVoiceSettingsFlow();
        break;
      case changeVoiceProvider.type: {
        const payload = Array.isArray(action.payload) ? action.payload : [];
        if (isVoiceProvider(payload[0])) void changeVoiceProviderFlow(payload[0]);
        break;
      }
      case changeVoiceEngine.type: {
        const payload = Array.isArray(action.payload) ? action.payload : [];
        if (isVoiceEngine(payload[0])) changeVoiceEngineFlow(payload[0]);
        break;
      }
      case changeVoiceInputDevice.type: {
        const payload = Array.isArray(action.payload) ? action.payload : [];
        if (payload[0] === null || typeof payload[0] === "string") {
          changeVoiceInputDeviceFlow(payload[0]);
        }
        break;
      }
      case changeVoiceOpenAiModel.type: {
        const payload = Array.isArray(action.payload) ? action.payload : [];
        if (isVoiceOpenAiModel(payload[0])) void changeVoiceOpenAiModelFlow(payload[0]);
        break;
      }
      case saveVoiceKey.type: {
        const payload = Array.isArray(action.payload) ? action.payload : [];
        if (isVoiceProvider(payload[0]) && typeof payload[1] === "string") {
          void saveVoiceKeyFlow(payload[0], payload[1]);
        }
        break;
      }
      case clearVoiceKey.type: {
        const payload = Array.isArray(action.payload) ? action.payload : [];
        if (isVoiceProvider(payload[0])) void clearVoiceKeyFlow(payload[0]);
        break;
      }
    }
    return result;
  };
}
