import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";
import type { WorkspaceEvent } from "$features/events/types";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

const { takeEveryFromListenSyncMock, invokeMock } = vi.hoisted(() => ({
  takeEveryFromListenSyncMock: vi.fn(function* () {}),
  invokeMock: vi.fn(),
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromListenSync: takeEveryFromListenSyncMock,
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: invokeMock,
}));

import {
  eventReceived,
  eventsCleared,
  eventsLoaded,
  loadEventsRequested,
  setEventsLoading,
} from "../workspace-events-slice";
import {
  handleLoadEventsRequested,
  watchEventsNewSaga,
  watchEventsClearedSaga,
  watchLoadEventsRequestedSaga,
  workspaceEventsSaga,
} from "./workspace-events-saga";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";

function mockEvent(id: string, workspaceId = "ws-1"): WorkspaceEvent {
  return {
    id,
    workspaceId,
    timestamp: "2026-03-25T00:00:00.000Z",
    type: "file:changed",
    actor: { type: "system" },
  };
}

function getListenSyncHandler(eventName: string) {
  const call = takeEveryFromListenSyncMock.mock.calls.find(([name]: any) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("workspaceEventsSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockReset();
  });

  it("forks all watchers and registers workspaceMounted handler", () => {
    const iterator = workspaceEventsSaga();
    // fork(watchEventsNewSaga)
    const step1 = iterator.next().value as any;
    expect(step1.type).toBe("FORK");
    expect(step1.payload.fn).toBe(watchEventsNewSaga);
    // fork(watchEventsClearedSaga)
    const step2 = iterator.next().value as any;
    expect(step2.type).toBe("FORK");
    expect(step2.payload.fn).toBe(watchEventsClearedSaga);
    // fork(watchLoadEventsRequestedSaga)
    const step3 = iterator.next().value as any;
    expect(step3.type).toBe("FORK");
    expect(step3.payload.fn).toBe(watchLoadEventsRequestedSaga);
    // takeEvery(workspaceMounted, handleWorkspaceMounted)
    const step4 = iterator.next().value as any;
    expect(step4.type).toBe("FORK");
    expect(step4.payload.args[0]).toBe(workspaceMounted);
    expect(iterator.next().done).toBe(true);
  });

  it("dispatches eventReceived on events:new IPC", () => {
    watchEventsNewSaga().next();
    const event = mockEvent("evt-1");
    const handler = getListenSyncHandler("events:new");
    const gen = handler({ workspaceId: "ws-1", event });
    expect(gen.next()).toEqual({
      value: sagaEffects.put(eventReceived("ws-1", event)),
      done: false,
    });
  });

  it("skips events:new without workspaceId", () => {
    watchEventsNewSaga().next();
    const handler = getListenSyncHandler("events:new");
    expect(handler({ event: mockEvent("evt-1") }).next()).toEqual({
      value: undefined,
      done: true,
    });
  });

  it("dispatches eventsCleared on events:cleared IPC", () => {
    watchEventsClearedSaga().next();
    const handler = getListenSyncHandler("events:cleared");
    expect(handler({ workspaceId: "ws-1" }).next()).toEqual({
      value: sagaEffects.put(eventsCleared("ws-1")),
      done: false,
    });
  });

  it("loads events via IPC and dispatches eventsLoaded", () => {
    const action = loadEventsRequested("ws-1");
    const iterator = handleLoadEventsRequested(action);

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(setEventsLoading("ws-1", true)),
      done: false,
    });

    const callEffect = iterator.next().value as any;
    expect(callEffect.type).toBe("CALL");

    const events = [mockEvent("evt-1"), mockEvent("evt-2")];
    expect(iterator.next({ success: true, events })).toEqual({
      value: sagaEffects.put(eventsLoaded("ws-1", events)),
      done: false,
    });
  });

  it("clears loading on failed load", () => {
    const action = loadEventsRequested("ws-1");
    const iterator = handleLoadEventsRequested(action);
    iterator.next(); // put setEventsLoading
    iterator.next(); // call invoke
    expect(iterator.next({ success: false, error: "fail" })).toEqual({
      value: sagaEffects.put(setEventsLoading("ws-1", false)),
      done: false,
    });
  });
});

