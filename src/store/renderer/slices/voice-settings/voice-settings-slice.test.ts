import { describe, expect, it } from "vitest";
import {
  addVoiceVocabularyTerm,
  initialState,
  removeVoiceVocabularyTerm,
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
  voiceSettingsReducer,
} from "./voice-settings-slice";

describe("voiceSettingsReducer", () => {
  it("starts loading with the daemon-default provider and no keys", () => {
    expect(initialState).toEqual({
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
    });
  });

  it("hydrates from the daemon snapshot and clears loading", () => {
    const state = voiceSettingsReducer(
      initialState,
      setVoiceSettingsSnapshot(
        true,
        "openai",
        { elevenlabs: true, openai: false },
        ["intentd"],
        "gpt-4o-transcribe",
        "de",
        25,
      ),
    );
    expect(state.isLoading).toBe(false);
    expect(state.available).toBe(true);
    expect(state.provider).toBe("openai");
    expect(state.keyConfigured).toEqual({ elevenlabs: true, openai: false });
    expect(state.vocabulary).toEqual(["intentd"]);
    expect(state.openaiModel).toBe("gpt-4o-transcribe");
    expect(state.language).toBe("de");
    expect(state.workspaceVocabularyMaxTerms).toBe(25);
  });

  it("marks unavailable (pre-voice daemon) while still clearing loading", () => {
    const state = voiceSettingsReducer(
      initialState,
      setVoiceSettingsSnapshot(
        false,
        "elevenlabs",
        { elevenlabs: false, openai: false },
        null,
        null,
        null,
        null,
      ),
    );
    expect(state.isLoading).toBe(false);
    expect(state.available).toBe(false);
    expect(state.vocabulary).toBeNull();
    expect(state.openaiModel).toBeNull();
    expect(state.language).toBeNull();
    expect(state.workspaceVocabularyMaxTerms).toBeNull();
  });

  it("sets the OpenAI model value (optimistic apply and rollback)", () => {
    const applied = voiceSettingsReducer(initialState, setVoiceOpenAiModelValue("whisper-1"));
    expect(applied.openaiModel).toBe("whisper-1");
    const rolledBack = voiceSettingsReducer(applied, setVoiceOpenAiModelValue(null));
    expect(rolledBack.openaiModel).toBeNull();
  });

  it("sets the language value (optimistic apply, auto-detect, and rollback)", () => {
    const applied = voiceSettingsReducer(initialState, setVoiceLanguageValue("de"));
    expect(applied.language).toBe("de");
    const auto = voiceSettingsReducer(applied, setVoiceLanguageValue(""));
    expect(auto.language).toBe("");
    const rolledBack = voiceSettingsReducer(auto, setVoiceLanguageValue(null));
    expect(rolledBack.language).toBeNull();
  });

  it("sets the workspace-vocabulary cap value (optimistic apply, 0 = off, and rollback)", () => {
    const applied = voiceSettingsReducer(
      initialState,
      setVoiceWorkspaceVocabularyMaxTermsValue(75),
    );
    expect(applied.workspaceVocabularyMaxTerms).toBe(75);
    const off = voiceSettingsReducer(applied, setVoiceWorkspaceVocabularyMaxTermsValue(0));
    expect(off.workspaceVocabularyMaxTerms).toBe(0);
    const rolledBack = voiceSettingsReducer(
      off,
      setVoiceWorkspaceVocabularyMaxTermsValue(null),
    );
    expect(rolledBack.workspaceVocabularyMaxTerms).toBeNull();
  });

  it("sets the provider value", () => {
    const state = voiceSettingsReducer(initialState, setVoiceProviderValue("openai"));
    expect(state.provider).toBe("openai");
  });

  it("sets the engine value", () => {
    const state = voiceSettingsReducer(initialState, setVoiceEngineValue("os"));
    expect(state.engine).toBe("os");
    expect(voiceSettingsReducer(state, setVoiceEngineValue("daemon")).engine).toBe("daemon");
  });

  it("sets and clears the input-device value (null = system default)", () => {
    const selected = voiceSettingsReducer(initialState, setVoiceInputDeviceValue("mic-1"));
    expect(selected.inputDeviceId).toBe("mic-1");
    const cleared = voiceSettingsReducer(selected, setVoiceInputDeviceValue(null));
    expect(cleared.inputDeviceId).toBeNull();
  });

  it("hydrates and replaces the enumerated input-device list", () => {
    const hydrated = voiceSettingsReducer(
      initialState,
      setVoiceInputDevices([{ deviceId: "mic-1", label: "USB Mic" }]),
    );
    expect(hydrated.inputDevices).toEqual([{ deviceId: "mic-1", label: "USB Mic" }]);
    const replaced = voiceSettingsReducer(
      hydrated,
      setVoiceInputDevices([{ deviceId: "mic-2", label: "Headset" }]),
    );
    expect(replaced.inputDevices).toEqual([{ deviceId: "mic-2", label: "Headset" }]);
    expect(voiceSettingsReducer(replaced, setVoiceInputDevices([])).inputDevices).toEqual([]);
  });

  it("sets the OS-engine availability flag", () => {
    const state = voiceSettingsReducer(initialState, setVoiceOsEngineAvailable(true));
    expect(state.osEngineAvailable).toBe(true);
    expect(voiceSettingsReducer(state, setVoiceOsEngineAvailable(false)).osEngineAvailable).toBe(
      false,
    );
  });

  it("updates one provider's key-configured flag without touching the other", () => {
    const state = voiceSettingsReducer(
      initialState,
      setVoiceKeyConfigured("elevenlabs", true),
    );
    expect(state.keyConfigured).toEqual({ elevenlabs: true, openai: false });
  });

  it("tracks and clears the busy provider", () => {
    const busy = voiceSettingsReducer(initialState, setVoiceBusyProvider("openai"));
    expect(busy.busyProvider).toBe("openai");
    const idle = voiceSettingsReducer(busy, setVoiceBusyProvider(null));
    expect(idle.busyProvider).toBeNull();
  });

  it("sets and clears the error", () => {
    const withError = voiceSettingsReducer(initialState, setVoiceSettingsError("boom"));
    expect(withError.error).toBe("boom");
    const cleared = voiceSettingsReducer(withError, setVoiceSettingsError(null));
    expect(cleared.error).toBeNull();
  });

  describe("vocabulary add/remove", () => {
    const hydrated = voiceSettingsReducer(
      initialState,
      setVoiceVocabularyValue(["intentd", "Cloudlands"]),
    );

    it("appends a trimmed term", () => {
      const state = voiceSettingsReducer(hydrated, addVoiceVocabularyTerm("  Datadog  "));
      expect(state.vocabulary).toEqual(["intentd", "Cloudlands", "Datadog"]);
    });

    it("ignores a blank add", () => {
      const state = voiceSettingsReducer(hydrated, addVoiceVocabularyTerm("   "));
      expect(state).toBe(hydrated);
    });

    it("ignores a duplicate add (case-insensitive)", () => {
      const state = voiceSettingsReducer(hydrated, addVoiceVocabularyTerm("CLOUDLANDS"));
      expect(state).toBe(hydrated);
    });

    it("ignores a term longer than 50 characters", () => {
      const state = voiceSettingsReducer(hydrated, addVoiceVocabularyTerm("x".repeat(51)));
      expect(state).toBe(hydrated);
    });

    it("accepts a term of exactly 50 characters", () => {
      const term = "x".repeat(50);
      const state = voiceSettingsReducer(hydrated, addVoiceVocabularyTerm(term));
      expect(state.vocabulary).toContain(term);
    });

    it("ignores an add while the vocabulary is unavailable (null)", () => {
      const state = voiceSettingsReducer(initialState, addVoiceVocabularyTerm("intentd"));
      expect(state).toBe(initialState);
    });

    it("removes an existing term", () => {
      const state = voiceSettingsReducer(hydrated, removeVoiceVocabularyTerm("intentd"));
      expect(state.vocabulary).toEqual(["Cloudlands"]);
    });

    it("ignores a remove of a term that is not listed", () => {
      const state = voiceSettingsReducer(hydrated, removeVoiceVocabularyTerm("missing"));
      expect(state).toBe(hydrated);
    });

    it("ignores a remove while the vocabulary is unavailable (null)", () => {
      const state = voiceSettingsReducer(initialState, removeVoiceVocabularyTerm("intentd"));
      expect(state).toBe(initialState);
    });

    it("sets the vocabulary value directly (hydrate/rollback)", () => {
      expect(hydrated.vocabulary).toEqual(["intentd", "Cloudlands"]);
      const rolledBack = voiceSettingsReducer(hydrated, setVoiceVocabularyValue(null));
      expect(rolledBack.vocabulary).toBeNull();
    });
  });
});
