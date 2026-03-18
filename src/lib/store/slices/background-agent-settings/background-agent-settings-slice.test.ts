import { describe, it, expect } from "vitest";
import {
  backgroundAgentSettingsReducer,
  setDefaultModel,
  setTypeOverride,
  clearTypeOverride,
  resetSettings,
  hydrateSettings,
  hydrateProviderSettings,
  saveProviderSnapshot,
  restoreProviderSettings,
  initialState,
  DEFAULT_BACKGROUND_MODEL,
  type BackgroundAgentSettingsState,
} from "./background-agent-settings-slice";

describe("backgroundAgentSettingsReducer", () => {
  it("should return initial state", () => {
    const state = backgroundAgentSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setDefaultModel", () => {
    it("should update defaultModel", () => {
      const state = backgroundAgentSettingsReducer(
        initialState,
        setDefaultModel("sonnet4.5")
      );
      expect(state.defaultModel).toBe("sonnet4.5");
    });

    it("should not mutate previous state", () => {
      const state = backgroundAgentSettingsReducer(
        initialState,
        setDefaultModel("sonnet4.5")
      );
      expect(initialState.defaultModel).toBe(DEFAULT_BACKGROUND_MODEL);
      expect(state.defaultModel).toBe("sonnet4.5");
    });
  });

  describe("setTypeOverride", () => {
    it("should set a type override", () => {
      const state = backgroundAgentSettingsReducer(
        initialState,
        setTypeOverride({ type: "commit", model: "haiku4.5" })
      );
      expect(state.typeOverrides.commit).toBe("haiku4.5");
      // Other overrides unchanged
      expect(state.typeOverrides.pr).toBe("");
      expect(state.typeOverrides.review).toBe("");
      expect(state.typeOverrides.fast).toBe("");
    });
  });

  describe("clearTypeOverride", () => {
    it("should clear a type override", () => {
      const prev: BackgroundAgentSettingsState = {
        ...initialState,
        typeOverrides: { ...initialState.typeOverrides, commit: "haiku4.5" },
      };
      const state = backgroundAgentSettingsReducer(
        prev,
        clearTypeOverride("commit")
      );
      expect(state.typeOverrides.commit).toBe("");
    });
  });

  describe("resetSettings", () => {
    it("should reset to initial state", () => {
      const prev: BackgroundAgentSettingsState = {
        defaultModel: "sonnet4.5",
        typeOverrides: {
          commit: "haiku4.5",
          pr: "opus4.5",
          review: "",
          fast: "",
        },
        providerSettings: {
          auggie: {
            defaultModel: "sonnet4.5",
            typeOverrides: { commit: "", pr: "", review: "", fast: "" },
          },
        },
      };
      const state = backgroundAgentSettingsReducer(prev, resetSettings());
      expect(state.defaultModel).toBe(DEFAULT_BACKGROUND_MODEL);
      expect(state.typeOverrides).toEqual({
        commit: "",
        pr: "",
        review: "",
        fast: "",
      });
      expect(state.providerSettings).toEqual({});
    });
  });

  describe("hydrateSettings", () => {
    it("should hydrate from localStorage data", () => {
      const state = backgroundAgentSettingsReducer(
        initialState,
        hydrateSettings({
          defaultModel: "sonnet4.5",
          typeOverrides: {
            commit: "haiku4.5",
            pr: "",
            review: "",
            fast: "",
          },
        })
      );
      expect(state.defaultModel).toBe("sonnet4.5");
      expect(state.typeOverrides.commit).toBe("haiku4.5");
    });

    it("should use defaults for missing values", () => {
      const state = backgroundAgentSettingsReducer(
        initialState,
        hydrateSettings({
          defaultModel: "",
          typeOverrides: {} as any,
        })
      );
      expect(state.defaultModel).toBe(DEFAULT_BACKGROUND_MODEL);
      expect(state.typeOverrides.commit).toBe("");
    });
  });

  describe("hydrateProviderSettings", () => {
    it("should set provider settings", () => {
      const providerSettings = {
        auggie: {
          defaultModel: "sonnet4.5",
          typeOverrides: { commit: "", pr: "", review: "", fast: "" },
        },
      };
      const state = backgroundAgentSettingsReducer(
        initialState,
        hydrateProviderSettings(providerSettings)
      );
      expect(state.providerSettings).toEqual(providerSettings);
    });
  });

  describe("saveProviderSnapshot", () => {
    it("should save settings for a provider", () => {
      const settings = {
        defaultModel: "sonnet4.5",
        typeOverrides: { commit: "haiku4.5", pr: "", review: "", fast: "" },
      };
      const state = backgroundAgentSettingsReducer(
        initialState,
        saveProviderSnapshot({ providerId: "auggie", settings })
      );
      expect(state.providerSettings.auggie).toEqual(settings);
    });
  });

  describe("restoreProviderSettings", () => {
    it("should restore settings from a provider snapshot", () => {
      const state = backgroundAgentSettingsReducer(
        initialState,
        restoreProviderSettings({
          defaultModel: "opus4.5",
          typeOverrides: { commit: "haiku4.5", pr: "", review: "", fast: "" },
        })
      );
      expect(state.defaultModel).toBe("opus4.5");
      expect(state.typeOverrides.commit).toBe("haiku4.5");
    });
  });
});
