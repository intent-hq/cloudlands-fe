import { describe, it, expect } from "vitest";
import {
  selectEnabledProviders,
  selectIsProviderEnabled,
  selectEnabledProviderIds,
} from "./additional-agents-selectors";
import type { StoreState } from "../../types";

/**
 * Create a minimal mock StoreState with only additionalAgents populated.
 */
function mockState(
  enabledProviders: Record<string, boolean>,
  activeProviderId = "auggie"
): StoreState {
  return {
    additionalAgents: { enabledProviders },
    activeProvider: { activeProviderId },
  } as unknown as StoreState;
}

describe("additional-agents selectors", () => {
  describe("selectEnabledProviders", () => {
    it("should return the enabledProviders map", () => {
      const state = mockState({ "claude-code": true, codex: false });
      expect(selectEnabledProviders.select(state)).toEqual({
        "claude-code": true,
        codex: false,
      });
    });

    it("should return empty object for initial state", () => {
      const state = mockState({});
      expect(selectEnabledProviders.select(state)).toEqual({});
    });
  });

  describe("selectIsProviderEnabled", () => {
    it("should return true for enabled provider", () => {
      const state = mockState({ "claude-code": true });
      expect(selectIsProviderEnabled.select(state, "claude-code")).toBe(true);
    });

    it("should return false for disabled provider", () => {
      const state = mockState({ "claude-code": false });
      expect(selectIsProviderEnabled.select(state, "claude-code")).toBe(false);
    });

    it("should return false for unknown provider", () => {
      const state = mockState({});
      expect(selectIsProviderEnabled.select(state, "claude-code")).toBe(false);
    });

    it("should always return true for non-disableable provider (auggie)", () => {
      // auggie has canBeDisabled: false, so it's always enabled
      const state = mockState({});
      expect(selectIsProviderEnabled.select(state, "auggie")).toBe(true);
    });

    it("should return true for non-disableable provider even if explicitly set to false", () => {
      const state = mockState({ auggie: false });
      expect(selectIsProviderEnabled.select(state, "auggie")).toBe(true);
    });
  });

  describe("selectEnabledProviderIds", () => {
    it("should always include non-disableable providers", () => {
      const state = mockState({});
      const ids = selectEnabledProviderIds.select(state);
      expect(ids).toContain("auggie");
    });

    it("should include explicitly enabled providers", () => {
      const state = mockState({ "claude-code": true });
      const ids = selectEnabledProviderIds.select(state);
      expect(ids).toContain("claude-code");
      expect(ids).toContain("auggie"); // always included
    });

    it("should not include explicitly disabled providers", () => {
      const state = mockState({ "claude-code": false });
      const ids = selectEnabledProviderIds.select(state);
      expect(ids).not.toContain("claude-code");
    });

    it("should not duplicate always-enabled providers", () => {
      const state = mockState({ auggie: true });
      const ids = selectEnabledProviderIds.select(state);
      const auggieCount = ids.filter((id) => id === "auggie").length;
      expect(auggieCount).toBe(1);
    });

    it("should include the active provider even when it is explicitly disabled", () => {
      const state = mockState({ "claude-code": false }, "claude-code");
      const ids = selectEnabledProviderIds.select(state);

      expect(ids).toContain("claude-code");
    });
  });
});

