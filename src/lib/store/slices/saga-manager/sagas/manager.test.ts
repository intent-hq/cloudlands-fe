import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSaga, stdChannel, type Task } from "redux-saga";
import { writable } from "svelte/store";

const mockSentry = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

const mockSagas = vi.hoisted(() => ({
  streamingSaga: vi.fn(),
  workspaceSaga: vi.fn(function* workspaceSaga() {}),
}));

const mockSelectUpdatesLockedEffect = vi.hoisted(() =>
  vi.fn(function* selectUpdatesLockedEffect() {
    return false;
  })
);

const mockUnlockUpdates = vi.hoisted(() => vi.fn(() => ({ type: "unlockUpdates" })));

vi.mock("@sentry/electron/renderer", () => ({
  captureException: mockSentry.captureException,
}));

vi.mock("../../../sagas", () => ({
  sagas: {
    streamingSaga: mockSagas.streamingSaga,
    workspaceSaga: mockSagas.workspaceSaga,
  },
}));

vi.mock("../../store-utility/store-utility-selectors", () => ({
  selectUpdatesLocked: { effect: mockSelectUpdatesLockedEffect },
}));

vi.mock("../../store-utility/store-utility-slice", () => ({
  unlockUpdates: mockUnlockUpdates,
}));

import type { ReduxStoreContext, StoreState } from "../../../types";
import { startSaga, stopSaga } from "../saga-manager-slice";
import { getBackOffDelay, sagaManager } from "./manager";

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createState = () => ({
  storeUtility: {
    updatesLocked: false,
  },
}) as StoreState;

const runSagaManager = (
  exposeContext: (tasks: ReduxStoreContext["tasks"]) => void = vi.fn()
): { channel: ReturnType<typeof stdChannel>; task: Task } => {
  const channel = stdChannel();
  const task = runSaga(
    {
      channel,
      dispatch: vi.fn(),
      getState: createState,
    },
    sagaManager,
    writable(createState()),
    exposeContext
  );

  return { channel, task };
};

describe("getBackOffDelay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T18:00:00.000Z"));
    mockSentry.captureException.mockReset();
    mockSagas.streamingSaga.mockReset();
    mockSagas.workspaceSaga.mockClear();
    mockSelectUpdatesLockedEffect.mockClear();
    mockUnlockUpdates.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps exponential backoff for representative lower retry counts", () => {
    expect(getBackOffDelay(0)).toBe(1000);
    expect(getBackOffDelay(1)).toBe(2000);
    expect(getBackOffDelay(3)).toBe(8000);
    expect(getBackOffDelay(9)).toBe(512000);
  });

  it("caps the restart delay at 10 minutes", () => {
    expect(getBackOffDelay(10)).toBe(600000);
    expect(getBackOffDelay(25)).toBe(600000);
  });

  it("exposes per-saga status records on start and stop", async () => {
    mockSagas.streamingSaga.mockImplementation(function* streamingSaga() {
      yield new Promise(() => undefined);
    });

    const exposeContext = vi.fn();
    const { channel, task } = runSagaManager(exposeContext);

    channel.put(startSaga("streamingSaga"));
    await flushMicrotasks();

    const runningStatus = exposeContext.mock.lastCall?.[0];
    expect(runningStatus?.streamingSaga).toMatchObject({
      isRunning: true,
      crashes: [],
    });
    expect(runningStatus?.streamingSaga.launchedAtTs).toBeTypeOf("number");
    expect(runningStatus?.streamingSaga.launchedAtTs).toBe(Date.now());
    expect(runningStatus?.workspaceSaga).toEqual({
      isRunning: false,
      launchedAtTs: null,
      crashes: [],
    });

    channel.put(stopSaga("streamingSaga"));
    await flushMicrotasks();

    expect(exposeContext.mock.lastCall?.[0]?.streamingSaga).toMatchObject({
      isRunning: false,
      crashes: [],
    });
    expect(exposeContext.mock.lastCall?.[0]?.streamingSaga.launchedAtTs).toBeTypeOf("number");
    expect(exposeContext.mock.lastCall?.[0]?.streamingSaga.launchedAtTs).toBe(Date.now());

    task.cancel();
    await task.toPromise();
  });

  it("records crash history with crash timestamps and Error objects", async () => {
    const crashError = new Error("streaming saga crashed");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    mockSagas.streamingSaga
      .mockImplementationOnce(function* crashingSaga() {
        throw crashError;
      })
      .mockImplementation(function* runningSaga() {
        yield new Promise(() => undefined);
      });

    const exposeContext = vi.fn();
    const { channel, task } = runSagaManager(exposeContext);

    channel.put(startSaga("streamingSaga"));
    await vi.waitFor(() => {
      const latestStatus = exposeContext.mock.lastCall?.[0]?.streamingSaga;
      expect(latestStatus?.crashes).toHaveLength(1);
    });

    const latestStatus = exposeContext.mock.lastCall?.[0]?.streamingSaga;
    expect(latestStatus).toMatchObject({
      isRunning: true,
    });
    expect(latestStatus?.crashes[0]?.error).toBe(crashError);
    expect(latestStatus?.crashes[0]?.crashedAt).toBeInstanceOf(Date);
    expect(mockSentry.captureException).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();

    task.cancel();
    await task.toPromise();
  });

  it("preserves prior crash history across manual stop and restart", async () => {
    const firstCrash = new Error("first crash");
    const secondCrash = new Error("second crash");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    mockSagas.streamingSaga
      .mockImplementationOnce(function* crashingSaga() {
        throw firstCrash;
      })
      .mockImplementation(function* runningSaga() {
        yield new Promise(() => undefined);
      });

    const exposeContext = vi.fn();
    const { channel, task } = runSagaManager(exposeContext);

    channel.put(startSaga("streamingSaga"));
    await vi.waitFor(() => {
      expect(exposeContext.mock.lastCall?.[0]?.streamingSaga?.crashes).toHaveLength(1);
    });

    channel.put(stopSaga("streamingSaga"));
    await flushMicrotasks();

    mockSagas.streamingSaga.mockReset();
    mockSagas.streamingSaga
      .mockImplementationOnce(function* crashingSaga() {
        throw secondCrash;
      })
      .mockImplementation(function* runningSaga() {
        yield new Promise(() => undefined);
      });

    channel.put(startSaga("streamingSaga"));
    await vi.waitFor(() => {
      expect(exposeContext.mock.lastCall?.[0]?.streamingSaga?.crashes).toHaveLength(2);
    });

    expect(exposeContext.mock.lastCall?.[0]?.streamingSaga?.crashes.map((crash) => crash.error)).toEqual([
      firstCrash,
      secondCrash,
    ]);

    task.cancel();
    await task.toPromise();
  });

  it("marks synchronously completed sagas as not running", async () => {
    const exposeContext = vi.fn();
    const { channel, task } = runSagaManager(exposeContext);

    channel.put(startSaga("workspaceSaga"));
    await flushMicrotasks();

    expect(exposeContext.mock.lastCall?.[0]?.workspaceSaga).toMatchObject({
      isRunning: false,
      crashes: [],
    });
    expect(exposeContext.mock.lastCall?.[0]?.workspaceSaga?.launchedAtTs).toBeTypeOf("number");

    task.cancel();
    await task.toPromise();
  });
});