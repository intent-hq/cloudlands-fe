import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import {
  initialState as providerCatalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from "../provider-catalog/provider-catalog-slice";
import { MOCK_PROVIDER_CATALOG } from "../../../../test/fixtures/provider-catalog.fixture";
import {
  selectActiveProviderId,
  selectEnabledProviderIds,
  selectEnabledProviders,
  selectIsProviderActive,
  selectIsProviderEnabled,
} from "./provider-settings-selectors";

const providerCatalog = providerCatalogReducer(
  providerCatalogInitialState,
  providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
);

function mockState(
  enabledProviders: Record<string, boolean>,
  activeProviderId = "auggie"
): StoreState {
  return {
    providerCatalog,
    providerSettings: {
      activeProviderId,
      enabledProviders,
      defaultProviderId: MOCK_PROVIDER_CATALOG.defaultProviderId,
      nonDisableableProviderIds: [],
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
});