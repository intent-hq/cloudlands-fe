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
import { setActiveProvider } from "$store/renderer/slices/provider-settings/provider-settings-slice";

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
    const { seedProviderCatalog } = await import(
      "../../test/fixtures/provider-catalog.fixture"
    );
    seedProviderCatalog(appStore);
    // The catalog carries no default designation; the active provider is
    // user-derived, so set it explicitly for the reload path under test.
    appStore.dispatch(setActiveProvider("auggie"));
  });

  beforeEach(async () => {
    await flush();
    listSpy.mockReset();
    // Reset the picker to a known non-empty state so the reload's clearing
    // step is observable.
    appStore.dispatch(setAvailableModels([{ value: "stale", label: "Stale" }], "auggie"));
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

  it("discards a stale overlapping reload so a slow first fetch cannot overwrite the newer catalog", async () => {
    // Regression (generation guard): reload for auggie is in flight when the
    // user switches to codex and a second reload fires. The codex fetch
    // resolves first; when auggie's slow fetch finally resolves it must be
    // discarded — otherwise the store would end with auggie's models (and
    // auggie provenance) while codex is active.
    const CODEX_ROW = {
      id: "gpt-5-codex",
      name: "GPT-5 Codex",
      provider: "codex",
      description: "Codex model",
    };
    let resolveSlowAuggie:
      | ((value: { models: (typeof SONNET_ROW)[]; source: string }) => void)
      | undefined;
    listSpy
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlowAuggie = resolve;
          }),
      )
      .mockResolvedValueOnce({ models: [CODEX_ROW], source: "codex" });

    appStore.dispatch(reloadModelsForProvider());
    await flush();

    appStore.dispatch(setActiveProvider("codex"));
    appStore.dispatch(reloadModelsForProvider());
    await flush();

    expect(appStore.state.model.availableModelsProviderId).toBe("codex");
    expect(getItems(appStore.state.model.availableModels)).toEqual([
      expect.objectContaining({ value: "gpt-5-codex" }),
    ]);

    // The stale auggie response lands late — it must be ignored entirely
    // (catalog, provenance, and loading state all keep the codex result).
    resolveSlowAuggie?.({ models: [SONNET_ROW], source: "auggie" });
    await flush();

    expect(appStore.state.model.availableModelsProviderId).toBe("codex");
    expect(getItems(appStore.state.model.availableModels)).toEqual([
      expect.objectContaining({ value: "gpt-5-codex" }),
    ]);
    expect(appStore.state.model.loadingState.codex).toEqual(
      expect.objectContaining({ status: "success" }),
    );

    // Restore the suite-wide active provider.
    appStore.dispatch(setActiveProvider("auggie"));
  });
});
