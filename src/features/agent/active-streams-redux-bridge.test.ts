/**
 * Active streams Redux bridge test — regression test for the
 * tracker→Redux bridge that dispatches `bumpActiveStreamsVersion`
 * when active-stream data arrives after sidebar mount.
 *
 * This test asserts:
 * 1. The wire request (`agent:get-active-streams`) matches PROTOCOL.md §5.5
 * 2. The tracker notifies listeners when active streams are updated
 * 3. The bridge dispatches `bumpActiveStreamsVersion` 
 * 4. The Redux `selectActiveStreamsVersion` counter increments
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { store as appStore } from "$store/renderer/store";
import { selectActiveStreamsVersion } from "$store/renderer/slices/sidebar-nav/sidebar-nav-selectors";
import { activeStreamsTracker } from "./services/active-streams-tracker";
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { __resetActiveStreamsReduxBridgeForTests } from "./active-streams-redux-bridge";

// Mock electron-bridge to provide on/off functions for event listeners
vi.mock("$lib/electron-bridge", () => ({
  on: vi.fn(),
  off: vi.fn(),
  invoke: vi.fn(),
  isElectron: () => false,
  listenOnce: vi.fn(),
  listenSync: vi.fn(),
  removeListener: vi.fn(),
}));

describe("Active streams → Redux bridge", () => {
  beforeEach(() => {
    // Register the mock IPC handler BEFORE initializing the store
    // because the middleware calls startPolling during initialization
    registerMockIpcHandler("agent:get-active-streams", async () => ({
      success: true,
      data: [],
    }));

    appStore.init();

    // Trigger an action to initialize the bridge middleware
    // (it initializes on first action dispatch)
    appStore.dispatch({ type: "test/init" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    __resetActiveStreamsReduxBridgeForTests();
  });

  it("dispatches bumpActiveStreamsVersion when tracker notifies listeners after active-streams update", async () => {
    // Initial version should be 0
    const initialVersion = selectActiveStreamsVersion.select(appStore.state);
    expect(initialVersion).toBe(0);

    // Update the mock IPC handler to return streaming data
    // PROTOCOL.md §5.5 shape: { success: boolean, data: ActiveStream[] }
    registerMockIpcHandler("agent:get-active-streams", async () => ({
      success: true,
      data: [
        {
          agentId: "agent-streaming-1",
          sessionId: "agent-streaming-1",
          workspaceId: "ws-test",
          startTime: Date.parse("2026-07-17T00:00:00.000Z"),
        },
      ],
    }));

    // Trigger the fetch which will notify listeners
    await activeStreamsTracker.fetchActiveStreams();

    // The Redux version should have incremented synchronously
    // (the dispatch happens in the listener callback, which is synchronous)
    const newVersion = selectActiveStreamsVersion.select(appStore.state);
    expect(newVersion).toBe(1);
  });

  it("increments version multiple times for multiple updates", async () => {
    // Note: startPolling was already called during middleware init, which fetched
    // empty data. The version should be 0 initially (no change from init state).
    const versionBefore = selectActiveStreamsVersion.select(appStore.state);

    // First change: add agent-1 (different from the empty initial state)
    registerMockIpcHandler("agent:get-active-streams", async () => ({
      success: true,
      data: [
        {
          agentId: "agent-1",
          sessionId: "agent-1",
          workspaceId: "ws-1",
          startTime: Date.parse("2026-07-17T10:00:00.000Z"),
        },
      ],
    }));

    await activeStreamsTracker.fetchActiveStreams();

    const versionAfterAdd = selectActiveStreamsVersion.select(appStore.state);
    // This should have incremented because we went from [] to [agent-1]
    expect(versionAfterAdd).toBe(versionBefore + 1);

    // Second change: different agent (agent-2 replaces agent-1)
    registerMockIpcHandler("agent:get-active-streams", async () => ({
      success: true,
      data: [
        {
          agentId: "agent-2",
          sessionId: "agent-2",
          workspaceId: "ws-2",
          startTime: Date.parse("2026-07-17T10:05:00.000Z"),
        },
      ],
    }));

    await activeStreamsTracker.fetchActiveStreams();

    const versionAfterReplace = selectActiveStreamsVersion.select(appStore.state);
    // This should have incremented because agent-1 was replaced with agent-2
    expect(versionAfterReplace).toBe(versionAfterAdd + 1);
  });

  it("does not increment version when streams have not changed", async () => {
    const data = [
      {
        agentId: "agent-stable",
        sessionId: "agent-stable",
        workspaceId: "ws-stable",
        startTime: Date.parse("2026-07-17T00:00:00.000Z"),
      },
    ];

    registerMockIpcHandler("agent:get-active-streams", async () => ({
      success: true,
      data,
    }));

    await activeStreamsTracker.fetchActiveStreams();

    const versionAfterFirst = selectActiveStreamsVersion.select(appStore.state);

    // Fetch again with the same data
    await activeStreamsTracker.fetchActiveStreams();

    const versionAfterSecond = selectActiveStreamsVersion.select(appStore.state);

    // Version should not increment when data hasn't changed
    expect(versionAfterSecond).toBe(versionAfterFirst);
  });
});
