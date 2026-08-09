import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  setProvider: vi.fn(),
  saveKey: vi.fn(),
  clearKey: vi.fn(),
  setVocabulary: vi.fn(),
  setModel: vi.fn(),
  setLanguage: vi.fn(),
  setMaxTerms: vi.fn(),
  osAvailable: vi.fn(),
  requestAuthorization: vi.fn(),
  loadEngine: vi.fn(),
  saveEngine: vi.fn(),
  loadInputDevice: vi.fn(),
  saveInputDevice: vi.fn(),
  resetVocabularyCache: vi.fn(),
}));

vi.mock('$features/voice/voice-settings-service', () => ({
  VOICE_VOCABULARY_TERM_MAX_LENGTH: 100,
  loadVoiceSettings: mocks.loadSettings,
  setVoiceProvider: mocks.setProvider,
  saveVoiceApiKey: mocks.saveKey,
  clearVoiceApiKey: mocks.clearKey,
  setVoiceVocabulary: mocks.setVocabulary,
  setVoiceOpenAiModel: mocks.setModel,
  setVoiceLanguage: mocks.setLanguage,
  setVoiceWorkspaceVocabularyMaxTerms: mocks.setMaxTerms,
}));
vi.mock('$features/voice/os-transcription-service', () => ({
  isOsTranscriptionAvailable: mocks.osAvailable,
  requestOsSpeechAuthorization: mocks.requestAuthorization,
}));
vi.mock('$features/voice/voice-engine-preference', () => ({
  loadVoiceEnginePreference: mocks.loadEngine,
  saveVoiceEnginePreference: mocks.saveEngine,
}));
vi.mock('$features/voice/voice-input-device-preference', () => ({
  loadVoiceInputDevicePreference: mocks.loadInputDevice,
  saveVoiceInputDevicePreference: mocks.saveInputDevice,
}));
vi.mock('$features/voice/workspace-vocabulary-service', () => ({
  resetWorkspaceVocabularyCache: mocks.resetVocabularyCache,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

import type { StoreState } from '../../../types';
import {
  addVoiceVocabularyTerm,
  changeVoiceEngine,
  changeVoiceInputDevice,
  changeVoiceLanguage,
  changeVoiceOpenAiModel,
  changeVoiceProvider,
  changeVoiceWorkspaceVocabularyMaxTerms,
  clearVoiceKey,
  initialState,
  initializeVoiceSettings,
  saveVoiceKey,
  setVoiceLanguageValue,
  setVoiceOpenAiModelValue,
  setVoiceOsEngineAvailable,
  setVoiceSettingsError,
  setVoiceVocabularyValue,
  setVoiceWorkspaceVocabularyMaxTermsValue,
  voiceSettingsReducer,
} from '../voice-settings-slice';
import { voiceSettingsSaga } from './voice-settings-saga';

const snapshot = {
  available: true,
  provider: 'elevenlabs' as const,
  keyConfigured: { elevenlabs: false, openai: false },
  vocabulary: [] as string[],
  openaiModel: 'gpt-4o-transcribe' as const,
  language: '',
  workspaceVocabularyMaxTerms: 50,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function createHarness() {
  let state = { voiceSettings: structuredClone(initialState) } as StoreState;
  const input = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: Parameters<typeof voiceSettingsReducer>[1]) => {
    state = {
      ...state,
      voiceSettings: voiceSettingsReducer(state.voiceSettings, action),
    };
    input.put(action);
    for (const listener of listeners) listener();
    return action;
  });
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel: input, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    voiceSettingsSaga,
  );
  return {
    dispatch,
    getState: () => state.voiceSettings,
    task,
  };
}

describe('voiceSettingsSaga', () => {
  let enumerateDevices: ReturnType<typeof vi.fn>;
  let deviceChangeHandler: (() => void) | undefined;
  let addEventListener: ReturnType<typeof vi.fn>;
  let removeEventListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadSettings.mockResolvedValue(snapshot);
    mocks.setProvider.mockResolvedValue(undefined);
    mocks.saveKey.mockResolvedValue(undefined);
    mocks.clearKey.mockResolvedValue(undefined);
    mocks.setVocabulary.mockResolvedValue(undefined);
    mocks.setModel.mockResolvedValue(undefined);
    mocks.setLanguage.mockResolvedValue(undefined);
    mocks.setMaxTerms.mockResolvedValue(undefined);
    mocks.osAvailable.mockResolvedValue(true);
    mocks.requestAuthorization.mockResolvedValue('authorized');
    mocks.loadEngine.mockReturnValue('daemon');
    mocks.loadInputDevice.mockReturnValue(null);
    enumerateDevices = vi.fn().mockResolvedValue([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'USB Mic' },
      { kind: 'audioinput', deviceId: '', label: '' },
      { kind: 'audiooutput', deviceId: 'speaker-1', label: 'Speakers' },
    ]);
    addEventListener = vi.fn((event: string, handler: () => void) => {
      if (event === 'devicechange') deviceChangeHandler = handler;
    });
    removeEventListener = vi.fn();
    vi.stubGlobal('navigator', {
      mediaDevices: { enumerateDevices, addEventListener, removeEventListener },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('hydrates the protocol-shaped boot snapshot exactly once and owns device cleanup', async () => {
    const { getState, task } = createHarness();

    await vi.waitFor(() => expect(getState().isLoading).toBe(false));
    expect(mocks.loadSettings).toHaveBeenCalledTimes(1);
    expect(getState()).toMatchObject({
      available: true,
      provider: 'elevenlabs',
      language: '',
      workspaceVocabularyMaxTerms: 50,
      inputDevices: [{ deviceId: 'mic-1', label: 'USB Mic' }],
    });
    expect(mocks.osAvailable).toHaveBeenCalledTimes(1);
    expect(mocks.loadEngine).toHaveBeenCalledTimes(1);
    expect(mocks.loadInputDevice).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function));

    task.cancel();
    await task.toPromise();
    expect(removeEventListener).toHaveBeenCalledWith('devicechange', deviceChangeHandler);
  });

  it('re-hydrates only for the explicit initialize trigger', async () => {
    const { dispatch, task } = createHarness();
    await vi.waitFor(() => expect(mocks.loadSettings).toHaveBeenCalledTimes(1));

    dispatch(initializeVoiceSettings());
    await vi.waitFor(() => expect(mocks.loadSettings).toHaveBeenCalledTimes(2));
    expect(mocks.osAvailable).toHaveBeenCalledTimes(2);
    expect(enumerateDevices).toHaveBeenCalledTimes(2);

    task.cancel();
    await task.toPromise();
  });

  it('persists provider and key requests with optimistic rollback and busy-state cleanup', async () => {
    const { dispatch, getState, task } = createHarness();
    await vi.waitFor(() => expect(getState().isLoading).toBe(false));

    dispatch(changeVoiceProvider('openai'));
    await vi.waitFor(() => expect(mocks.setProvider).toHaveBeenCalledWith('openai'));
    expect(getState().provider).toBe('openai');

    mocks.setProvider.mockRejectedValueOnce(new Error('settings.update failed'));
    dispatch(changeVoiceProvider('elevenlabs'));
    await vi.waitFor(() => expect(getState().error).not.toBeNull());
    expect(getState().provider).toBe('openai');

    dispatch(saveVoiceKey('openai', '  sk-test  '));
    await vi.waitFor(() => expect(mocks.saveKey).toHaveBeenCalledWith('openai', '  sk-test  '));
    expect(getState().keyConfigured.openai).toBe(true);
    expect(getState().busyProvider).toBeNull();

    mocks.clearKey.mockRejectedValueOnce(new Error('settings.reset failed'));
    dispatch(clearVoiceKey('openai'));
    await vi.waitFor(() => expect(getState().busyProvider).toBeNull());
    expect(mocks.clearKey).toHaveBeenCalledWith('openai');
    expect(getState().keyConfigured.openai).toBe(true);
    expect(getState().error).not.toBeNull();

    task.cancel();
    await task.toPromise();
  });

  it('preserves local engine, authorization, input-device, and devicechange flows', async () => {
    const { dispatch, getState, task } = createHarness();
    await vi.waitFor(() => expect(getState().isLoading).toBe(false));
    mocks.requestAuthorization.mockResolvedValueOnce('denied');

    dispatch(changeVoiceEngine('os'));
    await vi.waitFor(() => expect(mocks.requestAuthorization).toHaveBeenCalledTimes(1));
    expect(mocks.saveEngine).toHaveBeenCalledWith('os');
    expect(getState().engine).toBe('os');
    expect(getState().error).toMatch(/Speech Recognition/);

    dispatch(changeVoiceInputDevice('mic-1'));
    await vi.waitFor(() => expect(mocks.saveInputDevice).toHaveBeenCalledWith('mic-1'));
    expect(getState().inputDeviceId).toBe('mic-1');

    enumerateDevices.mockResolvedValue([
      { kind: 'audioinput', deviceId: 'mic-2', label: 'Headset' },
    ]);
    deviceChangeHandler?.();
    await vi.waitFor(() =>
      expect(getState().inputDevices).toEqual([{ deviceId: 'mic-2', label: 'Headset' }]),
    );

    task.cancel();
    await task.toPromise();
  });

  it('rejects an unavailable OS engine without persisting or requesting authorization', async () => {
    const { dispatch, getState, task } = createHarness();
    await vi.waitFor(() => expect(getState().isLoading).toBe(false));
    dispatch(setVoiceOsEngineAvailable(false));

    dispatch(changeVoiceEngine('os'));
    await vi.waitFor(() => expect(getState().error).toMatch(/not available/));
    expect(getState().engine).toBe('daemon');
    expect(mocks.saveEngine).not.toHaveBeenCalled();
    expect(mocks.requestAuthorization).not.toHaveBeenCalled();

    task.cancel();
    await task.toPromise();
  });

  it('persists model and language and rolls each back on its exact seam failure', async () => {
    const { dispatch, getState, task } = createHarness();
    await vi.waitFor(() => expect(getState().isLoading).toBe(false));
    dispatch(setVoiceOpenAiModelValue('gpt-4o-transcribe'));
    dispatch(setVoiceLanguageValue('de'));
    mocks.setModel.mockRejectedValueOnce(new Error('model rejected'));
    mocks.setLanguage.mockRejectedValueOnce(new Error('language rejected'));

    dispatch(changeVoiceOpenAiModel('whisper-1'));
    dispatch(changeVoiceLanguage('fr'));
    await vi.waitFor(() => expect(mocks.setModel).toHaveBeenCalledWith('whisper-1'));
    await vi.waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('fr'));
    expect(getState().openaiModel).toBe('gpt-4o-transcribe');
    expect(getState().language).toBe('de');
    expect(getState().error).not.toBeNull();

    task.cancel();
    await task.toPromise();
  });

  it('serializes vocabulary writes and ignores a stale failure rollback', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    mocks.setVocabulary.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { dispatch, getState, task } = createHarness();
    await vi.waitFor(() => expect(getState().isLoading).toBe(false));
    dispatch(setVoiceVocabularyValue([]));

    dispatch(addVoiceVocabularyTerm('Intent'));
    await vi.waitFor(() => expect(mocks.setVocabulary).toHaveBeenCalledWith(['Intent']));
    dispatch(addVoiceVocabularyTerm('Cloudlands'));
    expect(getState().vocabulary).toEqual(['Intent', 'Cloudlands']);
    expect(mocks.setVocabulary).toHaveBeenCalledTimes(1);

    first.reject(new Error('stale failure'));
    await vi.waitFor(() => expect(mocks.setVocabulary).toHaveBeenCalledTimes(2));
    expect(mocks.setVocabulary).toHaveBeenNthCalledWith(2, ['Intent', 'Cloudlands']);
    expect(getState().vocabulary).toEqual(['Intent', 'Cloudlands']);
    expect(getState().error).toBeNull();
    second.resolve();

    task.cancel();
    await task.toPromise();
  });

  it('serializes cap writes, protects newer optimism, and invalidates after success', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    mocks.setMaxTerms.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { dispatch, getState, task } = createHarness();
    await vi.waitFor(() => expect(getState().isLoading).toBe(false));
    dispatch(setVoiceWorkspaceVocabularyMaxTermsValue(50));

    dispatch(changeVoiceWorkspaceVocabularyMaxTerms(75));
    await vi.waitFor(() => expect(mocks.setMaxTerms).toHaveBeenCalledWith(75));
    dispatch(changeVoiceWorkspaceVocabularyMaxTerms(25));
    expect(getState().workspaceVocabularyMaxTerms).toBe(25);
    expect(mocks.setMaxTerms).toHaveBeenCalledTimes(1);

    first.reject(new Error('stale failure'));
    await vi.waitFor(() => expect(mocks.setMaxTerms).toHaveBeenCalledTimes(2));
    expect(mocks.setMaxTerms).toHaveBeenNthCalledWith(2, 25);
    expect(getState().workspaceVocabularyMaxTerms).toBe(25);
    expect(getState().error).toBeNull();
    second.resolve();
    await vi.waitFor(() => expect(mocks.resetVocabularyCache).toHaveBeenCalledTimes(1));

    task.cancel();
    await task.toPromise();
  });

  it('rolls back the latest vocabulary and cap writes and surfaces localized errors', async () => {
    mocks.setVocabulary.mockRejectedValueOnce(new Error('vocabulary rejected'));
    mocks.setMaxTerms.mockRejectedValueOnce(new Error('cap rejected'));
    const { dispatch, getState, task } = createHarness();
    await vi.waitFor(() => expect(getState().isLoading).toBe(false));
    dispatch(setVoiceVocabularyValue([]));

    dispatch(addVoiceVocabularyTerm('Intent'));
    await vi.waitFor(() => expect(getState().vocabulary).toEqual([]));
    expect(getState().error).not.toBeNull();

    dispatch(setVoiceSettingsError(null));
    dispatch(setVoiceWorkspaceVocabularyMaxTermsValue(50));
    dispatch(changeVoiceWorkspaceVocabularyMaxTerms(75));
    await vi.waitFor(() => expect(getState().workspaceVocabularyMaxTerms).toBe(50));
    expect(getState().error).not.toBeNull();
    expect(mocks.resetVocabularyCache).not.toHaveBeenCalled();

    task.cancel();
    await task.toPromise();
  });

  it('prevents a cancelled boot request from mutating state after it settles', async () => {
    const boot = deferred<typeof snapshot>();
    mocks.loadSettings.mockReturnValue(boot.promise);
    const { getState, task } = createHarness();
    await vi.waitFor(() => expect(mocks.loadSettings).toHaveBeenCalledTimes(1));

    task.cancel();
    boot.resolve({ ...snapshot, language: 'fr' });
    await task.toPromise();
    await Promise.resolve();

    expect(getState().isLoading).toBe(true);
    expect(getState().language).toBeNull();
    expect(removeEventListener).toHaveBeenCalledWith('devicechange', deviceChangeHandler);
  });
});
