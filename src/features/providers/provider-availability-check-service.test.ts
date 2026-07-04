/**
 * Tests for the provider-availability check middleware (bug: onboarding
 * provider cards stuck on "Checking…" forever).
 *
 * Asserts the agent-availability triggers route through
 * `providers:get-availability` / `providers:check-single` and ALWAYS land the
 * slice in a terminal state: per-provider statuses set, `hasCheckedOnce`
 * flipped — even when the availability envelope reports failure.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fake the live backend transport so unrelated boot middlewares (settings
// hydration, daemon events bridge) resolve quietly against a stub.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: () => Promise.resolve(undefined),
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-avail-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
}));

import { invoke } from "$lib/electron-bridge";
import { PROVIDERS_CHANNELS } from "$shared/ipc/channels";
import { store as appStore } from "$store/renderer/store";
import {
  checkAllProvidersRequested,
  checkSingleProviderRequested,
  ensureProvidersChecked,
} from "$store/renderer/slices/agent-availability/agent-availability-slice";
import { clearProviderAvailabilityCache } from "$features/providers/provider-availability.client";
import type { ProviderAvailabilityResult } from "$features/providers/provider-availability.client";

const flush = async () => {
  // The bulk check chains invoke → dispatch loops → dynamic import; drain a
  // few microtask/macrotask rounds so every dispatch has landed.
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

// `$lib/electron-bridge` is globally mocked in test-setup.ts; route the two
// provider channels through per-test spies and keep the setup default
// (`{ success: true, data: null }`) for everything else.
const availabilitySpy = vi.fn();
const checkSingleSpy = vi.fn();
const mockedInvoke = vi.mocked(invoke);

function availabilityResult(
  overrides: Partial<ProviderAvailabilityResult["providers"]> = {},
): ProviderAvailabilityResult {
  const off = { available: false };
  return {
    hasAnyProvider: true,
    providers: {
      auggie: { available: true, authenticated: true },
      claudeCode: off,
      codex: off,
      cortex: off,
      mock: off,
      opencode: off,
      pi: off,
      droid: off,
      ...overrides,
    },
    hiddenProviders: [],
  };
}

describe("provider-availability-check-service", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    await flush();
    clearProviderAvailabilityCache();
    availabilitySpy.mockReset();
    checkSingleSpy.mockReset();
    mockedInvoke.mockImplementation(async (channel: string, data?: unknown) => {
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) return availabilitySpy(data);
      if (channel === PROVIDERS_CHANNELS.CHECK_SINGLE) return checkSingleSpy(data);
      return { success: true, data: null };
    });
  });

  it("ensureProvidersChecked resolves every provider to a terminal status and flips hasCheckedOnce", async () => {
    availabilitySpy.mockResolvedValue({ success: true, data: availabilityResult() });

    appStore.dispatch(ensureProvidersChecked());
    await flush();

    const state = appStore.state.agentAvailability;
    expect(availabilitySpy).toHaveBeenCalledTimes(1);
    expect(state.hasCheckedOnce).toBe(true);
    expect(state.providerStatusMap.auggie).toEqual({ available: true, authenticated: true });
    expect(state.providerStatusMap["claude-code"]).toEqual({ available: false });
    for (const id of ["auggie", "claude-code", "codex", "opencode", "pi", "droid"]) {
      expect(state.providerLoadingMap[id]).toBe(false);
    }
  });

  it("ensureProvidersChecked does not refetch once hasCheckedOnce is set", async () => {
    availabilitySpy.mockResolvedValue({ success: true, data: availabilityResult() });

    appStore.dispatch(ensureProvidersChecked());
    await flush();

    expect(appStore.state.agentAvailability.hasCheckedOnce).toBe(true);
    expect(availabilitySpy).not.toHaveBeenCalled();
  });

  it("checkAllProvidersRequested still terminates when the availability envelope fails", async () => {
    availabilitySpy.mockResolvedValue({ success: false, error: "daemon unreachable" });

    appStore.dispatch(checkAllProvidersRequested());
    await flush();

    const state = appStore.state.agentAvailability;
    // The client folds failure to the all-unavailable default result — every
    // card lands on not-available instead of spinning.
    expect(state.hasCheckedOnce).toBe(true);
    expect(state.providerStatusMap.auggie).toEqual({ available: false });
    expect(state.providerLoadingMap.auggie).toBe(false);
  });

  it("checkSingleProviderRequested routes through providers:check-single", async () => {
    checkSingleSpy.mockResolvedValue({
      success: true,
      providerId: "codex",
      data: { available: true, authenticated: false },
    });

    appStore.dispatch(checkSingleProviderRequested("codex"));
    await flush();

    expect(checkSingleSpy).toHaveBeenCalledWith("codex");
    expect(appStore.state.agentAvailability.providerStatusMap.codex).toEqual({
      available: true,
      authenticated: false,
    });
    expect(appStore.state.agentAvailability.providerLoadingMap.codex).toBe(false);
  });

  it("checkSingleProviderRequested clears the loading flag on a failed envelope", async () => {
    checkSingleSpy.mockResolvedValue({ success: false, providerId: "droid", error: "probe failed" });

    appStore.dispatch(checkSingleProviderRequested("droid"));
    await flush();

    expect(appStore.state.agentAvailability.providerLoadingMap.droid).toBe(false);
  });
});
