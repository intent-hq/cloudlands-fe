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

// FAKE seam: only the daemon-write helper is stubbed (partial mock) — the
// constants and type guards stay real so the flows exercise real validation.
vi.mock("$features/voice/voice-settings-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./voice-settings-service")>()),
  setVoiceOpenAiModel: vi.fn(),
}));

import {
  isOsTranscriptionAvailable,
  requestOsSpeechAuthorization,
} from "$features/voice/os-transcription-service";
import { store as appStore } from "$store/renderer/store";
import {
  setVoiceEngineValue,
  setVoiceOpenAiModelValue,
  setVoiceOsEngineAvailable,
  setVoiceSettingsError,
} from "$store/renderer/slices/voice-settings/voice-settings-slice";
import { VOICE_ENGINE_STORAGE_KEY } from "$features/voice/voice-engine-preference";
import { setVoiceOpenAiModel } from "$features/voice/voice-settings-service";
import {
  changeVoiceEngineFlow,
  changeVoiceOpenAiModelFlow,
  hydrateVoiceEngineFlow,
  requestOsSpeechAuthorizationFlow,
} from "./voice-settings-store-service";

const availableMock = vi.mocked(isOsTranscriptionAvailable);
const requestAuthMock = vi.mocked(requestOsSpeechAuthorization);
const setModelMock = vi.mocked(setVoiceOpenAiModel);
// The global test setup replaces window.localStorage with vi.fn stubs.
const getItemMock = vi.mocked(window.localStorage.getItem);
const setItemMock = vi.mocked(window.localStorage.setItem);
const flush = () => new Promise((r) => setTimeout(r, 0));
const state = () => appStore.state.voiceSettings;

describe("voiceSettingsStoreService engine flows (fake seams, real store)", () => {
  beforeAll(() => appStore.init());
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
