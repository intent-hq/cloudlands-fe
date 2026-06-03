import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import {
  selectActiveProvider,
  selectActiveProviderId,
  selectEnabledProviderIds,
  selectEnabledProviders,
  selectIsProviderActive,
  selectIsProviderEnabled,
} from "./provider-settings-selectors";

function mockState(
  enabledProviders: Record<string, boolean>,
  activeProviderId = "auggie"
): StoreState {
  return {
    providerSettings: { activeProviderId, enabledProviders },
  } as unknown as StoreState;
}

describe("provider-settings selectors", () => {
  it("should return the active provider id", () => {
    const state = mockState({}, "codex");
    expect(selectActiveProviderId.select(state)).toBe("codex");
  });

  it("should return the active provider config", () => {
    const state = mockState({}, "auggie");
    expect(selectActiveProvider.select(state).id).toBe("auggie");
  });

  it("should report whether a provider is active", () => {
    const state = mockState({}, "codex");
    expect(selectIsProviderActive.select(state, "codex")).toBe(true);
    expect(selectIsProviderActive.select(state, "auggie")).toBe(false);
  });

  describe("enabled provider selectors", () => {
    it("should return the enabledProviders map", () => {
      const state = mockState({ "claude-code": true, codex: false });
      expect(selectEnabledProviders.select(state)).toEqual({
        "claude-code": true,
        codex: false,
      });
    });

    it("should return true for enabled provider", () => {
      const state = mockState({ "claude-code": true });
      expect(selectIsProviderEnabled.select(state, "claude-code")).toBe(true);
    });

    it("should return false for disabled provider", () => {
      const state = mockState({ "claude-code": false });
      expect(selectIsProviderEnabled.select(state, "claude-code")).toBe(false);
    });

    it("should always return true for non-disableable providers", () => {
      const state = mockState({});
      expect(selectIsProviderEnabled.select(state, "auggie")).toBe(true);
    });

    it("should always include non-disableable providers", () => {
      const state = mockState({});
      const ids = selectEnabledProviderIds.select(state);
      expect(ids).toContain("auggie");
    });

    it("should include explicitly enabled providers", () => {
      const state = mockState({ "claude-code": true });
      const ids = selectEnabledProviderIds.select(state);
      expect(ids).toContain("claude-code");
      expect(ids).toContain("auggie");
    });

    it("should not include explicitly disabled providers", () => {
      const state = mockState({ "claude-code": false });
      const ids = selectEnabledProviderIds.select(state);
      expect(ids).not.toContain("claude-code");
    });

    it("should include the active provider even when explicitly disabled", () => {
      const state = mockState({ "claude-code": false }, "claude-code");
      expect(selectEnabledProviderIds.select(state)).toContain("claude-code");
    });
  });
});