import { describe, it, expect } from "vitest";
import {
  codeFontSettingsReducer,
  setCodeFontFamily,
  setSystemFonts,
  type CodeFontSettingsState,
} from "./code-font-settings-slice";

describe("codeFontSettingsReducer", () => {
  const initialState: CodeFontSettingsState = {
    fontFamily: "system-default",
    systemFonts: [],
  };

  it("should return initial state", () => {
    const state = codeFontSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setCodeFontFamily", () => {
    it("should set font family", () => {
      const state = codeFontSettingsReducer(initialState, setCodeFontFamily("Fira Code"));
      expect(state.fontFamily).toBe("Fira Code");
    });

    it("should set font family back to system-default", () => {
      const stateWithCustom: CodeFontSettingsState = { ...initialState, fontFamily: "Fira Code" };
      const state = codeFontSettingsReducer(stateWithCustom, setCodeFontFamily("system-default"));
      expect(state.fontFamily).toBe("system-default");
    });
  });

  describe("setSystemFonts", () => {
    it("should set system fonts list", () => {
      const fonts = ["Fira Code", "JetBrains Mono", "Cascadia Code"];
      const state = codeFontSettingsReducer(initialState, setSystemFonts(fonts));
      expect(state.systemFonts).toEqual(fonts);
    });

    it("should replace existing system fonts", () => {
      const stateWithFonts: CodeFontSettingsState = {
        ...initialState,
        systemFonts: ["Old Font"],
      };
      const newFonts = ["New Font 1", "New Font 2"];
      const state = codeFontSettingsReducer(stateWithFonts, setSystemFonts(newFonts));
      expect(state.systemFonts).toEqual(newFonts);
    });

    it("should not affect fontFamily when setting system fonts", () => {
      const stateWithCustom: CodeFontSettingsState = {
        fontFamily: "Fira Code",
        systemFonts: [],
      };
      const state = codeFontSettingsReducer(stateWithCustom, setSystemFonts(["Font A"]));
      expect(state.fontFamily).toBe("Fira Code");
      expect(state.systemFonts).toEqual(["Font A"]);
    });
  });
});

