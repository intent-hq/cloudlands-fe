import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fake the live backend transport so `models.list` routes through an
// in-memory stub (no Electron). `vi.hoisted` keeps the spy visible to the
// hoisted `vi.mock` factory.
const { listSpy } = vi.hoisted(() => ({ listSpy: vi.fn() }));
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: (method: string, params?: unknown) => {
    if (method === "models.list") return listSpy(params);
    // Every other read (settings.list, workspace lists, ...) resolves empty so
    // the boot seeder + hydration middleware do not perturb the model slice.
    return Promise.resolve({});
  },
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-model-reload-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { store as appStore } from "$store/renderer/store";
import { getItems } from "$lib/store-shim/utils/collections/collection-utils";
import {
  reloadModelsForProvider,
  setAvailableModels,
} from "$store/renderer/slices/model/model-slice";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const SONNET_ROW = {
  id: "sonnet4.5",
  name: "Sonnet 4.5",
  provider: "auggie",
  description: "Balanced general model",
};

describe("model-reload-service (PROTOCOL §5.30 models.list wire)", () => {
  beforeAll(async () => {
    appStore.init();
    // activeProviderId adopts the registry default from catalog hydration.
    const { seedProviderCatalog } = await import(
      "../../test/fixtures/provider-catalog.fixture"
    );
    seedProviderCatalog(appStore);
  });

  beforeEach(async () => {
    await flush();
    listSpy.mockReset();
    // Reset the picker to a known non-empty state so the reload's clearing
    // step is observable.
    appStore.dispatch(setAvailableModels([{ value: "stale", label: "Stale" }]));
  });

  it("fetches models.list, clears the stale catalog, and drives loading → success", async () => {
    listSpy.mockResolvedValueOnce({ models: [SONNET_ROW], source: "auggie" });
    const providerId = appStore.state.providerSettings.activeProviderId;

    appStore.dispatch(reloadModelsForProvider());
    await flush();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(getItems(appStore.state.model.availableModels)).toEqual([
      expect.objectContaining({ value: "sonnet4.5", label: "Sonnet 4.5" }),
    ]);
    expect(appStore.state.model.loadingState[providerId]).toEqual(
      expect.objectContaining({ status: "success", retryAttempt: 0 }),
    );
  });

  it("marks the loading state as error when the daemon returns an empty catalog", async () => {
    listSpy.mockResolvedValueOnce({ models: [], source: "static" });
    const providerId = appStore.state.providerSettings.activeProviderId;

    appStore.dispatch(reloadModelsForProvider());
    await flush();

    expect(getItems(appStore.state.model.availableModels)).toEqual([]);
    expect(appStore.state.model.loadingState[providerId]).toEqual(
      expect.objectContaining({
        status: "error",
        error: expect.stringContaining("No models available"),
      }),
    );
  });

  it("marks the loading state as error when the transport throws (LiveModelsClient folds to empty)", async () => {
    // `LiveModelsClient.list()` catches transport failures and returns [] so
    // the picker falls back cleanly. The reload handler therefore observes
    // an empty catalog and drives the same "no models available" error state
    // the empty-catalog path uses.
    listSpy.mockRejectedValueOnce(new Error("uds boom"));
    const providerId = appStore.state.providerSettings.activeProviderId;

    appStore.dispatch(reloadModelsForProvider());
    await flush();

    expect(getItems(appStore.state.model.availableModels)).toEqual([]);
    expect(appStore.state.model.loadingState[providerId]).toEqual(
      expect.objectContaining({
        status: "error",
        error: expect.stringContaining("No models available"),
      }),
    );
  });
});
