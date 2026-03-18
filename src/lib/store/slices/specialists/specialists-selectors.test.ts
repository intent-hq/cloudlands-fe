import { describe, it, expect } from "vitest";
import {
  filterSpecialistsByGitHubAuth,
  selectProviderModelOverrides,
  selectSpecialists,
  selectUserOverrides,
  selectBundledSpecialists,
  selectOverridesLoaded,
  selectCustomSpecialistsLoaded,
  selectFileSpecialistsLoaded,
  selectBundledSpecialistsLoaded,
  selectSpecialistsFolderPath,
  selectHasOverrides,
  selectEffectiveCodingAgent,
} from "./specialists-selectors";
import { initialState } from "./specialists-slice";
import type { StoreState } from "../../types";
import { SPECIALISTS } from "$lib/constants/specialists";

/**
 * Create a minimal mock StoreState with specialists slice populated.
 */
function mockState(overrides: Partial<typeof initialState> = {}): StoreState {
  return {
    specialists: { ...initialState, ...overrides },
    featureCodes: { activeFeatures: [], initialized: true },
    activeProvider: { activeProviderId: "auggie" },
  } as unknown as StoreState;
}

describe("specialists selectors", () => {
  describe("selectProviderModelOverrides", () => {
    it("should return empty object from initial state", () => {
      const state = mockState();
      expect(selectProviderModelOverrides.select(state)).toEqual({});
    });

    it("should return provider model overrides", () => {
      const overrides = {
        "claude-code": { implementor: "opus", verifier: "sonnet" },
        auggie: { implementor: "gpt-4" },
      };
      const state = mockState({ providerModelOverrides: overrides });
      expect(selectProviderModelOverrides.select(state)).toEqual(overrides);
    });

    it("should return the exact reference (no copy)", () => {
      const overrides = { "claude-code": { implementor: "opus" } };
      const state = mockState({ providerModelOverrides: overrides });
      expect(selectProviderModelOverrides.select(state)).toBe(overrides);
    });
  });

  describe("selectUserOverrides", () => {
    it("should return initial user overrides", () => {
      const state = mockState();
      expect(selectUserOverrides.select(state)).toEqual({
        codingAgentOverrides: {},
        modelOverrides: {},
        behaviorPromptOverrides: {},
      });
    });

    it("should return modified overrides", () => {
      const userOverrides = {
        modelOverrides: { implementor: "gpt-4" },
        behaviorPromptOverrides: { "spec-writer": "Be concise" },
      };
      const state = mockState({ userOverrides });
      expect(selectUserOverrides.select(state)).toEqual(userOverrides);
    });
  });

  describe("selectBundledSpecialists", () => {
    it("should return empty array from initial state", () => {
      const state = mockState();
      expect(selectBundledSpecialists.select(state)).toEqual([]);
    });
  });

  describe("visibility gating", () => {
    it("should hide ralph when the feature flag is disabled", () => {
      const state = mockState();
      const ids = selectSpecialists.select(state).map((specialist) => specialist.id);

      expect(ids).not.toContain("ralph");
    });

    it("should include ralph when the feature flag is enabled", () => {
      const state = {
        ...mockState(),
        featureCodes: { activeFeatures: ["ralph-agent"], initialized: true },
      } as StoreState;
      const ids = selectSpecialists.select(state).map((specialist) => specialist.id);

      expect(ids).toContain("ralph");
    });

    it("should hide GitHub-dependent specialists when GitHub is not authenticated", () => {
      const ids = filterSpecialistsByGitHubAuth(SPECIALISTS, false).map((specialist) => specialist.id);

      expect(ids).not.toContain("pr-reviewer");
      expect(ids).not.toContain("pr-shepherd");
    });

    it("should keep GitHub-dependent specialists when GitHub is authenticated", () => {
      const ids = filterSpecialistsByGitHubAuth(SPECIALISTS, true).map((specialist) => specialist.id);

      expect(ids).toContain("pr-reviewer");
      expect(ids).toContain("pr-shepherd");
    });
  });

  describe("loaded flag selectors", () => {
    it("selectOverridesLoaded should return false initially", () => {
      expect(selectOverridesLoaded.select(mockState())).toBe(false);
    });

    it("selectOverridesLoaded should return true when set", () => {
      expect(selectOverridesLoaded.select(mockState({ overridesLoaded: true }))).toBe(true);
    });

    it("selectCustomSpecialistsLoaded should return false initially", () => {
      expect(selectCustomSpecialistsLoaded.select(mockState())).toBe(false);
    });

    it("selectFileSpecialistsLoaded should return false initially", () => {
      expect(selectFileSpecialistsLoaded.select(mockState())).toBe(false);
    });

    it("selectBundledSpecialistsLoaded should return false initially", () => {
      expect(selectBundledSpecialistsLoaded.select(mockState())).toBe(false);
    });
  });

  describe("selectSpecialistsFolderPath", () => {
    it("should return null from initial state", () => {
      expect(selectSpecialistsFolderPath.select(mockState())).toBeNull();
    });

    it("should return path when set", () => {
      const state = mockState({ specialistsFolderPath: "/path/to/specialists" });
      expect(selectSpecialistsFolderPath.select(state)).toBe("/path/to/specialists");
    });
  });

  describe("selectors with missing codingAgentOverrides (legacy electron-store data)", () => {
    /** Simulate old persisted data where codingAgentOverrides didn't exist yet */
    function legacyState() {
      return mockState({
        userOverrides: {
          modelOverrides: {},
          behaviorPromptOverrides: {},
        } as any,
      });
    }

    it("selectHasOverrides should return false without throwing", () => {
      const state = legacyState();
      expect(() => selectHasOverrides.select(state, "ui-designer")).not.toThrow();
      expect(selectHasOverrides.select(state, "ui-designer")).toBe(false);
    });

    it("selectEffectiveCodingAgent should return a fallback without throwing", () => {
      const state = {
        ...legacyState(),
        activeProvider: { activeProviderId: "auggie" },
      } as StoreState;
      expect(() => selectEffectiveCodingAgent.select(state, "nonexistent-specialist")).not.toThrow();
      const result = selectEffectiveCodingAgent.select(state, "nonexistent-specialist");
      expect(result).toBe("auggie");
    });
  });
});

