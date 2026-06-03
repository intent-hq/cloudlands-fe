import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  take: function* (patternOrChannel: any) {
    return yield sagaEffects.take(patternOrChannel);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
}));

const { takeEveryFromElectronChannelMock } = vi.hoisted(() => ({
  takeEveryFromElectronChannelMock: vi.fn(function* () {}),
}));

vi.mock("$store/renderer/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: takeEveryFromElectronChannelMock,
}));

vi.mock("$features/auto-update/auto-update.client", () => ({
  autoUpdateClient: {
    getState: vi.fn(),
    checkForUpdates: vi.fn(),
    checkForUpdatesManual: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    setChannel: vi.fn(),
  },
}));

import {
  autoUpdateSaga,
  watchAutoUpdateUpToDateSaga,
} from "./auto-update-saga";

function getElectronHandler(eventName: string) {
  const call = takeEveryFromElectronChannelMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("autoUpdateSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = { on: vi.fn(), offById: vi.fn() };
  });

  it("forks the up-to-date IPC watcher first", () => {
    testSaga(autoUpdateSaga)
      .next()
      .fork(watchAutoUpdateUpToDateSaga);
  });

  it("shows the up-to-date toast when no update toast is visible", () => {
    const data = { version: "1.2.3" };
    const iterator = watchAutoUpdateUpToDateSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromElectronChannelMock).toHaveBeenCalledWith(
      "auto-update:up-to-date",
      expect.any(Function),
    );

    // Handler should first select toastVisible, then either show toast or dispatch setUpToDate
    const handler = getElectronHandler("auto-update:up-to-date")(data);
    const selectEffect = handler.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    // Simulate toastVisible = false → should call showUpToDateToast
    const callEffect = handler.next(false).value as any;
    expect(callEffect.type).toBe("CALL");
    expect(callEffect.payload.args).toEqual([data]);
  });

  it("dispatches setUpToDate when the auto-update UI toast is already visible", () => {
    const data = { version: "1.2.3" };
    const iterator = watchAutoUpdateUpToDateSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getElectronHandler("auto-update:up-to-date")(data);
    const selectEffect = handler.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    // Simulate toastVisible = true → should dispatch setUpToDate
    const putEffect = handler.next(true).value as any;
    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action.type).toBe("autoUpdate/setUpToDate");
  });
});