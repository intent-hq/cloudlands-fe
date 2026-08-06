import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// FAKE seam: the OS transcription service (IPC to the Electron main process)
// is stubbed so no bridge/helper is ever touched. The flows run against the
// REAL configured store so the state-setting dispatches are exercised.
vi.mock("$features/voice/os-transcription-service", () => ({
  isOsTranscriptionAvailable: vi.fn(),
  requestOsSpeechAuthorization: vi.fn(),
  OsTranscriptionError: class OsTranscriptionError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "OsTranscriptionError";
    }
  },
}));

// FAKE seam: only the daemon-touching helpers are stubbed (partial mock) —
// the constants and type guards stay real so the flows exercise real validation.
vi.mock("$features/voice/voice-settings-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./voice-settings-service")>()),
  loadVoiceSettings: vi.fn(),
  setVoiceOpenAiModel: vi.fn(),
  setVoiceLanguage: vi.fn(),
  setVoiceWorkspaceVocabularyMaxTerms: vi.fn(),
}));

import {
  isOsTranscriptionAvailable,
  requestOsSpeechAuthorization,
} from "$features/voice/os-transcription-service";
import { store as appStore } from "$store/renderer/store";
import {
  setVoiceEngineValue,
  setVoiceInputDevices,
  setVoiceInputDeviceValue,
  setVoiceLanguageValue,
  setVoiceOpenAiModelValue,
  setVoiceOsEngineAvailable,
  setVoiceSettingsError,
  setVoiceWorkspaceVocabularyMaxTermsValue,
} from "$store/renderer/slices/voice-settings/voice-settings-slice";
import { VOICE_ENGINE_STORAGE_KEY } from "$features/voice/voice-engine-preference";
import {
  resetVoiceInputDevicePreferenceSession,
  VOICE_INPUT_DEVICE_STORAGE_KEY,
} from "$features/voice/voice-input-device-preference";
import {
  loadVoiceSettings,
  setVoiceLanguage,
  setVoiceOpenAiModel,
  setVoiceWorkspaceVocabularyMaxTerms,
} from "$features/voice/voice-settings-service";
import {
  __resetVoiceSettingsBootHydrationForTests,
  changeVoiceEngineFlow,
  changeVoiceInputDeviceFlow,
  changeVoiceLanguageFlow,
  changeVoiceOpenAiModelFlow,
  changeVoiceWorkspaceVocabularyMaxTermsFlow,
  createVoiceSettingsMiddleware,
  hydrateVoiceEngineFlow,
  hydrateVoiceInputDeviceFlow,
  refreshVoiceInputDevicesFlow,
  requestOsSpeechAuthorizationFlow,
} from "./voice-settings-store-service";

const availableMock = vi.mocked(isOsTranscriptionAvailable);
const requestAuthMock = vi.mocked(requestOsSpeechAuthorization);
const loadSettingsMock = vi.mocked(loadVoiceSettings);
const setModelMock = vi.mocked(setVoiceOpenAiModel);
const setLanguageMock = vi.mocked(setVoiceLanguage);
const setMaxTermsMock = vi.mocked(setVoiceWorkspaceVocabularyMaxTerms);
// The global test setup replaces window.localStorage with vi.fn stubs.
const getItemMock = vi.mocked(window.localStorage.getItem);
const setItemMock = vi.mocked(window.localStorage.setItem);
const removeItemMock = vi.mocked(window.localStorage.removeItem);
const flush = () => new Promise((r) => setTimeout(r, 0));
const state = () => appStore.state.voiceSettings;

describe("voiceSettingsStoreService engine flows (fake seams, real store)", () => {
  // Burn the middleware's one-time boot hydration before the flow tests run —
  // its async engine/device hydration would otherwise race the assertions.
  beforeAll(async () => {
    appStore.init();
    appStore.dispatch(setVoiceSettingsError(null));
    await flush();
    appStore.dispatch(setVoiceSettingsError(null));
  });
  beforeEach(() => {
    requestAuthMock.mockResolvedValue("authorized");
    availableMock.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
    getItemMock.mockReset().mockReturnValue(null);
    setItemMock.mockReset();
    appStore.dispatch(setVoiceEngineValue("daemon"));
    appStore.dispatch(setVoiceOsEngineAvailable(false));
    appStore.dispatch(setVoiceSettingsError(null));
  });

  it("enabling the OS engine requests speech authorization (enable-time TCC prompt)", async () => {
    appStore.dispatch(setVoiceOsEngineAvailable(true));

    changeVoiceEngineFlow("os");
    await flush();

    expect(state().engine).toBe("os");
    expect(setItemMock).toHaveBeenCalledWith(VOICE_ENGINE_STORAGE_KEY, "os");
    expect(requestAuthMock).toHaveBeenCalledTimes(1);
    expect(state().error).toBeNull();
  });

  it("surfaces the System Settings hint when authorization is denied — selection stands", async () => {
    appStore.dispatch(setVoiceOsEngineAvailable(true));
    requestAuthMock.mockResolvedValue("denied");

    changeVoiceEngineFlow("os");
    await flush();

    expect(state().engine).toBe("os");
    expect(state().error).toMatch(/Speech Recognition/);
  });

  it("surfaces the same hint for a restricted status", async () => {
    appStore.dispatch(setVoiceOsEngineAvailable(true));
    requestAuthMock.mockResolvedValue("restricted");

    changeVoiceEngineFlow("os");
    await flush();

    expect(state().error).toMatch(/Speech Recognition/);
  });

  it("keeps the selection and stays quiet when the authorization request itself fails", async () => {
    appStore.dispatch(setVoiceOsEngineAvailable(true));
    requestAuthMock.mockRejectedValue(new Error("helper crashed"));

    changeVoiceEngineFlow("os");
    await flush();

    expect(state().engine).toBe("os");
    expect(state().error).toBeNull();
  });

  it("does not request authorization when the OS engine is unavailable", async () => {
    changeVoiceEngineFlow("os");
    await flush();

    expect(state().engine).toBe("daemon");
    expect(state().error).toMatch(/not available/);
    expect(requestAuthMock).not.toHaveBeenCalled();
  });

  it("switching to the daemon engine never requests authorization", async () => {
    appStore.dispatch(setVoiceEngineValue("os"));

    changeVoiceEngineFlow("daemon");
    await flush();

    expect(state().engine).toBe("daemon");
    expect(requestAuthMock).not.toHaveBeenCalled();
  });

  it("re-selecting the current engine is a no-op — no repeat prompt", async () => {
    appStore.dispatch(setVoiceOsEngineAvailable(true));
    appStore.dispatch(setVoiceEngineValue("os"));

    changeVoiceEngineFlow("os");
    await flush();

    expect(requestAuthMock).not.toHaveBeenCalled();
  });

  it("hydration probes availability only — never the authorization channel", async () => {
    getItemMock.mockReturnValue("os");

    await hydrateVoiceEngineFlow();

    expect(state().engine).toBe("os");
    expect(state().osEngineAvailable).toBe(true);
    expect(availableMock).toHaveBeenCalledTimes(1);
    expect(requestAuthMock).not.toHaveBeenCalled();
  });

  it("hydration re-probes availability on each run — a helper built after launch is picked up", async () => {
    availableMock.mockResolvedValueOnce(false);
    await hydrateVoiceEngineFlow();
    expect(state().osEngineAvailable).toBe(false);

    availableMock.mockResolvedValueOnce(true);
    await hydrateVoiceEngineFlow();
    expect(state().osEngineAvailable).toBe(true);
    expect(availableMock).toHaveBeenCalledTimes(2);
  });

  it("requestOsSpeechAuthorizationFlow leaves no error for an authorized outcome", async () => {
    appStore.dispatch(setVoiceSettingsError(null));

    await requestOsSpeechAuthorizationFlow();

    expect(state().error).toBeNull();
  });
});

describe("voiceSettingsStoreService OpenAI model flow (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  beforeEach(() => {
    setModelMock.mockResolvedValue(undefined);
    appStore.dispatch(setVoiceOpenAiModelValue("gpt-4o-transcribe"));
    appStore.dispatch(setVoiceSettingsError(null));
  });
  afterEach(() => {
    vi.clearAllMocks();
    appStore.dispatch(setVoiceOpenAiModelValue(null));
    appStore.dispatch(setVoiceSettingsError(null));
  });

  it("applies the model optimistically and persists through the seam", async () => {
    await changeVoiceOpenAiModelFlow("whisper-1");

    expect(state().openaiModel).toBe("whisper-1");
    expect(setModelMock).toHaveBeenCalledWith("whisper-1");
    expect(state().error).toBeNull();
  });

  it("rolls back to the previous model and surfaces an error when the write fails", async () => {
    setModelMock.mockRejectedValue(new Error("settings.update did not apply voice.openai.model"));

    await changeVoiceOpenAiModelFlow("gpt-4o-mini-transcribe");

    expect(state().openaiModel).toBe("gpt-4o-transcribe");
    expect(state().error).not.toBeNull();
  });

  it("re-selecting the current model is a no-op — no daemon write", async () => {
    await changeVoiceOpenAiModelFlow("gpt-4o-transcribe");

    expect(setModelMock).not.toHaveBeenCalled();
  });

  it("skips the write when the daemon's catalog lacks the setting (null state)", async () => {
    appStore.dispatch(setVoiceOpenAiModelValue(null));

    await changeVoiceOpenAiModelFlow("whisper-1");

    expect(setModelMock).not.toHaveBeenCalled();
    expect(state().openaiModel).toBeNull();
  });
});

describe("voiceSettingsStoreService language flow (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  beforeEach(() => {
    setLanguageMock.mockResolvedValue(undefined);
    appStore.dispatch(setVoiceLanguageValue(""));
    appStore.dispatch(setVoiceSettingsError(null));
  });
  afterEach(() => {
    vi.clearAllMocks();
    appStore.dispatch(setVoiceLanguageValue(null));
    appStore.dispatch(setVoiceSettingsError(null));
  });

  it("applies the language optimistically and persists through the seam", async () => {
    await changeVoiceLanguageFlow("de");

    expect(state().language).toBe("de");
    expect(setLanguageMock).toHaveBeenCalledWith("de");
    expect(state().error).toBeNull();
  });

  it("persists the auto-detect sentinel (empty string)", async () => {
    appStore.dispatch(setVoiceLanguageValue("de"));

    await changeVoiceLanguageFlow("");

    expect(state().language).toBe("");
    expect(setLanguageMock).toHaveBeenCalledWith("");
  });

  it("rolls back to the previous language and surfaces an error when the write fails", async () => {
    appStore.dispatch(setVoiceLanguageValue("de"));
    setLanguageMock.mockRejectedValue(new Error("settings.update did not apply voice.language"));

    await changeVoiceLanguageFlow("fr");

    expect(state().language).toBe("de");
    expect(state().error).not.toBeNull();
  });

  it("re-selecting the current language is a no-op — no daemon write", async () => {
    appStore.dispatch(setVoiceLanguageValue("de"));

    await changeVoiceLanguageFlow("de");

    expect(setLanguageMock).not.toHaveBeenCalled();
  });

  it("skips the write when the daemon's catalog lacks the setting (null state)", async () => {
    appStore.dispatch(setVoiceLanguageValue(null));

    await changeVoiceLanguageFlow("de");

    expect(setLanguageMock).not.toHaveBeenCalled();
    expect(state().language).toBeNull();
  });
});

describe("voiceSettingsStoreService workspace-vocabulary cap flow (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  beforeEach(() => {
    setMaxTermsMock.mockResolvedValue(undefined);
    appStore.dispatch(setVoiceWorkspaceVocabularyMaxTermsValue(50));
    appStore.dispatch(setVoiceSettingsError(null));
  });
  afterEach(() => {
    vi.clearAllMocks();
    appStore.dispatch(setVoiceWorkspaceVocabularyMaxTermsValue(null));
    appStore.dispatch(setVoiceSettingsError(null));
  });

  it("applies the cap optimistically and persists through the seam", async () => {
    await changeVoiceWorkspaceVocabularyMaxTermsFlow(75);

    expect(state().workspaceVocabularyMaxTerms).toBe(75);
    expect(setMaxTermsMock).toHaveBeenCalledWith(75);
    expect(state().error).toBeNull();
  });

  it("persists the 0 = off sentinel", async () => {
    await changeVoiceWorkspaceVocabularyMaxTermsFlow(0);

    expect(state().workspaceVocabularyMaxTerms).toBe(0);
    expect(setMaxTermsMock).toHaveBeenCalledWith(0);
  });

  it("rolls back to the previous cap and surfaces an error when the write fails", async () => {
    setMaxTermsMock.mockRejectedValue(
      new Error("settings.update did not apply voice.workspaceVocabulary.maxTerms"),
    );

    await changeVoiceWorkspaceVocabularyMaxTermsFlow(75);

    expect(state().workspaceVocabularyMaxTerms).toBe(50);
    expect(state().error).not.toBeNull();
  });

  it("re-committing the current cap is a no-op — no daemon write", async () => {
    await changeVoiceWorkspaceVocabularyMaxTermsFlow(50);

    expect(setMaxTermsMock).not.toHaveBeenCalled();
  });

  it("skips the write when the daemon's catalog lacks the setting (null state)", async () => {
    appStore.dispatch(setVoiceWorkspaceVocabularyMaxTermsValue(null));

    await changeVoiceWorkspaceVocabularyMaxTermsFlow(75);

    expect(setMaxTermsMock).not.toHaveBeenCalled();
    expect(state().workspaceVocabularyMaxTerms).toBeNull();
  });
});

describe("voiceSettingsStoreService input-device flows (fake MediaDevices, real store)", () => {
  const enumerateDevices = vi.fn();
  const addEventListener = vi.fn();

  beforeAll(() => appStore.init());
  beforeEach(() => {
    enumerateDevices.mockResolvedValue([
      { kind: "audioinput", deviceId: "mic-1", label: "USB Mic" },
      { kind: "audioinput", deviceId: "", label: "" }, // permission-less placeholder
      { kind: "audiooutput", deviceId: "spk-1", label: "Speakers" },
      { kind: "videoinput", deviceId: "cam-1", label: "Camera" },
    ]);
    vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices, addEventListener } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    resetVoiceInputDevicePreferenceSession();
    getItemMock.mockReset().mockReturnValue(null);
    setItemMock.mockReset();
    appStore.dispatch(setVoiceInputDeviceValue(null));
    appStore.dispatch(setVoiceInputDevices([]));
  });

  it("refresh enumerates and keeps only audio inputs with real device ids", async () => {
    await refreshVoiceInputDevicesFlow();

    expect(state().inputDevices).toEqual([{ deviceId: "mic-1", label: "USB Mic" }]);
  });

  it("refresh leaves the list alone when enumeration fails", async () => {
    appStore.dispatch(setVoiceInputDevices([{ deviceId: "mic-1", label: "USB Mic" }]));
    enumerateDevices.mockRejectedValue(new Error("NotAllowedError"));

    await refreshVoiceInputDevicesFlow();

    expect(state().inputDevices).toEqual([{ deviceId: "mic-1", label: "USB Mic" }]);
  });

  // NOTE: this test must be the first hydrate call in the suite — the
  // devicechange listener is registered once per renderer (module-level guard),
  // so only the first hydration records the registration on the mock.
  it("hydration registers a devicechange listener that re-enumerates the device list", async () => {
    await hydrateVoiceInputDeviceFlow();

    const registration = addEventListener.mock.calls.find(([event]) => event === "devicechange");
    expect(registration).toBeDefined();

    enumerateDevices.mockResolvedValue([
      { kind: "audioinput", deviceId: "mic-2", label: "Headset" },
    ]);
    (registration![1] as () => void)();
    await flush();
    expect(state().inputDevices).toEqual([{ deviceId: "mic-2", label: "Headset" }]);
  });

  it("hydration loads the persisted preference and enumerates devices", async () => {
    getItemMock.mockImplementation((key) =>
      key === VOICE_INPUT_DEVICE_STORAGE_KEY ? "mic-1" : null,
    );

    await hydrateVoiceInputDeviceFlow();

    expect(state().inputDeviceId).toBe("mic-1");
    expect(state().inputDevices).toEqual([{ deviceId: "mic-1", label: "USB Mic" }]);
  });

  it("changing the device applies it to the store and persists locally", () => {
    changeVoiceInputDeviceFlow("mic-1");

    expect(state().inputDeviceId).toBe("mic-1");
    expect(setItemMock).toHaveBeenCalledWith(VOICE_INPUT_DEVICE_STORAGE_KEY, "mic-1");
  });

  it("selecting the system default clears the persisted preference", () => {
    appStore.dispatch(setVoiceInputDeviceValue("mic-1"));

    changeVoiceInputDeviceFlow(null);

    expect(state().inputDeviceId).toBeNull();
    expect(removeItemMock).toHaveBeenCalledWith(VOICE_INPUT_DEVICE_STORAGE_KEY);
  });

  it("re-selecting the current device is a no-op — no persistence write", () => {
    appStore.dispatch(setVoiceInputDeviceValue("mic-1"));

    changeVoiceInputDeviceFlow("mic-1");

    expect(setItemMock).not.toHaveBeenCalled();
    expect(removeItemMock).not.toHaveBeenCalled();
  });
});

describe("createVoiceSettingsMiddleware boot hydration (fake seams, real store)", () => {
  beforeAll(() => appStore.init());
  beforeEach(() => {
    __resetVoiceSettingsBootHydrationForTests();
    availableMock.mockResolvedValue(false);
    loadSettingsMock.mockResolvedValue({
      available: true,
      provider: "elevenlabs",
      keyConfigured: { elevenlabs: true, openai: false },
      vocabulary: [],
      openaiModel: null,
      language: "de",
      workspaceVocabularyMaxTerms: 50,
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
    __resetVoiceSettingsBootHydrationForTests();
    appStore.dispatch(setVoiceSettingsError(null));
  });

  it("hydrates the daemon snapshot once on the first dispatched action — dictation sees voice.language without the settings panel ever mounting", async () => {
    const middleware = createVoiceSettingsMiddleware();
    const invoke = middleware({
      dispatch: (action) => appStore.dispatch(action),
      getState: () => appStore.state,
    })((action) => action);

    invoke({ type: "unrelated/action" });
    invoke({ type: "another/action" });
    await flush();

    expect(loadSettingsMock).toHaveBeenCalledTimes(1);
    expect(state().language).toBe("de");
    expect(state().workspaceVocabularyMaxTerms).toBe(50);
  });
});
