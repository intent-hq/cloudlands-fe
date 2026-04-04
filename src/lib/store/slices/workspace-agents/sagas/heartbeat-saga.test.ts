import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";
import { runSaga, stdChannel } from "redux-saga";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  cancel: function* (task: any) {
    return yield sagaEffects.cancel(task);
  },
}));

import { watchSingleHeartbeat } from "./heartbeat-saga";
import {
  heartbeatReceived,
  heartbeatTimedOut,
  startHeartbeat,
  stopAllHeartbeats,
  stopHeartbeat,
} from "../workspace-agents-slice";

describe("heartbeatSaga", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("watchSingleHeartbeat dispatches heartbeatTimedOut when no beat received", async () => {
    const dispatched: any[] = [];
    const channel = stdChannel();

    runSaga(
      { dispatch: (action: any) => dispatched.push(action), channel, getState: () => ({}) },
      watchSingleHeartbeat,
      "session-1",
      100, // check every 100ms
    );

    // Advance past TIMEOUT_MS (60s)
    await vi.advanceTimersByTimeAsync(61_000);

    expect(dispatched).toContainEqual(heartbeatTimedOut("session-1"));
  });

  it("watchSingleHeartbeat does not timeout when beats arrive", async () => {
    const dispatched: any[] = [];
    const channel = stdChannel();

    runSaga(
      { dispatch: (action: any) => dispatched.push(action), channel, getState: () => ({}) },
      watchSingleHeartbeat,
      "session-1",
      1000,
    );

    // Send beats every 30s for 90s — should never timeout
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      channel.put(heartbeatReceived("session-1"));
    }

    const timeoutActions = dispatched.filter(
      (a) => a.type === "workspaceAgents/heartbeatTimedOut"
    );
    expect(timeoutActions).toHaveLength(0);
  });
});

describe("heartbeat actions", () => {
  it("startHeartbeat creates action with default interval", () => {
    const action = startHeartbeat("session-1");
    expect(action.type).toBe("workspaceAgents/startHeartbeat");
    expect(action.payload).toEqual(["session-1"]);
  });

  it("startHeartbeat creates action with custom interval", () => {
    const action = startHeartbeat("session-1", 5000);
    expect(action.type).toBe("workspaceAgents/startHeartbeat");
    expect(action.payload).toEqual(["session-1", 5000]);
  });

  it("heartbeatReceived creates action", () => {
    const action = heartbeatReceived("session-1");
    expect(action.type).toBe("workspaceAgents/heartbeatReceived");
    expect(action.payload).toEqual(["session-1"]);
  });

  it("stopHeartbeat creates action", () => {
    const action = stopHeartbeat("session-1");
    expect(action.type).toBe("workspaceAgents/stopHeartbeat");
    expect(action.payload).toEqual(["session-1"]);
  });

  it("stopAllHeartbeats creates action", () => {
    const action = stopAllHeartbeats();
    expect(action.type).toBe("workspaceAgents/stopAllHeartbeats");
  });

  it("heartbeatTimedOut creates action", () => {
    const action = heartbeatTimedOut("session-1");
    expect(action.type).toBe("workspaceAgents/heartbeatTimedOut");
    expect(action.payload).toEqual(["session-1"]);
  });
});

