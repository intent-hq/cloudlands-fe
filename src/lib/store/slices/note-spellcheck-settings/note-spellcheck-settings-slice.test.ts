import { describe, it, expect } from "vitest";
import {
  noteSpellcheckSettingsReducer,
  setSpellcheckEnabled,
  toggleSpellcheck,
  type NoteSpellcheckSettingsState,
} from "./note-spellcheck-settings-slice";

describe("noteSpellcheckSettingsReducer", () => {
  const initialState: NoteSpellcheckSettingsState = {
    enabled: false,
  };

  it("should return initial state", () => {
    const state = noteSpellcheckSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setSpellcheckEnabled", () => {
    it("should set enabled to true", () => {
      const state = noteSpellcheckSettingsReducer(initialState, setSpellcheckEnabled(true));
      expect(state.enabled).toBe(true);
    });

    it("should set enabled to false", () => {
      const stateEnabled: NoteSpellcheckSettingsState = { enabled: true };
      const state = noteSpellcheckSettingsReducer(stateEnabled, setSpellcheckEnabled(false));
      expect(state.enabled).toBe(false);
    });
  });

  describe("toggleSpellcheck", () => {
    it("should toggle from false to true", () => {
      const state = noteSpellcheckSettingsReducer(initialState, toggleSpellcheck());
      expect(state.enabled).toBe(true);
    });

    it("should toggle from true to false", () => {
      const stateEnabled: NoteSpellcheckSettingsState = { enabled: true };
      const state = noteSpellcheckSettingsReducer(stateEnabled, toggleSpellcheck());
      expect(state.enabled).toBe(false);
    });
  });

});

