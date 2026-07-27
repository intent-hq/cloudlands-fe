/**
 * Tests for the host-requirements check middleware.
 *
 * Asserts the host-requirements triggers probe git + node over the exact
 * legacy IPC channels (`system:check-git` / `system:check-node`) and ALWAYS
 * land the slice in a terminal state: per-tool statuses set as each probe
 * settles, `hasCheckedOnce` flipped once both settle — even when every probe
 * fails. The channel handlers themselves are wire-contract-tested in
 * host-bridge-seeder.test.ts against the daemon `host.*` methods; here the
 * envelopes fed back are exactly the shapes those bridges produce.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fake the live backend transport so unrelated boot middlewares (settings
// hydration, daemon events bridge) resolve quietly against a stub.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: () => Promise.resolve(undefined),
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-hostreq-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

// Mock electron-bridge with a vi.fn invoke so tests can spy on the exact
// channels the middleware hits.
vi.mock("$lib/electron-bridge", () => ({
  electronAPI: () => (window as any).electronAPI,
  invoke: vi.fn(),
  isElectron: vi.fn(() => true),
}));

import { invoke } from "$lib/electron-bridge";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { store as appStore } from "$store/renderer/store";
import {
  checkHostRequirementsRequested,
  ensureHostRequirementsChecked,
} from "$store/renderer/slices/host-requirements/host-requirements-slice";

const SYSTEM = IPC_CHANNELS.SYSTEM;
const mockedInvoke = vi.mocked(invoke);

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** Route the two probe channels; anything else resolves a bland envelope. */
function routeProbes(handlers: {
  git?: () => Promise<unknown>;
  node?: () => Promise<unknown>;
}): void {
  mockedInvoke.mockImplementation(async (channel: string) => {
    if (channel === SYSTEM.CHECK_GIT && handlers.git) return handlers.git();
    if (channel === SYSTEM.CHECK_NODE && handlers.node) return handlers.node();
    return { success: true, data: null };
  });
}

/** All probe-channel invocations so far, as channel names. */
const probeCalls = () =>
  mockedInvoke.mock.calls
    .map(([channel]) => channel)
    .filter((channel) => channel === SYSTEM.CHECK_GIT || channel === SYSTEM.CHECK_NODE);

describe("host-requirements-check-service", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    // Let any in-flight group from a previous test settle before re-mocking:
    // the middleware's `inFlight` guard is closure-scoped to the instance
    // created by appStore.init() and persists across tests.
    for (let i = 0; i < 8; i++) {
      await flush();
    }
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue({ success: true, data: null });
  });

  it("ensureHostRequirementsChecked probes both channels and lands terminal state", async () => {
    routeProbes({
      git: async () => ({
        success: true,
        data: { available: true, version: "git version 2.43.0" },
      }),
      node: async () => ({
        success: true,
        data: { available: true, version: "22.1.0", versionOk: true },
      }),
    });

    appStore.dispatch(ensureHostRequirementsChecked());
    await flush();

    expect(probeCalls().sort()).toEqual([SYSTEM.CHECK_GIT, SYSTEM.CHECK_NODE].sort());
    const state = appStore.state.hostRequirements;
    expect(state.git).toEqual({ checked: true, available: true, version: "git version 2.43.0" });
    expect(state.node).toEqual({ checked: true, ok: true, version: "22.1.0" });
    expect(state.checking).toBe(false);
    expect(state.hasCheckedOnce).toBe(true);
  });

  it("ensureHostRequirementsChecked does not refetch once hasCheckedOnce is set", async () => {
    appStore.dispatch(ensureHostRequirementsChecked());
    await flush();

    expect(appStore.state.hostRequirements.hasCheckedOnce).toBe(true);
    expect(probeCalls()).toEqual([]);
  });

  it("checkHostRequirementsRequested re-probes even after hasCheckedOnce", async () => {
    routeProbes({
      git: async () => ({ success: true, data: { available: false } }),
      node: async () => ({
        success: true,
        data: { available: true, version: "18.19.0", versionOk: false },
      }),
    });

    appStore.dispatch(checkHostRequirementsRequested());
    await flush();

    expect(probeCalls().sort()).toEqual([SYSTEM.CHECK_GIT, SYSTEM.CHECK_NODE].sort());
    const state = appStore.state.hostRequirements;
    // Terminal folds: git not available (version dropped), node present but
    // too old (version kept for messaging).
    expect(state.git).toEqual({ checked: true, available: false });
    expect(state.node).toEqual({ checked: true, ok: false, version: "18.19.0" });
    expect(state.hasCheckedOnce).toBe(true);
    expect(state.checking).toBe(false);
  });

  it("still lands terminal when both probes reject (never stuck in checking)", async () => {
    routeProbes({
      git: async () => {
        throw new Error("transport down");
      },
      node: async () => {
        throw new Error("transport down");
      },
    });

    appStore.dispatch(checkHostRequirementsRequested());
    await flush();

    const state = appStore.state.hostRequirements;
    expect(state.git).toEqual({ checked: true, available: false });
    expect(state.node).toEqual({ checked: true, ok: false, version: undefined });
    expect(state.checking).toBe(false);
    expect(state.hasCheckedOnce).toBe(true);
  });

  it("a fast probe settles its tool before a slow probe completes; completion waits for both", async () => {
    // The store persists across tests (single appStore.init()), so assert on
    // fresh per-test version markers rather than pristine initial state.
    let releaseNode: () => void = () => {};
    const nodeGate = new Promise<void>((resolve) => {
      releaseNode = resolve;
    });

    routeProbes({
      git: async () => ({
        success: true,
        data: { available: true, version: "git version 2.44.1" },
      }),
      node: async () => {
        await nodeGate;
        return { success: true, data: { available: true, version: "22.9.9", versionOk: true } };
      },
    });

    try {
      appStore.dispatch(checkHostRequirementsRequested());
      await flush();

      // Git already terminal with THIS test's marker; node has not received
      // this test's answer yet; the group is still in flight.
      const midState = appStore.state.hostRequirements;
      expect(midState.git).toEqual({
        checked: true,
        available: true,
        version: "git version 2.44.1",
      });
      expect(midState.node.version).not.toBe("22.9.9");
      expect(midState.checking).toBe(true);
    } finally {
      // Always release so a failed assertion cannot strand the in-flight
      // group and cascade into later tests.
      releaseNode();
    }
    await flush();

    const finalState = appStore.state.hostRequirements;
    expect(finalState.node).toEqual({ checked: true, ok: true, version: "22.9.9" });
    expect(finalState.checking).toBe(false);
  });

  it("coalesces overlapping check requests into a single in-flight group", async () => {
    let releaseProbes: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseProbes = resolve;
    });

    routeProbes({
      git: async () => {
        await gate;
        return { success: true, data: { available: true } };
      },
      node: async () => {
        await gate;
        return { success: true, data: { available: true, version: "22.1.0", versionOk: true } };
      },
    });

    try {
      appStore.dispatch(checkHostRequirementsRequested());
      appStore.dispatch(checkHostRequirementsRequested());
      await flush();
    } finally {
      releaseProbes();
    }
    await flush();

    // One git + one node probe despite two triggers.
    expect(probeCalls().sort()).toEqual([SYSTEM.CHECK_GIT, SYSTEM.CHECK_NODE].sort());
    expect(appStore.state.hostRequirements.checking).toBe(false);
  });

  it("treats a success:false envelope as not-available (no crash, terminal state)", async () => {
    routeProbes({
      git: async () => ({ success: false, error: "daemon unreachable" }),
      node: async () => ({ success: false, error: "daemon unreachable" }),
    });

    appStore.dispatch(checkHostRequirementsRequested());
    await flush();

    const state = appStore.state.hostRequirements;
    expect(state.git).toEqual({ checked: true, available: false });
    expect(state.node).toEqual({ checked: true, ok: false, version: undefined });
    expect(state.hasCheckedOnce).toBe(true);
  });
});
