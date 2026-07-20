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

vi.mock("$store/renderer/store", () => ({
  store: {
    state: {
      backgroundAgentSettings: {
        defaultModel: "test-model",
        typeOverrides: { commit: "", pr: "pr-model", review: "", fast: "" },
        providerSettings: {},
      },
    },
  } as unknown as Store<any, any>,
}));

describe("BackgroundAgentSettingsPersistenceService", () => {
  const middleware = createBackgroundAgentSettingsPersistenceMiddleware();
  const mockNext = vi.fn((action) => action);
  const chain = middleware(null as any)(mockNext);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists defaultModel and typeOverrides when setDefaultModel is dispatched", async () => {
    const action = setDefaultModel("new-model");
    chain(action);

    // Allow async persist to execute
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appClient.settings.update).toHaveBeenCalledTimes(2);
    expect(appClient.settings.update).toHaveBeenCalledWith([
      { path: "backgroundAgents.defaultModel", value: "test-model" },
    ]);
    expect(appClient.settings.update).toHaveBeenCalledWith([
      { path: "backgroundAgents.typeOverrides", value: { commit: "", pr: "pr-model", review: "", fast: "" } },
    ]);
  });

  it("persists when setTypeOverride is dispatched", async () => {
    const action = setTypeOverride({ type: "commit" as BackgroundAgentType, model: "commit-model" });
    chain(action);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appClient.settings.update).toHaveBeenCalledTimes(2);
  });

  it("persists when clearTypeOverride is dispatched", async () => {
    const action = clearTypeOverride("commit" as BackgroundAgentType);
    chain(action);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appClient.settings.update).toHaveBeenCalledTimes(2);
  });

  it("persists when resetSettings is dispatched", async () => {
    const action = resetSettings();
    chain(action);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appClient.settings.update).toHaveBeenCalledTimes(2);
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
