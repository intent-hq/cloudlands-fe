/**
 * Tests for the provider-availability check middleware (bug: onboarding
 * provider cards stuck on "Checking…" forever, then: cards must settle
 * INDIVIDUALLY as their own probe resolves).
 *
 * Asserts the agent-availability triggers fan out per-provider
 * `providers:check-single` IPC calls in parallel and ALWAYS land the slice
 * in a terminal state: per-provider statuses set as each probe settles,
 * `hasCheckedOnce` flipped once every probe settles — even when every
 * per-provider envelope reports failure.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fake the live backend transport so unrelated boot middlewares (settings
// hydration, daemon events bridge) resolve quietly against a stub.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: () => Promise.resolve(undefined),
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-avail-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {}, // Unused now but kept for compatibility
}));

// Mock electron-bridge: use the window.electronAPI set up by test-setup.ts,
// and provide a vi.fn mock for invoke so tests can spy on it.
vi.mock("$lib/electron-bridge", () => ({
  electronAPI: () => (window as any).electronAPI,
  invoke: vi.fn(),
}));

import { invoke } from "$lib/electron-bridge";
import { PROVIDERS_CHANNELS } from "$shared/ipc/channels";
import { PROVIDER_AVAILABILITY_KEY_TO_ID } from "$shared/config/provider-config";
import { store as appStore } from "$store/renderer/store";
import {
  checkAllProvidersRequested,
  checkSingleProviderRequested,
  ensureProvidersChecked,
} from "$store/renderer/slices/agent-availability/agent-availability-slice";
import { clearProviderAvailabilityCache } from "$features/providers/provider-availability.client";
import type { ProviderStatus } from "$store/renderer/slices/agent-availability/agent-availability-types";

const ALL_PROVIDER_IDS = Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID);

const flush = async () => {
  // The bulk fan-out chains invoke → dispatch loops; drain a few
  // microtask/macrotask rounds so every dispatch has landed.
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

// `$lib/electron-bridge` is globally mocked in test-setup.ts; route the
// provider channels through a per-provider dispatcher.
const checkSingleSpy = vi.fn();
const mockedInvoke = vi.mocked(invoke);

type CheckSingleResponse = {
  success: boolean;
  providerId: string;
  data?: ProviderStatus;
  error?: string;
};

/** Route every CHECK_SINGLE call through the provided per-provider map. */
function routeCheckSingle(
  responses: Partial<Record<string, () => Promise<CheckSingleResponse>>>,
): void {
  checkSingleSpy.mockImplementation(async (providerId: string) => {
    const responder = responses[providerId];
    if (responder) return responder();
    return {
      success: true,
      providerId,
      data: { available: false } satisfies ProviderStatus,
    };
  });
}

describe("provider-availability-check-service", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    // Flush many rounds to ensure any in-flight bulk checks from previous tests fully
    // settle. The middleware's `inFlight` guard is closure-scoped to the middleware instance
    // created by appStore.init() and persists across tests (store is initialized once in beforeAll).
    // Empirically, 30 flush cycles are needed to allow all previous checks to complete.
    for (let i = 0; i < 30; i++) {
      await flush();
    }
    clearProviderAvailabilityCache();
    checkSingleSpy.mockReset();
    mockedInvoke.mockImplementation(async (channel: string, data?: unknown) => {
      if (channel === PROVIDERS_CHANNELS.CHECK_SINGLE) return checkSingleSpy(data);
      return { success: true, data: null };
    });
  });

  it("ensureProvidersChecked fans out one providers:check-single per provider and flips hasCheckedOnce", async () => {
    routeCheckSingle({
      auggie: async () => ({
        success: true,
        providerId: "auggie",
        data: { available: true, authenticated: true },
      }),
    });

    appStore.dispatch(ensureProvidersChecked());
    await flush();

    const state = appStore.state.agentAvailability;
    expect(checkSingleSpy).toHaveBeenCalledTimes(ALL_PROVIDER_IDS.length);
    for (const providerId of ALL_PROVIDER_IDS) {
      expect(checkSingleSpy).toHaveBeenCalledWith(providerId);
    }
    expect(state.hasCheckedOnce).toBe(true);
    expect(state.providerStatusMap.auggie).toEqual({ available: true, authenticated: true });
    expect(state.providerStatusMap["claude-code"]).toEqual({ available: false });
    for (const id of ALL_PROVIDER_IDS) {
      expect(state.providerLoadingMap[id]).toBe(false);
    }
  });

  it("ensureProvidersChecked does not refetch once hasCheckedOnce is set", async () => {
    routeCheckSingle({});

    appStore.dispatch(ensureProvidersChecked());
    await flush();

    expect(appStore.state.agentAvailability.hasCheckedOnce).toBe(true);
    expect(checkSingleSpy).not.toHaveBeenCalled();
  });

  it("fast probes render their terminal status before slow probes complete", async () => {
    // Gate the "slow" providers behind a deferred that the test controls; the
    // "fast" auggie probe resolves immediately. Between the two sync points
    // the store must already show auggie's terminal status while the slow
    // providers are still in-flight. Uses `checkAllProvidersRequested`
    // because `ensureProvidersChecked` short-circuits after the first test.
    let releaseSlow: () => void = () => {};
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    const slowResponders: Record<string, () => Promise<CheckSingleResponse>> = {};
    for (const providerId of ALL_PROVIDER_IDS) {
      if (providerId === "auggie") continue;
      slowResponders[providerId] = async () => {
        await slowGate;
        return {
          success: true,
          providerId,
          data: { available: false } satisfies ProviderStatus,
        };
      };
    }

    routeCheckSingle({
      auggie: async () => ({
        success: true,
        providerId: "auggie",
        data: { available: true, authenticated: true },
      }),
      ...slowResponders,
    });

    appStore.dispatch(checkAllProvidersRequested());
    await flush();

    // Auggie has already settled; every other provider is still loading and
    // no status has been written for them yet. The bulk completion has NOT
    // fired because slow probes are still pending.
    const midState = appStore.state.agentAvailability;
    expect(midState.providerStatusMap.auggie).toEqual({ available: true, authenticated: true });
    expect(midState.providerLoadingMap.auggie).toBe(false);
    for (const providerId of ALL_PROVIDER_IDS) {
      if (providerId === "auggie") continue;
      expect(midState.providerLoadingMap[providerId]).toBe(true);
    }

    // Release the slow probes and the group settles → every card terminal.
    releaseSlow();
    await flush();

    const finalState = appStore.state.agentAvailability;
    expect(finalState.hasCheckedOnce).toBe(true);
    for (const providerId of ALL_PROVIDER_IDS) {
      expect(finalState.providerLoadingMap[providerId]).toBe(false);
    }
  });

  it("checkAllProvidersRequested still terminates when every per-provider probe fails", async () => {
    const failing: Record<string, () => Promise<CheckSingleResponse>> = {};
    for (const providerId of ALL_PROVIDER_IDS) {
      failing[providerId] = async () => ({
        success: false,
        providerId,
        error: "daemon unreachable",
      });
    }
    routeCheckSingle(failing);

    appStore.dispatch(checkAllProvidersRequested());
    await flush();

    const state = appStore.state.agentAvailability;
    // Every card lands terminal — loading cleared and hasCheckedOnce true —
    // so onboarding is never stuck on "Checking…" even when the daemon is
    // unreachable. Status stays undefined on probe failure, which the UI
    // renders as `available: false` via `status?.available ?? false`.
    expect(state.hasCheckedOnce).toBe(true);
    for (const providerId of ALL_PROVIDER_IDS) {
      expect(state.providerLoadingMap[providerId]).toBe(false);
    }
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

  // Backend connect/reconnect functional test: Verify the listener triggers bulk re-check.
  it("backend connected event triggers bulk re-check and flips state from unavailable to available", async () => {
    // The middleware factory runs when appStore.init() is called in beforeAll, which
    // should register a BACKEND.STATUS listener via electronAPI().on().
    const backendStatusHandlers = (window as any).electronAPI._getRegisteredHandlers("backend:status");
    expect(backendStatusHandlers.length).toBeGreaterThan(0);
    const backendStatusListener = backendStatusHandlers[0];
    expect(typeof backendStatusListener).toBe("function");

    // Clear the spy to measure only reconnect-triggered calls.
    checkSingleSpy.mockClear();

    // Configure probes to succeed (daemon is now reachable).
    routeCheckSingle({
      auggie: async () => ({
        success: true,
        providerId: "auggie",
        data: { available: true, authenticated: true },
      }),
      codex: async () => ({
        success: true,
        providerId: "codex",
        data: { available: true, authenticated: false },
      }),
    });

    // Simulate backend connected event by calling the captured listener.
    // This could be either initial connect (no reconnected flag) or reconnect
    // (reconnected: true). Both should trigger a bulk re-check.
    // Test the initial-connect case (reconnected undefined) to prove the startup race fix.
    backendStatusListener({ status: "connected" });

    // Flush several rounds to let the async bulk check settle.
    await flush();
    await flush();
    await flush();

    // Verify the connected event triggered a fresh bulk check.
    expect(checkSingleSpy).toHaveBeenCalled();
    expect(checkSingleSpy.mock.calls.length).toBe(ALL_PROVIDER_IDS.length);

    // State should reflect the reconnect probe results.
    const state = appStore.state.agentAvailability;
    expect(state.hasCheckedOnce).toBe(true);
    expect(state.providerStatusMap.auggie).toEqual({
      available: true,
      authenticated: true,
    });
    expect(state.providerStatusMap.codex).toEqual({
      available: true,
      authenticated: false,
    });
  });
});
