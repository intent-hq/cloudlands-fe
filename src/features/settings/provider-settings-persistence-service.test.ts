import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fake the live backend transport so the settings seam routes `settings.update`
// through an in-memory stub (no Electron). `vi.hoisted` keeps the spy visible
// to the hoisted `vi.mock` factory.
const { updateSpy } = vi.hoisted(() => ({ updateSpy: vi.fn() }));
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: (method: string, params?: unknown) => {
    if (method === "settings.update") return updateSpy(params);
    return Promise.resolve(undefined);
  },
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-provider-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { store as appStore } from "$store/renderer/store";
import {
  hydrateActiveProvider,
  loadEnabledProvidersFromStorage,
  setActiveProvider,
  setProviderEnabled,
  toggleProvider,
} from "$store/renderer/slices/provider-settings/provider-settings-slice";
import { ClientLogger } from "$lib/utils/client-logger";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("provider-settings-persistence-service (PROTOCOL §5.12 settings.update wire)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    await flush();
    updateSpy.mockReset();
    updateSpy.mockResolvedValue({ applied: [] });
  });

  it("persists providers.active when the user picks a provider via setActiveProvider", async () => {
    appStore.dispatch(setActiveProvider("claude-code"));
    await flush();

    expect(appStore.state.providerSettings.activeProviderId).toBe("claude-code");
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [{ path: "providers.active", value: "claude-code" }],
    });
  });

  it("does NOT write back on hydrateActiveProvider (no settings:changed loop)", async () => {
    appStore.dispatch(hydrateActiveProvider("codex"));
    await flush();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("ignores an empty providerId payload", async () => {
    appStore.dispatch(setActiveProvider(""));
    await flush();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("persists the full providers.enabled map when a provider is toggled on", async () => {
    appStore.dispatch(toggleProvider("opencode"));
    await flush();

    expect(appStore.state.providerSettings.enabledProviders.opencode).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "providers.enabled",
          value: appStore.state.providerSettings.enabledProviders,
        },
      ],
    });
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        { path: "providers.enabled", value: expect.objectContaining({ opencode: true }) },
      ],
    });
  });

  it("persists the full providers.enabled map when a provider is toggled off", async () => {
    appStore.dispatch(toggleProvider("opencode"));
    await flush();

    expect(appStore.state.providerSettings.enabledProviders.opencode).toBe(false);
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        { path: "providers.enabled", value: expect.objectContaining({ opencode: false }) },
      ],
    });
  });

  it("persists providers.enabled on setProviderEnabled (settings-proposal path)", async () => {
    appStore.dispatch(setProviderEnabled({ providerId: "codex", enabled: true }));
    await flush();

    expect(appStore.state.providerSettings.enabledProviders.codex).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        { path: "providers.enabled", value: expect.objectContaining({ codex: true }) },
      ],
    });
  });

  it("does NOT write back on loadEnabledProvidersFromStorage (no hydration loop)", async () => {
    appStore.dispatch(loadEnabledProvidersFromStorage({ opencode: true, codex: false }));
    await flush();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("logs (not throws) when the providers.enabled write fails", async () => {
    const errorSpy = vi
      .spyOn(ClientLogger.prototype, "error")
      .mockImplementation(() => {});
    updateSpy.mockRejectedValue(new Error("daemon unavailable"));

    expect(() => appStore.dispatch(toggleProvider("opencode"))).not.toThrow();
    await flush();

    expect(updateSpy).toHaveBeenCalledWith({
      changes: [{ path: "providers.enabled", value: expect.any(Object) }],
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to persist enabled providers",
      expect.objectContaining({ error: expect.anything() }),
    );
    errorSpy.mockRestore();
  });
});
