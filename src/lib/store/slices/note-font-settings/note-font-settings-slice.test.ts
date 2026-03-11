import { describe, it, expect } from "vitest";
import {
  noteFontSettingsReducer,
  setNoteFontStyle,
  cycleNoteFontStyle,
  type NoteFontSettingsState,
} from "./note-font-settings-slice";

describe("noteFontSettingsReducer", () => {
  const initialState: NoteFontSettingsState = {
    fontStyle: "sans",
  };

  it("should return initial state", () => {
    const state = noteFontSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setNoteFontStyle", () => {
    it("should set font style to monospace", () => {
      const state = noteFontSettingsReducer(initialState, setNoteFontStyle("monospace"));
      expect(state.fontStyle).toBe("monospace");
    });

    it("should set font style to sans", () => {
      const stateWithMono: NoteFontSettingsState = { fontStyle: "monospace" };
      const state = noteFontSettingsReducer(stateWithMono, setNoteFontStyle("sans"));
      expect(state.fontStyle).toBe("sans");
    });
  });

  describe("cycleNoteFontStyle", () => {
    it("should cycle from sans to monospace", () => {
      const state = noteFontSettingsReducer(initialState, cycleNoteFontStyle());
      expect(state.fontStyle).toBe("monospace");
    });

    it("should cycle from monospace to sans", () => {
      const stateWithMono: NoteFontSettingsState = { fontStyle: "monospace" };
      const state = noteFontSettingsReducer(stateWithMono, cycleNoteFontStyle());
      expect(state.fontStyle).toBe("sans");
    });
  });

});

