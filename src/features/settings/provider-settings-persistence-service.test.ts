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
}));

import { store as appStore } from "$store/renderer/store";
import {
  hydrateActiveProvider,
  setActiveProvider,
} from "$store/renderer/slices/provider-settings/provider-settings-slice";

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
});
