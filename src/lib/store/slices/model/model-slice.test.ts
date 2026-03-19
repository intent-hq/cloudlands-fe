import { describe, expect, it } from "vitest";
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import { createCollection } from "../../utils/collection-utils";
import { getDefaultProviderId } from "$shared/config/provider-config";
import {
  clearAllWorkspaceModels,
  clearLoadingStateForProvider,
  clearWorkspaceModel,
  initialState,
  loadProviderModelsFromStorage,
  loadWorkspaceModelsFromStorage,
  modelReducer,
  resetModelState,
  setAvailableModels,
  setLoadingStateForProvider,
  setProviderModel,
  setRetryAttempt,
  setSelectedModel,
  setWorkspaceModel,
  type ModelState,
} from "./model-slice";

const defaultProviderId = getDefaultProviderId();

const mockModels: AuggieModel[] = [
  {
    value: "gpt5.4",
    label: "GPT 5.4",
    description: "Smart model",
  },
  {
    value: "codex:gpt-5.3-codex/high",
    label: "Codex High",
  },
];

describe("modelReducer", () => {
  it("returns the initial state", () => {
    expect(modelReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores available models as a collection", () => {
    const state = modelReducer(initialState, setAvailableModels(mockModels));

    expect(state.availableModels).toEqual(createCollection("value", mockModels));
  });

  it("stores selected models in providerModels using provider normalization", () => {
    const defaultState = modelReducer(
      initialState,
      setSelectedModel({
        providerId: defaultProviderId,
        model: `${defaultProviderId}:gpt5.4`,
      })
    );
    const nonDefaultState = modelReducer(
      defaultState,
      setSelectedModel({ providerId: "codex", model: "gpt-5.3-codex/high" })
    );

    expect(nonDefaultState.providerModels).toEqual({
      [defaultProviderId]: "gpt5.4",
      codex: "codex:gpt-5.3-codex/high",
    });
  });

  it("updates provider-specific loading state and preserves omitted fields", () => {
    const loadingState = modelReducer(
      initialState,
      setLoadingStateForProvider({
        providerId: "codex",
        status: "error",
        retryAttempt: 2,
        error: "boom",
      })
    );
    const successState = modelReducer(
      loadingState,
      setLoadingStateForProvider({ providerId: "codex", status: "success" })
    );

    expect(successState.loadingState.codex).toEqual({
      status: "success",
      retryAttempt: 2,
      error: "boom",
    });
  });

  it("clears provider loading state for only the requested provider", () => {
    const prev: ModelState = {
      ...initialState,
      loadingState: {
        auggie: { status: "loading", retryAttempt: 0 },
        codex: { status: "error", retryAttempt: 1, error: "boom" },
      },
    };

    const state = modelReducer(prev, clearLoadingStateForProvider("codex"));

    expect(state.loadingState).toEqual({
      auggie: { status: "loading", retryAttempt: 0 },
    });
  });

  it("updates retry attempt while preserving existing provider status", () => {
    const prev: ModelState = {
      ...initialState,
      loadingState: {
        codex: { status: "error", retryAttempt: 1, error: "boom" },
      },
    };

    const state = modelReducer(prev, setRetryAttempt({ providerId: "codex", attempt: 3 }));

    expect(state.loadingState.codex).toEqual({
      status: "error",
      retryAttempt: 3,
      error: "boom",
    });
  });

  it("normalizes provider models loaded from storage", () => {
    const state = modelReducer(
      initialState,
      loadProviderModelsFromStorage({
        [defaultProviderId]: `${defaultProviderId}:gpt5.4`,
        codex: "gpt-5.3-codex/high",
      })
    );

    expect(state.providerModels).toEqual({
      [defaultProviderId]: "gpt5.4",
      codex: "codex:gpt-5.3-codex/high",
    });
  });

  it("preserves workspace model behaviors", () => {
    const withWorkspaceModel = modelReducer(
      initialState,
      setWorkspaceModel({ workspaceId: "ws-1", model: "gpt5.4" })
    );
    const loaded = modelReducer(
      withWorkspaceModel,
      loadWorkspaceModelsFromStorage({ "ws-1": "gpt5.4", "ws-2": "haiku4.5" })
    );
    const clearedOne = modelReducer(loaded, clearWorkspaceModel("ws-1"));
    const clearedAll = modelReducer(clearedOne, clearAllWorkspaceModels());

    expect(clearedAll.workspaceModels).toEqual({});
  });

  it("normalizes provider model updates", () => {
    const state = modelReducer(
      initialState,
      setProviderModel({ providerId: "codex", model: "gpt-5.3-codex/high" })
    );

    expect(state.providerModels).toEqual({ codex: "codex:gpt-5.3-codex/high" });
  });

  it("resets the slice to initial state without mutating the previous state", () => {
    const prev: ModelState = {
      availableModels: createCollection("value", mockModels),
      loadingState: { codex: { status: "loading", retryAttempt: 2 } },
      workspaceModels: { "ws-1": "gpt5.4" },
      providerModels: { codex: "codex:gpt-5.3-codex/high" },
    };

    const state = modelReducer(prev, resetModelState());

    expect(prev.providerModels).toEqual({ codex: "codex:gpt-5.3-codex/high" });
    expect(state).toEqual(initialState);
  });
});

