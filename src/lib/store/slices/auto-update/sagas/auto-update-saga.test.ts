import { beforeEach, describe, expect, it, vi } from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  take: function* (patternOrChannel: any) {
    return yield sagaEffects.take(patternOrChannel);
  },
}));

const { takeEveryFromElectronChannelMock, autoUpdateState } = vi.hoisted(() => ({
  takeEveryFromElectronChannelMock: vi.fn(function* () {}),
  autoUpdateState: { toastVisible: false },
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: takeEveryFromElectronChannelMock,
}));

vi.mock("$features/auto-update/auto-update.store.svelte", () => ({
  autoUpdateStore: {
    get toastVisible() {
      return autoUpdateState.toastVisible;
    },
  },
}));

import { autoUpdateSaga, watchAutoUpdateUpToDateSaga } from "./auto-update-saga";

function getElectronHandler(eventName: string) {
  const call = takeEveryFromElectronChannelMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("autoUpdateSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autoUpdateState.toastVisible = false;
    (window as any).electronAPI = { on: vi.fn(), offById: vi.fn() };
  });

  it("forks the up-to-date watcher", () => {
    testSaga(autoUpdateSaga).next().fork(watchAutoUpdateUpToDateSaga).next().isDone();
  });

  it("shows the up-to-date toast when no update toast is visible", () => {
    const data = { version: "1.2.3" };
    const iterator = watchAutoUpdateUpToDateSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromElectronChannelMock).toHaveBeenCalledWith(
      "auto-update:up-to-date",
      expect.any(Function),
    );

    const effect = getElectronHandler("auto-update:up-to-date")(data).next().value as any;
    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual([data]);
  });

  it("skips the toast when the auto-update UI toast is already visible", () => {
    autoUpdateState.toastVisible = true;
    const iterator = watchAutoUpdateUpToDateSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(getElectronHandler("auto-update:up-to-date")({ version: "1.2.3" }).next()).toEqual({
      value: undefined,
      done: true,
    });
  });
});