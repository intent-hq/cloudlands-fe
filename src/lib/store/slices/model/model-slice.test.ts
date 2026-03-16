import { describe, it, expect } from "vitest";
import {
  modelReducer,
  setSelectedModel,
  setAvailableModels,
  setIsLoadingModels,
  setModelsLoaded,
  setLoadError,
  setActiveProviderId,
  setRetryAttempt,
  setWorkspaceModel,
  clearWorkspaceModel,
  clearAllWorkspaceModels,
  setProviderModel,
  loadWorkspaceModelsFromStorage,
  loadProviderModelsFromStorage,
  resetModelState,
  initialState,
  type ModelState,
} from "./model-slice";
import type { AuggieModel } from "$features/auggie/auggie-models.client";

const mockModel: AuggieModel = {
  value: "sonnet4.5",
  label: "Claude Sonnet 4.5",
  description: "A powerful AI model",
};

const mockModel2: AuggieModel = {
  value: "haiku4.5",
  label: "Claude Haiku 4.5",
};

describe("modelReducer", () => {
  it("should return initial state", () => {
    const state = modelReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setSelectedModel", () => {
    it("should update selectedModel", () => {
      const state = modelReducer(initialState, setSelectedModel("sonnet4.5"));
      expect(state.selectedModel).toBe("sonnet4.5");
    });

    it("should not mutate previous state", () => {
      const state = modelReducer(initialState, setSelectedModel("sonnet4.5"));
      expect(initialState.selectedModel).not.toBe("sonnet4.5");
      expect(state.selectedModel).toBe("sonnet4.5");
    });
  });

  describe("setAvailableModels", () => {
    it("should set available models", () => {
      const models = [mockModel, mockModel2];
      const state = modelReducer(
        initialState,
        setAvailableModels({ providerId: "auggie", models })
      );
      expect(state.availableModelsByProvider).toEqual({ auggie: models });
    });

    it("should replace existing models for one provider without touching others", () => {
      const prev: ModelState = {
        ...initialState,
        availableModelsByProvider: {
          auggie: [mockModel],
          codex: [mockModel2],
        },
      };
      const state = modelReducer(
        prev,
        setAvailableModels({ providerId: "auggie", models: [mockModel2] })
      );
      expect(state.availableModelsByProvider).toEqual({
        auggie: [mockModel2],
        codex: [mockModel2],
      });
    });
  });

  describe("setIsLoadingModels", () => {
    it("should set loading to true", () => {
      const state = modelReducer(
        initialState,
        setIsLoadingModels({ providerId: "auggie", loading: true })
      );
      expect(state.isLoadingByProvider).toEqual({ auggie: true });
    });

    it("should set loading to false for only the target provider", () => {
      const prev: ModelState = {
        ...initialState,
        isLoadingByProvider: { auggie: true, codex: true },
      };
      const state = modelReducer(
        prev,
        setIsLoadingModels({ providerId: "auggie", loading: false })
      );
      expect(state.isLoadingByProvider).toEqual({ auggie: false, codex: true });
    });
  });

  describe("setModelsLoaded", () => {
    it("should set modelsLoaded", () => {
      const state = modelReducer(
        initialState,
        setModelsLoaded({ providerId: "auggie", loaded: true })
      );
      expect(state.modelsLoadedByProvider).toEqual({ auggie: true });
    });
  });

  describe("setLoadError", () => {
    it("should set error message", () => {
      const state = modelReducer(
        initialState,
        setLoadError("Network error")
      );
      expect(state.loadError).toBe("Network error");
    });

    it("should clear error with null", () => {
      const prev: ModelState = {
        ...initialState,
        loadError: "previous error",
      };
      const state = modelReducer(prev, setLoadError(null));
      expect(state.loadError).toBeNull();
    });
  });

  describe("setActiveProviderId", () => {
    it("should set provider ID", () => {
      const state = modelReducer(
        initialState,
        setActiveProviderId("auggie")
      );
      expect(state.activeProviderId).toBe("auggie");
    });
  });

  describe("setRetryAttempt", () => {
    it("should set retry attempt", () => {
      const state = modelReducer(initialState, setRetryAttempt(2));
      expect(state.retryAttempt).toBe(2);
    });
  });

  describe("setWorkspaceModel", () => {
    it("should set a workspace model", () => {
      const state = modelReducer(
        initialState,
        setWorkspaceModel({ workspaceId: "ws-1", model: "sonnet4.5" })
      );
      expect(state.workspaceModels).toEqual({ "ws-1": "sonnet4.5" });
    });

    it("should add to existing workspace models", () => {
      const prev: ModelState = {
        ...initialState,
        workspaceModels: { "ws-1": "sonnet4.5" },
      };
      const state = modelReducer(
        prev,
        setWorkspaceModel({ workspaceId: "ws-2", model: "haiku4.5" })
      );
      expect(state.workspaceModels).toEqual({
        "ws-1": "sonnet4.5",
        "ws-2": "haiku4.5",
      });
    });
  });


  describe("clearWorkspaceModel", () => {
    it("should remove a workspace model", () => {
      const prev: ModelState = {
        ...initialState,
        workspaceModels: { "ws-1": "sonnet4.5", "ws-2": "haiku4.5" },
      };
      const state = modelReducer(prev, clearWorkspaceModel("ws-1"));
      expect(state.workspaceModels).toEqual({ "ws-2": "haiku4.5" });
    });

    it("should handle clearing non-existent workspace", () => {
      const prev: ModelState = {
        ...initialState,
        workspaceModels: { "ws-1": "sonnet4.5" },
      };
      const state = modelReducer(prev, clearWorkspaceModel("ws-999"));
      expect(state.workspaceModels).toEqual({ "ws-1": "sonnet4.5" });
    });
  });

  describe("clearAllWorkspaceModels", () => {
    it("should clear all workspace models", () => {
      const prev: ModelState = {
        ...initialState,
        workspaceModels: { "ws-1": "sonnet4.5", "ws-2": "haiku4.5" },
      };
      const state = modelReducer(prev, clearAllWorkspaceModels());
      expect(state.workspaceModels).toEqual({});
    });
  });

  describe("setProviderModel", () => {
    it("should set a provider model", () => {
      const state = modelReducer(
        initialState,
        setProviderModel({ providerId: "auggie", model: "sonnet4.5" })
      );
      expect(state.providerModels).toEqual({ auggie: "sonnet4.5" });
    });

    it("should add to existing provider models", () => {
      const prev: ModelState = {
        ...initialState,
        providerModels: { auggie: "sonnet4.5" },
      };
      const state = modelReducer(
        prev,
        setProviderModel({ providerId: "claude-code", model: "default" })
      );
      expect(state.providerModels).toEqual({
        auggie: "sonnet4.5",
        "claude-code": "default",
      });
    });
  });

  describe("loadWorkspaceModelsFromStorage", () => {
    it("should bulk load workspace models", () => {
      const models = { "ws-1": "sonnet4.5", "ws-2": "haiku4.5" };
      const state = modelReducer(
        initialState,
        loadWorkspaceModelsFromStorage(models)
      );
      expect(state.workspaceModels).toEqual(models);
    });
  });

  describe("loadProviderModelsFromStorage", () => {
    it("should bulk load provider models", () => {
      const models = { auggie: "sonnet4.5", "claude-code": "default" };
      const state = modelReducer(
        initialState,
        loadProviderModelsFromStorage(models)
      );
      expect(state.providerModels).toEqual(models);
    });
  });

  describe("resetModelState", () => {
    it("should reset to initial state", () => {
      const prev: ModelState = {
        selectedModel: "sonnet4.5",
        availableModelsByProvider: { auggie: [mockModel] },
        isLoadingByProvider: { auggie: true },
        modelsLoadedByProvider: { auggie: true },
        loadError: "some error",
        activeProviderId: "auggie",
        retryAttempt: 2,
        workspaceModels: { "ws-1": "sonnet4.5" },
        providerModels: { auggie: "sonnet4.5" },
      };
      const state = modelReducer(prev, resetModelState());
      expect(state).toEqual(initialState);
    });

    it("should not mutate previous state", () => {
      const prev: ModelState = {
        ...initialState,
        selectedModel: "sonnet4.5",
        workspaceModels: { "ws-1": "haiku4.5" },
      };
      const state = modelReducer(prev, resetModelState());
      expect(prev.selectedModel).toBe("sonnet4.5");
      expect(prev.workspaceModels).toEqual({ "ws-1": "haiku4.5" });
      expect(state).toEqual(initialState);
    });
  });
});
