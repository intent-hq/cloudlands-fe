import { describe, expect, it } from "vitest";
import {
  initialState,
  loadBetaUpdatesSettings,
  setBetaUpdatesEnabled,
  setSpellcheckEnabled,
  setZoomFactor,
  toggleBetaUpdates,
  toggleSpellcheck,
  type UserPreferencesState,
  userPreferencesReducer,
} from "./user-preferences-slice";

describe("userPreferencesReducer", () => {
  it("should return initial state", () => {
    const state = userPreferencesReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("beta updates actions", () => {
    it("should set beta updates enabled to true", () => {
      const state = userPreferencesReducer(initialState, setBetaUpdatesEnabled(true));
      expect(state.betaUpdatesEnabled).toBe(true);
    });

    it("should set beta updates enabled to false", () => {
      const state = userPreferencesReducer(
        { ...initialState, betaUpdatesEnabled: true },
        setBetaUpdatesEnabled(false)
      );
      expect(state.betaUpdatesEnabled).toBe(false);
    });

    it("should load beta updates settings to true", () => {
      const state = userPreferencesReducer(initialState, loadBetaUpdatesSettings(true));
      expect(state.betaUpdatesEnabled).toBe(true);
    });

    it("should load beta updates settings to false", () => {
      const state = userPreferencesReducer(
        { ...initialState, betaUpdatesEnabled: true },
        loadBetaUpdatesSettings(false)
      );
      expect(state.betaUpdatesEnabled).toBe(false);
    });

    it("should toggle beta updates from false to true", () => {
      const state = userPreferencesReducer(initialState, toggleBetaUpdates());
      expect(state.betaUpdatesEnabled).toBe(true);
    });

    it("should toggle beta updates from true to false", () => {
      const state = userPreferencesReducer(
        { ...initialState, betaUpdatesEnabled: true },
        toggleBetaUpdates()
      );
      expect(state.betaUpdatesEnabled).toBe(false);
    });
  });

  describe("spellcheck actions", () => {
    it("should set spellcheck enabled to true", () => {
      const state = userPreferencesReducer(initialState, setSpellcheckEnabled(true));
      expect(state.spellcheckEnabled).toBe(true);
    });

    it("should set spellcheck enabled to false", () => {
      const state = userPreferencesReducer(
        { ...initialState, spellcheckEnabled: true },
        setSpellcheckEnabled(false)
      );
      expect(state.spellcheckEnabled).toBe(false);
    });

    it("should toggle spellcheck from false to true", () => {
      const state = userPreferencesReducer(initialState, toggleSpellcheck());
      expect(state.spellcheckEnabled).toBe(true);
    });

    it("should toggle spellcheck from true to false", () => {
      const state = userPreferencesReducer(
        { ...initialState, spellcheckEnabled: true },
        toggleSpellcheck()
      );
      expect(state.spellcheckEnabled).toBe(false);
    });
  });

  describe("setZoomFactor", () => {
    const state: UserPreferencesState = { ...initialState, zoomFactor: 1.0 };

    it("should set zoom factor", () => {
      expect(userPreferencesReducer(state, setZoomFactor(1.5)).zoomFactor).toBe(1.5);
    });

    it("should return same state if zoom factor unchanged", () => {
      expect(userPreferencesReducer(state, setZoomFactor(1.0))).toBe(state);
    });

    it("should reject invalid zoom factors", () => {
      expect(userPreferencesReducer(state, setZoomFactor(0))).toBe(state);
      expect(userPreferencesReducer(state, setZoomFactor(-1))).toBe(state);
      expect(userPreferencesReducer(state, setZoomFactor(NaN))).toBe(state);
      expect(userPreferencesReducer(state, setZoomFactor(Infinity))).toBe(state);
    });

    it("should accept valid zoom factors", () => {
      expect(userPreferencesReducer(state, setZoomFactor(0.5)).zoomFactor).toBe(0.5);
      expect(userPreferencesReducer(state, setZoomFactor(3.0)).zoomFactor).toBe(3.0);
    });
  });
});