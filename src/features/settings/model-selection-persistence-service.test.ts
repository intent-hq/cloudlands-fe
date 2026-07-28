import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fake the live backend transport so the settings seam routes settings.update
// through an in-memory stub (no Electron). `vi.hoisted` keeps the spies visible
// to the hoisted vi.mock factory. `modelsListSpy` observes the `models.list`
// wire call that reloadModelsForProvider (model-reload middleware) issues, so
// tests can assert whether a cross-provider pick triggered a catalog reload.
const { updateSpy, modelsListSpy } = vi.hoisted(() => ({
  updateSpy: vi.fn(),
  modelsListSpy: vi.fn(),
}));
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: (method: string, params?: unknown) => {
    if (method === "settings.update") return updateSpy(params);
    if (method === "models.list") return modelsListSpy(params);
    return Promise.resolve(undefined);
  },
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-model-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { store as appStore } from "$store/renderer/store";
import {
  loadProviderModelsFromStorage,
  selectModel,
  setSelectedModel,
} from "$store/renderer/slices/model/model-slice";
import { setActiveProvider } from "$store/renderer/slices/provider-settings/provider-settings-slice";
import {
  MOCK_PROVIDER_CATALOG,
  seedProviderCatalog,
} from "../../test/fixtures/provider-catalog.fixture";

const getDefaultProviderId = () => MOCK_PROVIDER_CATALOG.defaultProviderId;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("model-selection-persistence-service (PROTOCOL §5.12 settings.update wire)", () => {
  beforeAll(() => {
    appStore.init();
    // The middleware now reads known provider ids and the default provider
    // from the providerCatalog slice — seed the §5.38-shaped mock catalog.
    seedProviderCatalog(appStore);
  });

  beforeEach(async () => {
    // Drain any writes queued by earlier dispatches before resetting the spies.
    await flush();
    updateSpy.mockReset();
    updateSpy.mockResolvedValue({ applied: [] });
    modelsListSpy.mockReset();
    modelsListSpy.mockResolvedValue({ models: [] });
  });

  afterEach(async () => {
    // Restore the active provider and clear the model-selection slices even
    // when an assertion fails mid-test — the suite shares one live store, so
    // leaked state would make later tests ordering-dependent. The hydration
    // actions are already asserted to not trigger persistence writes.
    appStore.dispatch(setActiveProvider(getDefaultProviderId()));
    appStore.dispatch(loadProviderModelsFromStorage({}));
    await flush();
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

  it("attributes a compound selectModel pick to the provider in the id, not the active provider", async () => {
    const defaultProviderId = getDefaultProviderId();
    appStore.dispatch(setActiveProvider(defaultProviderId));
    appStore.dispatch(loadProviderModelsFromStorage({}));
    await flush();
    updateSpy.mockClear();

    appStore.dispatch(selectModel("opencode:opencode-go/kimi-k3"));
    await flush();

    expect(appStore.state.model.providerModels.opencode).toBe("opencode:opencode-go/kimi-k3");
    expect(appStore.state.model.providerModels[defaultProviderId]).toBeUndefined();
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        { path: "model.providerDefaults", value: appStore.state.model.providerModels },
      ],
    });
  });

  it("switches the active provider on a cross-provider compound pick and persists providers.active", async () => {
    const defaultProviderId = getDefaultProviderId();
    appStore.dispatch(setActiveProvider(defaultProviderId));
    appStore.dispatch(loadProviderModelsFromStorage({}));
    await flush();
    updateSpy.mockClear();

    appStore.dispatch(selectModel("opencode:opencode-go/kimi-k3"));
    await flush();

    expect(appStore.state.providerSettings.activeProviderId).toBe("opencode");
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [{ path: "providers.active", value: "opencode" }],
    });
  });

  it("reloads the model catalog (models.list) on a cross-provider compound pick", async () => {
    appStore.dispatch(setActiveProvider(getDefaultProviderId()));
    appStore.dispatch(loadProviderModelsFromStorage({}));
    await flush();
    modelsListSpy.mockClear();

    appStore.dispatch(selectModel("opencode:opencode-go/kimi-k3"));
    await flush();

    // The switch dispatched reloadModelsForProvider, which cleared the
    // previous provider's catalog and refetched via `models.list`.
    expect(modelsListSpy).toHaveBeenCalled();
  });

  it("does NOT dispatch a provider switch on a same-provider compound pick", async () => {
    appStore.dispatch(setActiveProvider("opencode"));
    appStore.dispatch(loadProviderModelsFromStorage({}));
    await flush();
    updateSpy.mockClear();
    modelsListSpy.mockClear();

    appStore.dispatch(selectModel("opencode:opencode-go/kimi-k3"));
    await flush();

    expect(appStore.state.providerSettings.activeProviderId).toBe("opencode");
    const persistedPaths = updateSpy.mock.calls.flatMap(([params]) =>
      (params as { changes: { path: string }[] }).changes.map((c) => c.path),
    );
    expect(persistedPaths).not.toContain("providers.active");
    expect(modelsListSpy).not.toHaveBeenCalled();
  });

  it("does NOT switch providers or reload the catalog on a malformed compound prefix", async () => {
    const defaultProviderId = getDefaultProviderId();
    appStore.dispatch(setActiveProvider(defaultProviderId));
    appStore.dispatch(loadProviderModelsFromStorage({}));
    await flush();
    updateSpy.mockClear();
    modelsListSpy.mockClear();

    appStore.dispatch(selectModel("not-a-provider:some-model"));
    await flush();

    // An unknown prefix must not flip activeProviderId globally (and thus
    // never persists providers.active) nor trigger a catalog reload.
    expect(appStore.state.providerSettings.activeProviderId).toBe(defaultProviderId);
    const persistedPaths = updateSpy.mock.calls.flatMap(([params]) =>
      (params as { changes: { path: string }[] }).changes.map((c) => c.path),
    );
    expect(persistedPaths).not.toContain("providers.active");
    expect(modelsListSpy).not.toHaveBeenCalled();
  });

  it("attributes a compound selectModel pick matching the active provider to that provider", async () => {
    appStore.dispatch(setActiveProvider("opencode"));
    appStore.dispatch(loadProviderModelsFromStorage({}));
    await flush();
    updateSpy.mockClear();

    appStore.dispatch(selectModel("opencode:opencode-go/kimi-k3"));
    await flush();

    expect(appStore.state.model.providerModels).toEqual({
      opencode: "opencode:opencode-go/kimi-k3",
    });
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        { path: "model.providerDefaults", value: appStore.state.model.providerModels },
      ],
    });
  });

  it("falls back to the active provider for a malformed compound id with an empty prefix", async () => {
    const defaultProviderId = getDefaultProviderId();
    appStore.dispatch(loadProviderModelsFromStorage({}));
    await flush();
    updateSpy.mockClear();

    appStore.dispatch(selectModel(":orphan-model"));
    await flush();

    expect(appStore.state.model.providerModels[""]).toBeUndefined();
    // The model slice normalizes the compound form when storing; the point
    // here is the attribution: no empty-string provider bucket is created.
    expect(appStore.state.model.providerModels[defaultProviderId]).toBe("orphan-model");
    // No provider switch, so no catalog reload either.
    expect(modelsListSpy).not.toHaveBeenCalled();
  });

  it("does NOT reload the catalog on a bare (non-compound) selectModel pick", async () => {
    appStore.dispatch(loadProviderModelsFromStorage({}));
    await flush();
    modelsListSpy.mockClear();

    appStore.dispatch(selectModel("sonnet-test-1"));
    await flush();

    expect(modelsListSpy).not.toHaveBeenCalled();
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

  it("does NOT write back hydration/echo actions (no settings:changed loop)", async () => {
    appStore.dispatch(loadProviderModelsFromStorage({ auggie: "sonnet-test-1" }));
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
