import { describe, it, expect } from "vitest";
import {
  betaUpdatesReducer,
  setBetaUpdatesEnabled,
  toggleBetaUpdates,
  loadBetaUpdatesSettings,
  type BetaUpdatesState,
} from "./beta-updates-slice";

describe("betaUpdatesReducer", () => {
  const initialState: BetaUpdatesState = {
    enabled: false,
  };

  it("should return initial state", () => {
    const state = betaUpdatesReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setBetaUpdatesEnabled", () => {
    it("should set enabled to true", () => {
      const state = betaUpdatesReducer(initialState, setBetaUpdatesEnabled(true));
      expect(state.enabled).toBe(true);
    });

    it("should set enabled to false", () => {
      const enabled = { ...initialState, enabled: true };
      const state = betaUpdatesReducer(enabled, setBetaUpdatesEnabled(false));
      expect(state.enabled).toBe(false);
    });
  });

  describe("loadBetaUpdatesSettings", () => {
    it("should set enabled to true", () => {
      const state = betaUpdatesReducer(initialState, loadBetaUpdatesSettings(true));
      expect(state.enabled).toBe(true);
    });

    it("should set enabled to false", () => {
      const enabled = { ...initialState, enabled: true };
      const state = betaUpdatesReducer(enabled, loadBetaUpdatesSettings(false));
      expect(state.enabled).toBe(false);
    });
  });

  describe("toggleBetaUpdates", () => {
    it("should toggle from false to true", () => {
      const state = betaUpdatesReducer(initialState, toggleBetaUpdates());
      expect(state.enabled).toBe(true);
    });

    it("should toggle from true to false", () => {
      const enabled = { ...initialState, enabled: true };
      const state = betaUpdatesReducer(enabled, toggleBetaUpdates());
      expect(state.enabled).toBe(false);
    });
  });
});

