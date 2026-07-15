/**
 * Tests for the auto-update mutation middleware (regression from saga removal:
 * clicking "Check for Updates" in production shows zero UI feedback because
 * `initAutoUpdate` has no handler and IPC listeners are never registered).
 *
 * Asserts that:
 * - `initAutoUpdate` registers listeners exactly once (idempotent)
 * - IPC events map to correct slice actions
 * - Initial state fetched and dispatched
 * - Slice state transitions correctly (toastVisible, status checking → not-available, etc.)
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock backend transport so unrelated middlewares resolve quietly
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: () => Promise.resolve(undefined),
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-au-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { AUTO_UPDATE_CHANNELS } from "$features/auto-update/types";
import { store as appStore } from "$store/renderer/store";
import { initAutoUpdate } from "$store/renderer/slices/auto-update/auto-update-slice";
import type { UpdateState, UpdateProgress } from "$features/auto-update/types";
import {
  registerMockIpcHandler,
  emitMockIpcEvent,
  resetMockIpcRouter,
  addMockIpcListener,
} from "$shared/ipc-mock-router";

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

// Wire up window.electronAPI.on to addMockIpcListener so auto-update client listeners work
beforeAll(() => {
  let listenerIdCounter = 0;
  (window as any).electronAPI = {
    ...((window as any).electronAPI || {}),
    on: vi.fn((channel: string, handler: (data: any) => void) => {
      const dispose = addMockIpcListener(channel, handler);
      const id = ++listenerIdCounter;
      // Store the disposer for offById
      return id;
    }),
    offById: vi.fn(),
  };
});

describe("auto-update-mutation-service", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    await flush();
    resetMockIpcRouter();
  });

  it("should register IPC listeners exactly once on initAutoUpdate", async () => {
    const initialState: UpdateState = {
      status: "idle",
      currentVersion: "2.0.2",
      updateInfo: null,
      progress: null,
      error: null,
      channel: "stable",
    };

    const getStateSpy = vi.fn();
    registerMockIpcHandler(AUTO_UPDATE_CHANNELS.GET_STATE, async () => {
      getStateSpy();
      return { success: true, data: initialState };
    });

    // Dispatch initAutoUpdate — should register listeners and fetch state
    appStore.dispatch(initAutoUpdate());
    await flush();

    // Verify getState was called
    expect(getStateSpy).toHaveBeenCalled();

    // Verify listeners registered for all event channels
    expect(eventHandlers.has(AUTO_UPDATE_CHANNELS.SHOW_TOAST)).toBe(true);
    expect(eventHandlers.has(AUTO_UPDATE_CHANNELS.UP_TO_DATE)).toBe(true);
    expect(eventHandlers.has(AUTO_UPDATE_CHANNELS.STATUS_CHANGED)).toBe(true);
    expect(eventHandlers.has(AUTO_UPDATE_CHANNELS.PROGRESS)).toBe(true);
    expect(eventHandlers.has(AUTO_UPDATE_CHANNELS.ERROR)).toBe(true);

    const listenerCountBefore = eventHandlers.get(AUTO_UPDATE_CHANNELS.STATUS_CHANGED)!.length;

    // Dispatch initAutoUpdate again — should be idempotent (no duplicate listeners)
    appStore.dispatch(initAutoUpdate());
    await flush();

    const listenerCountAfter = eventHandlers.get(AUTO_UPDATE_CHANNELS.STATUS_CHANGED)!.length;
    expect(listenerCountAfter).toBe(listenerCountBefore);
  });

  it("should dispatch showToastChecking when SHOW_TOAST event fires", async () => {
    registerMockIpcHandler(AUTO_UPDATE_CHANNELS.GET_STATE, async () => ({
      success: true,
      data: { status: "idle", currentVersion: "2.0.2", updateInfo: null, progress: null, error: null, channel: "stable" },
    }));

    appStore.dispatch(initAutoUpdate());
    await flush();

    // Simulate SHOW_TOAST IPC event
    emitMockIpcEvent(AUTO_UPDATE_CHANNELS.SHOW_TOAST, undefined);
    await flush();

    // Verify slice state
    const state = appStore.state.autoUpdate;
    expect(state?.toastVisible).toBe(true);
    expect(state?.status).toBe("checking");
  });

  it("should dispatch setUpToDate + showToast when UP_TO_DATE event fires", async () => {
    registerMockIpcHandler(AUTO_UPDATE_CHANNELS.GET_STATE, async () => ({
      success: true,
      data: { status: "idle", currentVersion: "2.0.2", updateInfo: null, progress: null, error: null, channel: "stable" },
    }));

    appStore.dispatch(initAutoUpdate());
    await flush();

    // Simulate UP_TO_DATE IPC event
    emitMockIpcEvent(AUTO_UPDATE_CHANNELS.UP_TO_DATE, { version: "2.0.2", isDev: false });
    await flush();

    // Verify slice state
    const state = appStore.state.autoUpdate;
    expect(state?.status).toBe("not-available");
    expect(state?.currentVersion).toBe("2.0.2");
    expect(state?.toastVisible).toBe(true);
  });
});
