import {
  describe,
  it,
  expect,
} from "vitest";
import {
  selectProviderInUseReason,
  selectProviderInUseReasons,
} from "./provider-in-use-selectors";
import { initialState as specialistsInitialState } from "../specialists/specialists-slice";
import { initialState as modelInitialState } from "../model/model-slice";
import {
  initialState as providerCatalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from "../provider-catalog/provider-catalog-slice";
import { MOCK_PROVIDER_CATALOG } from "../../../../test/fixtures/provider-catalog.fixture";
import { createCollection } from "$lib/store-shim/utils/collections/collection-utils";
import type { FileSpecialist } from "../specialists/specialists-slice";
import type { StoreState } from "../../types";

const providerCatalog = providerCatalogReducer(
  providerCatalogInitialState,
  providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
);

function fileSpecialist(overrides: Partial<FileSpecialist> & { id: string }): FileSpecialist {
  return {
    name: overrides.id,
    description: "test specialist",
    model: "",
    behaviorPrompt: "prompt",
    filePath: `/tmp/${overrides.id}.md`,
    source: "user",
    ...overrides,
  };
}

function mockState({
  activeProviderId = "auggie",
  providerModels = {},
  fileSpecialists = [],
}: {
  activeProviderId?: string;
  providerModels?: Record<string, string>;
  fileSpecialists?: FileSpecialist[];
} = {}): StoreState {
  return {
    providerCatalog,
    providerSettings: { activeProviderId, enabledProviders: {} },
    model: { ...modelInitialState, providerModels },
    specialists: {
      ...specialistsInitialState,
      fileSpecialists: createCollection("id", fileSpecialists),
    },
    featureCodes: { activeFeatures: [], initialized: true },
    githubAuth: { isAuthenticated: false },
  } as unknown as StoreState;
}

describe("provider in-use selectors", () => {
  describe("global default model", () => {
    it("marks the provider of a compound global model as in use", () => {
      const state = mockState({
        activeProviderId: "opencode",
        providerModels: { opencode: "opencode:claude-sonnet-4" },
      });
      expect(selectProviderInUseReason.select(state, "opencode")).toContain(
        "opencode:claude-sonnet-4",
      );
    });

    it("marks the default provider as in use for a bare global model", () => {
      const state = mockState({ providerModels: { auggie: "sonnet4.5" } });
      expect(selectProviderInUseReason.select(state, "auggie")).toContain("sonnet4.5");
      expect(selectProviderInUseReason.select(state, "codex")).toBeNull();
    });
  });

  describe("specialist explicit codingAgent", () => {
    it("marks a specialist's pinned coding agent as in use", () => {
      const state = mockState({
        fileSpecialists: [
          fileSpecialist({ id: "my-spec", name: "My Spec", codingAgent: "claude-code" }),
        ],
      });
      const reason = selectProviderInUseReason.select(state, "claude-code");
      expect(reason).toContain("My Spec");
      expect(reason).toContain("coding agent");
    });
  });

  describe("specialist explicit model", () => {
    it("marks the provider of a specialist compound model as in use", () => {
      const state = mockState({
        fileSpecialists: [
          fileSpecialist({ id: "my-spec", name: "My Spec", model: "codex:gpt-5.3-codex/high" }),
        ],
      });
      const reason = selectProviderInUseReason.select(state, "codex");
      expect(reason).toContain("My Spec");
      expect(reason).toContain("codex:gpt-5.3-codex/high");
    });

    it("marks the default provider as in use for a bare specialist model", () => {
      const state = mockState({
        fileSpecialists: [
          fileSpecialist({ id: "my-spec", name: "My Spec", model: "opus4.7" }),
        ],
      });
      expect(selectProviderInUseReason.select(state, "auggie")).toContain("My Spec");
    });

    it("does not pin the default provider for a bare model when a coding agent is set", () => {
      const state = mockState({
        fileSpecialists: [
          fileSpecialist({
            id: "my-spec",
            name: "My Spec",
            model: "sonnet",
            codingAgent: "claude-code",
          }),
        ],
      });
      expect(selectProviderInUseReasons.select(state)["auggie"]).toBeUndefined();
      expect(selectProviderInUseReason.select(state, "claude-code")).toContain("My Spec");
    });
  });

  describe("active-provider fallback does not count as in use", () => {
    it("does not mark the active provider as in use via tier-based specialists", () => {
      // Bundled/hardcoded specialists use defaultModelTier with no explicit
      // codingAgent — they follow the active provider and must not block it.
      const state = mockState({
        activeProviderId: "claude-code",
        providerModels: { "claude-code": "claude-code:sonnet" },
      });
      expect(selectProviderInUseReasons.select(state)["auggie"]).toBeUndefined();
      expect(selectProviderInUseReason.select(state, "codex")).toBeNull();
    });

    it("ignores tier-based file specialists without an explicit coding agent", () => {
      const state = mockState({
        activeProviderId: "codex",
        providerModels: { codex: "codex:gpt-5.3-codex/high" },
        fileSpecialists: [
          fileSpecialist({ id: "tiered", name: "Tiered", modelTier: "balanced" }),
        ],
      });
      expect(selectProviderInUseReasons.select(state)["auggie"]).toBeUndefined();
    });
  });

  describe("not in use", () => {
    it("returns null for providers not referenced anywhere", () => {
      const state = mockState({ providerModels: { auggie: "auggie:sonnet4.5" } });
      expect(selectProviderInUseReason.select(state, "opencode")).toBeNull();
      expect(selectProviderInUseReason.select(state, "droid")).toBeNull();
      expect(selectProviderInUseReason.select(state, "grok")).toBeNull();
    });
  });
});
