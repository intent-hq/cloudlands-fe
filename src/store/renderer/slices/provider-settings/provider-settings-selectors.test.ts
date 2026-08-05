import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import type { ProviderStatus } from "../agent-availability/agent-availability-types";
import {
  selectActiveProvider,
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
  selectEnabledProviderIds,
  selectEnabledProviders,
  selectIsActiveProviderAvailable,
  selectIsProviderActive,
  selectIsProviderEnabled,
} from "./provider-settings-selectors";

function mockState(
  enabledProviders: Record<string, boolean>,
  activeProviderId = "auggie",
  providerStatusMap: Record<string, ProviderStatus> = {}
): StoreState {
  return {
    providerSettings: { activeProviderId, enabledProviders },
    agentAvailability: {
      providerStatusMap,
      providerLoadingMap: {},
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: false,
      watchedTerminalIds: [],
      npxStatus: null,
    },
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

    it("should treat the unset default provider (auggie) as enabled", () => {
      const state = mockState({}, "codex");
      expect(selectIsProviderEnabled.select(state, "auggie")).toBe(true);
    });

    it("should return false for unset non-default disableable providers", () => {
      const state = mockState({});
      expect(selectIsProviderEnabled.select(state, "claude-code")).toBe(false);
    });

    it("should respect an explicit false for the default provider (auggie)", () => {
      const state = mockState({ auggie: false }, "codex");
      expect(selectIsProviderEnabled.select(state, "auggie")).toBe(false);
    });

    it("should respect an explicit true for the default provider (auggie)", () => {
      const state = mockState({ auggie: true }, "codex");
      expect(selectIsProviderEnabled.select(state, "auggie")).toBe(true);
    });

    it("should include the unset default provider in enabled ids even when not active", () => {
      const state = mockState({}, "codex");
      expect(selectEnabledProviderIds.select(state)).toContain("auggie");
    });

    it("should exclude the explicitly disabled default provider when not active", () => {
      const state = mockState({ auggie: false }, "codex");
      expect(selectEnabledProviderIds.select(state)).not.toContain("auggie");
    });

    it("should re-include the default provider when explicitly re-enabled", () => {
      const state = mockState({ auggie: true }, "codex");
      expect(selectEnabledProviderIds.select(state)).toContain("auggie");
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

  describe("availability-gated selectors", () => {
    it("should exclude enabled-but-unavailable providers", () => {
      const state = mockState(
        { "claude-code": true },
        "auggie",
        { auggie: { available: true }, "claude-code": { available: false } }
      );
      const ids = selectAvailableEnabledProviderIds.select(state);
      expect(ids).toContain("auggie");
      expect(ids).not.toContain("claude-code");
    });

    it("should exclude hidden providers even when reported available", () => {
      const state = mockState(
        {},
        "auggie",
        { auggie: { available: true }, mock: { available: true } }
      );
      const ids = selectAvailableEnabledProviderIds.select(state);
      expect(ids).not.toContain("mock");
    });

    it("should include available and enabled providers", () => {
      const state = mockState(
        { "claude-code": true },
        "auggie",
        { auggie: { available: true }, "claude-code": { available: true } }
      );
      const ids = selectAvailableEnabledProviderIds.select(state);
      expect(ids).toContain("auggie");
      expect(ids).toContain("claude-code");
    });

    it("should report the active provider as available when it is in the available set", () => {
      const state = mockState({}, "auggie", { auggie: { available: true } });
      expect(selectIsActiveProviderAvailable.select(state)).toBe(true);
    });

    it("should report the active provider as unavailable when it is not in the available set", () => {
      const state = mockState({}, "auggie", { auggie: { available: false } });
      expect(selectIsActiveProviderAvailable.select(state)).toBe(false);
    });

    it("should report the active provider as unavailable when nothing has been checked yet", () => {
      const state = mockState({}, "auggie");
      expect(selectIsActiveProviderAvailable.select(state)).toBe(false);
    });
  });
});