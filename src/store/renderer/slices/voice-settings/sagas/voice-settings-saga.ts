import { buffers, channel, END, eventChannel, type Channel, type EventChannel } from 'redux-saga';
import {
  all,
  call,
  join,
  put,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';

import {
  isOsTranscriptionAvailable,
  requestOsSpeechAuthorization,
} from '$features/voice/os-transcription-service';
import {
  loadVoiceEnginePreference,
  saveVoiceEnginePreference,
} from '$features/voice/voice-engine-preference';
import {
  loadVoiceInputDevicePreference,
  saveVoiceInputDevicePreference,
} from '$features/voice/voice-input-device-preference';
import {
  clearVoiceApiKey,
  loadVoiceSettings,
  saveVoiceApiKey,
  setVoiceLanguage,
  setVoiceOpenAiModel,
  setVoiceProvider,
  setVoiceVocabulary,
  setVoiceWorkspaceVocabularyMaxTerms,
} from '$features/voice/voice-settings-service';
import { resetWorkspaceVocabularyCache } from '$features/voice/workspace-vocabulary-service';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  addVoiceVocabularyTerm,
  changeVoiceEngine,
  changeVoiceInputDevice,
  changeVoiceLanguage,
  changeVoiceOpenAiModel,
  changeVoiceProvider,
  changeVoiceWorkspaceVocabularyMaxTerms,
  clearVoiceKey,
  initializeVoiceSettings,
  removeVoiceVocabularyTerm,
  saveVoiceKey,
  setVoiceBusyProvider,
  setVoiceEngineValue,
  setVoiceInputDevices,
  setVoiceInputDeviceValue,
  setVoiceKeyConfigured,
  setVoiceLanguageValue,
  setVoiceOpenAiModelValue,
  setVoiceOsEngineAvailable,
  setVoiceProviderValue,
  setVoiceSettingsError,
  setVoiceSettingsSnapshot,
  setVoiceVocabularyValue,
  setVoiceWorkspaceVocabularyMaxTermsValue,
} from '../voice-settings-slice';
import {
  selectVoiceEngine,
  selectVoiceInputDeviceId,
  selectVoiceLanguage,
  selectVoiceOpenAiModel,
  selectVoiceOsEngineAvailable,
  selectVoiceProvider,
  selectVoiceVocabulary,
  selectVoiceWorkspaceVocabularyMaxTerms,
} from '../voice-settings-selectors';

const logger = createLogger('VoiceSettingsSaga');

interface SequencedWrite<T> {
  next: T;
  previous: T;
  sequence: number;
}

interface LatestWrite {
  sequence: number;
}

function* hydrateVoiceEngineWorker(): SagaGenerator<void> {
  const available = yield* call(isOsTranscriptionAvailable);
  yield* put(setVoiceOsEngineAvailable(available));
  yield* put(setVoiceEngineValue(yield* call(loadVoiceEnginePreference)));
}

export function* refreshVoiceInputDevicesWorker(): SagaGenerator<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = yield* call([navigator.mediaDevices, navigator.mediaDevices.enumerateDevices]);
    yield* put(
      setVoiceInputDevices(
        devices
          .filter((device) => device.kind === 'audioinput' && device.deviceId !== '')
          .map((device) => ({ deviceId: device.deviceId, label: device.label })),
      ),
    );
  } catch (error) {
    logger.error('input device enumeration error', error);
  }
}

function* hydrateVoiceInputDeviceWorker(): SagaGenerator<void> {
  yield* put(setVoiceInputDeviceValue(yield* call(loadVoiceInputDevicePreference)));
  yield* call(refreshVoiceInputDevicesWorker);
}

export function* initializeVoiceSettingsWorker(): SagaGenerator<void> {
  yield* all([call(hydrateVoiceEngineWorker), call(hydrateVoiceInputDeviceWorker)]);
  try {
    const snapshot = yield* call(loadVoiceSettings);
    yield* put(
      setVoiceSettingsSnapshot(
        snapshot.available,
        snapshot.provider,
        snapshot.keyConfigured,
        snapshot.vocabulary,
        snapshot.openaiModel,
        snapshot.language,
        snapshot.workspaceVocabularyMaxTerms,
      ),
    );
  } catch (error) {
    yield* put(
      setVoiceSettingsSnapshot(
        false,
        'elevenlabs',
        { elevenlabs: false, openai: false },
        null,
        null,
        null,
        null,
      ),
    );
    yield* put(setVoiceSettingsError(m.settings_voice_loadFailed_error()));
    logger.error('initialize error', error);
  }
}

function* requestOsSpeechAuthorizationWorker(): SagaGenerator<void> {
  try {
    const status = yield* call(requestOsSpeechAuthorization);
    if (status === 'denied' || status === 'restricted') {
      yield* put(setVoiceSettingsError(m.hardwareConsole_voice_osAuthDenied_error()));
    }
  } catch (error) {
    logger.error('speech authorization request error', error);
  }
}

function* changeVoiceEngineWorker(
  action: ReturnType<typeof changeVoiceEngine>,
): SagaGenerator<void> {
  const [engine] = action.payload;
  if (engine === (yield* selectVoiceEngine.effect())) return;
  if (engine === 'os' && !(yield* selectVoiceOsEngineAvailable.effect())) {
    yield* put(setVoiceSettingsError(m.settings_voice_osEngineUnavailable_error()));
    return;
  }
  yield* put(setVoiceSettingsError(null));
  yield* put(setVoiceEngineValue(engine));
  yield* call(saveVoiceEnginePreference, engine);
  if (engine === 'os') yield* call(requestOsSpeechAuthorizationWorker);
}

function* changeVoiceInputDeviceWorker(
  action: ReturnType<typeof changeVoiceInputDevice>,
): SagaGenerator<void> {
  const [deviceId] = action.payload;
  if (deviceId === (yield* selectVoiceInputDeviceId.effect())) return;
  yield* put(setVoiceInputDeviceValue(deviceId));
  yield* call(saveVoiceInputDevicePreference, deviceId);
}

function* changeVoiceProviderWorker(
  action: ReturnType<typeof changeVoiceProvider>,
): SagaGenerator<void> {
  const [provider] = action.payload;
  const previous = yield* selectVoiceProvider.effect();
  if (provider === previous) return;
  yield* put(setVoiceSettingsError(null));
  yield* put(setVoiceProviderValue(provider));
  try {
    yield* call(setVoiceProvider, provider);
  } catch (error) {
    yield* put(setVoiceProviderValue(previous));
    yield* put(setVoiceSettingsError(m.settings_voice_providerSaveFailed_error()));
    logger.error('provider change error', error);
  }
}

function* changeVoiceOpenAiModelWorker(
  action: ReturnType<typeof changeVoiceOpenAiModel>,
): SagaGenerator<void> {
  const [model] = action.payload;
  const previous = yield* selectVoiceOpenAiModel.effect();
  if (previous === null || model === previous) return;
  yield* put(setVoiceSettingsError(null));
  yield* put(setVoiceOpenAiModelValue(model));
  try {
    yield* call(setVoiceOpenAiModel, model);
  } catch (error) {
    yield* put(setVoiceOpenAiModelValue(previous));
    yield* put(setVoiceSettingsError(m.settings_voice_modelSaveFailed_error()));
    logger.error('openai model change error', error);
  }
}

function* changeVoiceLanguageWorker(
  action: ReturnType<typeof changeVoiceLanguage>,
): SagaGenerator<void> {
  const [language] = action.payload;
  const previous = yield* selectVoiceLanguage.effect();
  if (previous === null || language === previous) return;
  yield* put(setVoiceSettingsError(null));
  yield* put(setVoiceLanguageValue(language));
  try {
    yield* call(setVoiceLanguage, language);
  } catch (error) {
    yield* put(setVoiceLanguageValue(previous));
    yield* put(setVoiceSettingsError(m.settings_voice_languageSaveFailed_error()));
    logger.error('language change error', error);
  }
}

function* saveVoiceKeyWorker(action: ReturnType<typeof saveVoiceKey>): SagaGenerator<void> {
  const [provider, apiKey] = action.payload;
  yield* put(setVoiceSettingsError(null));
  yield* put(setVoiceBusyProvider(provider));
  try {
    yield* call(saveVoiceApiKey, provider, apiKey);
    yield* put(setVoiceKeyConfigured(provider, true));
  } catch (error) {
    yield* put(setVoiceSettingsError(m.settings_voice_keySaveFailed_error()));
    logger.error('key save error', error);
  } finally {
    yield* put(setVoiceBusyProvider(null));
  }
}

function* clearVoiceKeyWorker(action: ReturnType<typeof clearVoiceKey>): SagaGenerator<void> {
  const [provider] = action.payload;
  yield* put(setVoiceSettingsError(null));
  yield* put(setVoiceBusyProvider(provider));
  try {
    yield* call(clearVoiceApiKey, provider);
    yield* put(setVoiceKeyConfigured(provider, false));
  } catch (error) {
    yield* put(setVoiceSettingsError(m.settings_voice_keyClearFailed_error()));
    logger.error('key clear error', error);
  } finally {
    yield* put(setVoiceBusyProvider(null));
  }
}

function createVoiceDeviceChangeChannel(): EventChannel<true> {
  return eventChannel<true>((emit) => {
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.mediaDevices?.addEventListener !== 'function'
    ) {
      emit(END);
      return () => {};
    }
    const mediaDevices = navigator.mediaDevices;
    const handler = () => emit(true);
    mediaDevices.addEventListener('devicechange', handler);
    return () => mediaDevices.removeEventListener('devicechange', handler);
  }, buffers.sliding(1));
}

function* watchVoiceDeviceChanges(): SagaGenerator<void> {
  const deviceChanges = createVoiceDeviceChangeChannel();
  try {
    const watcher = yield* takeLatest(deviceChanges, refreshVoiceInputDevicesWorker);
    yield* join(watcher);
  } finally {
    deviceChanges.close();
  }
}

function* watchVocabularyEdits(
  writes: Channel<SequencedWrite<string[]>>,
  latest: LatestWrite,
): SagaGenerator<void> {
  let previous = yield* selectVoiceVocabulary.effect();
  while (true) {
    const action = yield* take([
      addVoiceVocabularyTerm,
      removeVoiceVocabularyTerm,
      setVoiceSettingsSnapshot,
      setVoiceVocabularyValue,
    ]);
    const next = yield* selectVoiceVocabulary.effect();
    const isEdit =
      action.type === addVoiceVocabularyTerm.type || action.type === removeVoiceVocabularyTerm.type;
    if (isEdit && previous !== null && next !== null && next !== previous) {
      const sequence = ++latest.sequence;
      yield* put(setVoiceSettingsError(null));
      yield* put(writes, { next, previous, sequence });
    }
    previous = next;
  }
}

function* persistVocabularyWrites(
  writes: Channel<SequencedWrite<string[]>>,
  latest: LatestWrite,
): SagaGenerator<void> {
  while (true) {
    const write = yield* take(writes);
    try {
      yield* call(setVoiceVocabulary, write.next);
    } catch (error) {
      if (write.sequence === latest.sequence) {
        yield* put(setVoiceVocabularyValue(write.previous));
        yield* put(setVoiceSettingsError(m.settings_voice_vocabulary_saveFailed_error()));
      }
      logger.error('vocabulary save error', error);
    }
  }
}

function* watchWorkspaceVocabularyMaxTerms(
  writes: Channel<SequencedWrite<number>>,
  latest: LatestWrite,
): SagaGenerator<void> {
  while (true) {
    const action = yield* take(changeVoiceWorkspaceVocabularyMaxTerms);
    const [next] = action.payload;
    const previous = yield* selectVoiceWorkspaceVocabularyMaxTerms.effect();
    if (previous === null || next === previous) continue;
    const sequence = ++latest.sequence;
    yield* put(setVoiceSettingsError(null));
    yield* put(setVoiceWorkspaceVocabularyMaxTermsValue(next));
    yield* put(writes, { next, previous, sequence });
  }
}

function* persistWorkspaceVocabularyMaxTermsWrites(
  writes: Channel<SequencedWrite<number>>,
  latest: LatestWrite,
): SagaGenerator<void> {
  while (true) {
    const write = yield* take(writes);
    try {
      yield* call(setVoiceWorkspaceVocabularyMaxTerms, write.next);
      yield* call(resetWorkspaceVocabularyCache);
    } catch (error) {
      if (write.sequence === latest.sequence) {
        yield* put(setVoiceWorkspaceVocabularyMaxTermsValue(write.previous));
        yield* put(setVoiceSettingsError(m.settings_voice_workspaceVocabulary_saveFailed_error()));
      }
      logger.error('workspace vocabulary max terms change error', error);
    }
  }
}

export function* voiceSettingsSaga(): SagaGenerator<void> {
  const vocabularyWrites = channel<SequencedWrite<string[]>>(buffers.expanding());
  const maxTermsWrites = channel<SequencedWrite<number>>(buffers.expanding());
  const latestVocabularyWrite: LatestWrite = { sequence: 0 };
  const latestMaxTermsWrite: LatestWrite = { sequence: 0 };
  try {
    yield* all([
      call(initializeVoiceSettingsWorker),
      takeEvery(initializeVoiceSettings, initializeVoiceSettingsWorker),
      takeEvery(changeVoiceProvider, changeVoiceProviderWorker),
      takeEvery(changeVoiceEngine, changeVoiceEngineWorker),
      takeEvery(changeVoiceInputDevice, changeVoiceInputDeviceWorker),
      takeEvery(changeVoiceOpenAiModel, changeVoiceOpenAiModelWorker),
      takeEvery(changeVoiceLanguage, changeVoiceLanguageWorker),
      takeEvery(saveVoiceKey, saveVoiceKeyWorker),
      takeEvery(clearVoiceKey, clearVoiceKeyWorker),
      call(watchVoiceDeviceChanges),
      call(watchVocabularyEdits, vocabularyWrites, latestVocabularyWrite),
      call(persistVocabularyWrites, vocabularyWrites, latestVocabularyWrite),
      call(watchWorkspaceVocabularyMaxTerms, maxTermsWrites, latestMaxTermsWrite),
      call(persistWorkspaceVocabularyMaxTermsWrites, maxTermsWrites, latestMaxTermsWrite),
    ]);
  } finally {
    vocabularyWrites.close();
    maxTermsWrites.close();
  }
}
