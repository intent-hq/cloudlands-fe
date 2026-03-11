import { describe, it, expect } from "vitest";
import {
  agentFontSettingsReducer,
  setAgentFontStyle,
  cycleFontStyle,
  type AgentFontSettingsState,
} from "./agent-font-settings-slice";

describe("agentFontSettingsReducer", () => {
  const initialState: AgentFontSettingsState = {
    fontStyle: "sans",
  };

  it("should return initial state", () => {
    const state = agentFontSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setAgentFontStyle", () => {
    it("should set font style to monospace", () => {
      const state = agentFontSettingsReducer(initialState, setAgentFontStyle("monospace"));
      expect(state.fontStyle).toBe("monospace");
    });

    it("should set font style to sans", () => {
      const stateWithMono: AgentFontSettingsState = { fontStyle: "monospace" };
      const state = agentFontSettingsReducer(stateWithMono, setAgentFontStyle("sans"));
      expect(state.fontStyle).toBe("sans");
    });
  });

  describe("cycleFontStyle", () => {
    it("should cycle from sans to monospace", () => {
      const state = agentFontSettingsReducer(initialState, cycleFontStyle());
      expect(state.fontStyle).toBe("monospace");
    });

    it("should cycle from monospace to sans", () => {
      const stateWithMono: AgentFontSettingsState = { fontStyle: "monospace" };
      const state = agentFontSettingsReducer(stateWithMono, cycleFontStyle());
      expect(state.fontStyle).toBe("sans");
    });
  });

});

