import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE seam: the AppClient settings domain is stubbed so no IPC happens —
// the service is exercised directly against PROTOCOL §5.12-shaped responses
// (same pattern as linear-auth-store-service.test.ts).
vi.mock("$lib/client", () => ({
  appClient: {
    settings: {
      get: vi.fn(() => Promise.resolve(null)),
      update: vi.fn(() => Promise.resolve([])),
      reset: vi.fn(() => Promise.resolve(null)),
    },
  },
}));

import { appClient } from "$lib/client";
import {
  clearVoiceApiKey,
  loadVoiceSettings,
  saveVoiceApiKey,
  setVoiceLanguage,
  setVoiceOpenAiModel,
  setVoiceProvider,
  setVoiceVocabulary,
  VOICE_API_KEY_SETTING_PATHS,
  VOICE_LANGUAGE_SETTING_PATH,
  VOICE_OPENAI_DEFAULT_MODEL,
  VOICE_OPENAI_MODEL_SETTING_PATH,
  VOICE_PROVIDER_SETTING_PATH,
  VOICE_VOCABULARY_SETTING_PATH,
} from "./voice-settings-service";

const settings = appClient.settings as unknown as Record<string, ReturnType<typeof vi.fn>>;

/** §5.12 SettingDefinitionWithValue-shaped stub (only the fields the service reads). */
const entry = (path: string, value: unknown) => ({ path, value });

// Sensitive values are redacted to a placeholder on the wire (§5.12) — the
// service must treat any non-empty string as "configured", never the secret.
const REDACTED = "********";

describe("voiceSettingsService (mocked settings seam)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    settings.get.mockResolvedValue(null as never);
    settings.update.mockResolvedValue([] as never);
    settings.reset.mockResolvedValue(null as never);
  });

  it("loads provider + redacted key presence + vocabulary + model + language from the daemon settings paths", async () => {
    settings.get.mockImplementation((path: string) => {
      if (path === VOICE_PROVIDER_SETTING_PATH) return Promise.resolve(entry(path, "openai"));
      if (path === VOICE_API_KEY_SETTING_PATHS.elevenlabs)
        return Promise.resolve(entry(path, REDACTED));
      if (path === VOICE_VOCABULARY_SETTING_PATH)
        return Promise.resolve(entry(path, ["intentd", "Cloudlands"]));
      if (path === VOICE_OPENAI_MODEL_SETTING_PATH)
        return Promise.resolve(entry(path, "whisper-1"));
      if (path === VOICE_LANGUAGE_SETTING_PATH) return Promise.resolve(entry(path, "de"));
      return Promise.resolve(entry(path, null));
    });

    const snapshot = await loadVoiceSettings();

    expect(settings.get).toHaveBeenCalledWith(VOICE_PROVIDER_SETTING_PATH);
    expect(settings.get).toHaveBeenCalledWith(VOICE_API_KEY_SETTING_PATHS.elevenlabs);
    expect(settings.get).toHaveBeenCalledWith(VOICE_API_KEY_SETTING_PATHS.openai);
    expect(settings.get).toHaveBeenCalledWith(VOICE_VOCABULARY_SETTING_PATH);
    expect(settings.get).toHaveBeenCalledWith(VOICE_OPENAI_MODEL_SETTING_PATH);
    expect(settings.get).toHaveBeenCalledWith(VOICE_LANGUAGE_SETTING_PATH);
    expect(snapshot).toEqual({
      available: true,
      provider: "openai",
      keyConfigured: { elevenlabs: true, openai: false },
      vocabulary: ["intentd", "Cloudlands"],
      openaiModel: "whisper-1",
      language: "de",
    });
  });

  it("falls back to the daemon default provider and reports unavailable on a pre-voice daemon", async () => {
    settings.get.mockResolvedValue(null as never);

    const snapshot = await loadVoiceSettings();

    expect(snapshot.available).toBe(false);
    expect(snapshot.provider).toBe("elevenlabs");
    expect(snapshot.keyConfigured).toEqual({ elevenlabs: false, openai: false });
    expect(snapshot.vocabulary).toBeNull();
    expect(snapshot.openaiModel).toBeNull();
    expect(snapshot.language).toBeNull();
  });

  it("surfaces a null language when the daemon's catalog lacks voice.language", async () => {
    settings.get.mockImplementation((path: string) =>
      Promise.resolve(path === VOICE_LANGUAGE_SETTING_PATH ? null : entry(path, null)),
    );

    const snapshot = await loadVoiceSettings();

    expect(snapshot.language).toBeNull();
  });

  it("folds an unset or blank language value to auto-detect (empty string)", async () => {
    settings.get.mockImplementation((path: string) =>
      Promise.resolve(entry(path, path === VOICE_LANGUAGE_SETTING_PATH ? "  " : null)),
    );

    let snapshot = await loadVoiceSettings();
    expect(snapshot.language).toBe("");

    settings.get.mockImplementation((path: string) => Promise.resolve(entry(path, null)));
    snapshot = await loadVoiceSettings();
    expect(snapshot.language).toBe("");
  });

  it("lowercases a hand-edited language value so it matches the curated codes", async () => {
    settings.get.mockImplementation((path: string) =>
      Promise.resolve(entry(path, path === VOICE_LANGUAGE_SETTING_PATH ? " DE " : null)),
    );

    const snapshot = await loadVoiceSettings();

    expect(snapshot.language).toBe("de");
  });

  it("surfaces a null model when the daemon's catalog lacks voice.openai.model", async () => {
    settings.get.mockImplementation((path: string) =>
      Promise.resolve(path === VOICE_OPENAI_MODEL_SETTING_PATH ? null : entry(path, null)),
    );

    const snapshot = await loadVoiceSettings();

    expect(snapshot.openaiModel).toBeNull();
  });

  it("folds an unset or out-of-enum model value to the daemon default", async () => {
    settings.get.mockImplementation((path: string) =>
      Promise.resolve(entry(path, path === VOICE_OPENAI_MODEL_SETTING_PATH ? "gpt-5" : null)),
    );

    const snapshot = await loadVoiceSettings();

    expect(snapshot.openaiModel).toBe(VOICE_OPENAI_DEFAULT_MODEL);
  });

  it("surfaces a null vocabulary on a daemon that predates the setting (non-array value)", async () => {
    settings.get.mockImplementation((path: string) =>
      Promise.resolve(path === VOICE_VOCABULARY_SETTING_PATH ? null : entry(path, null)),
    );

    const snapshot = await loadVoiceSettings();

    expect(snapshot.vocabulary).toBeNull();
  });

  it("ignores an out-of-enum provider value instead of propagating it", async () => {
    settings.get.mockImplementation((path: string) =>
      Promise.resolve(entry(path, path === VOICE_PROVIDER_SETTING_PATH ? "whisper-local" : null)),
    );

    const snapshot = await loadVoiceSettings();

    expect(snapshot.provider).toBe("elevenlabs");
  });

  it("persists the provider selection through settings.update", async () => {
    settings.update.mockResolvedValue([
      entry(VOICE_PROVIDER_SETTING_PATH, "openai"),
    ] as never);

    await setVoiceProvider("openai");

    expect(settings.update).toHaveBeenCalledWith([
      { path: VOICE_PROVIDER_SETTING_PATH, value: "openai" },
    ]);
  });

  it("throws when the daemon does not apply the provider change", async () => {
    settings.update.mockResolvedValue([] as never);

    await expect(setVoiceProvider("openai")).rejects.toThrow(VOICE_PROVIDER_SETTING_PATH);
  });

  it("persists the OpenAI model selection through settings.update", async () => {
    settings.update.mockResolvedValue([
      entry(VOICE_OPENAI_MODEL_SETTING_PATH, "gpt-4o-mini-transcribe"),
    ] as never);

    await setVoiceOpenAiModel("gpt-4o-mini-transcribe");

    expect(settings.update).toHaveBeenCalledWith([
      { path: VOICE_OPENAI_MODEL_SETTING_PATH, value: "gpt-4o-mini-transcribe" },
    ]);
  });

  it("throws when the daemon does not apply the model change (setting absent from the catalog)", async () => {
    settings.update.mockResolvedValue([] as never);

    await expect(setVoiceOpenAiModel("whisper-1")).rejects.toThrow(
      VOICE_OPENAI_MODEL_SETTING_PATH,
    );
  });

  it("persists the language selection through settings.update", async () => {
    settings.update.mockResolvedValue([entry(VOICE_LANGUAGE_SETTING_PATH, "de")] as never);

    await setVoiceLanguage("de");

    expect(settings.update).toHaveBeenCalledWith([
      { path: VOICE_LANGUAGE_SETTING_PATH, value: "de" },
    ]);
  });

  it("persists the auto-detect sentinel (empty string) through settings.update", async () => {
    settings.update.mockResolvedValue([entry(VOICE_LANGUAGE_SETTING_PATH, "")] as never);

    await setVoiceLanguage("");

    expect(settings.update).toHaveBeenCalledWith([
      { path: VOICE_LANGUAGE_SETTING_PATH, value: "" },
    ]);
  });

  it("throws when the daemon does not apply the language change (setting absent from the catalog)", async () => {
    settings.update.mockResolvedValue([] as never);

    await expect(setVoiceLanguage("de")).rejects.toThrow(VOICE_LANGUAGE_SETTING_PATH);
  });

  it("persists the full vocabulary array through settings.update", async () => {
    settings.update.mockResolvedValue([
      entry(VOICE_VOCABULARY_SETTING_PATH, ["intentd", "Datadog"]),
    ] as never);

    await setVoiceVocabulary(["intentd", "Datadog"]);

    expect(settings.update).toHaveBeenCalledWith([
      { path: VOICE_VOCABULARY_SETTING_PATH, value: ["intentd", "Datadog"] },
    ]);
  });

  it("throws when the daemon does not apply the vocabulary change", async () => {
    settings.update.mockResolvedValue([] as never);

    await expect(setVoiceVocabulary(["intentd"])).rejects.toThrow(
      VOICE_VOCABULARY_SETTING_PATH,
    );
  });

  it("stores a pasted key under the provider's secrets-file path (trimmed)", async () => {
    await saveVoiceApiKey("elevenlabs", "  sk_el_abc123  ");

    expect(settings.update).toHaveBeenCalledWith([
      { path: VOICE_API_KEY_SETTING_PATHS.elevenlabs, value: "sk_el_abc123" },
    ]);
  });

  it("rejects an empty key without touching the seam", async () => {
    await expect(saveVoiceApiKey("openai", "   ")).rejects.toThrow();

    expect(settings.update).not.toHaveBeenCalled();
  });

  it("propagates daemon errors from the key write", async () => {
    settings.update.mockRejectedValueOnce(new Error("unknown setting: voice.openai.apiKey") as never);

    await expect(saveVoiceApiKey("openai", "sk_oa_x")).rejects.toThrow(
      "unknown setting: voice.openai.apiKey",
    );
  });

  it("clears a key via settings.reset (deletes the secrets-file entry)", async () => {
    settings.reset.mockResolvedValue(entry(VOICE_API_KEY_SETTING_PATHS.openai, null) as never);

    await clearVoiceApiKey("openai");

    expect(settings.reset).toHaveBeenCalledWith(VOICE_API_KEY_SETTING_PATHS.openai);
  });

  it("treats the live client's null-folded reset failure as an error", async () => {
    settings.reset.mockResolvedValue(null as never);

    await expect(clearVoiceApiKey("elevenlabs")).rejects.toThrow(
      VOICE_API_KEY_SETTING_PATHS.elevenlabs,
    );
  });
});
