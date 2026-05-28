import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from "vitest";
import {
  eventChannel,
  runSaga,
} from "redux-saga";

import * as sagaEffects from "redux-saga/effects";

// Mock typed-redux-saga to use real redux-saga effects (same pattern as terminal-overlay tests)
vi.mock("typed-redux-saga", () => {
  function* take(patternOrChannel: any): Generator<any, any, any> {
    return yield sagaEffects.take(patternOrChannel);
  }
  function* fork(fn: any, ...args: any[]): Generator<any, any, any> {
    return yield sagaEffects.fork(fn, ...args);
  }
  function* cancel(task: any): Generator<any, any, any> {
    return yield sagaEffects.cancel(task);
  }
  return { take, fork, cancel };
});

import {
  takeEveryFromChannel,
  takeLatestFromChannel,
} from "./channel-effects";

describe("channel-effects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("takeEveryFromChannel", () => {
    it("calls worker for each channel event", async () => {
      const workerCalls: string[] = [];
      let emitter: ((value: string) => void) | null = null;

      const channel = eventChannel<string>((emit) => {
        emitter = emit;
        return () => {};
      });

      function* worker(data: string) {
        workerCalls.push(data);
      }

      function* rootSaga() {
        yield* takeEveryFromChannel(channel, worker);
      }

      const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, rootSaga);

      // Emit events
      emitter!("first");
      emitter!("second");
      emitter!("third");

      // Allow microtasks to flush
      await new Promise((r) => setTimeout(r, 10));

      expect(workerCalls).toEqual(["first", "second", "third"]);

      task.cancel();
      await task.toPromise();
    });

    it("closes the channel when the saga is cancelled", async () => {
      const channel = eventChannel<never>(() => () => {});
      const originalClose = channel.close.bind(channel);
      const closeSpy = vi.fn(() => originalClose());
      (channel as any).close = closeSpy;

      function* worker() {}

      function* rootSaga() {
        yield* takeEveryFromChannel(channel, worker);
      }

      const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, rootSaga);

      task.cancel();
      await task.toPromise();

      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it("stops processing when channel is closed (END)", async () => {
      const workerCalls: string[] = [];
      let emitter: ((value: string) => void) | null = null;

      const channel = eventChannel<string>((emit) => {
        emitter = emit;
        return () => {};
      });

      function* worker(data: string) {
        workerCalls.push(data);
      }

      function* rootSaga() {
        yield* takeEveryFromChannel(channel, worker);
      }

      const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, rootSaga);

      emitter!("before-close");
      await new Promise((r) => setTimeout(r, 0));

      // Close the channel — next take() should yield END
      channel.close();
      await new Promise((r) => setTimeout(r, 0));

      // Worker should have run for the event before close
      expect(workerCalls).toEqual(["before-close"]);
      // Task should have completed (not hanging in while loop)
      expect(task.isRunning()).toBe(false);
    });
  });

  describe("takeLatestFromChannel", () => {
    it("calls worker for each channel event and cancels previous", async () => {
      const workerCalls: number[] = [];
      const completedWorkers: number[] = [];
      const cancelledWorkers: number[] = [];
      let emitter: ((value: number) => void) | null = null;

      const channel = eventChannel<number>((emit) => {
        emitter = emit;
        return () => {};
      });

      function* worker(data: number) {
        workerCalls.push(data);
        try {
          yield sagaEffects.delay(10000);
          completedWorkers.push(data);
        } finally {
          if (yield sagaEffects.cancelled()) {
            cancelledWorkers.push(data);
          }
        }
      }

      function* rootSaga() {
        yield* takeLatestFromChannel(channel, worker);
      }

      const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, rootSaga);

      emitter!(1);
      emitter!(2);
      await new Promise((r) => setTimeout(r, 0));

      // Both workers started
      expect(workerCalls).toEqual([1, 2]);
      // First worker was cancelled (positive proof of cancellation)
      expect(cancelledWorkers).toContain(1);
      // Second worker was not cancelled
      expect(cancelledWorkers).not.toContain(2);

      task.cancel();
      await task.toPromise();
    });

    it("closes the channel when the saga is cancelled", async () => {
      const channel = eventChannel<never>(() => () => {});
      const originalClose = channel.close.bind(channel);
      const closeSpy = vi.fn(() => originalClose());
      (channel as any).close = closeSpy;

      function* worker() {}

      function* rootSaga() {
        yield* takeLatestFromChannel(channel, worker);
      }

      const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, rootSaga);

      task.cancel();
      await task.toPromise();

      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it("stops processing when channel is closed (END)", async () => {
      const workerCalls: string[] = [];
      let emitter: ((value: string) => void) | null = null;

      const channel = eventChannel<string>((emit) => {
        emitter = emit;
        return () => {};
      });

      function* worker(data: string) {
        workerCalls.push(data);
      }

      function* rootSaga() {
        yield* takeLatestFromChannel(channel, worker);
      }

      const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, rootSaga);

      emitter!("before-close");
      await new Promise((r) => setTimeout(r, 0));

      // Close the channel — next take() should yield END
      channel.close();
      await new Promise((r) => setTimeout(r, 0));

      // Worker should have run for the event before close
      expect(workerCalls).toEqual(["before-close"]);
      // Task should have completed (not hanging in while loop)
      expect(task.isRunning()).toBe(false);
    });
  });
});
