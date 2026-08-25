import {
  describe,
  it,
  expect,
} from "vitest";
import { backgroundAgentSettingsReducer, setDefaultModel, setTypeOverride, hydrateSettings, initialState, DEFAULT_BACKGROUND_MODEL } from "./background-agent-settings-slice";

describe("backgroundAgentSettingsReducer", () => {
  it("should return initial state", () => {
    const state = backgroundAgentSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  it("defaults to no explicit model (empty string = provider default)", () => {
    expect(DEFAULT_BACKGROUND_MODEL).toBe("");
    expect(initialState.defaultModel).toBe("");
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

    it("should keep an empty defaultModel (provider default) and default missing overrides", () => {
      const state = backgroundAgentSettingsReducer(
        initialState,
        hydrateSettings({
          defaultModel: "",
          typeOverrides: {} as any,
        })
      );
      expect(state.defaultModel).toBe("");
      expect(state.typeOverrides.commit).toBe("");
    });
  });
});
