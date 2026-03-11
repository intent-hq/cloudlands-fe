import { describe, it, expect } from "vitest";
import {
  editorSettingsReducer,
  setLineWrapping,
  setFoldUnchanged,
  setDiffSideBySide,
  setDiffIndicators,
  toggleLineWrapping,
  toggleFoldUnchanged,
  toggleDiffSideBySide,
  toggleDiffIndicators,
  loadEditorSettings,
  type EditorSettingsState,
} from "./editor-settings-slice";

describe("editorSettingsReducer", () => {
  const initialState: EditorSettingsState = {
    lineWrapping: true,
    foldUnchanged: true,
    diffSideBySide: true,
    diffIndicators: true,
  };

  it("should return initial state", () => {
    const state = editorSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setters", () => {
    it("should set lineWrapping", () => {
      const state = editorSettingsReducer(initialState, setLineWrapping(false));
      expect(state.lineWrapping).toBe(false);
    });

    it("should set foldUnchanged", () => {
      const state = editorSettingsReducer(initialState, setFoldUnchanged(false));
      expect(state.foldUnchanged).toBe(false);
    });

    it("should set diffSideBySide", () => {
      const state = editorSettingsReducer(initialState, setDiffSideBySide(false));
      expect(state.diffSideBySide).toBe(false);
    });

    it("should set diffIndicators", () => {
      const state = editorSettingsReducer(initialState, setDiffIndicators(false));
      expect(state.diffIndicators).toBe(false);
    });
  });

  describe("toggles", () => {
    it("should toggle lineWrapping off", () => {
      const state = editorSettingsReducer(initialState, toggleLineWrapping());
      expect(state.lineWrapping).toBe(false);
    });

    it("should toggle lineWrapping on", () => {
      const off: EditorSettingsState = { ...initialState, lineWrapping: false };
      const state = editorSettingsReducer(off, toggleLineWrapping());
      expect(state.lineWrapping).toBe(true);
    });

    it("should toggle foldUnchanged off", () => {
      const state = editorSettingsReducer(initialState, toggleFoldUnchanged());
      expect(state.foldUnchanged).toBe(false);
    });

    it("should toggle foldUnchanged on", () => {
      const off: EditorSettingsState = { ...initialState, foldUnchanged: false };
      const state = editorSettingsReducer(off, toggleFoldUnchanged());
      expect(state.foldUnchanged).toBe(true);
    });

    it("should toggle diffSideBySide off", () => {
      const state = editorSettingsReducer(initialState, toggleDiffSideBySide());
      expect(state.diffSideBySide).toBe(false);
    });

    it("should toggle diffSideBySide on", () => {
      const off: EditorSettingsState = { ...initialState, diffSideBySide: false };
      const state = editorSettingsReducer(off, toggleDiffSideBySide());
      expect(state.diffSideBySide).toBe(true);
    });

    it("should toggle diffIndicators off", () => {
      const state = editorSettingsReducer(initialState, toggleDiffIndicators());
      expect(state.diffIndicators).toBe(false);
    });

    it("should toggle diffIndicators on", () => {
      const off: EditorSettingsState = { ...initialState, diffIndicators: false };
      const state = editorSettingsReducer(off, toggleDiffIndicators());
      expect(state.diffIndicators).toBe(true);
    });
  });

  describe("loadEditorSettings", () => {
    it("should load all settings", () => {
      const newSettings: EditorSettingsState = {
        lineWrapping: false,
        foldUnchanged: false,
        diffSideBySide: false,
        diffIndicators: false,
      };
      const state = editorSettingsReducer(initialState, loadEditorSettings(newSettings));
      expect(state).toEqual(newSettings);
    });

    it("should merge partial settings with existing state", () => {
      const partialSettings = {
        lineWrapping: false,
        foldUnchanged: true,
        diffSideBySide: false,
        diffIndicators: true,
      };
      const state = editorSettingsReducer(initialState, loadEditorSettings(partialSettings));
      expect(state.lineWrapping).toBe(false);
      expect(state.foldUnchanged).toBe(true);
      expect(state.diffSideBySide).toBe(false);
      expect(state.diffIndicators).toBe(true);
    });
  });
});

