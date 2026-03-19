import { describe, expect, it } from "vitest";
import {
  cycleFontStyle,
  cycleNoteFontStyle,
  fontSettingsReducer,
  setAgentFontStyle,
  setCodeFontFamily,
  setNoteFontStyle,
  setSystemFonts,
  type FontSettingsState,
} from "./font-settings-slice";

describe("fontSettingsReducer", () => {
  const initialState: FontSettingsState = {
    agentFontStyle: "sans",
    noteFontStyle: "sans",
    codeFontFamily: "system-default",
    systemFonts: [],
  };

  it("should return initial state", () => {
    const state = fontSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  it("should keep action type prefixes under fontSettings", () => {
    expect(setAgentFontStyle.type).toBe("fontSettings/setAgentFontStyle");
    expect(cycleFontStyle.type).toBe("fontSettings/cycleFontStyle");
    expect(setNoteFontStyle.type).toBe("fontSettings/setNoteFontStyle");
    expect(cycleNoteFontStyle.type).toBe("fontSettings/cycleNoteFontStyle");
    expect(setCodeFontFamily.type).toBe("fontSettings/setCodeFontFamily");
    expect(setSystemFonts.type).toBe("fontSettings/setSystemFonts");
  });

  it("should update and cycle agent font style", () => {
    expect(fontSettingsReducer(initialState, setAgentFontStyle("monospace")).agentFontStyle).toBe(
      "monospace"
    );
    expect(fontSettingsReducer(initialState, cycleFontStyle()).agentFontStyle).toBe("monospace");
    expect(
      fontSettingsReducer(
        { ...initialState, agentFontStyle: "monospace" },
        cycleFontStyle()
      ).agentFontStyle
    ).toBe("sans");
  });

  it("should update and cycle note font style", () => {
    expect(fontSettingsReducer(initialState, setNoteFontStyle("monospace")).noteFontStyle).toBe(
      "monospace"
    );
    expect(fontSettingsReducer(initialState, cycleNoteFontStyle()).noteFontStyle).toBe("monospace");
    expect(
      fontSettingsReducer(
        { ...initialState, noteFontStyle: "monospace" },
        cycleNoteFontStyle()
      ).noteFontStyle
    ).toBe("sans");
  });

  it("should update code font family", () => {
    expect(fontSettingsReducer(initialState, setCodeFontFamily("Fira Code")).codeFontFamily).toBe(
      "Fira Code"
    );
  });

  it("should update system fonts without affecting code font family", () => {
    const state = fontSettingsReducer(
      { ...initialState, codeFontFamily: "Fira Code" },
      setSystemFonts(["JetBrains Mono", "Cascadia Code"])
    );

    expect(state.codeFontFamily).toBe("Fira Code");
    expect(state.systemFonts).toEqual(["JetBrains Mono", "Cascadia Code"]);
  });
});