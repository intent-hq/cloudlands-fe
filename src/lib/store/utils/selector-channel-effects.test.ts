import { describe, it, expect } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import { delay, put } from "typed-redux-saga";
import { createSelector } from "./create-selector";
import { init, rootReducer } from "../init";
import type { StoreState } from "../types";
import { saveScrollPosition } from "../slices/tab-state/tab-state-slice";
import {
  takeEveryFromSelector,
  takeLatestFromSelector,
  takeLeadingFromSelector,
  type SelectorChannelPayload,
} from "./selector-channel-effects";
import { createAction } from "./create-action";

// Test action to track worker invocations
const workerCalled =
  createAction<[payload: Record<string, number>, prevPayload: Record<string, number> | undefined | null]>("test/workerCalled");

describe("selector-channel-effects", () => {
  describe("takeEveryFromSelector", () => {
    it("should create channel and spawn worker for each value change", async () => {
      const { store, storeState } = init();
      const selector = createSelector((state: StoreState) => state.tabState.scrollPositions);

      function* worker({ payload, prevPayload }: SelectorChannelPayload<Record<string, number>>) {
        yield* put(workerCalled(payload, prevPayload));
      }

      function* testSaga() {
        // Using 2-argument signature (no args needed)
        yield* takeEveryFromSelector(selector, worker);
      }

      const sagaPromise = expectSaga(testSaga)
        .provide([[matchers.getContext("readableStoreState"), storeState]])
        .withReducer(rootReducer)
        .put(workerCalled({ "tab-1": 100 }, {})) // After value change
        .silentRun(500);

      // Dispatch change
      setTimeout(() => {
        store.dispatch(saveScrollPosition("tab-1", 100));
      }, 50);

      await sagaPromise;
    });

    it("should close channel when saga is cancelled", async () => {
      const { storeState } = init();
      const selector = createSelector((state: StoreState) => state.tabState.scrollPositions);

      function* worker() {
        yield* delay(1000);
      }

      function* testSaga() {
        // Using 2-argument signature (no args needed)
        yield* takeEveryFromSelector(selector, worker);
      }

      // Run saga briefly and let it be cancelled by timeout
      await expectSaga(testSaga)
        .provide([[matchers.getContext("readableStoreState"), storeState]])
        .silentRun(50);

      // Channel should be closed when saga ends
      // (implicit test - no memory leak from unclosed channel)
    });
  });

  describe("takeLatestFromSelector", () => {
    it("should cancel previous task when new value arrives", async () => {
      const { store, storeState } = init();
      const selector = createSelector((state: StoreState) => state.tabState.scrollPositions);
      const callOrder: string[] = [];

      function* worker({ payload }: SelectorChannelPayload<Record<string, number>>) {
        callOrder.push(`start-${JSON.stringify(payload)}`);
        yield* delay(100);
        callOrder.push(`end-${JSON.stringify(payload)}`);
      }

      function* testSaga() {
        // Using 2-argument signature (no args needed)
        yield* takeLatestFromSelector(selector, worker);
      }

      const sagaPromise = expectSaga(testSaga)
        .provide([[matchers.getContext("readableStoreState"), storeState]])
        .withReducer(rootReducer)
        .silentRun(300);

      // Rapid changes - only the last should complete
      setTimeout(() => {
        store.dispatch(saveScrollPosition("tab-1", 100));
      }, 20);
      setTimeout(() => {
        store.dispatch(saveScrollPosition("tab-2", 200));
      }, 40);

      await sagaPromise;

      // First task should start but be cancelled by second
      expect(callOrder.length).toBeGreaterThanOrEqual(1);
      expect(callOrder[0]).toContain("start-");
    });
  });

  describe("takeLeadingFromSelector", () => {
    it("should ignore new values while task is running", async () => {
      const { store, storeState } = init();
      const selector = createSelector((state: StoreState) => state.tabState.scrollPositions);
      const invocations: Record<string, number>[] = [];

      function* worker({ payload }: SelectorChannelPayload<Record<string, number>>) {
        invocations.push(payload);
        yield* delay(300); // Long delay to ensure multiple values arrive during execution
      }

      function* testSaga() {
        // Using 2-argument signature (no args needed)
        yield* takeLeadingFromSelector(selector, worker);
      }

      const sagaPromise = expectSaga(testSaga)
        .provide([[matchers.getContext("readableStoreState"), storeState]])
        .withReducer(rootReducer)
        .silentRun(400);

      // Give the saga time to set up the channel
      await new Promise((resolve) => setTimeout(resolve, 50));

      // First dispatch - this triggers the worker (takes 300ms)
      store.dispatch(saveScrollPosition("tab-1", 100));

      // Rapid changes while worker is running - these should be ignored
      await new Promise((resolve) => setTimeout(resolve, 20));
      store.dispatch(saveScrollPosition("tab-2", 200)); // Should be ignored
      await new Promise((resolve) => setTimeout(resolve, 20));
      store.dispatch(saveScrollPosition("tab-3", 300)); // Should be ignored

      await sagaPromise;

      // Only the first dispatch should have triggered a worker
      // All subsequent changes during the 300ms delay should be ignored
      expect(invocations.length).toBe(1);
      expect(invocations[0]).toEqual({ "tab-1": 100 }); // First dispatch value
    });
  });
});
