import { resolveEffectiveVoiceEngine } from "$features/voice/effective-voice-engine";
import { store } from "../../store";

export const selectVoiceSettingsIsLoading = store.createSelector(
  (state) => state.voiceSettings.isLoading,
);

export const selectVoiceSettingsAvailable = store.createSelector(
  (state) => state.voiceSettings.available,
);

export const selectVoiceProvider = store.createSelector(
  (state) => state.voiceSettings.provider,
);

export const selectVoiceEngine = store.createSelector(
  (state) => state.voiceSettings.engine,
);

export const selectVoiceOsEngineAvailable = store.createSelector(
  (state) => state.voiceSettings.osEngineAvailable,
);

export const selectVoiceKeyConfigured = store.createSelector(
  (state) => state.voiceSettings.keyConfigured,
);

export const selectVoiceVocabulary = store.createSelector(
  (state) => state.voiceSettings.vocabulary,
);

export const selectVoiceOpenAiModel = store.createSelector(
  (state) => state.voiceSettings.openaiModel,
);

export const selectVoiceBusyProvider = store.createSelector(
  (state) => state.voiceSettings.busyProvider,
);

export const selectVoiceSettingsError = store.createSelector(
  (state) => state.voiceSettings.error,
);

/**
 * The engine a dictation trigger will actually use right now — the selected
 * engine resolved against configuration reality (provider key presence, OS
 * engine availability), including the daemon→os graceful fallback. See
 * `resolveEffectiveVoiceEngine` for the resolution rules.
 */
export const selectEffectiveVoiceEngine = store.createSelector((state) =>
  resolveEffectiveVoiceEngine(state.voiceSettings),
);
