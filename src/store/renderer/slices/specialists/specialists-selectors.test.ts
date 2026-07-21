import {
  describe,
  it,
  expect,
} from "vitest";
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
  selectSpecialistSourceLabel,
} from "./specialists-selectors";
import { createCollection } from "$lib/store-shim/utils/collections/collection-utils";
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
    providerSettings: { activeProviderId: "auggie", enabledProviders: {} },
    githubAuth: { isAuthenticated: false },
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
    it("should include ralph without any feature flag", () => {
      const state = mockState();
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

  describe("source labels", () => {
    it("should label project and user file specialists distinctly", () => {
      const state = mockState({
        fileSpecialists: createCollection("id", [
          {
            id: "repo-spec",
            name: "Repo Specialist",
            description: "project-level",
            model: "",
            behaviorPrompt: "prompt",
            filePath: "/repo/.intent/specialists/repo-spec.md",
            source: "project",
          },
          {
            id: "user-spec",
            name: "User Specialist",
            description: "user-level",
            model: "",
            behaviorPrompt: "prompt",
            filePath: "/Users/test/.intent/specialists/user-spec.md",
            source: "user",
          },
        ]),
      });

      expect(selectSpecialistSourceLabel.select(state, "repo-spec")).toBe("Project");
      expect(selectSpecialistSourceLabel.select(state, "user-spec")).toBe("User");
    });

    it("should fall back to built-in label (legacy custom no longer tracked)", () => {
      const state = mockState({
        bundledSpecialists: [SPECIALISTS[0]],
        customSpecialists: createCollection("id", [
          {
            id: "legacy-custom",
            name: "Legacy Custom",
            description: "legacy",
            model: "gpt-4",
            behaviorPrompt: "prompt",
          },
        ]),
      });

      expect(selectSpecialistSourceLabel.select(state, SPECIALISTS[0].id)).toBe("Built-in");
      // Wave 2: legacy custom specialists are no longer given a source label
      // They should have been migrated to files on startup
      expect(selectSpecialistSourceLabel.select(state, "legacy-custom")).toBe(null);
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

  describe("selectSpecialists sort order", () => {
    it("should place bundled specialists first in their original order, then custom alphabetically", () => {
      // Use ALL bundled specialists so the SPECIALISTS fallback doesn't add extras
      const bundled = SPECIALISTS;
      const state = mockState({
        bundledSpecialists: bundled,
        fileSpecialists: createCollection("id", [
          {
            id: "zebra-custom",
            name: "Zebra Custom",
            description: "Z specialist",
            model: "gpt-4",
            behaviorPrompt: "prompt",
            filePath: "/Users/test/.intent/specialists/zebra-custom.md",
            source: "user" as const,
          },
          {
            id: "alpha-custom",
            name: "Alpha Custom",
            description: "A specialist",
            model: "gpt-4",
            behaviorPrompt: "prompt",
            filePath: "/Users/test/.intent/specialists/alpha-custom.md",
            source: "user" as const,
          },
        ]),
      });

      const ids = selectSpecialists.select(state).map((s) => s.id);
      // Bundled first in original order (spec-writer, implementor, verifier, ...)
      expect(ids[0]).toBe("spec-writer");
      expect(ids[1]).toBe("implementor");
      expect(ids[2]).toBe("verifier");
      // Custom at the end, sorted alphabetically by name
      const customIds = ids.filter((id) => id === "alpha-custom" || id === "zebra-custom");
      expect(customIds).toEqual(["alpha-custom", "zebra-custom"]);
    });

    it("should keep bundled order stable when a file overrides a bundled specialist", () => {
      const bundled = SPECIALISTS;
      const state = mockState({
        bundledSpecialists: bundled,
        fileSpecialists: createCollection("id", [
          // Override implementor (bundled) + add a custom one
          {
            id: "implementor",
            name: "Implementor",
            description: "overridden",
            model: "gpt-4",
            behaviorPrompt: "custom prompt",
            filePath: "/Users/test/.intent/specialists/implementor.md",
            source: "user" as const,
          },
          {
            id: "my-custom",
            name: "My Custom",
            description: "custom",
            model: "gpt-4",
            behaviorPrompt: "prompt",
            filePath: "/Users/test/.intent/specialists/my-custom.md",
            source: "user" as const,
          },
        ]),
      });

      const ids = selectSpecialists.select(state).map((s) => s.id);
      // Bundled order preserved even though implementor was overridden by file
      expect(ids[0]).toBe("spec-writer");
      expect(ids[1]).toBe("implementor");
      expect(ids[2]).toBe("verifier");
      // Custom at the very end (after all bundled/hardcoded)
      expect(ids[ids.length - 1]).toBe("my-custom");
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
        providerSettings: { activeProviderId: "auggie", enabledProviders: {} },
      } as StoreState;
      expect(() => selectEffectiveCodingAgent.select(state, "nonexistent-specialist")).not.toThrow();
      const result = selectEffectiveCodingAgent.select(state, "nonexistent-specialist");
      expect(result).toBe("auggie");
    });
  });
});

