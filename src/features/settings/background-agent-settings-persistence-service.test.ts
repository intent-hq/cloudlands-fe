import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "@augmentcode/ag-redux-toolkit/svelte-store";
import { createBackgroundAgentSettingsPersistenceMiddleware } from "./background-agent-settings-persistence-service";
import { appClient } from "$lib/client";
import {
  setDefaultModel,
  setTypeOverride,
  clearTypeOverride,
  resetSettings,
  hydrateSettings,
  type BackgroundAgentType,
} from "$store/renderer/slices/background-agent-settings/background-agent-settings-slice";

vi.mock("$lib/client", () => ({
  appClient: {
    settings: {
      update: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

// Mutable mock state that mockNext will update to simulate reducer behavior
const mockState = {
  backgroundAgentSettings: {
    defaultModel: "test-model",
    typeOverrides: { commit: "", pr: "pr-model", review: "", fast: "" },
    providerSettings: {},
  },
};

vi.mock("$store/renderer/store", () => ({
  store: {
    get state() {
      return mockState;
    },
  } as unknown as Store<any, any>,
}));

describe("BackgroundAgentSettingsPersistenceService", () => {
  const middleware = createBackgroundAgentSettingsPersistenceMiddleware();
  const mockNext = vi.fn((action) => {
    // Simulate reducer updating the mocked state.
    // Actions use tuple payloads: createAction<[param: Type]> → action.payload is [value]
    switch (action.type) {
      case "backgroundAgentSettings/setDefaultModel":
        mockState.backgroundAgentSettings.defaultModel = action.payload[0];
        break;
      case "backgroundAgentSettings/setTypeOverride": {
        const { type, model } = action.payload[0];
        mockState.backgroundAgentSettings.typeOverrides[type] = model;
        break;
      }
      case "backgroundAgentSettings/clearTypeOverride":
        mockState.backgroundAgentSettings.typeOverrides[action.payload[0]] = "";
        break;
      case "backgroundAgentSettings/resetSettings":
        mockState.backgroundAgentSettings.defaultModel = "";
        mockState.backgroundAgentSettings.typeOverrides = { commit: "", pr: "", review: "", fast: "" };
        break;
      case "backgroundAgentSettings/hydrateSettings": {
        const { defaultModel, typeOverrides } = action.payload[0];
        mockState.backgroundAgentSettings.defaultModel = defaultModel;
        mockState.backgroundAgentSettings.typeOverrides = typeOverrides;
        break;
      }
    }
    return action;
  });
  const chain = middleware(null as any)(mockNext);

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock state to initial values
    mockState.backgroundAgentSettings.defaultModel = "test-model";
    mockState.backgroundAgentSettings.typeOverrides = { commit: "", pr: "pr-model", review: "", fast: "" };
  });

  it("persists defaultModel and typeOverrides atomically when setDefaultModel is dispatched", async () => {
    const action = setDefaultModel("new-model");
    chain(action);

    // Allow async persist to execute
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should make ONE atomic settings.update call with both paths and post-action values
    expect(appClient.settings.update).toHaveBeenCalledTimes(1);
    expect(appClient.settings.update).toHaveBeenCalledWith([
      { path: "backgroundAgents.defaultModel", value: "new-model" },
      { path: "backgroundAgents.typeOverrides", value: { commit: "", pr: "pr-model", review: "", fast: "" } },
    ]);
  });

  it("persists atomically when setTypeOverride is dispatched", async () => {
    const action = setTypeOverride({ type: "commit" as BackgroundAgentType, model: "commit-model" });
    chain(action);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appClient.settings.update).toHaveBeenCalledTimes(1);
    expect(appClient.settings.update).toHaveBeenCalledWith([
      { path: "backgroundAgents.defaultModel", value: "test-model" },
      { path: "backgroundAgents.typeOverrides", value: { commit: "commit-model", pr: "pr-model", review: "", fast: "" } },
    ]);
  });

  it("persists atomically when clearTypeOverride is dispatched", async () => {
    const action = clearTypeOverride("pr" as BackgroundAgentType);
    chain(action);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appClient.settings.update).toHaveBeenCalledTimes(1);
    expect(appClient.settings.update).toHaveBeenCalledWith([
      { path: "backgroundAgents.defaultModel", value: "test-model" },
      { path: "backgroundAgents.typeOverrides", value: { commit: "", pr: "", review: "", fast: "" } },
    ]);
  });

  it("persists atomically when resetSettings is dispatched", async () => {
    const action = resetSettings();
    chain(action);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appClient.settings.update).toHaveBeenCalledTimes(1);
    expect(appClient.settings.update).toHaveBeenCalledWith([
      { path: "backgroundAgents.defaultModel", value: "" },
      { path: "backgroundAgents.typeOverrides", value: { commit: "", pr: "", review: "", fast: "" } },
    ]);
  });

  it("does not persist when hydrateSettings is dispatched (avoids write loop)", async () => {
    const action = hydrateSettings({ defaultModel: "hydrated-model", typeOverrides: { commit: "", pr: "", review: "", fast: "" } });
    chain(action);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appClient.settings.update).not.toHaveBeenCalled();
  });

  it("logs error if persist fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(appClient.settings.update).mockRejectedValueOnce(new Error("Network error"));

    const action = setDefaultModel("fail-model");
    chain(action);

    await new Promise((resolve) => setTimeout(resolve, 10));

    // The error is logged internally by the logger; we just verify it doesn't throw
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
