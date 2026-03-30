import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", async () => await import("$lib/store/utils/test-helpers/typed-redux-saga-mock"));

vi.mock("$lib/electron-bridge", async () => await import("$lib/store/utils/test-helpers/electron-bridge-mock"));

vi.mock("$lib/store/utils/ipc-channel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/store/utils/ipc-channel")>();
  return {
    ...actual,
    takeEveryFromListenSync: vi.fn(function* () {}),
  };
});

vi.mock("./init-saga", () => ({
  fetchZoomFactor: vi.fn(async () => 1.0),
}));

import { isElectron } from "$lib/electron-bridge";
import { takeEveryFromListenSync } from "$lib/store/utils/ipc-channel";
import { fetchZoomFactor } from "./init-saga";
import { ipcZoomSaga } from "./ipc-saga";
import { resizeZoomSaga } from "./resize-saga";
import { setZoomFactor } from "../user-preferences-slice";

const mockedIsElectron = vi.mocked(isElectron);
const mockedTakeEveryFromListenSync = vi.mocked(takeEveryFromListenSync);
const mockedFetchZoomFactor = vi.mocked(fetchZoomFactor);

function getListenSyncHandler(eventName: string) {
  const call = mockedTakeEveryFromListenSync.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("user preferences zoom sagas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsElectron.mockReturnValue(false);
    mockedFetchZoomFactor.mockResolvedValue(1.0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips the IPC listener outside Electron", () => {
    const iterator = ipcZoomSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(mockedTakeEveryFromListenSync).not.toHaveBeenCalled();
  });

  it("registers the IPC listener in Electron and updates zoom factor for valid payloads", () => {
    mockedIsElectron.mockReturnValue(true);

    const iterator = ipcZoomSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(mockedTakeEveryFromListenSync).toHaveBeenCalledWith(
      "window:zoom-changed",
      expect.any(Function),
    );
    expect(getListenSyncHandler("window:zoom-changed")({ zoomFactor: 1.25 }).next()).toEqual({
      value: sagaEffects.put(setZoomFactor(1.25)),
      done: false,
    });
  });

  it("skips the resize listener outside Electron", () => {
    const iterator = resizeZoomSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(mockedFetchZoomFactor).not.toHaveBeenCalled();
  });

  it("coalesces a resize burst into a single zoom fetch", async () => {
    vi.useFakeTimers();
    mockedIsElectron.mockReturnValue(true);
    mockedFetchZoomFactor.mockResolvedValue(1.5);

    const dispatched: unknown[] = [];
    const task = runSaga(
      {
        dispatch: (action) => dispatched.push(action),
        getState: () => ({}),
      },
      resizeZoomSaga,
    );

    await Promise.resolve();

    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));

    expect(mockedFetchZoomFactor).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();

    expect(mockedFetchZoomFactor).toHaveBeenCalledTimes(1);
    expect(dispatched).toEqual([setZoomFactor(1.5)]);

    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();

    expect(mockedFetchZoomFactor).toHaveBeenCalledTimes(1);

    task.cancel();
    await task.toPromise();
  });
});