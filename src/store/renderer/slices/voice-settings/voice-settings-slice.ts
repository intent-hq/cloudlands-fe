import {
  VOICE_VOCABULARY_TERM_MAX_LENGTH,
  type VoiceOpenAiModel,
  type VoiceProvider,
} from "$features/voice/voice-settings-service";
import type { VoiceEngine } from "$features/voice/voice-engine-preference";
import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import type { VoiceInputDevice, VoiceSettingsSliceState } from "./voice-settings-types";

export const initialState: VoiceSettingsSliceState = {
  isLoading: true,
  available: false,
  engine: "daemon",
  osEngineAvailable: false,
  provider: "elevenlabs",
  keyConfigured: { elevenlabs: false, openai: false },
  vocabulary: null,
  openaiModel: null,
  language: null,
  workspaceVocabularyMaxTerms: null,
  inputDeviceId: null,
  inputDevices: [],
  busyProvider: null,
  error: null,
};

// --- Actions ---

/** Trigger: load voice settings from the daemon (store-service reads the seam) */
export const initializeVoiceSettings = createAction("voiceSettings/initialize");

/** Trigger: persist the provider selection through `settings.update` */
export const changeVoiceProvider = createAction<[provider: VoiceProvider]>(
  "voiceSettings/changeProvider",
);

/** Trigger: switch the transcription engine (store-service persists locally) */
export const changeVoiceEngine = createAction<[engine: VoiceEngine]>(
  "voiceSettings/changeEngine",
);

/** Set the (already persisted) engine value */
export const setVoiceEngineValue = createAction<[engine: VoiceEngine]>(
  "voiceSettings/setEngineValue",
);

/** Set whether the local OS dictation engine is available on this host */
export const setVoiceOsEngineAvailable = createAction<[available: boolean]>(
  "voiceSettings/setOsEngineAvailable",
);

/** Trigger: store a pasted API key under the provider's secrets-file path */
export const saveVoiceKey = createAction<[provider: VoiceProvider, apiKey: string]>(
  "voiceSettings/saveKey",
);

/** Trigger: clear a stored API key (`settings.reset` deletes the secrets-file entry) */
export const clearVoiceKey = createAction<[provider: VoiceProvider]>(
  "voiceSettings/clearKey",
);

/**
 * Trigger + optimistic reducer: append a vocabulary term. Trimmed; blank,
 * over-length, and duplicate (case-insensitive) terms are ignored. The
 * store-service persists the resulting array through `settings.update`.
 */
export const addVoiceVocabularyTerm = createAction<[term: string]>(
  "voiceSettings/addVocabularyTerm",
);

/** Trigger + optimistic reducer: remove a vocabulary term (exact match). */
export const removeVoiceVocabularyTerm = createAction<[term: string]>(
  "voiceSettings/removeVocabularyTerm",
);

/** Set the vocabulary value directly (hydrate or rollback after a failed write) */
export const setVoiceVocabularyValue = createAction<[vocabulary: string[] | null]>(
  "voiceSettings/setVocabularyValue",
);

/** Hydrate from the daemon snapshot */
export const setVoiceSettingsSnapshot = createAction(
  "voiceSettings/setSnapshot",
  (
    available: boolean,
    provider: VoiceProvider,
    keyConfigured: Record<VoiceProvider, boolean>,
    vocabulary: string[] | null,
    openaiModel: VoiceOpenAiModel | null,
    language: string | null,
    workspaceVocabularyMaxTerms: number | null = null,
  ) => ({
    available,
    provider,
    keyConfigured,
    vocabulary,
    openaiModel,
    language,
    workspaceVocabularyMaxTerms,
  }),
);

/** Trigger: persist the OpenAI transcription model through `settings.update` */
export const changeVoiceOpenAiModel = createAction<[model: VoiceOpenAiModel]>(
  "voiceSettings/changeOpenAiModel",
);

/** Set the OpenAI model value directly (optimistic apply or rollback) */
export const setVoiceOpenAiModelValue = createAction<[model: VoiceOpenAiModel | null]>(
  "voiceSettings/setOpenAiModelValue",
);

/** Trigger: persist the language hint through `settings.update` (`""` = auto-detect) */
export const changeVoiceLanguage = createAction<[language: string]>(
  "voiceSettings/changeLanguage",
);

/** Set the language value directly (optimistic apply or rollback) */
export const setVoiceLanguageValue = createAction<[language: string | null]>(
  "voiceSettings/setLanguageValue",
);

/** Trigger: persist the workspace-vocabulary cap through `settings.update` (0..=100, `0` = off) */
export const changeVoiceWorkspaceVocabularyMaxTerms = createAction<[maxTerms: number]>(
  "voiceSettings/changeWorkspaceVocabularyMaxTerms",
);

/** Set the workspace-vocabulary cap value directly (optimistic apply or rollback) */
export const setVoiceWorkspaceVocabularyMaxTermsValue = createAction<
  [maxTerms: number | null]
>("voiceSettings/setWorkspaceVocabularyMaxTermsValue");

/** Set the (already persisted) provider value */
export const setVoiceProviderValue = createAction<[provider: VoiceProvider]>(
  "voiceSettings/setProviderValue",
);

/** Trigger: switch the microphone input device (store-service persists locally) */
export const changeVoiceInputDevice = createAction<[deviceId: string | null]>(
  "voiceSettings/changeInputDevice",
);

/** Set the (already persisted) input-device value (`null` = system default) */
export const setVoiceInputDeviceValue = createAction<[deviceId: string | null]>(
  "voiceSettings/setInputDeviceValue",
);

/** Hydrate the enumerated audio-input device list */
export const setVoiceInputDevices = createAction<[devices: VoiceInputDevice[]]>(
  "voiceSettings/setInputDevices",
);

/** Set one provider's key-configured flag */
export const setVoiceKeyConfigured = createAction<
  [provider: VoiceProvider, configured: boolean]
>("voiceSettings/setKeyConfigured");

/** Set the provider with an in-flight key operation */
export const setVoiceBusyProvider = createAction<[provider: VoiceProvider | null]>(
  "voiceSettings/setBusyProvider",
);

/** Set the surfaced error */
export const setVoiceSettingsError = createAction<[error: string | null]>(
  "voiceSettings/setError",
);

// --- Reducer ---

export const voiceSettingsReducer = createReducer<VoiceSettingsSliceState>(initialState)
  .with(setVoiceSettingsSnapshot, (state, { payload }) => ({
    ...state,
    isLoading: false,
    available: payload.available,
    provider: payload.provider,
    keyConfigured: payload.keyConfigured,
    vocabulary: payload.vocabulary,
    openaiModel: payload.openaiModel,
    language: payload.language,
    workspaceVocabularyMaxTerms: payload.workspaceVocabularyMaxTerms,
  }))
  .with(setVoiceOpenAiModelValue, (state, { payload: [model] }) => ({
    ...state,
    openaiModel: model,
  }))
  .with(setVoiceLanguageValue, (state, { payload: [language] }) => ({
    ...state,
    language,
  }))
  .with(setVoiceWorkspaceVocabularyMaxTermsValue, (state, { payload: [maxTerms] }) => ({
    ...state,
    workspaceVocabularyMaxTerms: maxTerms,
  }))
  .with(setVoiceProviderValue, (state, { payload: [provider] }) => ({
    ...state,
    provider,
  }))
  .with(setVoiceInputDeviceValue, (state, { payload: [deviceId] }) => ({
    ...state,
    inputDeviceId: deviceId,
  }))
  .with(setVoiceInputDevices, (state, { payload: [devices] }) => ({
    ...state,
    inputDevices: devices,
  }))
  .with(setVoiceEngineValue, (state, { payload: [engine] }) => ({
    ...state,
    engine,
  }))
  .with(setVoiceOsEngineAvailable, (state, { payload: [available] }) => ({
    ...state,
    osEngineAvailable: available,
  }))
  .with(addVoiceVocabularyTerm, (state, { payload: [term] }) => {
    if (state.vocabulary === null) return state;
    const trimmed = term.trim();
    if (!trimmed || trimmed.length > VOICE_VOCABULARY_TERM_MAX_LENGTH) return state;
    const lower = trimmed.toLowerCase();
    if (state.vocabulary.some((existing) => existing.toLowerCase() === lower)) return state;
    return { ...state, vocabulary: [...state.vocabulary, trimmed] };
  })
  .with(removeVoiceVocabularyTerm, (state, { payload: [term] }) => {
    if (state.vocabulary === null || !state.vocabulary.includes(term)) return state;
    return { ...state, vocabulary: state.vocabulary.filter((entry) => entry !== term) };
  })
  .with(setVoiceVocabularyValue, (state, { payload: [vocabulary] }) => ({
    ...state,
    vocabulary,
  }))
  .with(setVoiceKeyConfigured, (state, { payload: [provider, configured] }) => ({
    ...state,
    keyConfigured: { ...state.keyConfigured, [provider]: configured },
  }))
  .with(setVoiceBusyProvider, (state, { payload: [provider] }) => ({
    ...state,
    busyProvider: provider,
  }))
  .with(setVoiceSettingsError, (state, { payload: [error] }) => ({
    ...state,
    error,
  }));
