import {
  describe,
  expect,
  it,
} from "vitest";
import {
  ensureEnabledIfUnset,
  hydrateActiveProvider,
  initialState,
  loadEnabledProvidersFromStorage,
  providerSettingsReducer,
  setActiveProvider,
  setProviderEnabled,
  toggleProvider,
  type ProviderSettingsState,
} from "./provider-settings-slice";

describe("providerSettingsReducer", () => {
  it("should return initial state", () => {
    const state = providerSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("active provider actions", () => {
    it("should update activeProviderId", () => {
      const state = providerSettingsReducer(initialState, setActiveProvider("claude-code"));
      expect(state.activeProviderId).toBe("claude-code");
    });

    it("should not mutate previous state when setting active provider", () => {
      const prev = { ...initialState };
      const state = providerSettingsReducer(prev, setActiveProvider("claude-code"));
      expect(prev.activeProviderId).toBe(initialState.activeProviderId);
      expect(state.activeProviderId).toBe("claude-code");
    });

    it("should set activeProviderId from hydration", () => {
      const state = providerSettingsReducer(initialState, hydrateActiveProvider("codex"));
      expect(state.activeProviderId).toBe("codex");
    });

    it("should overwrite an existing active provider during hydration", () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        activeProviderId: "claude-code",
      };
      const state = providerSettingsReducer(prev, hydrateActiveProvider("auggie"));
      expect(state.activeProviderId).toBe("auggie");
    });
  });

  describe("enabled providers actions", () => {
    it("should enable a provider", () => {
      const state = providerSettingsReducer(
        initialState,
        setProviderEnabled({ providerId: "claude-code", enabled: true })
      );
      expect(state.enabledProviders["claude-code"]).toBe(true);
    });

    it("should disable a provider", () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        enabledProviders: { "claude-code": true },
      };
      const state = providerSettingsReducer(
        prev,
        setProviderEnabled({ providerId: "claude-code", enabled: false })
      );
      expect(state.enabledProviders["claude-code"]).toBe(false);
    });

    it("should not mutate previous state when setting provider enabled", () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        enabledProviders: { "claude-code": true },
      };
      providerSettingsReducer(prev, setProviderEnabled({ providerId: "claude-code", enabled: false }));
      expect(prev.enabledProviders["claude-code"]).toBe(true);
    });

    it("should toggle from false to true", () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        enabledProviders: { "claude-code": false },
      };
      const state = providerSettingsReducer(prev, toggleProvider("claude-code"));
      expect(state.enabledProviders["claude-code"]).toBe(true);
    });

    it("should toggle from true to false", () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        enabledProviders: { "claude-code": true },
      };
      const state = providerSettingsReducer(prev, toggleProvider("claude-code"));
      expect(state.enabledProviders["claude-code"]).toBe(false);
    });

    it("should toggle an unset provider to true", () => {
      const state = providerSettingsReducer(initialState, toggleProvider("claude-code"));
      expect(state.enabledProviders["claude-code"]).toBe(true);
    });

    it("should enable provider if unset", () => {
      const state = providerSettingsReducer(initialState, ensureEnabledIfUnset("claude-code"));
      expect(state.enabledProviders["claude-code"]).toBe(true);
    });

    it("should not change provider if already set", () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        enabledProviders: { "claude-code": false },
      };
      const state = providerSettingsReducer(prev, ensureEnabledIfUnset("claude-code"));
      expect(state).toBe(prev);
    });

    it("should bulk load providers", () => {
      const providers = { "claude-code": true, codex: false };
      const state = providerSettingsReducer(initialState, loadEnabledProvidersFromStorage(providers));
      expect(state.enabledProviders).toEqual(providers);
    });

    it("should keep non-disableable providers unchanged", () => {
      const state = providerSettingsReducer(
        initialState,
        setProviderEnabled({ providerId: "auggie", enabled: false })
      );
      expect(state).toBe(initialState);
    });

    it("should not toggle non-disableable providers", () => {
      const state = providerSettingsReducer(initialState, toggleProvider("auggie"));
      expect(state).toBe(initialState);
    });
  });
});