import { describe, it, expect } from "vitest";
import {
  additionalAgentsReducer,
  setProviderEnabled,
  toggleProvider,
  ensureEnabledIfUnset,
  loadEnabledProvidersFromStorage,
  initialState,
  type AdditionalAgentsState,
} from "./additional-agents-slice";

describe("additionalAgentsReducer", () => {
  it("should return initial state", () => {
    const state = additionalAgentsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setProviderEnabled", () => {
    it("should enable a provider", () => {
      const state = additionalAgentsReducer(
        initialState,
        setProviderEnabled({ providerId: "claude-code", enabled: true })
      );
      expect(state.enabledProviders["claude-code"]).toBe(true);
    });

    it("should disable a provider", () => {
      const prev: AdditionalAgentsState = {
        enabledProviders: { "claude-code": true },
      };
      const state = additionalAgentsReducer(
        prev,
        setProviderEnabled({ providerId: "claude-code", enabled: false })
      );
      expect(state.enabledProviders["claude-code"]).toBe(false);
    });

    it("should not mutate previous state", () => {
      const prev: AdditionalAgentsState = {
        enabledProviders: { "claude-code": true },
      };
      additionalAgentsReducer(
        prev,
        setProviderEnabled({ providerId: "claude-code", enabled: false })
      );
      expect(prev.enabledProviders["claude-code"]).toBe(true);
    });
  });

  describe("toggleProvider", () => {
    it("should toggle from false to true", () => {
      const prev: AdditionalAgentsState = {
        enabledProviders: { "claude-code": false },
      };
      const state = additionalAgentsReducer(
        prev,
        toggleProvider("claude-code")
      );
      expect(state.enabledProviders["claude-code"]).toBe(true);
    });

    it("should toggle from true to false", () => {
      const prev: AdditionalAgentsState = {
        enabledProviders: { "claude-code": true },
      };
      const state = additionalAgentsReducer(
        prev,
        toggleProvider("claude-code")
      );
      expect(state.enabledProviders["claude-code"]).toBe(false);
    });

    it("should toggle unset provider to true (default false -> true)", () => {
      const state = additionalAgentsReducer(
        initialState,
        toggleProvider("claude-code")
      );
      expect(state.enabledProviders["claude-code"]).toBe(true);
    });
  });

  describe("ensureEnabledIfUnset", () => {
    it("should enable provider if not set", () => {
      const state = additionalAgentsReducer(
        initialState,
        ensureEnabledIfUnset("claude-code")
      );
      expect(state.enabledProviders["claude-code"]).toBe(true);
    });

    it("should not change provider if already set to true", () => {
      const prev: AdditionalAgentsState = {
        enabledProviders: { "claude-code": true },
      };
      const state = additionalAgentsReducer(
        prev,
        ensureEnabledIfUnset("claude-code")
      );
      expect(state).toBe(prev);
    });

    it("should not change provider if already set to false", () => {
      const prev: AdditionalAgentsState = {
        enabledProviders: { "claude-code": false },
      };
      const state = additionalAgentsReducer(
        prev,
        ensureEnabledIfUnset("claude-code")
      );
      expect(state).toBe(prev);
    });
  });

  describe("loadEnabledProvidersFromStorage", () => {
    it("should bulk load providers", () => {
      const providers = { "claude-code": true, codex: false };
      const state = additionalAgentsReducer(
        initialState,
        loadEnabledProvidersFromStorage(providers)
      );
      expect(state.enabledProviders).toEqual(providers);
    });
  });

  describe("canBeDisabled guard", () => {
    // "auggie" has canBeDisabled: false in provider-config
    it("setProviderEnabled should be a no-op for non-disableable providers", () => {
      const state = additionalAgentsReducer(
        initialState,
        setProviderEnabled({ providerId: "auggie", enabled: false })
      );
      expect(state).toBe(initialState);
    });

    it("setProviderEnabled should be a no-op even when trying to enable a non-disableable provider", () => {
      const state = additionalAgentsReducer(
        initialState,
        setProviderEnabled({ providerId: "auggie", enabled: true })
      );
      expect(state).toBe(initialState);
    });

    it("toggleProvider should be a no-op for non-disableable providers", () => {
      const state = additionalAgentsReducer(
        initialState,
        toggleProvider("auggie")
      );
      expect(state).toBe(initialState);
    });

    it("setProviderEnabled should work for disableable providers", () => {
      const state = additionalAgentsReducer(
        initialState,
        setProviderEnabled({ providerId: "claude-code", enabled: true })
      );
      expect(state.enabledProviders["claude-code"]).toBe(true);
    });

    it("toggleProvider should work for disableable providers", () => {
      const state = additionalAgentsReducer(
        initialState,
        toggleProvider("claude-code")
      );
      expect(state.enabledProviders["claude-code"]).toBe(true);
    });
  });
});

