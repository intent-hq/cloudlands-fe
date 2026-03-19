import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => {
  function* call(fn: any, ...args: any[]): Generator<any, any, any> {
    return yield sagaEffects.call(fn, ...args);
  }
  function* put(action: any): Generator<any, any, any> {
    return yield sagaEffects.put(action);
  }
  function* take(pattern: any): Generator<any, any, any> {
    return yield sagaEffects.take(pattern);
  }
  function* delay(ms: number): Generator<any, any, any> {
    return yield sagaEffects.delay(ms);
  }
  return { call, put, take, delay };
});

vi.mock("$lib/electron-bridge", () => ({
  isElectron: vi.fn(() => false),
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  createListenSyncChannel: vi.fn(),
}));

vi.mock("./init-saga", () => ({
  fetchZoomFactor: vi.fn(async () => 1.0),
}));

import { isElectron } from "$lib/electron-bridge";
import { createListenSyncChannel } from "$lib/store/utils/ipc-channel";
import { fetchZoomFactor } from "./init-saga";
import { ipcZoomSaga } from "./ipc-saga";
import { resizeZoomSaga } from "./resize-saga";
import { setZoomFactor } from "../user-preferences-slice";

const mockedIsElectron = vi.mocked(isElectron);
const mockedCreateListenSyncChannel = vi.mocked(createListenSyncChannel);
const mockedFetchZoomFactor = vi.mocked(fetchZoomFactor);

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
    expect(mockedCreateListenSyncChannel).not.toHaveBeenCalled();
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