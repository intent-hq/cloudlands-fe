import { describe, it, expect } from "vitest";
import {
  activeProviderReducer,
  setActiveProvider,
  hydrateActiveProvider,
  initialState,
  type ActiveProviderState,
} from "./active-provider-slice";

describe("activeProviderReducer", () => {
  it("should return initial state", () => {
    const state = activeProviderReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setActiveProvider", () => {
    it("should update activeProviderId", () => {
      const state = activeProviderReducer(
        initialState,
        setActiveProvider("claude-code")
      );
      expect(state.activeProviderId).toBe("claude-code");
    });

    it("should not mutate previous state", () => {
      const prev = { ...initialState };
      const state = activeProviderReducer(prev, setActiveProvider("claude-code"));
      expect(prev.activeProviderId).toBe(initialState.activeProviderId);
      expect(state.activeProviderId).toBe("claude-code");
    });
  });

  describe("hydrateActiveProvider", () => {
    it("should set activeProviderId from localStorage data", () => {
      const state = activeProviderReducer(
        initialState,
        hydrateActiveProvider("codex")
      );
      expect(state.activeProviderId).toBe("codex");
    });

    it("should overwrite existing value", () => {
      const prev: ActiveProviderState = {
        activeProviderId: "claude-code",
      };
      const state = activeProviderReducer(
        prev,
        hydrateActiveProvider("auggie")
      );
      expect(state.activeProviderId).toBe("auggie");
    });
  });
});

