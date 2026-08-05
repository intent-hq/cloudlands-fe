import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import type { ProviderStatus } from "../agent-availability/agent-availability-types";
import {
  initialState as providerCatalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from "../provider-catalog/provider-catalog-slice";
import { MOCK_PROVIDER_CATALOG } from "../../../../test/fixtures/provider-catalog.fixture";
import {
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
  selectEnabledProviderIds,
  selectEnabledProviders,
  selectIsActiveProviderAvailable,
  selectIsProviderActive,
  selectIsProviderEnabled,
} from "./provider-settings-selectors";

const providerCatalog = providerCatalogReducer(
  providerCatalogInitialState,
  providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
);

function mockState(
  enabledProviders: Record<string, boolean>,
  activeProviderId = "auggie",
  providerStatusMap: Record<string, ProviderStatus> = {}
): StoreState {
  return {
    providerCatalog,
    providerSettings: {
      activeProviderId,
      enabledProviders,
      nonDisableableProviderIds: [],
    },
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

    it("should treat unset providers as disabled (no default-provider exception)", () => {
      const state = mockState({}, "codex");
      expect(selectIsProviderEnabled.select(state, "auggie")).toBe(false);
    });

    it("should return false for unset disableable providers", () => {
      const state = mockState({});
      expect(selectIsProviderEnabled.select(state, "claude-code")).toBe(false);
    });

    it("should respect an explicit false for auggie", () => {
      const state = mockState({ auggie: false }, "codex");
      expect(selectIsProviderEnabled.select(state, "auggie")).toBe(false);
    });

    it("should respect an explicit true for auggie", () => {
      const state = mockState({ auggie: true }, "codex");
      expect(selectIsProviderEnabled.select(state, "auggie")).toBe(true);
    });

    it("should not include an unset provider in enabled ids when not active", () => {
      const state = mockState({}, "codex");
      expect(selectEnabledProviderIds.select(state)).not.toContain("auggie");
    });

    it("should exclude an explicitly disabled provider when not active", () => {
      const state = mockState({ auggie: false }, "codex");
      expect(selectEnabledProviderIds.select(state)).not.toContain("auggie");
    });

    it("should re-include a provider when explicitly re-enabled", () => {
      const state = mockState({ auggie: true }, "codex");
      expect(selectEnabledProviderIds.select(state)).toContain("auggie");
    });

    it("should include explicitly enabled providers", () => {
      const state = mockState({ "claude-code": true });
      const ids = selectEnabledProviderIds.select(state);
      expect(ids).toContain("claude-code");
      // The active provider is always included.
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