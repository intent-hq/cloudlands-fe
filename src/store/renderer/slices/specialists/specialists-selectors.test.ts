import {
  beforeAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";

// FAKE seam: `$lib/client` is stubbed so importing `dispatchSpecialistList`
// (which imports the AppClient singleton) never constructs the live client.
vi.mock("$lib/client", () => ({
  appClient: {
    specialists: {
      create: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(() => Promise.resolve([])),
    },
  },
}));

import {
  filterSpecialistsByGitHubAuth,
  filterPickableSpecialists,
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
  selectEffectiveModel,
  selectSpecialistSourceLabel,
} from "./specialists-selectors";
import { createCollection } from "$lib/store-shim/utils/collections/collection-utils";
import { initialState } from "./specialists-slice";
import type { StoreState } from "../../types";
import { SPECIALISTS } from "$lib/constants/specialists";
import { PROVIDER_MODEL_TIERS } from "$shared/config/provider-config";
import { store as appStore } from "$store/renderer/store";
import { dispatchSpecialistList } from "../../../../features/specialists/specialists-mutation-service";
import type { SpecialistDef } from "$lib/client/app-client";

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

    it("filterSpecialistsByGitHubAuth should keep hidden specialists (Settings surface)", () => {
      const ids = filterSpecialistsByGitHubAuth(SPECIALISTS, true).map((specialist) => specialist.id);

      expect(ids).toContain("chief-of-staff");
    });

    it("filterPickableSpecialists should drop hidden specialists (chief-of-staff)", () => {
      const ids = filterPickableSpecialists(SPECIALISTS, true).map((specialist) => specialist.id);

      expect(ids).not.toContain("chief-of-staff");
      expect(ids).toContain("spec-writer");
    });

    it("filterPickableSpecialists should also apply GitHub gating when not authenticated", () => {
      const ids = filterPickableSpecialists(SPECIALISTS, false).map((specialist) => specialist.id);

      expect(ids).not.toContain("chief-of-staff");
      expect(ids).not.toContain("pr-reviewer");
      expect(ids).not.toContain("pr-shepherd");
    });

    it("filterPickableSpecialists should drop file specialists flagged hidden", () => {
      const specialists = [
        { ...SPECIALISTS[0], id: "visible-custom", hidden: undefined },
        { ...SPECIALISTS[0], id: "hidden-custom", hidden: true },
      ];
      const ids = filterPickableSpecialists(specialists, true).map((specialist) => specialist.id);

      expect(ids).toContain("visible-custom");
      expect(ids).not.toContain("hidden-custom");
    });
  });

  describe("hidden flag propagation through selectSpecialists", () => {
    it("should carry hidden from a file specialist into the merged list", () => {
      const state = mockState({
        bundledSpecialists: SPECIALISTS,
        fileSpecialists: createCollection("id", [
          {
            id: "chief-of-staff",
            name: "Chief of Staff",
            description: "overridden",
            model: "gpt-4",
            behaviorPrompt: "custom prompt",
            filePath: "/Users/test/.intent/specialists/chief-of-staff.md",
            source: "user" as const,
            hidden: true,
          },
        ]),
      });

      const merged = selectSpecialists.select(state);
      const chief = merged.find((s) => s.id === "chief-of-staff");
      expect(chief?.hidden).toBe(true);
      // And the pickable filter drops it from the merged list too.
      const pickableIds = filterPickableSpecialists(merged, true).map((s) => s.id);
      expect(pickableIds).not.toContain("chief-of-staff");
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

  describe("selectEffectiveModel precedence (model before tier)", () => {
    // These tests ingest PROTOCOL §5.11-shaped `specialist.list` defs through
    // the REAL configured store via `dispatchSpecialistList`, mirroring the
    // daemon's model-first precedence (`resolve_model`).
    beforeAll(() => appStore.init());

    it("returns the explicit model when a user-tier def carries both model and an inherited modelTier", () => {
      // The daemon inherits `modelTier` from the bundled parent when the user
      // file omits it, so the wire def carries BOTH the explicit compound
      // model AND modelTier: "smart". The explicit model must win.
      const userDef: SpecialistDef = {
        id: "implementor",
        name: "Implementor",
        description: "Executes implementation tasks, writes code",
        model: "claude-code:opus-custom",
        modelTier: "smart",
        behaviorPrompt: "You implement.",
        source: "user",
        path: "/Users/test/.intent/specialists/implementor.md",
      };
      dispatchSpecialistList([userDef]);

      expect(selectEffectiveModel.select(appStore.state, "implementor")).toBe(
        "claude-code:opus-custom",
      );
    });

    it("still resolves tier-only specialists via PROVIDER_MODEL_TIERS", () => {
      const tierOnlyDef: SpecialistDef = {
        id: "tier-only-custom",
        name: "Tier Only",
        description: "custom tier-only specialist",
        modelTier: "smart",
        behaviorPrompt: "prompt",
        source: "user",
        path: "/Users/test/.intent/specialists/tier-only-custom.md",
      };
      dispatchSpecialistList([tierOnlyDef]);

      // Active provider is the default (auggie), so the tier resolves to a
      // bare model ID without a provider prefix.
      expect(selectEffectiveModel.select(appStore.state, "tier-only-custom")).toBe(
        PROVIDER_MODEL_TIERS["auggie"].smart,
      );
      // Bundled specialists carrying only a tier (e.g. verifier: smart) also
      // resolve via the tier mapping.
      expect(selectEffectiveModel.select(appStore.state, "verifier")).toBe(
        PROVIDER_MODEL_TIERS["auggie"].smart,
      );
    });
  });
});

