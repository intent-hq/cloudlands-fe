import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
}));

import { invoke } from "$lib/electron-bridge";
import { AUGGIE_CHANNELS } from "$shared/ipc/channels";
import { setSystemStatus } from "../system-status-slice";
import {
  loadSystemStatusSaga,
  systemStatusSaga,
} from "./system-status-saga";

describe("systemStatusSaga", () => {
  it("loads status on startup", () => {
    const iterator = systemStatusSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(loadSystemStatusSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("dispatches hydrated status when IPC returns data", () => {
    const iterator = loadSystemStatusSaga();
    const result = {
      success: true,
      data: {
        nodeVersionOk: false,
        nodeVersion: "v18.0.0",
        installed: true,
        binaryInstallAvailable: true,
      },
    };

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(invoke, AUGGIE_CHANNELS.STATUS),
      done: false,
    });
    expect(iterator.next(result)).toEqual({
      value: sagaEffects.put(
        setSystemStatus({
          nodeVersionOk: false,
          nodeVersion: "v18.0.0",
          auggieInstalled: true,
          binaryInstallAvailable: true,
        })
      ),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("swallows IPC errors", () => {
    const iterator = loadSystemStatusSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(invoke, AUGGIE_CHANNELS.STATUS),
      done: false,
    });
    expect(iterator.throw(new Error("boom"))).toEqual({ value: undefined, done: true });
  });
});