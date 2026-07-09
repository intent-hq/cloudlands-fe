import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fake the live backend transport so the settings seam routes settings.update
// through an in-memory stub (no Electron). `vi.hoisted` keeps the spy visible
// to the hoisted vi.mock factory.
const { updateSpy } = vi.hoisted(() => ({ updateSpy: vi.fn() }));
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: (method: string, params?: unknown) => {
    if (method === "settings.update") return updateSpy(params);
    return Promise.resolve(undefined);
  },
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-model-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
}));

import { store as appStore } from "$store/renderer/store";
import {
  clearWorkspaceModel,
  loadProviderModelsFromStorage,
  loadWorkspaceModelsFromStorage,
  selectModel,
  setSelectedModel,
  setWorkspaceModel,
} from "$store/renderer/slices/model/model-slice";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("model-selection-persistence-service (PROTOCOL §5.12 settings.update wire)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    // Drain any writes queued by earlier dispatches before resetting the spy.
    await flush();
    updateSpy.mockReset();
    updateSpy.mockResolvedValue({ applied: [] });
  });

  it("maps the selectModel trigger to the active provider and persists model.providerDefaults", async () => {
    appStore.dispatch(selectModel("sonnet-test-1"));
    await flush();

    const providerId = appStore.state.providerSettings.activeProviderId;
    expect(appStore.state.model.providerModels[providerId]).toBe("sonnet-test-1");
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        { path: "model.providerDefaults", value: appStore.state.model.providerModels },
      ],
    });
  });

  it("persists model.providerDefaults on a direct per-provider selection", async () => {
    appStore.dispatch(setSelectedModel({ providerId: "codex", model: "gpt-test-2" }));
    await flush();

    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        { path: "model.providerDefaults", value: appStore.state.model.providerModels },
      ],
    });
    expect(appStore.state.model.providerModels.codex).toBe("codex:gpt-test-2");
  });

  it("persists model.workspaceOverrides on workspace pick and clear", async () => {
    appStore.dispatch(setWorkspaceModel({ workspaceId: "ws-1", model: "sonnet-test-3" }));
    await flush();
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "model.workspaceOverrides",
          value: expect.objectContaining({ "ws-1": "sonnet-test-3" }),
        },
      ],
    });

    updateSpy.mockClear();
    appStore.dispatch(clearWorkspaceModel("ws-1"));
    await flush();
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "model.workspaceOverrides",
          value: expect.not.objectContaining({ "ws-1": "sonnet-test-3" }),
        },
      ],
    });
  });

  it("does NOT write back hydration/echo actions (no settings:changed loop)", async () => {
    appStore.dispatch(loadProviderModelsFromStorage({ auggie: "sonnet-test-1" }));
    appStore.dispatch(loadWorkspaceModelsFromStorage({ "ws-1": "sonnet-test-3" }));
    await flush();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("ignores an empty selectModel payload (settings proposals may emit '')", async () => {
    const before = { ...appStore.state.model.providerModels };
    appStore.dispatch(selectModel(""));
    await flush();

    expect(appStore.state.model.providerModels).toEqual(before);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
